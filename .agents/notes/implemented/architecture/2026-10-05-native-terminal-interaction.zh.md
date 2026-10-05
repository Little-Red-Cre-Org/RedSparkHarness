# Agent Note: 原生终端交互

Status: implemented

[English](2026-10-05-native-terminal-interaction.md) | 中文

## Problem

原生终端用户需要持久输入、受限保留输出及前台进程信号。维护第二套 PTY 实现会使就绪与取消语义脱离现有 shell 后端。

## Decision

原生与 Cordis 后端共享 LocalPtySession、清理器与启动准备。终端协议及可按代码路由的错误是独立导出；配置使用相同 shell 默认值及已验证的输出与就绪预算。

原生注册表只接纳确切存活 Agent 对其拥有且打开的会话进行交互。所有者及后端取消传递到活跃发送，拆卸等待现有后端关闭。命名会话在分配前预留所有者本地名称，在设置失败或成功关闭后释放。

原生 Consumer 暴露六个工具，限制文本长度并持久化发送元数据。前台取消会中断请求持有的发送。后台发送使用选定 NativeJobs Provider 及其 Agent 清理；启用后台发送但缺少 Provider 时安装失败。

## Consequences

终端机制没有重复实现。原生策略模式由安装固定，不提供按 Session 修改原生沙箱模式。Windows ConPTY 保留所选子进程 Provider 已记录的较弱进程包含能力。

NativeJobs 暴露最终输出，实时保留终端输出仍通过 terminal_read 可用。本变更不提供增量原生任务输出收集。持久工具结果可重建模型可见终端文本，活跃 PTY 无法跨进程重启保留。

## Alternatives considered

原生 PTY 引擎或后台读取工作器会引入独立的就绪及清理持有者。复用现有操作及原生 Jobs 取消，让终端读取保持同步并受所选 Provider 限制。
