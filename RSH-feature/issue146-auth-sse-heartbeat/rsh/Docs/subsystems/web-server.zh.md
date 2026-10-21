# HTTP 服务器

[English](web-server.md) | 中文

[dsh-host-webserver](../../Programs/Web/host/webserver) 是 GUI Host 的浏览器 HTTP 载体：它是一个提供 Cordis `ctx.webServer` 的 `node:http` 插件，包含可选的 gzip 响应压缩、index.html 转换，以及一个可由插件认领的回退处理器。共享路由定义与可排空 table 位于 [`dsh-http-routes`](../../Core/util/http-routes)；Cordis service 与 event 声明位于 [`dsh-http-routes-cordis`](../../Compatibility/DSH/bridge/http-routes-cordis)。载体不了解 harness 概念，`/api`、插件 bundle 与 HMR（热模块替换）事件流等功能路由由功能插件注册。Native Web 载体复用同一张路由表，同时保留自己的 `/api`、channel 与页面策略（[分层说明](../../../.agents/notes/implemented/architecture/2026-07-24-web-config-tree-boot-and-transport-layering.zh.md)）。Electron 通过 `file://` 加载已构建文件，并经 IPC 桥接发送 fetch 请求，不使用 Cordis Web 服务器。

源码：[`rsh/Programs/Web/host/webserver/src/index.ts`](../../Programs/Web/host/webserver/src/index.ts)

## 路由

```ts type-equiv
/** Legacy route-match kind, expressed by the generic HTTP route Definition. */
type WebRouteKind = HttpRoute['kind']
```

```ts type-equiv
/** Legacy Cordis name for a generic HTTP route. */
type WebRoute = HttpRoute
```

匹配顺序固定：先查精确 HTTP 路由，再取最长匹配前缀，最后落到已注册的回退。注册顺序不会选择 handler。重复的 `(kind, path)` 注册会抛错；重叠前缀由最长匹配者处理。独立 upgrade 表进行精确匹配，并可与 HTTP route 共用 pathname。任何未被具名 HTTP 路由认领的请求都由回退席位应答；席位只有一个所有者，第二次注册会抛出异常。发布的 Web 组合用 [`dsh-host-frontend-static`](../../Programs/Web/host/frontend-static/src/index.ts) 认领席位，即遵循固定语义的 SPA dist 服务器：Connection 在读取 dist 根目录和配置 index 的 HTML 前完成认证；非 index 资产保持公开；非 GET/HEAD 返回 405，越出 dist 根目录的遍历返回 403，现有文件直接提供，缺失或不是文件的目标返回空的 404，未知扩展名按 octet-stream 发送。

## 配置

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

`host` 只接受 `127.0.0.1`（默认姿态）和 `0.0.0.0`（刻意的网络暴露）。载体本身不拥有 TLS、认证或 Origin 策略，因此绑定到非回环地址会暴露服务器，除非组合层提供这些控制。`compression` 默认为 `none`；随附的 Web 组合选择 gzip level 1 和 1024 字节阈值。随附的 `dsh web` 命令选择 loopback 并拒绝 `--host 0.0.0.0`；其 Connection 插件为每个 Host API route 与 stream 提供 Host/Origin 校验和浏览器会话认证。其他组合自行拥有绑定与路由认证策略。dist 位置是认领席位的前端插件的组装事实。

## 服务

`WebServer`（`ctx.webServer`）在激活时立即监听；监听失败（EADDRINUSE 等）会使初始化被拒绝，启动进程会报告失败的 fiber。`register(route)` 添加一条具名路由并返回异步 disposer；它会停止后续接纳，并在该注册项已接纳的 handler 结算后返回。Gzip 在服务器内部包装符合条件且基于 socket 的响应，因此 route handler 继续直接持有 `ServerResponse`，服务也不新增响应写出 API。已有内容编码、`Cache-Control: no-transform`、范围响应、SSE、ZIP 与打包后的 `.gz` Worker 镜像均保持 identity 响应。`collectIndexInjections()` 经一次 `webserver/index-inject` emit 收集 Client face 的结构化 `IndexInjection` 行，`renderIndex(html)` 把它们渲染进成功的根路径和配置 index 响应，随后再按注册顺序应用原始的 `tapIndex(transform)` 逃生口转换；[dsh-client-modules](../../Programs/Web/client/modules) 以启动 manifest（元数据清单）行回应该事件。`port` 读取监听端口，包括 `config.port` 为 0 时操作系统分配的端口。

处理过程中抛出异常的请求（畸形的 % 转义撞上 `decodeURIComponent`、客户端在请求体中途断开）会记录为警告并应答 400（响应头已发出时则销毁 socket），绝不导致进程退出。dispose（资源释放）把 `close()` 与 `closeAllConnections()` 配对使用，因为处理器可能像 SSE（Server-Sent Events）那样保持响应打开，而这类连接永远不会自行结束；没有强制关闭，拆卸就会挂起。该包从不打印输出：URL 行归 shell 所有。逐包运维细节（含开发模式的 bundle 监视流水线）留在 [README](../../Programs/Web/host/webserver/README.zh.md) 中。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [HttpRoute](http-routes.zh.md) · [HttpUpgradeRoute](http-routes.zh.md)

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
