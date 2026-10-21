# Agent Note: Native Session queued submissions

Status: implemented

[English](2026-10-12-native-session-queued-submissions.md) | 中文

## Problem

原生 Web 的 `session/prompt` 只准入一个轮次，并拒绝繁忙时的第二次提交。Client 无法用稳定请求身份表达排队工作或轮次中途引导。

## Decision

Host 在确切的活动 root owner 上提供 `session/queue` 和 `session/steer`，使用现有的 `next-turn` 与 `next-step` inbox。`session/dequeue` 会移除仍待处理的已识别请求。调用方的 request id 就是持久化用户消息 id。inbox 追加持久化后，RPC 才会完成；`session/submissions` 会读取两个待处理 inbox。

带观察者的提示跟随流会在持久化准入后、已准入输入在模型准入前被取消后，以及对应用户消息的轮次结束后发送 `submission-update` 帧。RPC 拒绝时会在错误详情中包含 request id。普通提示继续遵循[普通发送顺序](../simplification/2026-07-17-one-send-one-turn.zh.md)的单待处理轮次规则。

## Alternatives considered

- **保留仅 Web 内存队列：**拒绝，因为已接受的工作无法在 Host 重启后保留，也不会进入持久 Session inbox。
- **两种操作都使用 `next-turn`：**拒绝，因为原生 inbox 已区分后续轮次与下一模型步骤。

## Consequences

排队和中途引导复用 Session 日志中的已识别消息与 inbox 事件，不再增加执行队列。只有当此控制器拥有活动的 root 浏览器轮次时，queue 和 steer 才接受输入；dequeue 会移除待处理的 inbox 输入，可选的提示跟随流传递生命周期帧，`session/submissions` 报告当前待处理 inbox 状态。
