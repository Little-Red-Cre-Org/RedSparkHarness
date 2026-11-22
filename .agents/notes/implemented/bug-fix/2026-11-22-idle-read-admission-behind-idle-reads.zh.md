# Agent Note: 空闲 Session 读取排在其他空闲读取之后

Status: implemented

[English](2026-11-22-idle-read-admission-behind-idle-reads.md) | 中文

## Problem

浏览器恢复 Session 时会先读取 `session/mode-controls`，再读取 `session/submissions`。历史发布所选 Session 之后，计划芯片会在第一次 `session/submissions` 的同一时刻再发起一次只读的 `session/mode-controls`。两次空闲 Session 操作都会占用 `NativeAgentExecution.runMaintenance`。第二次占用从 `execution.ts` 抛出 `native-agent: Agent is busy`，Web Session 服务以 HTTP 200 返回 `code: native/session` 和该消息。计划芯片的读取仍然成功。之后的 `session/submissions` 可以成功，但 `refreshSubmissions` 发布快照时没有清除 `submissionError`，横幅因此保留。

该失败不是 `native-headless: exclusive Session maintenance is active`。那条拒绝只在已发布活动 owner 且其 execution 状态为 `maintenance` 时适用。

## Decision

`runMaintenance` 接受 `shareIdleReads`。仅当每个已准入的操作本身都是空闲读取时，该选项把本次调用排入队列；活动或已排队的操作不是空闲读取时，它仍抛出 `native-agent: Agent is busy`。独占的 `runMaintenance` 不变：只要存在活动或已排队的操作，它就同步拒绝。

`executeSessionOperation` 只在 `admission` 为 `shared-read` 时传递该选项。默认仍是独占。`session/mode-controls` 与 `session/submissions` 在打开空闲 Session 时使用 `shared-read`。排队的读取会等当前空闲读取释放 writer 之后再打开自己的 writer；两次读取不会同时打开 writer。写入、preset 选择以及其余空闲操作仍是独占。已有活动 owner 时仍走原来的附着路径，包括其中的 maintenance 拒绝。

`refreshSubmissions` 接受快照时会清除 `submissionError`，但 `mutateSubmission` 里紧随变更的那次读取除外。收件箱读取成功时，该调用仍保留变更失败。

## Verification

`submissions-read-admission.host.spec.ts` 在第一次空闲准入内部守住恢复用的写入打开，并在 owner 发布前发出另一个调用。重叠的 `session/mode-controls` 与 `session/submissions` 都返回 `ok: true`。独占的 submission edit 准入期间，submissions 读取和第二次 edit 都返回 `native/session`，消息为 `native-agent: Agent is busy`。没有重叠 mode-controls 时，submissions 读取返回快照。`submission-error.client.spec.ts` 选择一个 Session，其第一次 submissions 读取抛出 `native-agent: Agent is busy`，随后的读取成功，并期望 `submissionError` 不存在。

## Alternatives considered

### 为什么不停止抛出 `Agent is busy`？

独占维护，包括写入和 child-lock 的空闲占用，在已有操作被准入时仍需要同步拒绝。如果所有维护调用都排队，写入会等待后再执行。

### 为什么不等待 `exclusive Session maintenance is active`？

捕获到的第一次 submissions 正文是 `native-agent: Agent is busy`，由 owner 发布前的 `runMaintenance` 抛出。附着 owner 的拒绝是另一条路径，保持原样。

### 为什么不改为串行化计划芯片？

计划芯片的第二次 mode-controls 读取与 submissions 读取可以重叠。客户端调度不变。

### 为什么不同时打开两个 Session writer？

Session writer 仍只有一个所有者。共享的空闲读取会等到当前空闲读取结束，再自己打开 writer。

## Consequences

- 只读的 `session/submissions` 不再仅因为只读的 `session/mode-controls` 持有空闲准入而失败，反过来也同样能完成。
- 写入或任何独占维护在其他操作活动或已排队时仍收到 `native-agent: Agent is busy`。
- 成功的 submissions 读取会去掉先前 submissions 失败留下的横幅。
- 这次准入变更不改变 follow-bus 投递或计划芯片调度。
