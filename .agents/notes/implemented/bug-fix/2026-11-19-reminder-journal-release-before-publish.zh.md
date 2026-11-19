# Agent Note: 提醒日志在写入者关闭后才发布身份

Status: implemented

[English](2026-11-19-reminder-journal-release-before-publish.md) | 中文

## Problem

兼容调度器的提醒日志会创建或恢复 Session、执行 flush，然后在写句柄仍打开时通过 `store.bindReminderSession` 发布其身份。loader 冒烟测试会轮询已发布的 run，直到 `sessionId` 出现，然后立即恢复该会话。在并行负载下，恢复落在身份发布与句柄 `dispose()` 之间，JSONL 后端于是以 `SessionAlreadyOwnedError` 拒绝第二次写声明。`removeReminderRecord` 对其替换会话也有相同的发布顺序。

该包的测试套件还带着一个独立的红色测试。`MockAdapter` 声明了 `defaultMaxTokens`，却继承了 `LlmAdapter.prepareCall`，后者的 `supportsOutputTokenLimit` 恒为 false。`native-model-execution` 因此拒绝所有携带 maxTokens 的请求，包括断言持久化配置的重启测试。

## Decision

`startReminderJournal` 现在只在 `handle.dispose()` 释放写句柄后调用 `bindReminderSession`，`removeReminderRecord` 也只在其写入者关闭后才绑定并归档。提醒日志的恢复若在所有权竞争中输给调用者，就在当前 tick 跳过该任务并在之后重试；会话由调用者持有并负责 flush。`MockAdapter.prepareCall` 报告脚本化代际能够执行到其声明的 `defaultMaxTokens` 为止的上限。

## Verification

- `reminder-journal.spec.ts` 新增测试记录 `flush`、`dispose`、`bind` 的顺序；若发布早于释放就会失败。
- task-scheduler 目录连续三次运行均通过 126 个测试、跳过 1 个。
- 真实 loader 冒烟通过，包括日志检查、替换与删除步骤。
- Native 重启测试现在能到达持久化配置断言，而不再因 `maxTokens` 失败。

## Alternatives considered

### 为什么只在 loader driver 中重试？

driver 代表打开定时会话的用户。在那里重试会掩盖任何 `agents.resume` 调用者在日志写入期间都会遇到的真实产品竞态。

### 为什么不让日志句柄在 tick 之间保持打开？

那会把瞬时竞态变成持续拒绝：该会话的每次用户恢复都要与一个永不释放的写入者竞争。

### 为什么不让 mock 拒绝 `maxTokens`？

mock 声明了它能服务的上限。拒绝自己声明的默认值会让重启测试断言测试适配器永远无法满足的契约，也与 fixture 提供的模型元数据矛盾。

## Consequences

- 通过调度器观察到的会话身份可以立即恢复，而无需竞争写声明。
- 当调用者赢得打开竞争时，日志任务可能延后一个 tick；下一个 tick 会从持久化存储中对其对账。
- 脚本化适配器可以验证输出 token 透传，而超过其声明默认值的请求仍会报告该代际无法执行上限。
