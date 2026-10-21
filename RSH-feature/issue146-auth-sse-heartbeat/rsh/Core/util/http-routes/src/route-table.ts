/** One exact-first HTTP route authority with admitted-handler draining. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpRoute, HttpUpgradeRoute } from './host.ts'

interface Entry<Route> {
  readonly route: Route
  readonly active: Set<ActiveHandler>
}

interface ActiveHandler {
  readonly request: IncomingMessage
  readonly completion: Promise<void>
}

function matchPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Shared route table for the Cordis Web and Native Web listener Providers. */
export class HttpRouteTable {
  private readonly exact = new Map<string, Entry<HttpRoute>>()
  private readonly prefixes = new Map<string, Entry<HttpRoute>>()
  private readonly upgrades = new Map<string, Entry<HttpUpgradeRoute>>()
  private readonly active = new Set<ActiveHandler>()
  private closing = false
  private closePromise: Promise<void> | undefined

  /** Register one route. Disposal aborts incomplete bodies, then drains admitted handlers.
   * @param route - route path, match kind, and handler.
   * @returns a disposer that removes the route and waits for admitted work.
   */
  register(route: HttpRoute): () => Promise<void> {
    if (this.closing) throw new Error('http routes: listener is closing')
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) throw new Error(`http routes: duplicate ${route.kind} route ${JSON.stringify(route.path)}`)
    const entry = { route, active: new Set<ActiveHandler>() }
    table.set(route.path, entry)
    return () => this.release(table, route.path, entry)
  }

  /** Register one upgrade route; disposal aborts incomplete bodies and drains handlers.
   * @param route - exact path and protocol-upgrade handler.
   * @returns a disposer that removes the route and waits for admitted work.
   */
  registerUpgrade(route: HttpUpgradeRoute): () => Promise<void> {
    if (this.closing) throw new Error('http routes: listener is closing')
    if (this.upgrades.has(route.path)) throw new Error(`http routes: duplicate upgrade route ${JSON.stringify(route.path)}`)
    const entry = { route, active: new Set<ActiveHandler>() }
    this.upgrades.set(route.path, entry)
    return () => this.release(this.upgrades, route.path, entry)
  }

  /** Dispatch one HTTP request; returns false when no named route claims it.
   * @param pathname - parsed URL pathname.
   * @param request - incoming request owned by the listener.
   * @param response - response owned by the selected handler.
   * @returns whether a named route handled the request.
   */
  async dispatch(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const entry = this.match(pathname)
    if (entry === undefined) return false
    await this.invoke(entry, request, () => entry.route.handler(request, response))
    return true
  }

  /** Dispatch one upgrade request; returns false when no exact route claims it.
   * @param pathname - parsed URL pathname.
   * @param request - incoming upgrade request.
   * @param socket - upgraded connection owned by the selected handler.
   * @param head - bytes already read after the request headers.
   * @returns whether an upgrade route handled the request.
   */
  async dispatchUpgrade(pathname: string, request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    const entry = this.upgrades.get(pathname)
    if (entry === undefined) return false
    await this.invoke(entry, request, () => entry.route.handler(request, socket, head))
    return true
  }

  /** Whether a generic route can claim the given path or any child path.
   * @param prefix - path reserved for a static or protocol owner.
   * @returns whether an exact or prefix route overlaps it.
   */
  conflictsPrefix(prefix: string): boolean {
    if ([...this.exact.keys()].some(path => path === prefix || path.startsWith(`${prefix}/`))) return true
    return [...this.prefixes.keys()].some(path => matchPrefix(prefix, path) || matchPrefix(path, prefix))
  }

  /** Whether a registered route claims one pathname using the route-match rules.
   * @param pathname - parsed URL pathname.
   * @returns whether an exact or prefix route matches it.
   */
  claims(pathname: string): boolean {
    return this.match(pathname) !== undefined
  }

  /** Remove every route, abort incomplete request bodies, and drain admitted handlers before the listener closes. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closing = true
    const active = [...this.active]
    this.abortIncompleteRequests(active)
    this.exact.clear()
    this.prefixes.clear()
    this.upgrades.clear()
    return this.closePromise = Promise.allSettled(active.map(handler => handler.completion)).then(() => undefined)
  }

  private match(pathname: string): Entry<HttpRoute> | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: Entry<HttpRoute> | undefined
    for (const [prefix, entry] of this.prefixes) {
      if (!matchPrefix(pathname, prefix)) continue
      if (best === undefined || prefix.length > best.route.path.length) best = entry
    }
    return best
  }

  private async invoke<Route>(entry: Entry<Route>, request: IncomingMessage, handler: () => void | Promise<void>): Promise<void> {
    const active = { request, completion: Promise.resolve().then(handler) }
    entry.active.add(active)
    this.active.add(active)
    try { await active.completion }
    finally {
      entry.active.delete(active)
      this.active.delete(active)
    }
  }

  private async release<Route>(table: Map<string, Entry<Route>>, path: string, entry: Entry<Route>): Promise<void> {
    if (table.get(path) === entry) table.delete(path)
    await this.drain(entry)
  }

  private async drain<Route>(entry: Entry<Route>): Promise<void> {
    const active = [...entry.active]
    this.abortIncompleteRequests(active)
    await Promise.allSettled(active.map(handler => handler.completion))
  }

  private abortIncompleteRequests(active: readonly ActiveHandler[]): void {
    for (const handler of active) {
      if (!handler.request.complete) handler.request.destroy()
    }
  }
}
