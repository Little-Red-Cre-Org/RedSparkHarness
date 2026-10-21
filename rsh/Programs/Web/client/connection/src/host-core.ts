/** Carrier-independent Host Connection registry for native Hosts. */

import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import { RpcId, type ClientRequest, type RpcId as RpcIdType } from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import type { BrowserAuth } from './browser-auth.ts'
import type {
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionHandle,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** Carrier hooks used to attach one native registry to an HTTP or desktop transport. */
export interface HostConnectionOwner {
  /** Register a contribution and retain its disposer under the owner lifetime. */
  effect(setup: () => (() => void | Promise<void>), label: string): () => Promise<void>
  /** Mount a decoded RPC channel and return its carrier disposer. */
  mount(channel: string, handler: ConnectionFetchHandler): () => void | Promise<void>
}

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: ConnectionFetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

/** Shared route, authentication, and RPC dispatch state for one Host process. */
export class HostConnectionRegistry {
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()

  /**
   * Create a native registry without selecting a physical carrier.
   * @param trustedHosts - authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
  ) {}

  /** Bind route registration to one native installation lifetime.
   * @param owner - installation lifetime that owns registrations.
   * @returns connection handle for route and RPC contributions.
   */
  forOwner(owner: HostConnectionOwner): HostConnectionHandle {
    return {
      rpc: {
        handle: (channel, handler) => this.register(owner, channel, handler),
        intercept: (channel, matches, handler) => this.registerInterceptor(owner, channel, matches, handler),
      },
      fetch: { register: route => this.registerFetchRoute(owner, route) },
      requestRejection: request => this.requestRejection(request),
      authorizeIndex: (request, response) => this.authorizeIndex(request, response),
      authenticatedUrl: baseUrl => this.authenticatedUrl(baseUrl),
      createSharedFetchHandler: channel => this.createSharedFetchHandler(channel),
    }
  }

  /** Apply the Host/Origin fence, then browser-session authentication.
   * @param request - incoming trust and authentication request.
   * @returns HTTP rejection status, or undefined when accepted.
   */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    if (!isTrustedApiRequest(request, this.trustedHosts)) return 403
    return this.browserAuth.isAuthenticated(request) ? undefined : 401
  }

  /** Authenticate an index request through the process token or signed cookie.
   * @param request - incoming index request.
   * @param response - response headers available for a session cookie.
   * @returns whether the index request is authorized.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean {
    return this.browserAuth.authorizeIndex(request, response)
  }

  /** Add this process's launch token to the clean application URL.
   * @param baseUrl - clean application URL.
   * @returns authenticated application URL.
   */
  authenticatedUrl(baseUrl: string): string { return this.browserAuth.authenticatedUrl(baseUrl) }

  /** Compose exact Fetch routes and the shared RPC interceptor for a carrier.
   * @param channel - RPC channel to intercept.
   * @returns carrier fetch handler.
   */
  createSharedFetchHandler(channel: '/api'): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) return route.fetch(request)
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  private registerFetchRoute(owner: HostConnectionOwner, route: ConnectionFetchRoute): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods), requestBody: route.requestBody, fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(owner: HostConnectionOwner, channel: string, handler: ConnectionRpcHandler): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler)
    return owner.effect(
      () => owner.mount(channel, fetchHandler),
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: HostConnectionOwner,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = { matches, fetchHandler: rpcFetchHandler(channel, handler) }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => { this.interceptors.delete(channel) }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(channel: string, handler: ConnectionRpcHandler): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) return new Response('not found', { status: 404 })
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') return new Response('content type must be application/json', { status: 415 })
      let body: unknown
      try { body = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) return invalidEnvelopeResponse(body, envelope.error.issues)
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }
      try {
        return fullResponse(message.rpcId, await handler(endpoint, message.payload, request.signal))
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues } })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.split('/').some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return undefined
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: ConnectionRpcResult<unknown>): Response {
  return Response.json({ type: 'server-response', rpcId, result } satisfies ConnectionServerResponse)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  if (new Set(route.methods).size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
