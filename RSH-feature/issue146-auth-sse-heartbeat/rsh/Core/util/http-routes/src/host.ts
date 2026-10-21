/** Node HTTP route definitions shared by the selected listener Providers. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** Path-matching rule for a named HTTP route. */
export type HttpRouteKind = 'exact' | 'prefix'

/** One named HTTP route; the handler owns its full response lifecycle. */
export interface HttpRoute {
  readonly kind: HttpRouteKind
  readonly path: string
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

/** One exact-path protocol-upgrade route. */
export interface HttpUpgradeRoute {
  readonly path: string
  readonly handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Route registration and admitted-handler lifecycle supplied by one listener. */
export interface HttpRouteListener {
  /** Register one route and remove future admission on disposal.
   * @param route - path, match kind, and handler for the request.
   * @returns a disposer that disconnects incomplete bodies and waits for admitted handlers.
   */
  register(route: HttpRoute): () => Promise<void>
}
