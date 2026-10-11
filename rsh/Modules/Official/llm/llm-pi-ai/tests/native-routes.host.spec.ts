import { describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialRecord, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { NativeSettings, type NativeSettingsSection } from '../../../settings/settings/src/native.ts'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSettings } from '../src/model-settings.ts'
import { plugin as piAi } from '../src/native.ts'
import type { DeepSeekAccount } from '../../../credentials/deepseek-account/src/native.ts'
import { plugin as deepseekAccount } from '../../../credentials/deepseek-account/src/native.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const DEEPSEEK_KEY = credentialKey('deepseek-account', 'default')
const CUSTOM_DEEPSEEK_ORIGIN = 'https://gateway.deepseek.example'
const CUSTOM_DEEPSEEK_BASE_URL = `${CUSTOM_DEEPSEEK_ORIGIN}/anthropic`
const codexGrantPayload = () => ({
  type: 'oauth', access: 'fixture-codex-access', refresh: 'fixture-codex-refresh', expires: Date.now() + 3_600_000,
  siwc: 'chatgpt-plan', clientId: 'fixture-client', issuer: 'https://auth.openai.com',
  subject: 'fixture-subject', idToken: 'fixture-id-token', extAgentHostId: 'fixture-agent',
  scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
})
const cases = [
  { provider: 'openai-codex', key: CODEX_KEY, account: false, profile: 'default', inferenceOrigin: undefined, baseURL: undefined },
  { provider: 'deepseek-account', key: DEEPSEEK_KEY, account: true, profile: 'default', inferenceOrigin: undefined, baseURL: undefined },
  {
    provider: 'deepseek-account', key: DEEPSEEK_KEY, account: true, profile: 'custom origin',
    inferenceOrigin: CUSTOM_DEEPSEEK_ORIGIN, baseURL: CUSTOM_DEEPSEEK_BASE_URL,
  },
] as const

describe('native account model routes', () => {
  it.each(cases)('keeps $provider routes current across startup and credential updates ($profile)', async ({
    provider, key, account, inferenceOrigin, baseURL,
  }) => {
    const records = new Map<string, CredentialRecord>()
    let apiKeyConfigured = false
    let apiKeyRecordConfigured = false
    let releaseAccountSnapshot!: () => void
    let enterAccountSnapshot!: () => void
    const accountSnapshotEntered = new Promise<void>((resolve) => { enterAccountSnapshot = resolve })
    const accountSnapshotGate = new Promise<void>((resolve) => { releaseAccountSnapshot = resolve })
    const waitForInitialAccountSnapshot = account && inferenceOrigin === undefined
    let holdInitialAccountSnapshot = waitForInitialAccountSnapshot
    let model: NativeModel | undefined
    let directory: NativeModelDirectory | undefined
    let modelSettings: NativeModelSettings | undefined
    let accountService: DeepSeekAccount | undefined
    let settingsDocument: NativeSettingsSection = {}
    const settings = new NativeSettings({
      load: async () => settingsDocument,
      persist: async (update) => { settingsDocument = update(settingsDocument); return settingsDocument },
    })
    await settings.start()
    const credentials = {
      async resolve(ref: string) {
        return apiKeyConfigured && ref === 'OPENAI_API_KEY'
          ? { value: 'fixture-api-key', source: 'store' }
          : undefined
      },
      async describe() { return { configured: false, writable: false } },
      async readRecord(recordKey: string) {
        const record = records.get(recordKey)
        if (holdInitialAccountSnapshot && recordKey === DEEPSEEK_KEY) {
          holdInitialAccountSnapshot = false
          enterAccountSnapshot()
          await accountSnapshotGate
        }
        return record
      },
      async describeRecord(recordKey: string) {
        const record = records.get(recordKey)
        return record === undefined
          ? { configured: false, writable: true }
          : { configured: true, kind: record.kind, writable: true }
      },
      async listRecords() {
        return apiKeyRecordConfigured
          ? [{ key: credentialKey('llm-pi-ai', 'openai'), kind: 'api-key' as const }]
          : []
      },
      async modifyRecord() { return undefined },
      async deleteRecord() {},
      async set() {},
      async unset() {},
    } as unknown as NativeCredentials
    const services: NativePlugin = {
      apiVersion: 1, name: 'native-route-fixtures', targets: ['host'], requires: [],
      provides: ['credentials', 'launchEnvironment', 'settings'],
      resolve: () => (context) => {
        context.provide('credentials', credentials)
        context.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
        context.provide('settings', settings)
      },
    }
    const observer: NativePlugin = {
      apiVersion: 1, name: 'native-route-observer', targets: ['host'],
      requires: ['model', 'modelDirectory', 'modelSettings'], optional: ['deepseekAccount'], provides: [],
      resolve: () => (context) => {
        model = context.require('model')
        directory = context.require('modelDirectory')
        modelSettings = context.require('modelSettings')
        accountService = context.optional('deepseekAccount')
      },
    }
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: services, scope, config: undefined },
      ...(account ? [{ plugin: deepseekAccount, scope, config: inferenceOrigin === undefined ? undefined : { inferenceOrigin } }] : []),
      {
        plugin: piAi, scope,
        config: {
          providers: {
            openai: {}, deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
            ...(baseURL === undefined ? {} : {
              'deepseek-account': {
                api: 'anthropic-messages', baseURL, models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }],
              },
            }),
          },
        },
      },
      { plugin: observer, scope, config: undefined },
    ], 'host'))
    const publishAccountGrants = async () => {
      records.set(CODEX_KEY, { kind: 'grant', payload: codexGrantPayload() })
      records.set(DEEPSEEK_KEY, {
        kind: 'grant', payload: { version: 1, token: 'fixture-account-value', issuer: 'https://platform.deepseek.com' },
      })
      await host.events.parallel(scope, 'credentials/record-updated', CODEX_KEY)
      await host.events.parallel(scope, 'credentials/record-updated', DEEPSEEK_KEY)
    }

    let starting: Promise<void> | undefined
    try {
      starting = host.start()
      if (waitForInitialAccountSnapshot) {
        await Promise.race([
          accountSnapshotEntered,
          starting.then(() => { throw new Error('Host startup completed before the account snapshot barrier') }),
        ])
        await publishAccountGrants()
        await settings.mutate('llm-pi-ai', [
          { op: 'set', path: ['providers', 'openai', 'displayName'], value: 'Startup settings update' },
        ], 0)
        releaseAccountSnapshot()
      }
      await starting
      if (account && !waitForInitialAccountSnapshot) await publishAccountGrants()
      if (account) {
        expect(directory?.providers().map(row => row.id)).toContain('openai-codex')
        if (waitForInitialAccountSnapshot) {
          expect(modelSettings?.configurableProviders().find(row => row.provider === 'openai')?.displayName)
            .toBe('Startup settings update')
        }
      } else {
        expect(directory?.providers().map(row => row.id)).not.toContain(provider)
        records.set(key, { kind: 'grant', payload: codexGrantPayload() })
        await host.events.parallel(scope, 'credentials/record-updated', key)
      }
      expect(directory?.providers().map(row => row.id)).toContain(provider)
      expect(modelSettings?.configurableProviders().map(row => row.provider)).toContain(provider)
      if (account) {
        const acceptedBaseURL = baseURL ?? 'https://api.deepseek.com/anthropic'
        expect(await accountService?.resolveToken(acceptedBaseURL)).toBe('fixture-account-value')
        if (inferenceOrigin !== undefined) {
          expect(await accountService?.resolveToken('https://api.deepseek.com/anthropic')).toBeUndefined()
        }
        expect(await accountService?.resolveToken('https://attacker.example/anthropic')).toBeUndefined()
        const requestHeaders: Headers[] = []
        let recordingInference = false
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (url === 'https://api.openai.com/v1/models') {
            return new Response(JSON.stringify({ models: [
              { slug: 'fixture-codex-model', display_name: 'Fixture Codex model', visibility: 'list' },
            ] }), { headers: { 'content-type': 'application/json' } })
          }
          if (recordingInference) requestHeaders.push(new Headers(init?.headers))
          return recordingInference
            ? new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
            : new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })
        }))
        try {
          const catalog = await directory?.catalog({ provider, model: 'deepseek-flash' }, new AbortController().signal)
          expect(catalog?.groups.find(group => group.id === provider)?.models.map(model => model.id)).toEqual([
            'deepseek-flash', 'deepseek-v4-pro',
          ])
          if (model === undefined) throw new Error('native model fixture missing')
          recordingInference = true
          for await (const _chunk of model.stream({ provider, model: 'deepseek-flash', messages: [] })) { /* drain */ }
          recordingInference = false
          expect(requestHeaders).toHaveLength(1)
          expect(requestHeaders[0]?.has('x-dsh-auth-token')).toBe(true)
          expect(requestHeaders[0]?.has('authorization')).toBe(true)
          expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal))
            .toEqual({ provider, model: 'deepseek-flash' })
          if (baseURL !== undefined) {
            const updateDeepSeekBaseURL = async (nextBaseURL: string) => {
              const revision = settings.describe().find(row => row.namespace === 'llm-pi-ai')?.revision
              if (revision === undefined) throw new Error('native settings fixture missing llm-pi-ai revision')
              await settings.mutate('llm-pi-ai', [
                { op: 'set', path: ['providers', 'deepseek-account', 'baseURL'], value: nextBaseURL },
              ], revision)
            }
            await updateDeepSeekBaseURL('https://attacker.example/anthropic')
            expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal))
              .toEqual({ provider: 'openai-codex', model: 'fixture-codex-model' })
            await updateDeepSeekBaseURL(baseURL)
            expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal))
              .toEqual({ provider, model: 'deepseek-flash' })
          }
          apiKeyConfigured = true
          expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal)).toBeUndefined()
          apiKeyConfigured = false
          apiKeyRecordConfigured = true
          expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal)).toBeUndefined()
          apiKeyRecordConfigured = false
          records.delete(key)
          await host.events.parallel(scope, 'credentials/record-updated', key)
          if (baseURL === undefined) expect(directory?.providers().map(row => row.id)).not.toContain(provider)
          else expect(directory?.providers().map(row => row.id)).toContain(provider)
          expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal))
            .toEqual({ provider: 'openai-codex', model: 'fixture-codex-model' })
          records.set(key, {
            kind: 'grant', payload: { version: 1, token: 'fixture-account-value', issuer: 'https://platform.deepseek.com' },
          })
          await host.events.parallel(scope, 'credentials/record-updated', key)
          expect(directory?.providers().map(row => row.id)).toContain(provider)
        } finally {
          vi.unstubAllGlobals()
        }
      } else {
        if (modelSettings === undefined) throw new Error('native model settings fixture missing')
        const fetch = vi.fn(async () => new Response('{}', { status: 503 }))
        vi.stubGlobal('fetch', fetch)
        try {
          await expect(modelSettings.firstAvailableAccountModel(new AbortController().signal))
            .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
        } finally {
          vi.unstubAllGlobals()
        }
        expect(fetch).toHaveBeenCalledOnce()
      }
    } finally {
      releaseAccountSnapshot()
      await starting?.catch(() => undefined)
      await host.stop()
      await settings.dispose()
    }
  })
})
