/** Native Web Host application selected by an explicit profile installation. */
import { createNativeHostConnectionRegistry } from '@deepseek-ai/dsh-client-connection/native-host'
import { bridge } from '@deepseek-ai/dsh-client-connection/native-http-bridge'
import {
  createNativeDesktopAssetHandler,
  listenNativeHttpHost,
  prepareNativeClientBundle,
  type NativeHttpHost,
} from '@deepseek-ai/dsh-native-web-assets'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { watch, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import type { NativeWebHostService } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Bound native Web Host carrier and shared authenticated Connection handle. */
    nativeWebHost: NativeWebHostService
  }
}

/** Explicit configuration for one native Web Host process. */
export interface NativeWebHostConfig {
  /** Profile-owned package root containing `rsh.client.json`. */
  readonly projectDir: string
  /** Installed runtime root containing `@deepseek-ai/dsh-web-frontend`. */
  readonly runtimeDir: string
  /** Script installed before the native browser entry runs. */
  readonly transportScript?: string
  /** Interface and port for the HTTP listener. */
  readonly host?: '127.0.0.1' | '0.0.0.0'
  readonly port?: number
  readonly maxRequestBodyBytes?: number
  /** Additional trusted authorities accepted by the Connection Origin fence. */
  readonly trustedHosts?: readonly string[]
  readonly cookieMaxAgeDays?: number
  /** Rebuild and publish native Client changes while the Host is running. */
  readonly clientReload?: 'startup' | 'live'
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('native web host: configuration must be an object')
  }
  return value as Record<string, unknown>
}

function pathValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`native web host: ${name} must be a nonempty string`)
  return value
}

function optionalInteger(value: unknown, name: string, minimum: number, maximum?: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    throw new TypeError(`native web host: ${name} must be an integer in the configured range`)
  }
  return value
}

/** Validate native Web Host configuration without opening files or sockets.
 * @param input - native Web Host configuration value.
 * @returns validated native Web Host configuration.
 */
export function resolveNativeWebHostConfig(input: unknown): NativeWebHostConfig {
  const fields = record(input)
  const allowed = new Set(['projectDir', 'runtimeDir', 'transportScript', 'host', 'port', 'maxRequestBodyBytes', 'trustedHosts', 'cookieMaxAgeDays', 'clientReload'])
  for (const key of Object.keys(fields)) if (!allowed.has(key)) throw new Error(`native web host: unknown configuration field ${key}`)
  const host = fields.host
  if (host !== undefined && host !== '127.0.0.1' && host !== '0.0.0.0') throw new TypeError('native web host: host must be 127.0.0.1 or 0.0.0.0')
  const trustedHosts = fields.trustedHosts
  if (trustedHosts !== undefined && (!Array.isArray(trustedHosts) || trustedHosts.some(value => typeof value !== 'string'))) {
    throw new TypeError('native web host: trustedHosts must be an array of strings')
  }
  const transportScript = fields.transportScript
  if (transportScript !== undefined && typeof transportScript !== 'string') throw new TypeError('native web host: transportScript must be a string')
  const port = optionalInteger(fields.port, 'port', 0, 65535)
  const maxRequestBodyBytes = optionalInteger(fields.maxRequestBodyBytes, 'maxRequestBodyBytes', 1)
  const cookieMaxAgeDays = optionalInteger(fields.cookieMaxAgeDays, 'cookieMaxAgeDays', 1)
  const clientReload = fields.clientReload ?? 'startup'
  if (clientReload !== 'startup' && clientReload !== 'live') throw new TypeError('native web host: clientReload must be startup or live')
  return {
    projectDir: pathValue(fields.projectDir, 'projectDir'),
    runtimeDir: pathValue(fields.runtimeDir, 'runtimeDir'),
    ...(transportScript === undefined ? {} : { transportScript }),
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(maxRequestBodyBytes === undefined ? {} : { maxRequestBodyBytes }),
    ...(trustedHosts === undefined ? {} : { trustedHosts }),
    ...(cookieMaxAgeDays === undefined ? {} : { cookieMaxAgeDays }),
    clientReload,
  }
}

/** Native application that keeps the bound Web Host alive until shutdown. */
export class NativeWebApplication implements NativeApplication {
  constructor(private readonly host: NativeHttpHost) {}

  /**
   * Print the authenticated browser URL and wait for Host cancellation.
   * @param args - must be empty; profile configuration owns the Web Host.
   * @param signal - NativeHost shutdown signal.
   * @returns zero after cancellation is observed.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (args.length > 0) throw new Error('native web host: task arguments are unsupported')
    signal.throwIfAborted()
    process.stdout.write(`${this.host.connection.authenticatedUrl(this.host.url)}\n`)
    await new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return }
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    return 0
  }
}

/** Native Web Host installation entry for `dsh` profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-native-web-host',
  targets: ['host'],
  requires: ['credentials'],
  provides: ['nativeWebHost', 'application'],
  resolve(input) {
    const config = resolveNativeWebHostConfig(input)
    return async (context: NativeContext) => {
      const bundle = await prepareNativeClientBundle(config.projectDir, config.runtimeDir)
      if (bundle === undefined) throw new Error('native web host: project has no rsh.client.json')
      let currentBundle = bundle
      let revision = createHash('sha256').update(JSON.stringify(currentBundle.wire)).digest('hex')
      const initialBundle = config.clientReload === 'live'
        ? { ...currentBundle, wire: { ...currentBundle.wire, reload: { endpoint: '/api/native-client/reload', revision } } }
        : currentBundle
      const assets = createNativeDesktopAssetHandler(config.runtimeDir, initialBundle, config.transportScript ?? '')
      const credentials = context.require('credentials')
      const registry = await createNativeHostConnectionRegistry({}, credentials, {
        ...(config.trustedHosts === undefined ? {} : { trustedHosts: config.trustedHosts }),
        ...(config.cookieMaxAgeDays === undefined ? {} : { cookieMaxAgeDays: config.cookieMaxAgeDays }),
      })
      const host = await listenNativeHttpHost(registry, assets, bridge, {
        ...(config.host === undefined ? {} : { host: config.host }),
        ...(config.port === undefined ? {} : { port: config.port }),
        ...(config.maxRequestBodyBytes === undefined ? {} : { maxRequestBodyBytes: config.maxRequestBodyBytes }),
      })
      const reload = (): Promise<Response> => Promise.resolve(Response.json({ wire: { ...currentBundle.wire, reload: { endpoint: '/api/native-client/reload', revision } } }))
      const routeDisposer = config.clientReload === 'live'
        ? host.connection.fetch.register({
          path: '/api/native-client/reload', methods: ['GET'], requestBody: 'buffered', fetch: reload,
        })
        : () => Promise.resolve()
      let watcher: FSWatcher | undefined
      let pendingReload: Promise<void> = Promise.resolve()
      if (config.clientReload === 'live') {
        watcher = watch(config.projectDir, { persistent: false }, (_event, filename) => {
          if (filename !== 'rsh.client.json') return
          pendingReload = pendingReload.then(async () => {
            const candidate = await prepareNativeClientBundle(config.projectDir, config.runtimeDir)
            if (candidate === undefined) return
            const nextRevision = createHash('sha256').update(JSON.stringify(candidate.wire)).digest('hex')
            if (nextRevision === revision) return
            currentBundle = { ...candidate, wire: { ...candidate.wire, reload: { endpoint: '/api/native-client/reload', revision: nextRevision } } }
            assets.update(currentBundle)
            revision = nextRevision
          }).catch((error: unknown) => { process.stderr.write(`native web: Client reload rejected: ${String(error)}\n`) })
        })
      }
      context.provide('nativeWebHost', host)
      context.provide('application', new NativeWebApplication(host))
      context.own(async () => {
        watcher?.close()
        await pendingReload
        await routeDisposer()
        await host.close()
      })
    }
  },
}
