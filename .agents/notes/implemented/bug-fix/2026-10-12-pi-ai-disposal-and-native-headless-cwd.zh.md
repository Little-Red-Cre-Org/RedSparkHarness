# Agent Note: 原生 profile 默认值可解析且 pi-ai 会排空关闭工作

状态：已实现

[English](2026-10-12-pi-ai-disposal-and-native-headless-cwd.md) | 中文

## 问题

`PiAiAdapter.dispose()` 可能因 Native Responses 关闭错误而提前 rejection，此时已接纳的凭据刷新仍可能处于等待状态。普通 `native-headless` 模板也未设置应用 `cwd`。Native headless、query、TUI 和 Web session-controller 默认值使用 `deepseek-v4-flash`，而已安装的 pi-ai DeepSeek catalog 无法解析该模型 ID。

## 决策

pi-ai 适配器会在已预备的 Codex 调用上公开 `nativeResponses`；Native model executor 会从确切的预备代际捕获该能力，用于 external Responses 操作。释放时会中止目录刷新、排空已接纳的凭据解析和活动 Native Responses 传输关闭，并在两组工作都结算后报告首个关闭错误。`native-headless`、`native-headless-query`、`native-tui` 和 Web session-controller 默认值统一使用 catalog 可解析的 `deepseek/deepseek-flash`；native ACP Provider 仍显式使用 `deepseek-official`。`native-headless` 和 query 模板会把 `process.cwd()` 记录为应用 `cwd`；TUI 保留原有 `cwd` 行为。

## 考虑过的替代方案

**关闭组结算后立即报告传输关闭错误。** 这样会在已接纳的凭据刷新完成并写入轮换凭据之前返回。

**保留 `deepseek-v4-flash` 或增加隐式别名。** 已安装的 catalog 无法解析该模型 ID；别名会掩盖模板过期的模型选择。

**让 `cwd` 保持隐式，或让普通 headless 用户改用 query profile。** Headless 应用需要在配置中获得启动目录；query profile 还会添加单独的 SQLite Provider 和工具。

## 后果

新初始化的原生 profile 会选择已安装 pi-ai catalog 中存在的模型；不会迁移用户已有 profile，也不会通过 fallback 改变默认值。Native headless 会把应用工作区根目录绑定到启动目录，同时不启用查询工具。释放会在等待凭据持久化时保留关闭错误信号。

## 验证

CLI 模板测试使用公开的 `PiAiAdapter.resolveModel` 和已安装 catalog 解析普通 headless、query 与 Web session-controller 默认模型。Native headless 快照驱动会在调用前把随附 `app` route 替换为 fixture route（`snapshots/native-headless/goal-continuation.snapshot.ts`、`snapshots/native-headless/native-headless.snapshot.ts`）；Web 与 Desktop Session 快照驱动也会覆盖 session-controller route（`snapshots/web/native-session-core.snapshot.ts`、`snapshots/desktop/native-session-core.snapshot.ts`），因此其预期 transcript 不会固定本次修改的随附模型默认值。释放逻辑不增加 Session 字段或模型可见内容。Native Responses 回归在流关闭失败时挂起凭据刷新，先排空所有 Promise 再断言，并验证只有刷新完成后释放才 rejection。CLI 模板测试还会检查普通 headless 和 query profile 的 `cwd`。
