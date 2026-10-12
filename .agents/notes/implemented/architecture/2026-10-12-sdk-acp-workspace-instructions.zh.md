# Agent Note：在原生 SDK 与 ACP profile 中加载工作区指令

Status: implemented

[English](2026-10-12-sdk-acp-workspace-instructions.md) | 中文

## 问题

Cordis base 与原生 headless profile 会把工作区指令加载到持久 Session，但随 CLI 提供的原生 SDK、SDK 子进程和 ACP 组合遗漏了现有 Provider。因此，同一工作区经这些受支持的运行时访问时，模型看到的指引并不相同。

## 决策

在共享的 `native-sdk`、`native-sdk-dsh-child` 与 `native-acp` profile 组合中安装 `@deepseek-ai/dsh-agent-instructions`，预算为 65,536 字节。该 Provider 使用当前 Session 的 cwd，并通过组合中选定的 `fs` Provider 发现项目根目录、探测元数据和读取文件内容。Native Headless 仍是唯一的 Session writer。

Provider 的发现与持久化协调行为仍由[原生工作区指令决策](2026-10-05-native-workspace-instructions.zh.md)说明。

SDK child launcher 会提供请求中的工作区 cwd 和私有 DSH_HOME。实际 child 进程使用 `native-sdk` profile 与其选定的 `fs-local` Provider；launcher 会按选定的子进程 sandbox policy 运行该进程，但不会把父进程的完整历史或全局指令文件复制到 child home。可选的 `native-sdk-dsh-child` 父 profile 使用 `fs-sandbox`，其 `workspace-write` policy 会限制写入和编辑，但不限制读取。指令发现使用每个进程选定的 Provider，本次不承诺读取隔离。

## 考虑过的替代方案

继续让 instructions 保持可选可以保留原有遗漏，但会继续存在运行时能力差异。把父消息或全局文件复制进 SDK child 会混淆不同 Session 与 home 的所有权，因此 child 会为自己的 Session 重新解析工作区指令。

## 后果

适用的指令基线会成为现有 Session 日志中的一条持久 `user/message`，兼容恢复时会复用它。这些 profile 会在模型输入中保留预算范围内的指引，并相应消耗 token。SDK 客户端和 ACP wire protocol 保持现有事件与提示格式；它们仍观察相同的 Native Headless Session 事件。本次不改变 time-context Provider、Session writer、external-operation 投影或客户端 UI 行为。
