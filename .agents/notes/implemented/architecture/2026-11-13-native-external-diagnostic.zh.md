# Agent Note: Native external diagnostic

Status: implemented

[English](2026-11-13-native-external-diagnostic.md) | 中文

## Problem

产品子进程可能因 `stopReason` 说不清的原因失败。已录制的 `product-subagent-result-diagnostic` 工具结果把该原因写成 `Diagnostic: ...`，放在标题和任何部分输出之间。`NativeExternalSubagentOutcome` 以前只有 `output`、`structured` 和 `stopReason`，Native 宿主因此无法显示同样的文本。

## Decision

`NativeExternalSubagentOutcome.diagnostic` 是可选字符串。`acceptExternalOutcome` 只在非 completed 的结果上保留它，丢掉空白文本，并限制在 4096 个 UTF-8 字节以内。截断落在码点边界，并追加 `\n[diagnostic truncated]`。subagent 工具在停止原因标题之后、部分输出之前渲染非空 diagnostic。Codex 的 Native 适配器转发其产品运行已经产生的 diagnostic。ACP、SDK 和 Claude 适配器不编造 diagnostic。[产品子代理非交互权限](../feature/2026-08-15-product-subagent-noninteractive-permissions.zh.md) 负责这个字段承载的产品文本。

该字段不是 session 事件。模型在工具结果里看到它，而该结果已经在 session log 中。`external-end` 仍只记录 `stopReason`。`SESSION_FORMAT_VERSION` 不变。

## Alternatives considered

**把 diagnostic 记成 session 事件。** 模型可见的文本就是工具结果。再记一个事件会复制 log 里已有的文本。回放不读取这段文本，所以新增必填 session 字段会提高 `SESSION_FORMAT_VERSION`，或者该事件需要 `ignorable: true`。

**为每个 provider 都渲染 diagnostic，包括本地 spawn 失败。** 本地失败没有产品文本。编造一段会改变已录制的 native-sdk 输出，那些输出不含 `Diagnostic:`。

**把 `product-subagent-result-diagnostic` 连同这个字段重录到 Native profile。** 作为真实产品录制被拒绝。已录制的调用现在对着返回录制诊断的 stub 驱动回放。后台调用是归 Agent 所有的 job，所以 `job_output` 读到 `subagent-1` 与 `subagent-2`。该场景不启动产品子进程。

## Consequences

已经返回 diagnostic 的产品，包括 Codex 的 Native 运行，可以显示它。不返回 diagnostic 的产品仍只渲染标题和部分输出。空字符串被省略，所以标签不会在没有文本时出现。该字段不是 profile 安装项，legacy 场景也没有重录。已录制的调用对着 stub 驱动和归 Agent 所有的 job 回放。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 挂载了 shell，并让 Python 入口保持不挂载。
