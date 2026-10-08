/** Cordis-free node:http carrier for the native Host Connection and Client page. */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { NativeClientBundle } from './index.ts'
import { HttpRouteTable } from '@deepseek-ai/dsh-http-routes/native'
import type { HttpRoute, HttpRouteListener } from '@deepseek-ai/dsh-http-routes/native'

/** Native HTTP listener configuration. */
export interface NativeHttpHostConfig {
  /** Interface to bind; native Web uses loopback by default. */
  readonly host?: '127.0.0.1' | '0.0.0.0'
  /** TCP port, with zero requesting an OS-assigned port. */
  readonly port?: number
  /** Maximum buffered request bytes passed to Connection. */
  readonly maxRequestBodyBytes?: number
}

/** Fetch-shaped native Connection route. */
export interface NativeConnectionFetchHandler {
  requestBodyMode(request: { readonly method: string; readonly url: URL }): 'buffered' | 'streaming'
  fetch(request: Request): Promise<Response>
}

/** Owner hooks supplied by the physical native carrier. */
export interface NativeConnectionOwner {
  effect(setup: () => (() => void | Promise<void>), label: string): () => Promise<void>
  mount(channel: string, handler: NativeConnectionFetchHandler): () => void | Promise<void>
}

/** Structural subset of the shared Connection registry used by this carrier. */
export interface NativeConnectionRegistry {
  forOwner(owner: NativeConnectionOwner): NativeConnectionHandle
}

/** Structural subset of Connection exposed to a physical native carrier. */
export interface NativeConnectionHandle {
  readonly rpc: {
    handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>): () => Promise<void>
    intercept(
      channel: '/api',
      matches: (endpoint: string) => boolean,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
    ): () => Promise<void>
  }
  /** Exact Fetch routes authenticated by the shared `/api` carrier. */
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
  requestRejection(request: { readonly headers: Headers }): 401 | 403 | undefined
  authorizeIndex(
    request: { readonly headers: Headers; readonly method?: string | undefined; readonly url?: string | undefined },
    response: {
      writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
      end(body?: string): unknown
    },
  ): boolean
  /** Add the process token to the first browser URL. */
  authenticatedUrl(baseUrl: string): string
  createSharedFetchHandler(channel: '/api'): NativeConnectionFetchHandler
}

/** Node bridge supplied by the native Connection package. */
export type NativeHttpBridge = (
  req: IncomingMessage,
  res: ServerResponse,
  handler: NativeConnectionFetchHandler,
  maxRequestBodyBytes: number,
) => Promise<void>

/** Native HTTP listener returned after its socket is bound. */
export interface NativeHttpHost {
  readonly host: '127.0.0.1' | '0.0.0.0'
  readonly port: number
  readonly connection: NativeConnectionHandle
  /** Native HMAC and other non-Connection routes on this same listener. */
  readonly httpRoutes: HttpRouteListener
  /** Canonical loopback URL for this listener. */
  readonly url: string
  /** Stop accepting requests, dispose route contributions, and close the socket. */
  close(): Promise<void>
}

/** Minimal route source required by the native carrier. */
export interface NativeHttpAssetHandler {
  readonly requestBodyMode: () => 'buffered'
  fetch(request: Request): Promise<Response>
}

interface NativeOwnerState {
  readonly channels: Map<string, NativeConnectionFetchHandler>
  readonly disposers: Set<() => void | Promise<void>>
}

const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

function matchPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function overlapsPrefix(route: HttpRoute, prefix: string): boolean {
  return route.kind === 'exact'
    ? matchPrefix(route.path, prefix)
    : matchPrefix(route.path, prefix) || matchPrefix(prefix, route.path)
}

function resolveConfig(input: NativeHttpHostConfig): Required<NativeHttpHostConfig> {
  const host = input.host ?? '127.0.0.1'
  const port = input.port ?? 0
  const maxRequestBodyBytes = input.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('native web: port must be 0..65535')
  if (!Number.isSafeInteger(maxRequestBodyBytes) || maxRequestBodyBytes < 1) {
    throw new TypeError('native web: maxRequestBodyBytes must be a positive integer')
  }
  return { host, port, maxRequestBodyBytes }
}

function ownerState(routes: HttpRouteTable): { owner: NativeConnectionOwner; state: NativeOwnerState } {
  const state: NativeOwnerState = { channels: new Map(), disposers: new Set() }
  const owner: NativeConnectionOwner = {
    effect(setup) {
      const disposer = setup()
      state.disposers.add(disposer)
      let released = false
      return async () => {
        if (released) return
        released = true
        state.disposers.delete(disposer)
        await disposer()
      }
    },
    mount(channel, handler) {
      if (state.channels.has(channel)) throw new Error(`native web: RPC channel ${JSON.stringify(channel)} is already mounted`)
      if (routes.conflictsPrefix(channel)) throw new Error(`native web: HTTP route overlaps RPC channel ${JSON.stringify(channel)}`)
      state.channels.set(channel, handler)
      return () => { state.channels.delete(channel) }
    },
  }
  return { owner, state }
}

function requestHeaders(req: IncomingMessage): Headers {
  const rows: [string, string][] = []
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') rows.push([name, value])
    else if (Array.isArray(value)) rows.push([name, value.join(', ')])
  }
  return new Headers(rows)
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    if (!res.write(chunk)) await new Promise<void>(resolve => res.once('drain', resolve))
  }
  res.end()
}

function indexResponse(res: ServerResponse): {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): void
  end(body?: string): void
} {
  return {
    writeHead(status, headers) { res.writeHead(status, headers) },
    end(body) { res.end(body) },
  }
}

/**
 * Listen on a native HTTP carrier and bind one registry owner to its lifetime.
 * @param registry - shared native Host Connection registry.
 * @param assets - selected native Client page and static asset handler.
 * @param bridge - native HTTP bridge for the selected transport.
 * @param config - bind and request-size options.
 * @returns the bound listener, carrier-owned connection handle, and disposer.
 */
export async function listenNativeHttpHost(
  registry: NativeConnectionRegistry,
  assets: NativeHttpAssetHandler,
  bridge: NativeHttpBridge,
  config: NativeHttpHostConfig = {},
): Promise<NativeHttpHost> {
  const resolved = resolveConfig(config)
  const routes = new HttpRouteTable()
  const { owner, state } = ownerState(routes)
  const connection = registry.forOwner(owner)
  const shared = connection.createSharedFetchHandler('/api')
  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (res.headersSent) res.destroy()
      else { res.writeHead(400); res.end() }
    })
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const channel = url.pathname.startsWith('/api/')
      ? '/api'
      : [...state.channels.keys()].find(candidate => url.pathname.startsWith(`${candidate}/`))
    if (channel !== undefined) {
      const rejection = connection.requestRejection({ headers: requestHeaders(req) })
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const handler = channel === '/api' ? shared : state.channels.get(channel)
      if (handler === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      await bridge(req, res, handler, resolved.maxRequestBodyBytes)
      return
    }
    if (await routes.dispatch(url.pathname, req, res)) return
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!connection.authorizeIndex({ headers: requestHeaders(req), method: req.method, url: req.url }, indexResponse(res))) return
    }
    const request = new Request(url, { method: req.method ?? 'GET', headers: requestHeaders(req) })
    await writeResponse(res, await assets.fetch(request))
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(resolved.port, resolved.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  let closed: Promise<void> | undefined
  return {
    host: resolved.host,
    port,
    connection,
    httpRoutes: {
      register(route: HttpRoute) {
        if (['/api', ...state.channels.keys()].some(prefix => overlapsPrefix(route, prefix))) {
          throw new Error(`native web: HTTP route ${JSON.stringify(route.path)} overlaps a reserved route`)
        }
        if (route.kind === 'exact' ? route.path === '/' || route.path === '/index.html'
          : matchPrefix('/', route.path) || matchPrefix('/index.html', route.path)) {
          throw new Error('native web: HTTP route cannot shadow the native Client page')
        }
        return routes.register(route)
      },
    },
    url: `http://${resolved.host === '0.0.0.0' ? '127.0.0.1' : resolved.host}:${String(port)}/`,
    async close() {
      closed ??= (async () => {
        const serverClosed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
        await routes.close()
        for (const disposer of [...state.disposers].reverse()) await disposer()
        await serverClosed
      })()
      await closed
    },
  }
}

/** Keep the bundle type available to native Host callers without a runtime import. */
export type { NativeClientBundle }
