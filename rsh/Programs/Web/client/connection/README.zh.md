---
description: "Web GUI 的浏览器与 Host 之间的协议层：Remote RPC、带重连的事件流投递、精确 Fetch 路由、/api HTTP 桥与浏览器信任栅栏。"
kind: "package-reference"
---

# @redspark/rsh-client-connection

[English](README.md) | 中文

## 概述

本包承载浏览器到 Host 的 Remote 调用、精确 Fetch 响应与 connection generation。Client 插件挂载 `ctx.connection`，其中包含当前页面的 loopback 状态、通用 RPC、当前 generation 及其 Host 信息、可观察的恢复状态、立即重连命令，以及单一 generation source 的注册点。source 报告 ready 后 generation 才可见；source 结束、失败、被撤回或显式 stop 都会清空它，再由 `ConnectionController` 执行重试策略。

## 目录

- [使用本包](#use-this-package)
- [浏览器认证与请求信任](#browser-authentication-and-request-trust)
- [Connection generation](#connection-generation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

浏览器通过 HTTP POST 执行 Remote 一元调用；API Gateway 自己拥有 `/api/remote.mux` WebSocket 及其逻辑流。由 shell 持有的组合通过 `connection.rpc.open` 提供等价的 Remote 流，不打开 WebSocket。Host half 始终提供与载体无关的 RPC 注册表和精确 `GET`/`HEAD`/`POST` 路由注册表。存在 Web 载体时，它还持有唯一 `/api` route、Fetch bridge、浏览器认证与 Host/Origin 校验；由 shell 持有的载体则直接分派共享 Fetch handler。每条精确路由会在 bridge 读取任何字节前声明缓冲或流式请求体处理方式。Typert Gateway 认领生成的 Remote endpoint，功能包注册 Session 日志下载、原始文件上传等非 JSON 响应，未认领的请求返回 404。Loopback hostname 判定只供浏览器侧当前页面状态使用，留在包内。浏览器原始请求体传输由 [`dsh-client-file-upload`](../file-upload/README.zh.md) 提供。

当调用方使用页面 `fetch` 时，`/api` 上的 JSON `response()` 调用共用一条双工 `POST /api/connection/follow-bus`。Host 读取换行分隔的 subscribe 与 cancel 帧，在进程内调用已经注册的精确 `POST` 路由，并把该路由的状态、标头与响应体字节作为分帧块写回。一元 `call()`、带原始请求体的 `response()`、非 `/api` 通道，以及任何由调用方提供的 `fetch`，各自仍是普通 HTTP 请求。对已注册路由的直接请求保持可用。follow-bus 路径是保留路径：`POST` 按流式请求体读取，`GET` 返回 405，缺少请求体返回 400，注册该路径会抛出错误。这条共享连接在任一 JSON 响应尚未结束时保持打开，并在最后一条结束后关闭。每次 subscribe 都执行与直接 POST 相同的 Host/Origin 与浏览器会话检查。客户端会先对该路径发送一次新的 `GET`，让浏览器附上当前 cookie；401 或 403 会拒绝这次 subscribe 并关闭总线。服务器对每次 subscribe 重复该检查，包括签名 cookie 的过期时间，并使用打开请求的标头，而不是复制到内部路由上的 cookie。总线在读取任何帧之前仍会以 401 或 403 被拒绝。路由状态写回之前的失败仍是 HTTP 500。状态写回之后的失败是错误帧，客户端以流错误结束该订阅。路由自己返回的 Response，包括它返回的 401 或 403，会按原样复制。一条 follow-bus 行不能超过缓冲请求体上限再加 64 KiB，缓冲路由不会收到更大的载荷。

`./native` 浏览器入口在原生 `clientConnection` 服务下安装与 Cordis Client 适配器相同的 Connection 实现。它接受空配置，选择页面提供的 RPC 载体或 Web 传输，并发布可观察的 generation 与恢复状态。原生组合仍需要 Host API 路由和 generation source 才能接收实时 Session 事件。原生 Host 释放时会中止连接循环并等待 generation source 结束；此适配器不安装 Host `/api` 路由或浏览器认证。

`./native-host` 入口为已认证的 Host Consumer 提供一个有上限的请求所有者。Consumer 提供请求上限，在获取资源前接收回调，组合载体与安装生命周期的取消信号，并在关闭时等待已接收的回调结束。容量不足与停止接收是显式错误；Consumer 自己分类 RPC 错误，并保留独立资源清理失败。Web 与 Desktop 载体可以发布同一个 `hostConnection` 服务，而不持有 Session 或 Agent 状态。

-----

<a id="browser-authentication-and-request-trust"></a>
## 浏览器认证与请求信任

每个 Host RPC 方法和 WebSocket 流都要求一个浏览器会话，不存在按方法区分的 loopback 层。每个进程生成一个随机启动令牌。`dsh-web-app` 打印并打开带 `?token=...` 的普通根 URL；`frontend-static` 把根路径和 index 请求交给 `ctx.connection.authorizeIndex`，后者只在 `GET /` 接受该令牌，写入绑定 authority 的签名 cookie，再重定向到干净的 `/`。缺失、过期、畸形或 authority 不匹配的 cookie 会在 RPC 分发前得到 401。静态资源保持公开。HTTP 载体不在根路径交换之外接受 query token，也不接受 Authorization header token。

cookie 签名密钥是 `ctx.credentials` 中由 `client-connection/browser-session` 拥有的 grant 记录。本地提供方把它持久化到 `$RSH_HOME/.credentials.yaml`；`BrowserAuth` 在 Connection 激活期间加载或创建该记录，并把密钥留在内存中，因此请求认证同步执行。删除或替换该记录会在下一次 Connection 激活时生效。cookie 携带绝对签发与过期区间，`cookieMaxAgeDays` 默认设为 30 天，并在确定性名称与签名 payload 中同时绑定规范化 hostname 和 port。它是 host-only、`Path=/`、`HttpOnly`、`SameSite=Strict`；随附服务器使用 loopback HTTP，因此刻意不设置 `Secure`。

认证之前，每个请求仍经过 `src/api-request-trust.ts`。其 `Host` 必须是 loopback，或与 `trustedHosts` 条目匹配：带端口的 `host:port` 精确匹配，不带端口的条目匹配任意端口，两侧均经 WHATWG 归一化。若附带 `Origin`，它必须等于该 Host；`sec-fetch-site: cross-site` 一律拒绝。畸形配置 authority 会让插件加载失败。这些检查防御 DNS rebinding 与跨站浏览器请求，绝不建立身份。Host/Origin 校验失败返回 403；Host 可信但未认证的请求返回 401。`dsh web --host 0.0.0.0` 仍不受支持。决策记录：[浏览器请求信任](../../../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.zh.md)与[浏览器令牌认证](../../../../../.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md)。

<a id="connection-generation"></a>
## Connection generation

API Gateway Client 把内部 `$events` 逻辑流注册为唯一 generation source，与有无 `$on` 订阅无关。Host 在 API Remotes source factory 同步挂好所有增量 listener 后，先发送唯一 `{ type: 'ready', clientId, host: { home } }` 项，再发送事件。`ConnectionController` 仅在收到该 ready 项后发布 generation 并调用 `onConnected`，因此 baseline 不会跑在增量 listener 前面。

`$events` 结束、Remote 流报错、收到非 ready 首项或畸形事件项，都会使当前 generation 失效。默认情况下，挂起的握手在 3 秒后记录 Host 响应缓慢告警，在 15 秒后记录就绪超时并中止，包含等待物理 socket 的时间。取消后，source 必须停止投递、释放资源并结束，替换 source 才能启动；已取消 source 迟到的 ready 不能发布 generation。浏览器报告网络可用时，Controller 发布 `connecting`，并在 500ms、1s、2s、4s、8s 与 10s 上限内采用 50%–100% 抖动重试，达到终档后继续尝试直到恢复。每次重试都要求 Gateway 替换一次物理 WebSocket，再重开 `$events`。[持续恢复决策](../../../../../.agents/notes/implemented/bug-fix/2026-09-05-continuous-client-recovery.zh.md)规定握手期限与重试策略。

`ctx.connection.reconnect()` 会中断活动工作、重置序列，并立即开始 retry 1。浏览器 `offline` 会中断活动工作、发布 `disconnected` 并暂停自动尝试；下一次 `online` 转换会重置序列并从 500ms 档开始。只有 ready 项会发布 `connected`。Gateway mux 不拥有独立重试调度。

可通过 Host Connection 行的 `config.recovery` 覆盖重试上限、增长因子或握手告警与取消时间；[配置目录](../../../../Docs/config-catalog.zh.md#redsparkrsh-client-connection)列出接受的字段。Host 校验这些值，并将其注入所提供的每个页面。Client 在提供 Connection 前校验启动数据，并在 Gateway 启动循环时采用这些默认值；显式传给 `start()` 的时序覆盖优先。增长因子必须是至少为一的有限数。若就绪、失败、取消或硬期限先于告警发生，该告警会被取消。修改 Host 恢复配置后需重新加载页面。


RPC Provider 可选提供经过身份验证的 Fetch 响应，用于功能自身拥有的流式端点。选定载体解析 Host 地址和令牌；功能 Consumer 拥有响应解码、取消与终止结算。此操作不替换既有 WebSocket 连接代次，也不引入重连循环。

<a id="model-experience"></a>
## 模型体验

无。协议消费层只在浏览器与主机之间搬运已经组合好的消息；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **缓冲型 `/api` 路由会把每个请求体保留在内存里**：`maxRequestBodyBytes`（默认 300 MiB，按默认 200 MiB 图片总量上限经 base64 膨胀加信封余量得出）限制普通图片与 RPC 信封。显式启用的流式路由接收带背压的分块并绕过总量上限；路由实现负责持久化、取消与存储配额。follow-bus 的每一行使用同一缓冲上限再加 64 KiB 帧开销，超限的 subscribe 会在缓冲路由运行前被拒绝。
- **JSON `/api` 响应共用一条 HTTP/1.1 连接**：follow 与图片字节在 `POST /api/connection/follow-bus` 上分帧，因此一个块会等在正在写出的块后面。一元 RPC 与原始上传各自使用独立请求。每条逻辑 follow 仍计入其自身的 follower 上限。
- **浏览器 cookie 不带 `Secure`**：当前随产品提供的传输方式是 loopback HTTP；若部署经明文网络暴露同一 authority，bearer cookie 可能在传输中泄露。
- **没有 logout 操作**：清除浏览器 cookie 会结束单个浏览器会话；删除 owner 凭据记录并重启 `dsh` 会撤销全部会话。之后的 follow-bus subscribe 会通过一次新请求观察到这次清除，过期的签名 cookie 会使下一次 subscribe 的检查失败；两种拒绝都会关闭总线。已经打开的 follow 会保持到那次 subscribe。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。浏览器会话验证会在请求授权工作时异步读取凭据记录，而记录的 commit-event 生命周期由 credentials 伴生入口负责；流与重连的时序及 rpcId 往返约束由行为规范直接验证，路由注册与 dispose（资源释放）的对称性由 webserver 伴生入口审计。

原生入口导出共享浏览器 RPC 工厂与 Connection 类型，供不依赖 Cordis 的 Client Consumer 使用。
