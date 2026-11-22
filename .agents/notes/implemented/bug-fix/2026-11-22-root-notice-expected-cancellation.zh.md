# Agent Note: 根通知清理失败不计入该 execution 自己的中止 reason

Status: implemented

[English](2026-11-22-root-notice-expected-cancellation.md) | 中文

## Problem

`NativeHeadlessApplication.queueRootWake` 通过不带调用方 signal 的 `recipient.run` 启动根通知轮次。`NativeAgentExecution.dispose` 以 `{ kind: 'disposed' }` 中止该 execution，并用同一对象拒绝仍在排队的 `run()`。该唤醒的拒绝处理程序把每一次拒绝都记入 `noticeFailures`。`disposeInternal` 追加该数组，并在仍有条目时抛出消息为 `native-headless: Agent cleanup failed` 的 `AggregateError`。因此，由该 execution 自己的 dispose 取消的根通知唤醒被报告为应用清理失败。Host 的 `close`、`release` 和 `stop`，以及 `NativeWebSessionService.close`，只传播该错误。

## Decision

`queueRootWake` 仅当拒绝与 `recipient.signal.reason` 不是严格同一对象时，才把该拒绝记入 `noticeFailures`。`recipient.signal.reason` 是该 execution 的 `dispose` 中止所创建的 reason。任何其他拒绝都会被记录，包括另一个 `{ kind: 'disposed' }` 对象。该判断不检查 `kind`。只有当 `operationCancellation.signal.reason` 就是该同一对象时，它才会被略去。`disposeInternal` 保持不变：任何已记录的失败仍会使释放以 `native-headless: Agent cleanup failed` 失败。

## Verification

`continuation-host.spec.ts` 固定两种结果。排队的根通知若以 `execution.signal.reason` 拒绝，则 `dispose()` 会完成。根通知若以另一个 `{ kind: 'disposed' }` 对象拒绝，则 `dispose()` 抛出 `AggregateError`，消息为 `native-headless: Agent cleanup failed`，且 `errors` 等于该对象。这些测试并不表明 Host 请求正文或空正文的 `native-session/subagent-follow` 期望已经通过。

## Alternatives considered

### 为什么不略去每一个 `{ kind: 'disposed' }` reason？

该 kind 并不专属于这一 execution 的中止。另一个字段相同的对象可以是真实的清理失败，按 kind 过滤会把它丢掉。

### 为什么不在 Host `stop` 或 `NativeWebSessionService.close` 中吞掉该 reason？

这些调用方只传播释放结果。在那里吞掉会隐藏每一次 `native-headless: Agent cleanup failed`，包括并非该 execution 中止 reason 的拒绝。

### 为什么不在 `NativeAgentExecution.dispose` 里丢掉排队拒绝？

`dispose` 仍以其中止 reason 拒绝排队的 `run()`，以便调用方观察到取消。由通知路径决定该 reason 是否构成清理失败。

### 为什么不与 `operationCancellation.signal.reason` 比较？

应用释放中止的是另一个控制器。只有拒绝就是 `recipient.signal.reason` 时，它才是预期取消。

## Consequences

- 根通知唤醒上的该 execution 自己的中止 reason 属于预期取消，不进入 `noticeFailures`。
- 不同的拒绝，包括另一个 `{ kind: 'disposed' }` 对象，仍会使释放失败，并仍沿未改动的 Host 与 session service 关闭路径传播。
- 对这一拒绝的分类并不能证明 Host 测试正文或空正文的 follow 期望已经通过。去掉被误记的清理错误后，更早的正文失败仍可能显露出来。
