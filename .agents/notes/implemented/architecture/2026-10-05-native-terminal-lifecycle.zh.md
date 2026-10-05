# Agent Note: 原生终端生命周期的所有权

Status: implemented

[English](2026-10-05-native-terminal-lifecycle.md) | 中文

## 问题

原生 Profile 在支持交互式输入与输出前，需要先管理真实终端进程的所有权。普通的管道子进程无法分配 PTY 或终止整个进程会话；若暴露不完整的交互接口，则会暗示原生包尚未实现的就绪与输出保证。

## 决策

`dsh-terminal`、`dsh-terminal-bash` 与 `dsh-tool-terminal` 的原生入口组成完整的 Definition、Provider 与 Consumer 能力。Definition 在分配期间为确切的 Agent 预留所有权，且仅在后端返回活跃进程后发布不透明 id。Provider 通过 `SubprocessOperations.spawnTerminal()` 分配真实 PTY，应用选定的沙箱策略，排空当前不对外提供的输出，并将完全停稳的终止操作交给子进程句柄。Consumer 只提供打开、列出与关闭，不把分配成功表述为 shell 就绪。

Agent 释放、后端卸载及 Host 关闭都会中止待完成的分配，等待回滚，并关闭已发布的会话。原生服务只存在于进程本地，Host 退出后不能恢复终端。原生会话与 Cordis 的 `ctx.terminals` 注册表独立，两者不共享 id 或进程状态。

在 Windows 上，本地子进程 Provider 的 ConPTY 不受 Job 容器约束。关闭操作会等待它可观察到的进程范围；逃离该范围的后代可能继续存活。原生注册表不会声称比选定 Provider 更强的清理能力。

## 考虑过的备选方案

普通 stdin/stdout 管道子进程没有终端会话或前台进程组，因此不适用。直接复制 Cordis 后端也不适用，因为其就绪、滚动缓冲与信号行为依赖此原生生命周期能力尚不包含的服务。仅含生命周期的 PTY 是一项闭合能力，不会把不支持的交互误报为成功。

## 后果

Profile 必须显式选择 shell 可执行文件、参数、终端尺寸、终止宽限期、沙箱策略及 Consumer 公开的后端类型。受限策略要求沙箱 Provider。原生终端工具只产生生命周期事实，不提供捕获输出；面向模型的交互仍使用 Cordis 路径。原生注册表负责处理清理失败；后端报告资源尚未释放时，打开或关闭操作会拒绝，而不会声称成功。
