/** The native Perplexity provider keeps the Cordis configuration, key fallback, and request shape. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { plugin as webPlugin, type NativeWebOperation, type NativeWebService } from '@deepseek-ai/dsh-web/native'
import { plugin } from '../src/native.ts'

const hosts: NativeHost[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const host of hosts.splice(0)) await host.stop()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function operation(signal = new AbortController().signal): NativeWebOperation {
  return { signal, appendEvent: () => Promise.reject(new Error('unexpected event')) }
}

/** Boot native web with the Perplexity provider; fetch is mocked so nothing reaches the network. */
async function boot(config: unknown, processValues: Record<string, string> = {}) {
  const scope = new NativeScope()
  let web!: NativeWebService
  const capture: NativePlugin = {
    apiVersion: 1, name: 'perplexity-capture', targets: ['host'], requires: ['web'], provides: [],
    resolve: () => (context) => { web = context.require('web') },
  }
  const provider = { plugin, scope, config }
  const host = new NativeHost(resolveInstallation([
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([{ source: 'process', values: processValues }])), scope, config: undefined },
    { plugin: webPlugin, scope, config: { searchProvider: 'perplexity' } },
    { plugin: capture, scope, config: undefined },
    provider,
  ], 'host'))
  hosts.push(host)
  await host.start()
  return { web, remove: () => host.remove(provider) }
}

describe('native web-search-perplexity', () => {
  it('searches with the launch-environment key and the configured endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ choices: [{ message: { content: 'the answer' } }], search_results: [{ url: 'https://a.test', title: 'A' }] }))
    const bench = await boot({ baseURL: 'https://api.perplexity.test' }, { PERPLEXITY_API_KEY: 'env-key' })
    const result = await bench.web.search({ query: 'hello', maxResults: 5 }, operation())
    expect(result.sources).toEqual([{ url: 'https://a.test', title: 'A' }])
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.perplexity.test/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
  })

  it('prefers a configured key and reports the pinned provider unavailable without one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ choices: [{ message: { content: 'the answer' } }], search_results: [{ url: 'https://a.test', title: 'A' }] }))
    const configured = await boot({ apiKey: 'config-key', baseURL: 'https://api.perplexity.test' }, { PERPLEXITY_API_KEY: 'env-key' })
    await configured.web.search({ query: 'hello' }, operation())
    expect(((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['authorization']).toBe('Bearer config-key')
    const missing = await boot(undefined)
    await expect(missing.web.search({ query: 'hello' }, operation())).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })

  it('removal cancels an admitted search and unregisters the provider', async () => {
    const started = Promise.withResolvers<undefined>()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      started.resolve(undefined)
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason as Error) }, { once: true })
    }))
    const bench = await boot({ apiKey: 'config-key', baseURL: 'https://api.perplexity.test' })
    const rejected = expect(bench.web.search({ query: 'slow' }, operation())).rejects.toThrow()
    await started.promise
    await bench.remove()
    await rejected
    await expect(bench.web.search({ query: 'again' }, operation())).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it.each([
    [{ unknown: 1 }, /unknown native configuration field unknown/],
    ['nope', /native configuration must be an object/],
  ])('rejects invalid configuration %j', (config, message) => {
    expect(() => plugin.resolve(config)).toThrow(message)
  })
})
