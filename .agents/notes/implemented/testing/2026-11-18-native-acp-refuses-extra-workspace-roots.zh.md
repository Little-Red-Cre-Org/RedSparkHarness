# Agent Note：Native ACP 拒绝额外工作区根并覆盖工具取消

状态：已实现

[English](2026-11-18-native-acp-refuses-extra-workspace-roots.md) | 中文

## 问题

上一篇记录把 `reject-extra-dirs` 和 `cancel-tool-calls` 留在 `snapshots/acp/`：前者描述的行为 Native ACP 并不具备，后者没有 Native 测试。

这个缺口是真实存在的：`session/new` 接受非空的 `additionalDirectories` 然后丢弃。客户端请求额外工作区根目录时会收到 Session 创建成功，而 Harness 并不解析 `cwd` 之外的任何路径。legacy 服务端对同一请求返回 invalid params。

工具调用执行期间的取消也没有覆盖。Native 套件取消的是一条流式模型回合，它在任何工具启动之前就结算了。

## 决定

`NativeAcpApplication.newSession` 与 `session/resume` 处理器在任何 Session 工作开始之前，以 legacy 服务端的原文 `additionalDirectories is not supported` 拒绝非空的 `additionalDirectories`。字段缺失、为 `null` 或为空数组时仍然创建 Session：该字段是工作区范围请求，空列表不会扩大任何范围。

`snapshots/native-acp/tool-cancel.snapshot.ts` 通过 JSON-RPC 驱动随包发布的 `acp` profile，模型由本地 fixture 提供。fixture 在一条 assistant 消息里返回两个 `write_file` 调用。客户端挂起第一个 `session/request_permission` 的应答，发送 `session/cancel`，快照断言：

- `session/prompt` 以 `stopReason: 'cancelled'` 结算；
- 正在执行的调用先报 `tool_call`，再报 `tool_call_update` 且 `failed`；
- 排在它后面的调用只报一条 `tool_call_update` 且 `failed`，正文是 "interrupted before the Harness recorded it as started"，因为 Native ACP 从不为未派发的调用发布宣告；
- 两个文件都没有落盘。

挂起权限应答让执行中的窗口变得确定，同时不需要 shell 工具——`acp` profile 并不挂载 shell。

两个 legacy 场景都离开 `snapshots/acp/`。`cancel-tool-calls` 拥有的录制 Session 同时是两个 Native Web abort-row 测试的种子数据，因此它移到 `snapshots/web/bash-abort-row/`——拥有该行为的场景——而不是随 legacy 目录一起消失。

## 后果

`snapshots/acp/` 现在只剩 `escalation-approved`、`fs-escalation-approved` 和 `image-compaction`。第一个是 `acp-default` 请求头的 pin；后两个仍是 legacy 退出的未决问题。

`snapshots/native-acp/tool-cancel.snapshot.ts` 加入 Native ACP 的 pull-request CI 步骤，因此执行中取消路径在每次 pull request 上都会运行，而不只是在跑全量语料的地方运行。

## 备选方案

**接受并应用 `additionalDirectories`。** 否决：随包发布的 profile 只挂载一个工作区根，要兑现该字段，需要把工作区根列表贯穿文件系统 Provider、沙箱策略和每个工具 schema。那是 profile 的功能决策，不是迁移步骤。

**继续静默忽略该字段。** 否决：客户端会以为 `cwd` 之外的路径可寻址，这比拒绝请求更糟。

**用 shell 工具占住工具调用。** 否决：`acp` profile 没有挂载 shell，为快照组合加一个 shell 测到的是 shell，而不是取消。

**把 `cancel-tool-calls` 作为 Native Web fixture 原地保留。** 否决：`snapshots/acp/` 下没有 ACP 场景的目录会被读成仍然生效的 legacy 覆盖，清单校验也分辨不出来。

## 验证

`pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-acp/legacy-handshake.snapshot.ts snapshots/native-acp/tool-cancel.snapshot.ts` 通过。握手快照同时断言空的 `additionalDirectories` 列表仍然创建 Session。
