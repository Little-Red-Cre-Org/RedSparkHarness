# Agent Note: Native scheduled-task list

Status: implemented

[English](2026-10-12-native-scheduled-task-list.md) | 中文

## Problem

Native Host 提供只读计划数据流，原生侧边栏需要一个保持最新的任务列表，同时不暴露任务提示词或不受支持的管理操作。

## Decision

定时任务标题操作会选中一个 keyed 主面板。面板在挂载期间消费 `clientNativeSchedule.follow()`，应用 baseline、upsert 和 remove 帧，并在卸载时中止数据流。

每行显示任务名称、活动/暂停/失败状态、已保存的计划与时区，以及可用时的下次执行时间。面板不会收到任务提示词或执行配置，也不提供创建、暂停、恢复或删除操作。

## Alternatives considered

- **面板打开时轮询 `list()`：**拒绝，因为 `follow()` 会提供基线和后续变化，无需轮询间隔。
- **复用 legacy SchedulerPanel：**拒绝，因为该组件需要 Native Host 未提供的任务变更与执行数据。
- **让数据流在整个侧边栏生命周期内保持活动：**拒绝，因为 keyed 面板拥有可见列表及其数据流生命周期。

## Consequences

Native Schedule 数据流仅在列表面板挂载时活动；关闭面板会中止请求。原生用户可以查看计划元数据，但无法从此视图管理任务。
