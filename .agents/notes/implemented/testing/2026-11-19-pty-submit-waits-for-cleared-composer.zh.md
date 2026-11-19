# Agent Note：终端 PTY 输入等待输入框清空

Status: implemented

[English](2026-11-19-pty-submit-waits-for-cleared-composer.md) | 中文

## 问题

`terminalFixture().submit()` 先输入文本，等待文本出现在 PTY 输出中，然后写入 `\r`。它在应用确认已提交输入之前就返回，因此下一段文本可能在 Enter 尚未被读取时到达进程。读取较慢时，`\r` 与随后的文本会被合并成一个输入块，`ink-text-input` 会把回车当作普通字符插入输入框，而不是当作 Enter。`snapshots/native-tui/native-tui.snapshot.ts` 在 Linux CI runner 上就是这样失败的：`/sessions` 以 `"\r/sessions"` 到达，忙碌终端的拒绝提示从未出现。

## 决定

`submit()` 在 Enter 之后等待终端渲染出不再包含该输入的帧：fixture 默认语言下的空输入框占位符（`terminalCopy('en').placeholder`），或 `/exit`、`/quit` 请求的进程退出。它直接轮询累积的 PTY 输出，而不使用 `vi.waitFor`；在同一测试中再次等待 `vi.waitFor` 会让子进程输出停住整整 30 秒超时。

## 后果

每次 `submit()` 多等一帧，场景在再次输入前观察到应用已接受的状态，而不再依赖回显时序。该等待依赖英文字符串，因为所有 fixture 都以默认语言启动；若某个场景选择 `zh`，需要匹配对应文案。

## 备选方案

**只收窄场景里的排队断言。** 否决：`waitFor('1 queued')` 匹配到的是上一回合的排队状态，但同样的输入合并会影响每个 `submit()` 调用方，包括取消生命周期测试。

**在 Enter 与下一次写入之间短暂休眠。** 否决：延迟只会掩盖竞争，而不是证明应用已消费 Enter，慢速 CI runner 仍可能合并输入块。

## 验证

`pnpm exec vitest run rsh/Programs/TUI/native-tui/tests` 与 `RSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-tui/{native-tui,human-interaction}.snapshot.ts` 通过，在 `taskset -c 0` 下同样通过；改动前该命令可稳定复现原失败。
