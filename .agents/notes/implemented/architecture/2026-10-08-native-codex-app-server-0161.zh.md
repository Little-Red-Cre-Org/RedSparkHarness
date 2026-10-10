# Agent Note: Native Codex app-server 产品包 0.162.1

状态：已实施

[English](2026-10-08-native-codex-app-server-0161.md) | 中文

## 问题

Native external-subagent 请求携带精确的父级工具 authority 和执行上限。此适配器尚未执行这些逐请求约束，因此把 Native 请求映射为部署级权限设置会丢失上限或扩大授权。使用正确 workspace-write 配置的 Cordis 探测仍未验证，因为嵌套产品工具返回 blocked by policy。

## 决策

@deepseek-ai/dsh-codex-app-server 位于 rsh/Modules/Official/subagent/codex-app-server，拥有固定 Codex 进程、app-server JSON-RPC、临时线程和轮次生命周期、答案选择、安全诊断及释放。它通过 Core childConnection 启动进程，并导出供 Cordis adapter 调用的唯一 startCodexProductRun 产品 API。

Native 模块注册一个 externalSubagentDriver，并在 childConnection.connect() 前拒绝每个 Native 请求。它不会用 permissionMode 替代父级 authority 或正数执行上限。此包固定 Codex 0.162.1。

@deepseek-ai/dsh-subagent-codex 仍是薄 Cordis 兼容桥，把旧版 SubagentRun 契约映射到 Official 产品 API；它不拥有第二套协议或产品生命周期。

## 协议

兼容适配器会初始化 app-server、启动临时线程并发送一个仅含文本的 turn/start。它只传入 Provider 部署配置中的固定 model（若有）；Compat 请求没有逐次 model 或 reasoningEffort 字段，因此不会发送 effort。直接调用 Official `startCodexProductRun` API 时可以提供可选的 model 和 reasoningEffort。处理无人值守审批请求时，Compat 在提供 cancel 时使用它，否则使用 decline；未知请求方法会使运行失败。

固定上游 [ThreadStartParams schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) 承载线程权限字段。[TurnStartParams](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json) 承载 effort 和可选的 `parentTurnId`/`rootTurnId` ancestry 字段，但此适配器没有可填入的 Codex turn ID，因此不会把 RSH Session ID 替代进去。这些字段不执行 Native 所需的父级工具授权或 `maxSteps`/`maxTokens`。官方 [CommandExecutionApprovalDecision](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionApprovalDecision.ts) 和 [FileChangeApprovalDecision](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/typescript/v2/FileChangeApprovalDecision.ts) schema 均包含 cancel 和 decline。

## 测试

`@openai/codex` 固定为 npm 0.162.1 wrapper，其 registry SHA-512 integrity 为 `sha512-NWZdi/kxyjv/8EUGFupziGU38YyleugZRM4JXgY5XFH7FUmaFA33NZS2Bmq0HPazf7S3jJQQWsZ/jAK9jsrV3Q==`；六个精确版本的可选平台载荷也各自有 lockfile integrity 记录。包内 binary 输出 `codex-cli 0.162.1`；隔离的 app-server 完成 `initialize`/`initialized` 后正常 EOF 退出，exit 0。现有 `native-admission.spec.ts` 回归用例确认 Native 请求会在 `childConnection.connect()` 前拒绝，即使部署权限配置为 full access 也一样。Cordis 兼容路径的探测确认 `workspace-write` 已写入 `config.toml`，但 nested product tool 返回 `blocked by policy`；成功执行 workspace-write 及其继承行为仍未验证。

`main` 上 `1753cc36d7888375118dca542e69fa6ff58fe019` 的早期实现检查包含来自 PR #124 的 SDK Native authority interface；这些结果不验证 0.162.1 刷新。本次刷新已对照固定上游 v2 schema、已安装包版本和隔离 app-server 初始化进行检查。Native 请求仍会在连接前拒绝；Native 成功执行尚未验证。

## 考虑过的替代方案

- **用部署级权限设置代替 Native request authority。** 拒绝，因为这无法保留父级逐请求授权和执行上限。
- **在 Cordis bridge 中保留第二套 Codex 进程和 wire 实现。** 拒绝，因为这会拆分协议行为和生命周期 owner；bridge 可以通过 startCodexProductRun 做适配。

## 后果

Cordis 兼容路径仍可执行，但 workspace-write 继承未验证。当前没有可执行的 Native Codex 请求；现有进程内 spawn 提供方仍是可执行 Native 基线，默认路径保持不变。
