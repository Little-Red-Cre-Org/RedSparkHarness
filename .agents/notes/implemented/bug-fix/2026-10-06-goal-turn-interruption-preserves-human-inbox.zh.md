# Agent Note: Goal turn 中断会保留人类 inbox 输入

Status: implemented

[English](2026-10-06-goal-turn-interruption-preserves-human-inbox.md) | 中文

## 问题

宿主暂停 Goal 或卸载驱动器时必须停止自动 Goal 工作，但关闭完整 root epoch 也会丢弃尚未进入模型 step 的普通人类消息。同一 Goal-owned turn 还可能在后续 step 接纳直接人类输入，这会授权模型发起的暂停正常结束。

## 决策

Native 确切的 Program 绑定 root owner 提供 `interruptTurn(reason)`，它会中止并等待当前 turn，同时保留 Session epoch 与尚未领取的 inbox 消息。Native 命令通过可选的 Goal 驱动器处理 pause；只有驱动器拥有当前自动 Goal Round 且该 turn 尚未接纳直接人类输入时，才会中断它。仅挂载命令的 profile 会持久化暂停，但不会取消人类 turn。若 Native root owner 没有 `rootOperations.interruptTurn`，驱动器会在安装 hooks 或调度 Goal 输入前拒绝附加。驱动器卸载会停用 Goal、中断并排空已接纳的 Goal turn，然后移除 hooks。这些路径都不会创建另一个 writer 或 Agent loop。

原生 SDK 的公开 `session/steer` 会把普通人类下一步输入持久化到精确的已接纳 root owner，并唤醒它暂停的普通驱动。这不会重新启用已暂停的 Goal；只有显式 Goal resume 才会接纳下一轮 Goal。

Native Goal 驱动器会跟踪已接纳的 Goal 消息，以及同一 turn 中接纳的直接人类消息。模型暂停只会中断纯 Goal 自动轮次；若人类消息进入后续 step，模型可以暂停 Goal 并正常完成 turn。显式 Session 与 TUI cancel 继续使用完整 root cancel，它会关闭 epoch 并丢弃待处理 inbox。

## 考虑过的替代方案

**每次 Goal pause 或卸载都取消完整 root epoch。** 否决：Goal 驱动器不拥有普通 inbox 消息，因此也会丢弃无关的人类输入并关闭 Program 的 root 驻留。

**看到已接纳的 Goal 消息后中断所有 turn。** 否决：同一 turn 的后续 step 可以接纳直接人类消息并授权模型暂停；仅凭 Goal 来源无法确定当前 turn 的操作者。

**只中止模型请求。** 否决：在其他输入复用唯一 writer 前，Program 必须完成持久 turn 结算并等待清理。

## 后果

Goal pause 与驱动器卸载会停止当前自动 Goal turn，不会取消无关的人类 turn，也不会撤回尚未领取的普通消息。之后的公开 SDK steer 会唤醒暂停的 root，并把已保留和新的人类消息交给模型，同时 Goal 继续保持暂停。完整 Session cancel 保留其显式丢弃行为。

## 测试

Native Host 回归覆盖驱动器卸载、`/goal pause` 后 `/goal resume`，以及人类消息进入 Goal-owned 后续 step 后的模型暂停。TypeScript 与 Python 原生 SDK 录制会话 twin 也检查 Goal 来源、嵌套的 aborted turn end、持久人类 steer 回执与 SDK 事件投影、公开唤醒后保留输入的消费、在显式 resume 前没有 Goal 准入的冷恢复，以及最终响应。这些检查覆盖 `session/steer`，不证明并发 `session/prompt` 行为；同一 Session 的 prompt 仍按序执行。所有回归都检查模型 abort signal、turn 结算、inbox 保留、后续模型请求与持久 Goal 回放。
