/** The native web service keeps Cordis provider selection, pins and caps, and drains removed providers. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import {
  createNativeWebService,
  plugin,
  resolveNativeWebConfig,
  type NativeWebOperation,
  type NativeWebSearchProvider,
  type NativeWebService,
} from '../src/native.ts'

function operation(signal = new AbortController().signal): NativeWebOperation {
  return { signal, appendEvent: () => Promise.reject(new Error('unexpected event')) }
}

function searchProvider(id: string, available = true, sources = [{ url: `https://${id}.test` }]): NativeWebSearchProvider {
  return { id, available: () => available, search: () => Promise.resolve({ sources, truncated: false }) }
}

/** Start `web` with a process-layer environment and capture the provided service. */
async function startWeb(config: unknown, processValues: Record<string, string> = {}) {
  const scope = new NativeScope()
  let web!: NativeWebService
  const capture: NativePlugin = {
    apiVersion: 1, name: 'web-capture', targets: ['host'], requires: ['web'], provides: [],
    resolve: () => (context) => { web = context.require('web') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([
      { source: 'process', values: processValues },
      { source: 'user-env', path: '/home/user/.env', values: { DSH_WEB_SEARCH_PROVIDER: 'from-user-env' } },
    ])), scope, config: undefined },
    { plugin, scope, config },
    { plugin: capture, scope, config: undefined },
  ], 'host'))
  await host.start()
  return { web, stop: () => host.stop() }
}

describe('native web service', () => {
  it('auto-selects one usable provider and caps sources to the request bound', async () => {
    const web = createNativeWebService({})
    const disposers = [
      web.registerSearchProvider(searchProvider('off', false)),
      web.registerSearchProvider(searchProvider('on', true, [{ url: 'https://1.test' }, { url: 'https://2.test' }])),
    ]
    expect(await web.search({ query: 'q', maxResults: 1 }, operation())).toEqual({ sources: [{ url: 'https://1.test' }], truncated: true })
    await Promise.all(disposers.map(dispose => dispose()))
  })

  it.each([
    [{}, [], 'WEB_PROVIDER_UNAVAILABLE'],
    [{}, ['a', 'b'], 'WEB_PROVIDER_AMBIGUOUS'],
    [{ searchProvider: 'missing' }, ['a'], 'WEB_PROVIDER_CONFIGURED_MISSING'],
  ] as const)('reports the Cordis selection error for %j over %j', async (config, ids, code) => {
    const web = createNativeWebService(config)
    for (const id of ids) web.registerSearchProvider(searchProvider(id))
    await expect(web.search({ query: 'q' }, operation())).rejects.toMatchObject({ name: 'WebError', code })
  })

  it('reports a configured but unavailable provider and rejects duplicates', async () => {
    const web = createNativeWebService({ searchProvider: 'a' })
    web.registerSearchProvider(searchProvider('a', false))
    await expect(web.search({ query: 'q' }, operation())).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(() => web.registerSearchProvider(searchProvider('a'))).toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_PROVIDER' }))
  })

  it('removal cancels and drains admitted operations, then stops selecting the provider', async () => {
    const web = createNativeWebService({})
    const started = Promise.withResolvers<undefined>()
    let settled = false
    const dispose = web.registerFetchProvider({
      id: 'slow', available: () => true,
      fetch: (_request, admitted) => new Promise((_resolve, reject) => {
        started.resolve(undefined)
        admitted.signal.addEventListener('abort', () => {
          setTimeout(() => { settled = true; reject(admitted.signal.reason as Error) }, 5)
        }, { once: true })
      }),
    })
    const pending = web.fetch({ url: 'https://a.test' }, operation())
    const rejected = expect(pending).rejects.toThrow('web: provider "slow" was removed')
    await started.promise
    await dispose()
    expect(settled).toBe(true)
    await rejected
    await expect(web.fetch({ url: 'https://a.test' }, operation())).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })

  it('forwards the consuming invocation recorder and cancellation', async () => {
    const web = createNativeWebService({})
    const events: unknown[] = []
    let forwarded: AbortSignal | undefined
    web.registerSearchProvider({ id: 'rec', available: () => true, async search(_request, admitted) {
      forwarded = admitted.signal
      await admitted.appendEvent('web/deepseek-search-llm-request', { endpoint: 'e', apiVersion: 'v', body: {} } as never)
      return { sources: [], truncated: false }
    } })
    const controller = new AbortController()
    await web.search({ query: 'q' }, { signal: controller.signal, appendEvent: (async (_type: string, data: unknown) => { events.push(data) }) as never })
    expect(events).toEqual([{ endpoint: 'e', apiVersion: 'v', body: {} }])
    controller.abort()
    expect(forwarded?.aborted).toBe(true)
  })

  it('takes pins from configuration over the process environment, never from env files', async () => {
    const pinned = await startWeb({ searchProvider: 'b' }, { DSH_WEB_SEARCH_PROVIDER: 'a' })
    pinned.web.registerSearchProvider(searchProvider('a'))
    pinned.web.registerSearchProvider(searchProvider('b'))
    expect((await pinned.web.search({ query: 'q' }, operation())).sources).toEqual([{ url: 'https://b.test' }])
    await pinned.stop()
    const fromProcess = await startWeb(undefined, { DSH_WEB_SEARCH_PROVIDER: 'a' })
    fromProcess.web.registerSearchProvider(searchProvider('a'))
    fromProcess.web.registerSearchProvider(searchProvider('b'))
    expect((await fromProcess.web.search({ query: 'q' }, operation())).sources).toEqual([{ url: 'https://a.test' }])
    await fromProcess.stop()
    const envFileOnly = await startWeb(undefined)
    envFileOnly.web.registerSearchProvider(searchProvider('a'))
    expect((await envFileOnly.web.search({ query: 'q' }, operation())).sources).toEqual([{ url: 'https://a.test' }])
    await envFileOnly.stop()
  })

  it.each([
    ['nope', /must be an object/],
    [{ other: 1 }, /unknown native configuration field other/],
    [{ searchProvider: '' }, /searchProvider must be a nonempty string/],
    [{ fetchProvider: 3 }, /fetchProvider must be a nonempty string/],
  ])('rejects invalid configuration %j', (config, message) => {
    expect(() => resolveNativeWebConfig(config)).toThrow(message)
  })
})
