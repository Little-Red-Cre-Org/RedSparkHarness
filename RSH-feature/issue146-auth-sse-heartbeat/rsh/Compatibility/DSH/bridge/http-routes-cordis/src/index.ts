/** Cordis-only service and event augmentations for selected HTTP Providers. */

import type { IndexInjection } from '@deepseek-ai/dsh-http-routes/client'
import type { HttpRoute, HttpRouteListener, HttpUpgradeRoute } from '@deepseek-ai/dsh-http-routes/host'
import type {} from '@deepseek-ai/cordis'

/** Cordis Web listener service retained by the compatibility Provider. */
export interface HttpWebServer extends HttpRouteListener {
  readonly host: '127.0.0.1' | '0.0.0.0'
  readonly port: number
  /** Register one exact-path HTTP upgrade route and drain admitted sockets on disposal.
   * @param route - pathname and handler that own negotiation and socket use.
   * @returns an asynchronous disposer that waits for admitted handlers.
   */
  registerUpgrade(route: HttpUpgradeRoute): () => Promise<void>
  /** Claim the single fallback handler for requests no named route claims.
   * @param handler - owns the complete unmatched response lifecycle.
   * @returns a disposer that releases the fallback seat.
   */
  registerFallback(handler: HttpRoute['handler']): () => void
  /** Register a raw-HTML transform applied after structured index injections.
   * @param transform - pure HTML-to-HTML transformation.
   * @returns a disposer that removes the transform.
   */
  tapIndex(transform: (html: string) => string): () => void
  /** Apply raw-HTML transforms in registration order.
   * @param html - the unmodified index document.
   * @returns the transformed document.
   */
  applyIndexTaps(html: string): string
  /** Emit once and collect each subscriber's current index injection rows.
   * @returns rows in subscriber activation order.
   */
  collectIndexInjections(): IndexInjection[]
  /** Render structured injection rows, then apply registered raw transforms.
   * @param html - the unmodified index document.
   * @returns the transformed document.
   */
  renderIndex(html: string): string
}

/** Configuration accepted by the selected Cordis WebServer Provider. */
export interface HttpWebServerConfig {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  readonly host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  readonly port: number
  /** Response compression for socket-backed HTTP requests. @default 'none' */
  readonly compression?: 'none' | 'gzip'
  /** Gzip DEFLATE level from 0 through 9. @default 1 */
  readonly compressionLevel?: number
  /** Minimum known response length eligible for gzip; unknown-length streams are eligible. @default 1024 */
  readonly compressionThresholdBytes?: number
}

/** Legacy Cordis name for a generic HTTP route. */
export type WebRoute = HttpRoute
/** Legacy Cordis name for an exact-path protocol-upgrade route. */
export type WebUpgradeRoute = HttpUpgradeRoute
/** Legacy route-match kind, expressed by the generic HTTP route Definition. */
export type WebRouteKind = HttpRoute['kind']
/** Legacy name for the selected Cordis WebServer configuration. */
export type WebServerConfig = HttpWebServerConfig

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: HttpWebServer
  }
  interface Events {
    /** Collect current Client page injection rows from selected consumers.
     * @param table - Mutable row table; listeners append in activation order.
     * @mode emit
     */
    'webserver/index-inject'(table: IndexInjection[]): void
  }
}

export {}
