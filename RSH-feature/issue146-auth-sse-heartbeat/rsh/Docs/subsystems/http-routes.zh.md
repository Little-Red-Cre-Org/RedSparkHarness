# HTTP Routes

[English](http-routes.md) | 中文

`@deepseek-ai/dsh-http-routes` 定义 Node HTTP handler 与共享路由表，供所选 Cordis Web 和 Native Web listener 使用。其 Host 与 Native 入口不含 Cordis 声明；浏览器安全的 index 注入值从 `./client` 导出。[Cordis bridge](../../Compatibility/DSH/bridge/http-routes-cordis/README.zh.md) 将旧式 `ctx.webServer` 与 event 声明单独保留在这些约定之外。

## 定义

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

源码：[`rsh/Core/util/http-routes/src/host.ts`](../../Core/util/http-routes/src/host.ts)

## 匹配与释放

`HttpRouteTable` 会拒绝重复的 `(kind, path)` 注册。HTTP 请求先匹配精确路由，再查前缀并选择最长匹配者；前缀注册可以重叠。HTTP 与 upgrade 注册使用不同的表，因此两种协议可各自认领同一个 pathname。Upgrade 仅做精确匹配。

注册 disposer 会先从后续匹配中移除该 route，断开请求体尚未接收完成的已接纳 HTTP 请求，再等待 handler 结算。`close()` 会阻止后续注册、移除所有路由、断开未完成的 HTTP 请求，并排空所有已接纳的 HTTP 与 upgrade handler，包括已被 disposer 移除的路由上的 handler。路由表不拥有 listener socket、route 认证、保留路径、浏览器 `/api` 策略或静态页面策略；这些决定仍属于所选 listener 与功能 owner。

## Consumer

Cordis `dsh-host-webserver` Provider 拥有自己的 Node socket，并使用共享表分发 HTTP 与 upgrade 请求。Native Web Assets 拥有所选 Node listener 并向 Native 插件提供 `httpRoutes`，同时保护 `/api`、已挂载 channel 与 Client 页面路径。Native GitHub ingress 通过此 capability 注册已验证的 webhook 路由，并使用所选 root execution owner；详见 [Webhook 子系统](webhook.zh.md)。

[WebServer 子系统](web-server.zh.md)描述 Cordis service、绑定与压缩配置以及 index 渲染。[Core 库 README](../../Core/util/http-routes/README.zh.md)描述 package 入口。
