# Agent Note: Native 持久 Bash

Status: implemented

[English](2026-11-13-native-persistent-bash.md) | 中文

## Problem

`tool-bash-persistent` 只能作为 Cordis 插件运行。Native profile 因此无法组合 `sdk-minimal` 所宣称的、按所有者隔离的持久 `bash` 工具。标记提取、按所有者复用和重置都写在 `apply` 里，若在 `native.ts` 再抄一份，就会和 Cordis 路径分叉。

## Decision

本包是 mixed。`src/persistent-core.ts` 拥有标记提取、按所有者复用、重置和渲染，并且不导入任一运行时。`src/index.ts` 适配 Cordis 的 `ctx.terminals`。`src/native.ts` 适配 `NativeTerminalRegistry`，并注册同一个 `bash` 值工具。

Native 的 list 快照只带 `running`、`exited` 或 `failed`，没有退出码或信号。不再处于运行中的 shell 渲染 `[shell exited]`。`close` 不接受原因；适配器先 list，会话已经不在时不调用 `close`。所有者销毁只丢掉缓存，不关闭 shell。终端注册表在 agent 销毁时关闭会话。

这一改动本身不挂载该入口。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 随后把它挂到 `native-sdk`。

## Alternatives considered

**把循环抄进 `native.ts`。** 两份实现会分叉，而 PowerShell 对应包已经是有意的镜像。一份 core 把可观察字符串留在一处。

**在这一改动里挂到 `native-sdk`。** `sdk-minimal` 还组合了持久 PowerShell，而决定该 profile 属于阶段 A。发布 bash 入口并不决定该 profile。

**去后端会话里读 list 快照没有的退出码。** Native 注册表的 list 结果只暴露状态。编造退出码会让 Native 结果声称注册表没有报告的事实。

## Consequences

Cordis 调用方保留同样的错误、重置说明和退出文本。只要终端后端在场，Native 宿主就可以安装 `@redspark/rsh-tool-bash-persistent/native`。PowerShell 对应包已发布同样的拆分。Native 重置不能点名 list 快照没有携带的退出码。

[Native 持久 PowerShell](2026-11-13-native-persistent-pwsh.zh.md) 记录对应拆分。[Cordis 还依赖什么](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md) 记录了点名这一缺口的调查。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 挂载了 shell，并让 Python 入口保持不挂载。[Native 外部 diagnostic](2026-11-13-native-external-diagnostic.zh.md) 记录该字段。
