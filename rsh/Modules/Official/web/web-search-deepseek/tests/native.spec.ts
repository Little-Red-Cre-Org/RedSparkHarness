/** The native DeepSeek provider keeps the Cordis settings, credential, and request-recording behavior. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSettingsService } from '@deepseek-ai/dsh-settings-definition/native'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { plugin as fileSettings } from '@deepseek-ai/dsh-settings-file/native'
import { plugin as webPlugin, type NativeWebOperation, type NativeWebService } from '@deepseek-ai/dsh-web/native'
import { plugin } from '../src/native.ts'

/** The URL a mocked `fetch` call targeted. */
function requestUrl(call: Parameters<typeof fetch> | undefined): string | undefined {
  const input = call?.[0]
  if (input === undefined) return undefined
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const ONE_RESULT = {
  content: [
    { type: 'text', text: 'ok' },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A' }] },
  ],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

interface Bench {
  web: NativeWebService
  settings: NativeSettingsService | undefined
  remove(): Promise<void>
  stop(): Promise<void>
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Boot native web with the DeepSeek provider; no request leaves the process because fetch is mocked. */
async function boot(options: {
  config?: unknown
  processValues?: Record<string, string>
  credential?: string
  withSettings?: boolean
}): Promise<Bench> {
  const scope = new NativeScope()
  let web!: NativeWebService
  let settings: NativeSettingsService | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'deepseek-capture', targets: ['host'], requires: ['web'], optional: ['settings'], provides: [],
    resolve: () => (context) => { web = context.require('web'); settings = context.optional('settings') },
  }
  const credentials: NativePlugin = {
    apiVersion: 1, name: 'credential-fixture', targets: ['host'], requires: [], provides: ['credentials'],
    resolve: () => (context) => {
      context.provide('credentials', {
        resolve: (ref: string) => Promise.resolve(ref === 'DEEPSEEK_API_KEY' && options.credential !== undefined
          ? { value: options.credential, source: 'fixture' } : undefined),
      } as never)
    },
  }
  const installations = [
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([{ source: 'process', values: options.processValues ?? {} }])), scope, config: undefined },
    { plugin: webPlugin, scope, config: undefined },
    { plugin: capture, scope, config: undefined },
  ]
  if (options.credential !== undefined) installations.push({ plugin: credentials, scope, config: undefined })
  if (options.withSettings === true) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-deepseek-search-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    installations.push({ plugin: fileSettings, scope, config: { path: join(root, 'settings.yaml'), watch: false } as never })
  }
  const deepseek = { plugin, scope, config: options.config }
  const host = new NativeHost(resolveInstallation([...installations, deepseek], 'host'))
  await host.start()
  cleanups.push(() => host.stop())
  return { web, settings, remove: () => host.remove(deepseek), stop: () => host.stop() }
}

function recorder(order: string[]): NativeWebOperation & { events: { type: string; data: unknown }[] } {
  const events: { type: string; data: unknown }[] = []
  return {
    events, signal: new AbortController().signal,
    appendEvent: (async (type: string, data: unknown) => { order.push(`event:${type}`); events.push({ type, data }) }) as never,
  }
}

describe('native web-search-deepseek', () => {
  it('records the secret-free request before dispatch and resolves the key from the launch environment', async () => {
    const order: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      order.push('fetch'); return jsonResponse(ONE_RESULT)
    })
    const bench = await boot({ config: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, processValues: { DEEPSEEK_API_KEY: 'env-key', DEEPSEEK_SEARCH_BASE_URL: 'https://search.env.test/v1' } })
    const operation = recorder(order)
    const result = await bench.web.search({ query: 'news' }, operation)
    expect(result.sources).toEqual([{ url: 'https://a.test', title: 'A' }])
    expect(order).toEqual(['event:web/deepseek-search-llm-request', 'fetch'])
    expect(requestUrl(fetchSpy.mock.calls[0])).toBe('https://search.env.test/v1/messages')
    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-key')).toBe('env-key')
    const [event] = operation.events
    expect(event?.type).toBe('web/deepseek-search-llm-request')
    expect(JSON.stringify(event?.data)).not.toContain('env-key')
    expect(event?.data).toMatchObject({ endpoint: 'https://search.env.test/v1/messages', apiVersion: '2023-06-01' })
  })

  it('prefers the selected credential service over the launch environment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(ONE_RESULT))
    const bench = await boot({ processValues: { DEEPSEEK_API_KEY: 'env-key' }, credential: 'cred-key' })
    await bench.web.search({ query: 'news' }, recorder([]))
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('cred-key')
  })

  it('does not dispatch when recording fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(ONE_RESULT))
    const bench = await boot({ config: { apiKey: 'literal' } })
    await expect(bench.web.search({ query: 'news' }, {
      signal: new AbortController().signal, appendEvent: () => Promise.reject(new Error('log unavailable')),
    })).rejects.toThrow('log unavailable')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails with the Cordis credential error, before recording or dispatch, without a key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(ONE_RESULT))
    const bench = await boot({})
    const operation = recorder([])
    await expect(bench.web.search({ query: 'news' }, operation)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(operation.events).toEqual([])
  })

  it('serves a stored settings endpoint to the next search without re-registering', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(ONE_RESULT))
    const bench = await boot({ config: { apiKey: 'literal', baseURL: 'https://search.entry.test/v1' }, withSettings: true })
    await bench.web.search({ query: 'one' }, recorder([]))
    expect(requestUrl(fetchSpy.mock.calls.at(-1))).toBe('https://search.entry.test/v1/messages')
    const descriptor = bench.settings?.describe().find(entry => entry.namespace === 'web-search-deepseek')
    expect(descriptor).toMatchObject({ applies: 'live', base: { baseURL: 'https://search.entry.test/v1' } })
    expect(JSON.stringify(descriptor)).not.toContain('literal')
    await bench.settings?.mutate('web-search-deepseek', [{ op: 'set', path: ['baseURL'], value: 'https://search.stored.test/v1' }], descriptor?.revision ?? 0)
    await bench.web.search({ query: 'two' }, recorder([]))
    expect(requestUrl(fetchSpy.mock.calls.at(-1))).toBe('https://search.stored.test/v1/messages')
  })

  it('removal cancels an admitted search and unregisters the provider', async () => {
    const started = Promise.withResolvers<undefined>()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      started.resolve(undefined)
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason as Error) }, { once: true })
    }))
    const bench = await boot({ config: { apiKey: 'literal' } })
    const pending = bench.web.search({ query: 'slow' }, recorder([]))
    const rejected = expect(pending).rejects.toThrow()
    await started.promise
    await bench.remove()
    await rejected
    await expect(bench.web.search({ query: 'again' }, recorder([]))).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })

  it.each([
    [{ unknown: 1 }, /unknown native configuration field unknown/],
    ['nope', /native configuration must be an object/],
  ])('rejects invalid configuration %j', (config, message) => {
    expect(() => plugin.resolve(config)).toThrow(message)
  })
})
