# Agent Note: Native Host subagent conversation, catalog, interrupt, and session fork

Status: implemented

[English](2026-11-22-native-host-subagent-and-fork.md) | 中文

## Problem

Desktop Native Host 可以列出普通 Session 并提示根轮次，但不能 fork 一个已关闭轮次、列出 parent 的直接子代理、按 parent 地址读取或跟随子 Session、投递可继续提示，或中断一个子项。旧 Web Host 已经通过 Cordis session 服务完成这些操作。在 Native Host 内重建种子切割、目录投影或继续准入，会偏离已经拥有这些规则的 Engine。在剩余 UI 缺口关闭之前，`profile: web` 快照仍留在旧组合上，而这些快照在迁移前需要这份 Host 行为。

## Decision

Native Web Session Host 包装现有 Engine 操作。它不重新实现种子切割、持久化或继续准入。

`session/fork` 接受 `{ sessionId, atSeq? }`。Host 铸造 `SessionId(randomUUID())`，解析源 Program route，并以 `{ route, source, id, atSeq? }` 调用 `NativeRootExecutionOperations.fork`。源 Session 不被修改。既不是活动 owner 也不是已存储 header 的源返回 `session/not-found`。Engine 文本 `fork source event does not exist` 或 `fork source turn has not closed` 变为 `session/fork-unavailable`。其余失败是 `native/session`，使用固定消息和空 details。

`subagents/list` 接受 `{ parentSessionId }`，只为直接子项返回 `{ entries, parentAvailable }`。可继续行来自 `NativeSubagentOperations.list`。一次性行和描述符诊断来自已存储 header 加上 `foldSubagentDescriptor`。未知 parent 返回 `{ entries: [], parentAvailable: false }`。已知 parent 但没有 `subagents` provider 时为 `subagent/projections-unavailable`。fork 的 `parentSession` 不被视为子代理 parent。`parentAvailable` 表示该 parent 是否已有活动 owner。 冷的非 subagent invocation root 可以被恢复，以便运行 `list`。无法走到非 subagent header 的遍历不会把该 subagent 当作 root 恢复；此时目录只使用已存储 header。

`subagents/prompt` 要求 `mode: 'continuable'`、活动的直接 parent，以及 `delivery: 'queue' | 'steer'`。两个 delivery 值都调用 `NativeSubagentOperations.sendMessage`，它准入相邻的 next-step 消息并返回 `{ messageId }`，不等待子轮次。图像经过 `attachments.admitPromptContent`。`clientTimeZone` 用 `canonicalClientTimeZone` 检查，且不存储。

`subagents/interruptByParent` 要求 `mode: 'continuable'`。它在活动的直接 parent 上调用 `subagents.interrupt`，否则在活动的 invocation-root 祖先上调用，且从不调用 `session/cancel`。信号已发出，或子项缺失、没有活动 owner 时，返回 `{ accepted: true }`。活动子项没有活动祖先时为 `subagent/parent-unavailable`。缺少 `subagents` 时为 `subagent/projections-unavailable`。Engine 文本 `interrupt requires a live ancestor` 为 `subagent/unauthorized`。parent、工作区或描述符不匹配时也为 `subagent/unauthorized`。

带 `{ sessionId }` 的 `session/history` 保持不变，包括原始子 id。`{ address: { kind: 'subagent', parentSessionId, childSessionId, mode } }` 会先被分发，并在 parent、工作区与描述符检查通过后返回相同的 history 字段。`POST /api/native-session/follow` 保持不变。`POST /api/native-session/subagent-follow` 跟随该已寻址子项，且不取得 parent 轮次。

线上失败使用固定消息。details 可以包含 session id 和目录原因。它们不包含引擎文本、文件系统路径或配置密钥。`settings/describe`、`settings/open-document`、`session/files/*`、files follow，以及持久的 tool call 与 result 事件保持不变。

这份 Host 行为遵循 [Web 子代理对话](2026-07-27-web-subagent-conversations.zh.md) 中的 Web 地址与继续规则、[可继续子代理中断](2026-08-06-continuable-subagent-interrupt.zh.md) 中的当前轮次中断规则，以及 [Desktop-only retires the browser Web deployment](../architecture/2026-11-21-desktop-only-retires-browser-web.zh.md) 中仍保留的产品缺口。

## Alternatives considered

**在 Host 内重新实现种子切割和目录投影。** Engine fork 与 `NativeSubagentOperations` 已经持久化目标、拒绝未关闭的源轮次并准入继续。第二套实现会偏离这些规则。

**把子代理地址放进 `POST /api/native-session/follow`。** 根调用方提交 session id 与 admission id。在该路由上增加地址字段可能改变对普通请求体的拒绝。兄弟路由保持现有 follow 请求不变。

**通过 `session/cancel` 中断。** 该路由取消根轮次。子项中断不得中止 parent。

**调用 Cordis `listChildren` 与 `catalogView`。** 这些服务不在 Native 包图内。Native Host 使用 `NativeSubagentOperations`。

**要求客户端提供目标 Session id。** 旧 Web Host 铸造该 id。Engine fork 已经要求调用方传入 `id`，因此由 Host 铸造，线上结果仍是 `{ sessionId }`。

## Consequences

根 history 与 follow 调用方保持现有请求和响应。queue 与 steer 在线上都被接受，而 Native 准入始终是 next-step 收件箱；这个提示没有单独的 Native queue 收件箱。中断被接受表示 Host 已发出 Engine 信号，或把子项视为缺失或非活动。无法发信号的活动子项是固定错误，而不是接受。接受不等待子轮次停止，也不取消 parent。

skill tool 行、settings 文档界面和右侧栏多文档标签仍然开放。Desktop-only 笔记仍拥有该产品范围。在这些 UI 缺口关闭之前，`profile: web` 快照留在旧组合上。

## Verification

`rsh/Programs/Web/api/native-web-session-controller/tests/subagent.host.spec.ts` 有四个测试：隐藏 fork 失败、直接子项目录诊断、提示加中断且不取消 parent，以及已寻址 history 与 follow 并保持 `history(sessionId)` 不变。现有的真实浏览器 RPC 测试断言空的 `POST /api/native-session/subagent-follow` 会被拒绝。该 spec 覆盖 `subagent-host.ts` 的全部分支、函数、语句和行。
