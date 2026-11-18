# Agent Note：Native ACP 覆盖取消与拒绝权限

Status: implemented

[English](2026-11-18-native-acp-covers-cancel-and-refusal.md) | 中文

## 问题

`snapshots/acp/` 的八个场景构建的是 Cordis ACP 组合，因此退役该运行时需要先有 Native ACP 的协议覆盖。此前只有 handshake、文本回合、权限、MCP 与外部子代理有覆盖，其中三项位于 `snapshots/native-acp/`，且没有任何 PR CI 步骤运行它们。

legacy 套件本身也不是可靠的预言机：在干净构建下，它在 `session/new` 响应之前推送 `config_option_update`，多数用例的 `stdout.expected.jsonl` 已不匹配。

## 决定

先为 Native 服务端已实现的行为补测试，再移除已被 Native 覆盖的 legacy 场景。

`snapshots/native-acp/cancel.snapshot.ts` 用本地 fixture 模型通过 JSON-RPC 驱动 shipped `acp` profile：

- 永不结束的流式回合被取消，`session/prompt` 以 `stopReason: 'cancelled'` 结束；
- `write_file` 回合触发 `session/request_permission`，客户端回 `reject-once`，工具调用报告 `failed`，磁盘上没有文件。

这覆盖了 `cancel` 与 `escalation-rejected`；`handshake` 已由 `snapshots/native-acp/legacy-handshake.snapshot.ts` 覆盖，允许路径由 `snapshots/native-acp/text-turn.snapshot.ts` 的权限回合覆盖。这三个 legacy 目录因此离开语料。

`snapshots/native-acp/*.snapshot.ts` 现在有 PR CI 步骤；在此之前，这些文件只在整条语料运行的地方执行。

## 后果

`snapshots/acp/` 仍保留四个场景：`reject-extra-dirs`、`cancel-tool-calls`、`fs-escalation-approved` 与 `image-compaction`。`escalation-approved` 也保留，因为它持有 `acp-default` 请求头 pin 及其 sidecar。

其中两个描述的是 Native ACP 并不具备的行为，而不是尚未编写的测试：

- `reject-extra-dirs` 断言 `session/new` 拒绝 `additionalDirectories`。该校验位于 `rsh/Programs/ACP/packages/acp/src/index.ts`；`native-acp` 从不读取该字段，因此会静默接受 legacy 服务端拒绝的输入。
- `fs-escalation-approved` 以 `sandbox_permissions: danger-full-access` 加 justification 执行写入。Native `write_file` 的 schema 没有 `sandbox_permissions` 参数。

这两者都无法靠写测试迁移，各自需要 Native 实现或显式退役；本笔记记录该缺口，而不是丢弃证据。

## 备选方案

**把整个 ACP 套件一次性迁到 Native profile。** 否决：套件施加的是 Cordis YAML patch，需要先构建 Native 组合，而且仍有四个场景没有可断言的行为。

**现在删除全部 legacy ACP 场景。** 否决：`reject-extra-dirs` 与 `fs-escalation-approved` 描述的是 Native 服务端尚未实现的行为。删除它们会把已知缺口变成无人跟踪的缺口。

**把三个重复场景留作额外覆盖。** 否决：它们重放的是即将退役的 legacy 运行时，而其期望输出已经与该运行时的实际输出不一致。

## 验证

`pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-acp/{legacy-handshake,text-turn,cancel}.snapshot.ts` 通过，语料门禁接受新 adapter，`pnpm run lint` 与 `pnpm run typecheck` 通过。

legacy ACP 套件剩余四个场景仍因 `config_option_update` 顺序问题失败，与本次改动之前一致；语料不再注册本次移除的三个目录。
