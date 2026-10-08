/** Cordis lifetime and HTTP adapter over the shared Host Connection registry. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { HttpRoute } from '@deepseek-ai/dsh-http-routes/host'
import type { BrowserAuth } from './browser-auth.ts'
import { HostConnectionRegistry, type HostConnectionOwner } from './host-core.ts'
import { bridge } from './http-bridge.ts'
import type {
  ConnectionFetchHandler,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionFetch,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection adapter whose registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  private readonly registry: HostConnectionRegistry

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(ctx: Context, trustedHosts: readonly string[], browserAuth: BrowserAuth) {
    super(ctx, 'connection')
    this.registry = new HostConnectionRegistry(trustedHosts, browserAuth)
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc { return this.registry.forOwner(this.owner()).rpc }

  /** Exact Fetch routes scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch { return this.registry.forOwner(this.owner()).fetch }

  /** Apply the configured Host/Origin fence, then browser authentication. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    return this.registry.requestRejection(request)
  }

  /** Authenticate an index request through the process-token exchange or signed cookie. */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean {
    return this.registry.authorizeIndex(request, response)
  }

  /** Add this process's launch token to the clean application root URL. */
  authenticatedUrl(baseUrl: string): string { return this.registry.authenticatedUrl(baseUrl) }

  /** Compose the authenticated shared Fetch handler for one HTTP carrier. */
  createSharedFetchHandler(channel: '/api'): ConnectionFetchHandler {
    return this.registry.createSharedFetchHandler(channel)
  }

  private owner(): HostConnectionOwner {
    const owner = this.ctx
    return {
      effect: (setup, label) => owner.effect(setup, label),
      mount: (channel, handler) => {
        const route: HttpRoute = {
          kind: 'prefix', path: channel,
          handler: async (req, res) => {
            const rejection = this.requestRejection(req)
            if (rejection !== undefined) {
              res.writeHead(rejection)
              res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
              return
            }
            await bridge(req, res, handler)
          },
        }
        return owner.webServer.register(route)
      },
    }
  }
}
