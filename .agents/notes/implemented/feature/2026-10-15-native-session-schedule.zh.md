# Agent Note: Native Session Schedule

Status: implemented

[English](2026-10-15-native-session-schedule.md) | 中文

## 问题

Native Host profile 需要持久提醒，但不应为此加载 Cordis 兼容 overlay。若用进程本地 timer 或第二个 store 替换 Session event log，提醒的 owner、持久化和回放就会脱离既有 Schedule 协议。

## 决策

Native profile 显式启用 `@deepseek-ai/dsh-schedule/native`，该入口要求 `activeSessions` 和 `tools`。入口附加到现有和未来的确切根 Session owner，在该根 Agent scope 安装三个 Schedule 工具，并拒绝来自委托 Agent 或其他 Session 的调用。Native Host 会先完成 owner 附加，再捕获首个模型请求的工具快照；若工具 allowlist 允许，首轮就会包含这些 schema。附加或创建快照失败时，请求不会到达模型，turn 会沿用现有的快照、owner 与 writer 清理路径。Cordis 保留独立的包根入口及其加载顺序行为；随附 Native profile 默认不启用 Schedule。

两个入口共同使用版本 1 的 `schedule/change` Session event、严格 fold、framing 和串行管理操作。Native 读取和写入使用已附加 owner 的 flush、已提交 event reader 与唯一 writer。timer 唤醒会认领根 owner 的 idle operation。如果某轮正忙，等待中的终结 idle hook 会在 writer 释放前，通过同一 Agent FIFO 处理到期工作。owner 等待队列准入持久确认后，才追加并 flush dispatch event。cold Session 不会被唤醒；只有根 owner 恢复时才会处理逾期提醒。

## 已考虑的替代方案

**使用进程本地或全局 scheduler。** 这会创建第二套 owner 与恢复协议，而不是从原 Session 日志派生待处理工作。

**向所有 Agent 安装工具或接受后代调用。** Schedule 变更属于一个确切的根 Session，后代工具不能读取或更改该根的提醒。

**替换 Cordis 或在 Native 默认配置中启用 Schedule。** 独立的 opt-in Native 入口保留兼容行为，并让每个 profile 显式选择其 Host 能力。

## 后果

- 显式启用的 Native profile 必须提供 `activeSessions` 和 `tools`；工具只附加到确切的根 Session，不附加到委托 Agent。
- dispatch 记录持久队列准入，而非模型完成或用户确认。enqueue 之后、dispatch append 之前崩溃，恢复后可能重复提醒。
- cold Session 不执行调度工作或外部通知；恢复根 owner 后会从 Session 日志重建 timer 并处理逾期记录。
- Cordis 行为与随附 Native profile 默认值保持不变。
