# Agent Note: Native Session queued submissions

Status: implemented

[English](2026-10-12-native-session-queued-submissions.md) | 中文

## Problem

原生 Web 的 `session/prompt` 只准入一个轮次，并拒绝繁忙时的第二次提交。Client 无法用稳定请求身份表达排队工作或轮次中途引导。

## Decision

Host 在确切的活动 root owner 上提供 `session/queue` 和 `session/steer`，使用现有的 `next-turn` 与 `next-step` inbox。`session/dequeue` 会移除仍待处理的已识别请求。调用方的 request id 就是持久化用户消息 id。Queue 和 steer 在 inbox 追加持久化后完成。`session/submissions` 折叠持久事件前缀，并连同 `throughSeq` 游标返回每条待处理完整消息。

`session/submission/edit` 会用文本块替换待处理消息的全部 content，同时保留其 id、source 和位置。它通过现有 splice 事件记录替换，并返回 `updated` 或 `stale`。`session/submission/promote` 通过一条 `agent/inbox/moved` 事件将 queued 消息移到 `next-step` 末尾；`stale` 表示消息已不再待处理，`not-promotable` 表示它已位于 `next-step`。两项操作都使用确切的 root owner。同步准入前的取消会拒绝操作；事件接纳后，owner 会等待现有持久化屏障。提交 move 后发生 teardown 时，待处理事实会保留以供恢复，并且仅跳过唤醒。

Headless 会在异步准备指令和上下文后，对比原始完整的 eligible inbox 快照，再领取输入。候选变化时，输入会继续保持待处理，并重新执行依赖输入的准备；Program 只会在领取时同步移除仍未变化的已选输入。

带观察者的提示跟随流会在持久化准入后、已准入输入在模型准入前被取消后，以及对应用户消息的轮次结束后发送 `submission-update` 帧。RPC 拒绝时会在错误详情中包含 request id。普通提示继续遵循[普通发送顺序](../simplification/2026-07-17-one-send-one-turn.zh.md)的单待处理轮次规则。

## Alternatives considered

- **保留仅 Web 内存队列：**拒绝，因为已接受的工作无法在 Host 重启后保留，也不会进入持久 Session inbox。
- **两种操作都使用 `next-turn`：**拒绝，因为原生 inbox 已区分后续轮次与下一模型步骤。
- **使用分开的移除与插入事件表达 promotion：**拒绝，因为持久折叠可能在两个事实之间观察到中间状态；一条 move 事件即可表达单个 inbox 转换事实。

## Consequences

排队、中途引导、编辑和 promotion 复用 Session 日志中的已识别消息与 inbox 事件，不再增加执行队列或 writer。只有当此控制器拥有活动的 root 浏览器轮次时，queue 和 steer 才接受输入。编辑会保留待处理消息的身份和位置，并将其 content 全部替换为文本；promotion 记录一条持久 move，并且只会在 owner 仍开放时唤醒现有 driver。持久 submissions 读取会连同完整待处理消息返回游标，可选的 prompt 跟随流继续传递生命周期帧。
