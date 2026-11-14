# Agent Note: Native 持久 PowerShell

Status: implemented

[English](2026-11-13-native-persistent-pwsh.md) | 中文

## Problem

`tool-pwsh-persistent` 只能作为 Cordis 插件运行。Native profile 因此无法组合 `sdk-minimal` 所宣称的、按所有者隔离的持久 `pwsh` 工具。标记提取、prompt 就绪、按所有者复用和重置都写在 `apply` 里，若在 `native.ts` 再抄一份，就会和 Cordis 路径以及 bash 对应包分叉。

## Decision

本包是 mixed。`src/persistent-core.ts` 拥有标记提取、prompt 设置、按所有者复用、重置和渲染，并且不导入任一运行时。`src/index.ts` 适配 Cordis 的 `ctx.terminals`。`src/native.ts` 适配 `NativeTerminalRegistry`，并注册同一个 `pwsh` 值工具。

PowerShell 的差异留在这份 core 里：反引号转义、`prompt` 函数、提示符剥离，以及只对非零包装命令追加 `[exit code: N]`。Native 的 list 快照只带 `running`、`exited` 或 `failed`，没有退出码或信号。不再处于运行中的 shell 渲染 `[shell exited]`。`close` 不接受原因；适配器先 list，会话已经不在时不调用 `close`。所有者销毁只丢掉缓存，不关闭 shell。终端注册表在 agent 销毁时关闭会话。

这一改动本身不挂载该入口。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 随后把它挂到 `native-sdk`。

## Alternatives considered

**把循环抄进 `native.ts`。** Cordis 路径和 bash 对应包会分叉。一份 core 把可观察的 PowerShell 字符串留在一处。

**与 `tool-bash-persistent` 共用 `persistent-core.ts`。** 包装、就绪检查和状态文本并不相同。共用文件会用标志把这些差异藏起来。

**在发布入口的同时挂到 `native-sdk`。** 决定 `sdk-minimal` 属于阶段 A。发布入口并不决定该 profile。

**去后端会话里读 list 快照没有的退出码。** Native 注册表的 list 结果只暴露状态。编造退出码会让 Native 结果声称注册表没有报告的事实。

## Consequences

Cordis 调用方保留同样的错误、重置说明和退出文本。只要 pwsh 方言的终端后端在场，Native 宿主就可以安装 `@redspark/rsh-tool-pwsh-persistent/native`。Native 重置不能点名 list 快照没有携带的退出码。`persistent-pwsh-tool-turn` 在 profile 能回放它之前仍需要一次 Native 重录。

[Native 持久 Bash](2026-11-13-native-persistent-bash.zh.md) 记录对应拆分。[Cordis 还依赖什么](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md) 记录了点名这一缺口的调查。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 挂载了 shell，并让 Python 入口保持不挂载。[Native 外部 diagnostic](2026-11-13-native-external-diagnostic.zh.md) 记录该字段。
