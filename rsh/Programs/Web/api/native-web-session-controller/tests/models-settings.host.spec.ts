import { expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSettings } from '@deepseek-ai/dsh-llm-pi-ai/native'
import type {} from '@deepseek-ai/dsh-llm-pi-ai/native'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import { NativeSettings } from '@deepseek-ai/dsh-settings/native'
import { NativeWebModels } from '../src/models.ts'
import { NativeWebSettingsEvents } from '../src/settings-events.ts'

it('dispatches model directory and discovery RPCs with safe failure results', async () => {
  const providers = [{ id: 'openai', name: 'OpenAI', hidden: true }]
  const configurable = [{ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }]
  const discovered = [{ id: 'gpt-test', name: 'GPT Test', contextWindow: 128_000, maxTokens: 4_096 }]
  const discover = vi.fn(async () => discovered)
  const modelSettings: NativeModelSettings = {
    configurableProviders: () => configurable,
    discover,
  }
  const directory = { providers: () => providers } as unknown as NativeModelDirectory
  const host = new NativeWebModels(directory, modelSettings)
  const signal = new AbortController().signal

  expect(await host.handle('models/providers', {}, signal)).toEqual({
    ok: true, value: [{ id: 'openai', name: 'OpenAI' }],
  })
  expect(await host.handle('models/configurable-providers', {}, signal)).toEqual({ ok: true, value: configurable })
  expect(await host.handle('models/discover', {
    settingsNs: 'llm-pi-ai', request: { baseURL: 'https://gateway.example/v1', apiKey: 'one-request-secret' },
  }, signal)).toEqual({ ok: true, value: discovered })
  expect(discover).toHaveBeenCalledWith(
    'llm-pi-ai', { baseURL: 'https://gateway.example/v1', apiKey: 'one-request-secret' }, signal,
  )

  const unavailable = new NativeWebModels(undefined, undefined)
  expect(await unavailable.handle('models/providers', {}, signal)).toEqual({ ok: true, value: [] })
  expect(await unavailable.handle('models/configurable-providers', {}, signal)).toEqual({ ok: true, value: [] })
  const brokenDirectory = { providers() { throw new Error('private directory details') } } as unknown as NativeModelDirectory
  expect(await new NativeWebModels(brokenDirectory, undefined).handle('models/providers', {}, signal)).toMatchObject({
    ok: false, error: { code: 'native/models-directory', message: 'Model directory request failed.' },
  })
  const failed = await unavailable.handle('models/discover', {
    settingsNs: 'llm-pi-ai', request: { baseURL: 'https://gateway.example/v1', apiKey: 'one-request-secret' },
  }, signal)
  expect(failed).toMatchObject({ ok: false, error: { code: 'native/models-discovery', message: 'Model discovery failed.' } })
  expect(JSON.stringify(failed)).not.toContain('one-request-secret')
})

it('streams settings, credential and adapter invalidations and closes on abort', async () => {
  const scope = new NativeScope()
  let stream: NativeWebSettingsEvents | undefined
  const publisher: NativePlugin = {
    apiVersion: 1, name: 'settings-events-test-publisher', targets: ['host'], requires: [], provides: ['application'],
    resolve: () => (context) => {
      stream = new NativeWebSettingsEvents(context)
      context.own(() => stream!.close())
      context.provide('application', { run: async () => 0 })
    },
  }
  const host = new NativeHost(resolveInstallation([{ plugin: publisher, scope, config: undefined }], 'host'))
  let settings: NativeSettings | undefined
  const requestSignal = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    await host.start()
    let document: Record<string, unknown> = {}
    let documentUpdated = Promise.resolve()
    settings = new NativeSettings({
      load: async () => document,
      persist: async (update) => { document = update(document); return document },
    }, (namespace, revision) => {
      documentUpdated = host.events.parallel(scope, 'settings/document-updated', namespace, revision)
    })
    await settings.start()
    const owner = settings.register('llm-pi-ai', { providers: {} }, value => value)
    const response = await stream!.stream(new Request('http://localhost/api/native-session/settings-events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: requestSignal.signal,
    }))
    reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const decoder = new TextDecoder()
    const readFrame = async (): Promise<unknown> => {
      const result = await reader!.read()
      expect(result.done).toBe(false)
      return JSON.parse(decoder.decode(result.value).slice(6).trim())
    }

    await owner.update({ providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } }, 0)
    await documentUpdated
    expect(await readFrame()).toEqual({ type: 'settings/document-updated', namespace: 'llm-pi-ai', revision: 1 })
    await host.events.parallel(scope, 'credentials/reference-updated', credentialRef('OPENAI_API_KEY'))
    expect(await readFrame()).toEqual({ type: 'credentials/reference-updated', ref: 'OPENAI_API_KEY' })
    await host.events.parallel(scope, 'llm/adapters-updated')
    expect(await readFrame()).toEqual({ type: 'llm/adapters-updated' })
    await host.events.parallel(scope, 'accounts/changed', 'llm-pi-ai/openai-codex')
    expect(await readFrame()).toEqual({ type: 'accounts/changed', key: 'llm-pi-ai/openai-codex' })

    requestSignal.abort()
    expect((await reader!.read()).done).toBe(true)
  } finally {
    requestSignal.abort()
    await reader?.cancel()
    await settings?.dispose()
    await host.stop()
  }
})
