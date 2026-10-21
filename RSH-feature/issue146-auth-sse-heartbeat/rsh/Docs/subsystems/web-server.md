# HTTP Server

English | [中文](web-server.zh.md)

[dsh-host-webserver](../../Programs/Web/host/webserver) is the browser HTTP carrier for the GUI host: a single `node:http` plugin providing Cordis `ctx.webServer`, optional gzip response compression, index.html transforms, and one fallback handler that a plugin may claim. The shared route definitions and draining table live in [`dsh-http-routes`](../../Core/util/http-routes); the Cordis service and event declarations live in [`dsh-http-routes-cordis`](../../Compatibility/DSH/bridge/http-routes-cordis). The carrier knows no harness concepts, and feature plugins register routes such as `/api`, plugin bundles, and the HMR event stream. The Native Web carrier uses the same route table while retaining its own `/api`, channel, and page policies ([layering note](../../../.agents/notes/implemented/architecture/2026-07-24-web-config-tree-boot-and-transport-layering.md)). Electron loads the built files over `file://` and sends fetch requests through an IPC bridge instead of the Cordis Web server.

Source: [`rsh/Programs/Web/host/webserver/src/index.ts`](../../Programs/Web/host/webserver/src/index.ts)

## Routes

```ts type-equiv
/** Legacy route-match kind, expressed by the generic HTTP route Definition. */
type WebRouteKind = HttpRoute['kind']
```

```ts type-equiv
/** Legacy Cordis name for a generic HTTP route. */
type WebRoute = HttpRoute
```

Match order is fixed: exact HTTP routes first, then the longest matching prefix, then the registered fallback. Registration order does not choose a handler. Duplicate `(kind, path)` registrations throw, while overlapping prefixes resolve to the longest match; the separate upgrade table uses exact matching and may claim the same pathname as an HTTP route. The fallback seat answers requests no named HTTP route claims; one owner only, and a second registration throws. The shipped Web composition claims the seat with [`dsh-host-frontend-static`](../../Programs/Web/host/frontend-static/src/index.ts), the SPA dist server with locked semantics: Connection authenticates the dist root and configured index before their HTML is read; non-index assets remain public; non-GET/HEAD is 405, traversal outside the dist root is 403, existing files are served directly, absent or non-file targets are empty 404 responses, and unknown extensions ship as octet-stream.

## Config

```ts type-equiv
type Config = HttpWebServerConfig
```

```ts type-equiv
/** Configuration accepted by the selected Cordis WebServer Provider. */
interface HttpWebServerConfig {
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
```

`host` accepts only `127.0.0.1` (default posture) and `0.0.0.0` (deliberate network exposure). The carrier itself owns no TLS, authentication, or Origin policy, so a non-loopback bind exposes the server unless the composition supplies those controls. `compression` defaults to `none`; the shipped Web bundle selects gzip level 1 with a 1024-byte threshold. The shipped `dsh web` command selects loopback and rejects `--host 0.0.0.0`; its Connection plugin supplies Host/Origin checks plus browser-session authentication for every Host API route and stream. Other compositions own their bind and route-authentication policy. The dist location is an assembly fact of the frontend plugin that claims the seat.

## The service

`WebServer` (`ctx.webServer`) listens immediately on activation; a listen failure (EADDRINUSE…) rejects initialization, and the boot process reports the failed fiber. `register(route)` adds one named route and returns an async disposer; the disposer stops future admission and resolves after that registration's admitted handlers settle. Gzip wraps eligible socket-backed responses inside the server, so route handlers retain direct `ServerResponse` ownership and no response-writing API is added to the service. Existing content encodings, `Cache-Control: no-transform`, ranges, SSE, ZIP, and the packaged `.gz` Worker image remain identity responses. `collectIndexInjections()` gathers structured Client-face `IndexInjection` rows over one `webserver/index-inject` emit, and `renderIndex(html)` renders them into successful root and configured index responses before applying the raw `tapIndex(transform)` escape-hatch transforms in registration order; [dsh-client-modules](../../Programs/Web/client/modules) answers the event with the boot manifest rows. `port` reads the listening port, including the port assigned by the OS when `config.port` is 0.

A request whose handling throws (a malformed %-escape hitting `decodeURIComponent`, a client dropping mid-body) is logged as a warning and answered 400 — or the socket destroyed when headers are already out — never a process exit. Disposal pairs `close()` with `closeAllConnections()` because a handler may hold its response open (SSE) and such connections never end on their own; without the force-close, teardown would hang. The package never prints: the URL line belongs to the shell. Per-package operational detail, including the dev-mode bundle watch pipeline, stays in the [README](../../Programs/Web/host/webserver/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebserver--httpwebserver"></a>

### `ctx.webServer` — `HttpWebServer`

Cordis Web listener service retained by the compatibility Provider.

```ts cordis-catalog
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

/** Register one route and remove future admission on disposal.
 * @param route - path, match kind, and handler for the request.
 * @returns a disposer that disconnects incomplete bodies and waits for admitted handlers.
 */
register(route: HttpRoute): () => Promise<void>
```

Types: [HttpRoute](http-routes.md) · [HttpUpgradeRoute](http-routes.md)

Source: [`rsh/Compatibility/DSH/bridge/http-routes-cordis/src/index.ts`](../../Compatibility/DSH/bridge/http-routes-cordis/src/index.ts)

<a id="webserver-events"></a>

### `webserver/*` events

<a id="webserverindex-inject--emit"></a>

#### `webserver/index-inject` — emit

Collect current Client page injection rows from selected consumers.

```ts cordis-catalog
/** Collect current Client page injection rows from selected consumers.
 * @param table - Mutable row table; listeners append in activation order.
 * @mode emit
 */
'webserver/index-inject'(table: IndexInjection[]): void
```

Source: [`rsh/Compatibility/DSH/bridge/http-routes-cordis/src/index.ts`](../../Compatibility/DSH/bridge/http-routes-cordis/src/index.ts)
<!-- END GENERATED cordis-surface -->
