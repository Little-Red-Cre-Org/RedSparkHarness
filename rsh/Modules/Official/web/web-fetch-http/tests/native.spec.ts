/** The native HTTP fetch provider keeps the Cordis limits, destination policy, and decoding. */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { plugin as webPlugin, type NativeWebOperation, type NativeWebService } from '@deepseek-ai/dsh-web/native'
import { publicHttpNetwork } from '../src/network.ts'
import { plugin } from '../src/native.ts'

let server: Server
let base: string
let body = 'hello'
const hosts: NativeHost[] = []

beforeEach(async () => {
  server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end(body) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // The loopback fixture stands in for a public destination; no request leaves the machine.
  vi.spyOn(publicHttpNetwork, 'resolve').mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const host of hosts.splice(0)) await host.stop()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

function operation(signal = new AbortController().signal): NativeWebOperation {
  return { signal, appendEvent: () => Promise.reject(new Error('unexpected event')) }
}

async function boot(config: unknown) {
  const scope = new NativeScope()
  let web!: NativeWebService
  const capture: NativePlugin = {
    apiVersion: 1, name: 'fetch-capture', targets: ['host'], requires: ['web'], provides: [],
    resolve: () => (context) => { web = context.require('web') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }])), scope, config: undefined },
    { plugin: webPlugin, scope, config: { fetchProvider: 'http' } },
    { plugin: capture, scope, config: undefined },
    { plugin, scope, config },
  ], 'host'))
  hosts.push(host)
  await host.start()
  return web
}

describe('native web-fetch-http', () => {
  it('fetches through the selected http provider with the configured body cap', async () => {
    body = 'x'.repeat(50)
    const web = await boot({ maxBodyChars: 10 })
    const result = await web.fetch({ url: `${base}/page` }, operation())
    expect(result).toMatchObject({ statusCode: 200, truncated: true, body: { kind: 'text', content: 'x'.repeat(10) } })
  })

  it('keeps the Cordis URL policy', async () => {
    const web = await boot(undefined)
    await expect(web.fetch({ url: 'ftp://example.test' }, operation())).rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    await expect(web.fetch({ url: 'https://user:pass@example.test' }, operation())).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it.each([
    [{ unknown: 1 }, /unknown native configuration field unknown/],
    ['nope', /native configuration must be an object/],
  ])('rejects invalid configuration %j', (config, message) => {
    expect(() => plugin.resolve(config)).toThrow(message)
  })
})
