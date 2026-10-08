# Agent Note: HTTP route Definitions and Native GitHub ingress

Status: implemented

[English](2026-10-07-http-route-definitions-and-native-github-ingress.md) | 中文

## Problem

Cordis WebServer 与 Native Web listener 需要共用 HTTP route 约定，同时功能包不能依赖 Program transport 代码。Native GitHub webhook 还需要可信的 HTTP 接纳点：所选 root executor 必须在 endpoint 返回成功前持久接纳本请求的 message，同时浏览器 `/api` 认证、单一 application 与单一 Session writer 仍归既有 Provider 所有。

## Decision

`rsh/Core/util/http-routes` 中的 `@deepseek-ai/dsh-http-routes` 拥有通用 Node `HttpRoute`、`HttpUpgradeRoute`、`HttpRouteListener` 与 `HttpRouteTable` 约定。Host、Client 与 Native 入口各自分开：Node route 类型与 exact/prefix/upgrade 单一 registry 归 Host；浏览器 index 注入值归 Client；无 Cordis 的 `./native` 入口提供共享 table 并扩展 `NativeServices.httpRoutes`。移除路由或关闭路由表时，会断开请求体尚未接收完成的已接纳 HTTP 请求，再排空 handler；关闭路由表还会等待此前已移除路由的 handler。Native Runtime 是可选 peer，非 Native consumer 无需安装它。

`rsh/Compatibility/DSH/bridge/http-routes-cordis` 中的 `@deepseek-ai/dsh-http-routes-cordis` 拥有 `ctx.webServer` Context augmentation、`webserver/index-inject` event、仅适用于 WebServer 的绑定／压缩配置与旧 Web 路由名称。`dsh-host-webserver` 仍拥有 Program 的 socket、gzip、回退与 index 传输，不会被搬入 Core 或 Compatibility。它消费 Core table。注册 disposer 可 await：它先停止后续接纳，再等待已接纳的 handler。HTTP 先选择精确路径，再选择最长匹配前缀；upgrade 使用独立精确表，因此两种协议可共用 pathname。Native listener 在自己的路由接纳层拒绝遮蔽 API／channel 与 Client 页面路径，同时保留通用 dispatch 前的 `/api` token gate。

Native GitHub entry 与 Cordis entry 共用有界且不改动的 raw-body HMAC 验证。它逐请求解析可轮换的 Credential 引用，在 JSON 解析前拒绝签名无效请求，并通过 `native-web-session-controller` 已提供的 `rootExecution` Provider 接纳一条 `createUserMessage`。既有 `native-session-execution` Definition 拥有 `NativeServices.rootExecution`；Core HTTP Definition 拥有 `NativeServices.httpRoutes`。Ingress 立即附加 `execute()` 结算观察器，将 `agent/inbox/spliced` 关联到精确 `message.id`，仅在该事件出现后返回 `202`。关联事件前失败或 execution 先完成时返回 `503`。接纳后继续观察并记录 root 最终结算结果。卸载会移除路由接纳、中止 ingress 拥有的 root，并等待 route handler 与 execution 排空。既有 `rootExecution` 仍是唯一的 root／Session 权威，`native-web-host` 仍是唯一 application Provider。

Native entry 是由 profile 显式选择的 package export；默认 Web 或 P5 组装保持不变。

较早的 HTTP 集成以直达 root 作为过渡：通过身份验证的交付发送到配置 root route，Native 规则组合留给 P4 跟进。当前 P4 扩展已由 `@deepseek-ai/dsh-webhook/native` 取代该行为。受信任规则会在创建 Session 前解析；返回 `null` 不创建 Session 或模型请求；返回请求则通过所选 Program 的 Workspace、Agent preset、permission、model-selection、maintenance 与 root-execution Provider 准备。Native `202` 在请求关联的持久 inbox 事件后返回，不等待模型完成。Cordis 包根入口和 Profile 保留既有 compatibility 语义，Native consumer 则只导入无 Cordis 的 `./definition` 契约。

完整 Session-request 支持要求 Native Web root 配置动态 Workspace 创建、Workspace registry、可恢复 Session deletion 与 preset Provider。当前 SDK root facade 未公开 `createWorkspaceRoute`，因此该 Native composition 会在安装时失败。ACP 集成由另一批次跟踪，当前 Native Web 路径不声称支持 ACP。路径与 policy 准入后的 Workspace 元数据创建是持久提交；inbox 前 Session 失败会排空新 Agent／route，且只可恢复地删除该 Session；inbox 已接纳的 Session 历史则在 root 结算后继续持久存在。

## Alternatives considered

**把完整 Cordis WebServer 搬进 Core 或 Compatibility bridge。** 否决，因为 socket 所有权、浏览器 API 顺序、压缩、回退与页面组装均属于所选 Program listener；搬移会扩大通用包并模糊传输策略。

**把通用 route table 留在 Program WebServer，让 Native 再建一张 registry。** 否决，因为两个 listener 需要相同路由与排空语义，功能模块应依赖 route Definition，而不是导入具体 Program。两张表还会产生两个路由匹配与生命周期事实源。

**Native 也使用 `webhookRuntime.dispatch()` 并立即确认。** 否决，因为它有意定义为 fire-and-forget，无法确认 Native root writer 已持久接纳本请求的精确 message。

**为 webhook 增加第二个 Native application、inbox observer 或 Session writer。** 否决，因为所选 Web controller 已提供 `rootExecution`，Native Web Host 已拥有唯一的 `application`；额外 executor 或 writer 会复制权威。

## Verification

定向 Native Session Controller、Cordis WebServer 与 GitHub Loader suites 使用真实 Native listener 与签名请求链路，覆盖签名无效且无副作用、接纳前 `503`、关联持久 inbox 在 `202` 前到达、浏览器 `/api` `401`、卸载中止／排空、同路径 HTTP 与 upgrade 分发，以及等待中的路由释放。定向 TypeScript build 覆盖改变的 Host 与 Client consumer。严格 NodeNext fixtures 分别解析纯 Native HTTP 入口与显式 Cordis bridge，均不使用 `skipLibCheck`。

## Consequences

- Program listener 保留传输与保留路径策略，功能模块共用一个 Core Definition。
- Cordis route disposer caller 会等待 teardown，文档同步说明此约定。
- Native GitHub `202` 确认每条非 null 规则请求的 inbox 已持久接纳，但不承诺模型完成；Cordis `202` 保持其内存分发含义。
- Native route 保持 opt-in，且只拥有它启动的 ingress roots。
