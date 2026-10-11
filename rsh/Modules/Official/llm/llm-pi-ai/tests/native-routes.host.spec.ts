import { describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialRecord, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSettings } from '../src/model-settings.ts'
import { plugin as piAi } from '../src/native.ts'
import { plugin as deepseekAccount } from '../../../credentials/deepseek-account/src/native.ts'

const CODEX_KEY = credentialKey('llm-pi-ai', 'openai-codex')
const DEEPSEEK_KEY = credentialKey('deepseek-account', 'default')
const cases = [
  { provider: 'openai-codex', key: CODEX_KEY, account: false },
  { provider: 'deepseek-account', key: DEEPSEEK_KEY, account: true },
] as const

describe('native account model routes', () => {
  it.each(cases)('adds $provider after its credential is available', async ({ provider, key, account }) => {
    const records = new Map<string, CredentialRecord>()
    let apiKeyConfigured = false
    let apiKeyRecordConfigured = false
    let model: NativeModel | undefined
    let directory: NativeModelDirectory | undefined
    let modelSettings: NativeModelSettings | undefined
    const credentials = {
      async resolve(ref: string) {
        return apiKeyConfigured && ref === 'OPENAI_API_KEY'
          ? { value: 'fixture-api-key', source: 'store' }
          : undefined
      },
      async describe() { return { configured: false, writable: false } },
      async readRecord(recordKey: string) { return records.get(recordKey) },
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
      provides: ['credentials', 'launchEnvironment'],
      resolve: () => (context) => {
        context.provide('credentials', credentials)
        context.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
      },
    }
    const observer: NativePlugin = {
      apiVersion: 1, name: 'native-route-observer', targets: ['host'],
      requires: ['model', 'modelDirectory', 'modelSettings'], provides: [],
      resolve: () => (context) => {
        model = context.require('model')
        directory = context.require('modelDirectory')
        modelSettings = context.require('modelSettings')
      },
    }
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: services, scope, config: undefined },
      ...(account ? [{ plugin: deepseekAccount, scope, config: undefined }] : []),
      { plugin: piAi, scope, config: { providers: { openai: {}, deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } } } },
      { plugin: observer, scope, config: undefined },
    ], 'host'))

    try {
      await host.start()
      expect(directory?.providers().map(row => row.id)).not.toContain(provider)
      records.set(key, account
        ? { kind: 'grant', payload: { version: 1, token: 'fixture-account-value', issuer: 'https://platform.deepseek.com' } }
        : { kind: 'grant', payload: {
          type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: Date.now() + 3_600_000,
          siwc: 'chatgpt-plan', clientId: 'fixture-client', issuer: 'https://auth.openai.com',
          subject: 'fixture-subject', idToken: 'fixture-id-token', extAgentHostId: 'fixture-agent',
          scopes: ['chatgpt.tokens.use.direct'],
        } })
      await host.events.parallel(scope, 'credentials/record-updated', key)
      expect(directory?.providers().map(row => row.id)).toContain(provider)
      expect(modelSettings?.configurableProviders().map(row => row.provider)).toContain(provider)
      if (account) {
        const catalog = await directory?.catalog({ provider, model: 'deepseek-flash' }, new AbortController().signal)
        expect(catalog?.groups.find(group => group.id === provider)?.models.map(model => model.id)).toEqual([
          'deepseek-flash', 'deepseek-v4-pro',
        ])
        const requestHeaders: Headers[] = []
        vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestHeaders.push(new Headers(init?.headers))
          return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
        })
        try {
          if (model === undefined) throw new Error('native model fixture missing')
          for await (const _chunk of model.stream({ provider, model: 'deepseek-flash', messages: [] })) { /* drain */ }
        } finally {
          vi.unstubAllGlobals()
        }
        expect(requestHeaders).toHaveLength(1)
        expect(requestHeaders[0]?.has('x-dsh-auth-token')).toBe(true)
        expect(requestHeaders[0]?.has('authorization')).toBe(true)
        expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal)).toEqual({ provider, model: 'deepseek-flash' })
        apiKeyConfigured = true
        expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal)).toBeUndefined()
        apiKeyConfigured = false
        apiKeyRecordConfigured = true
        expect(await modelSettings?.firstAvailableAccountModel(new AbortController().signal)).toBeUndefined()
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
      await host.stop()
    }
  })
})
