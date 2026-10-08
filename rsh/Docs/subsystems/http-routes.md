# HTTP Routes

English | [中文](http-routes.zh.md)

`@deepseek-ai/dsh-http-routes` defines Node HTTP handlers and the shared route table used by the selected Cordis Web and Native Web listeners. Its Host and Native entries contain no Cordis declarations; the browser-safe index-injection values are exported from `./client`. The [Cordis bridge](../../Compatibility/DSH/bridge/http-routes-cordis/README.md) keeps the legacy `ctx.webServer` and event declarations separate from these contracts.

## Definitions

```ts type-equiv
/** Path-matching rule for a named HTTP route. */
type HttpRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named HTTP route; the handler owns its full response lifecycle. */
interface HttpRoute {
  readonly kind: HttpRouteKind
  readonly path: string
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}
```

```ts type-equiv
/** One exact-path protocol-upgrade route. */
interface HttpUpgradeRoute {
  readonly path: string
  readonly handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}
```

```ts type-equiv
/** Route registration and admitted-handler lifecycle supplied by one listener. */
interface HttpRouteListener {
  /** Register one route and remove future admission on disposal.
   * @param route - path, match kind, and handler for the request.
   * @returns a disposer that disconnects incomplete bodies and waits for admitted handlers.
   */
  register(route: HttpRoute): () => Promise<void>
}
```

Source: [`rsh/Core/util/http-routes/src/host.ts`](../../Core/util/http-routes/src/host.ts)

## Matching and disposal

`HttpRouteTable` rejects duplicate `(kind, path)` registrations. HTTP requests check exact routes before prefixes, then choose the longest matching prefix; prefix registrations may overlap. HTTP and upgrade registrations use separate tables, so one route of each protocol may claim the same pathname. Upgrade matching is exact.

A registration disposer first removes that route from future matching, disconnects admitted requests whose HTTP bodies are incomplete, then waits for its handlers to settle. `close()` prevents further registration, removes every route, disconnects incomplete HTTP requests, and drains all admitted HTTP and upgrade handlers, including handlers for routes already removed by their disposers. The table does not own the listener socket, route authentication, reserved paths, browser `/api` policy, or static page policy; the selected listener and feature owner retain those decisions.

## Consumers

The Cordis `dsh-host-webserver` Provider owns its Node socket and consumes the shared table for HTTP and upgrade dispatch. Native Web Assets owns its selected Node listener and exposes `httpRoutes` to Native plugins, after protecting its `/api`, mounted channels, and Client page paths. A Native GitHub ingress registers its verified webhook route through that capability and uses the selected root execution owner; see the [Webhook subsystem](webhook.md).

The [WebServer subsystem](web-server.md) documents the Cordis service, its bind/compression configuration, and index rendering. The [Core library README](../../Core/util/http-routes/README.md) documents the package entries.
