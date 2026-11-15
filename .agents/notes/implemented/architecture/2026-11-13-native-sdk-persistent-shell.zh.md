# Agent Note: Native SDK 持久 shell

Status: implemented

[English](2026-11-13-native-sdk-persistent-shell.md) | 中文

## Problem

`sdk-minimal` 曾是唯一把 `rsh-terminal` 与持久 shell 组合在一起的已发布 profile。`native-sdk` 已经有对应的 Native 入口，但没有安装它们，因此没有覆盖那个 profile。

## Decision

`native-sdk` 安装平台对应的 shell。Linux 与 macOS 安装 `@redspark/rsh-tool-bash-persistent`。Windows 安装 `@redspark/rsh-tool-pwsh-persistent`。两者都使用 `@redspark/rsh-terminal`、`type: shell` 的 `@redspark/rsh-terminal-bash`，以及 `@redspark/rsh-subprocess-local`。工具描述与 `timeoutMs: 300000` 与 `sdk-minimal` 相同。

PTY 策略是 `danger-full-access`。`native-sdk` 仍使用 `@redspark/rsh-fs-local`，不安装 `@redspark/rsh-sandbox-local`。shell 不加限制，文件提供方本来也没有限制。`native-sdk-dsh-child` 仍是受限制的 child，且保持不变：它已经提供 `subprocess`，再加一行 `@redspark/rsh-subprocess-local` 会把 `childConnection` 提供两次。

`native-acp` 以及 headless、Web、TUI profile 不获得这个 shell。Headless 已经安装一次性 shell 工具。

`@redspark/rsh-experimental-code-runtime-python/native` 保持不挂载。已发布的包不得点名这个实验包。已经运行代码的已发布 profile 通过 `@redspark/rsh-code-runtime-process-sandbox` 提供 `codeRuntime`；同一 key 的第二个提供方无法安装。

## Alternatives considered

**把 shell 挂到每个 Native profile。** Headless、Web 与 TUI 已经有一次性 shell。在那里再加持久工具会改掉已录制的工具 schema，却并不覆盖 `sdk-minimal`。

**让 native-sdk 的 PTY 使用 `workspace-write`。** 该模式需要 sandbox 提供方。`native-sdk` 是不加限制的 profile；限制属于 child profile。

**把 Python runtime 挂到 `native-sdk`。** 已发布的 CLI 会点名一个实验包，而且代码运行处已经提供了 `codeRuntime`。

## Consequences

`dsh --profile sdk` 与 `dsh --profile native-sdk` 按平台暴露 `bash` 或 `pwsh`。child 与 ACP profile 不暴露。启动器拒绝 `sdk-minimal`；替代命令是 `--profile sdk`。Python 仍是按需安装的 Native 入口。

安装 `@redspark/rsh-sandbox-policy` 会公布常驻文件策略。每个 native-sdk 回合都带一条点名 `danger-full-access` 的运行时上下文用户消息。

native-sdk 的录制会话回放只在 POSIX 上运行：其模型请求携带平台 shell 名称（`bash` 或 `pwsh`），而 fixture 以 POSIX 工具集和 POSIX 工具调用录制。Windows 仍运行 native-sdk 与 ACP 的进程回归，Python SDK 回放的也是同一批 POSIX fixture。

[Native 持久 Bash](2026-11-13-native-persistent-bash.zh.md) 与 [Native 持久 PowerShell](2026-11-13-native-persistent-pwsh.zh.md) 记录这两个入口。[Native Python code runtime](2026-11-13-native-python-code-runtime.zh.md) 记录未挂载的 runtime。[Cordis 退役五阶段](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.zh.md) 仍负责退役 `sdk-minimal`。
