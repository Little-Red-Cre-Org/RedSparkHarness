# Agent 自动化

[English](automation.md) | 中文

[定时任务插件](../../packages/automation/task-scheduler/README.zh.md) 根据持久化计划组织独立的 Agent 执行。[决策记录](../../.agents/notes/implemented/feature/2026-09-15-agent-task-scheduler.zh.md) 说明重启恢复与防止重复执行的取舍。已有的[会话内提醒](schedule.zh.md) 具有独立的所有者与交付约定。

## 记录与权威来源

[TaskInput 和 Task](../../packages/automation/task-scheduler/src/types.ts) 保存标题、提示词、绝对工作区路径、提供方与模型标识、预设标识、首次目标时间及可选的固定周期。计划属于创建它的会话。状态控制后续执行的准入；下一目标时间为空表示单次任务已经领取。凭据保留在提供方的凭据服务中。

[Run](../../packages/automation/task-scheduler/src/types.ts) 标识一次执行，记录计划时间、开始时间、截止时间、结算时间、执行会话链接和结果。所有数字时间均为 Unix 毫秒。SQLite 是计划和回执的权威来源；执行会话是模型消息与工具结果的权威来源。完成回执表示持久化的 Agent 轮次已结束，不代表生成的代码通过了验证。

## 启动时间窗口

可选 RFC 3339 字段 `TaskInput.endAt` 不包含结束时刻，且必须晚于 `at`。计划到期清除后续启动，不取消正在执行的记录。启动恢复不补执行已经超过结束时间的计划。`Task.nextAt` 为 null 也可表示有界周期计划已无后续安排，不只表示单次已领取。`CreateTaskRequest` 与 `task_schedule.end_at` 共用此存储校验。

## 准入与生命周期

[TaskStore](../../packages/automation/task-scheduler/src/store.ts) 在同一个 SQLite 即时事务中创建运行回执并推进下次目标时间。任务与目标时间的唯一约束，以及运行中领取记录检查，防止同一次执行重复准入，也防止同一任务的领取重叠。错过的周期合并为最近一次到期目标。超时领取记录转为中断并暂停所属任务，因为其外部影响无法确定。

[SchedulerEngine](../../packages/automation/task-scheduler/src/engine.ts) 负责轮询和取消。[执行适配器](../../packages/automation/task-scheduler/src/execute.ts) 解析现有预设、创建独立 Agent、保留权限检查，并读取持久化轮次结算。插件卸载先停止准入，再等待取消完成，最后关闭连接。应用关闭会停止执行；已保存的计划保留到下次挂载。

## 提醒记录

`TaskNotice` 表示应用范围内一次执行的一张提醒卡，从到点原位更新为实际结果，包含稳定的执行/阶段标识、标题、有界正文、时间、可选执行会话标识和已读标记。已提交的计划和运行记录是权威数据源；排队与已调度的到点提醒使用相同的任务/目标时间标识。SQLite 第二版新增的 `notice_reads` 表只保存显式确认；清理运行记录时同时清理其确认行。到点提醒不声明执行成功。系统通知是未读提醒的尽力投递投影。

## 迁移边界

GUI 契约包括 `CreateTaskRequest`（用户填写的计划字段）、`SchedulerOwner`（可选的已打开根会话）和 `SchedulerSnapshot`（所属会话的计划、运行记录与周期限制），声明位于 [gui-types.ts](../../packages/automation/task-scheduler/src/gui-types.ts)。

[插件组装](../../packages/automation/task-scheduler/src/index.ts) 与[会话范围的管理工具](../../packages/automation/task-scheduler/src/tools.ts) 连接这些组件，无需修改 AgentLoop。运行时重构可以替换执行适配器，同时保留计划存储和准入语义。`taskScheduler` Context 服务为可选设置面板提供已认证的 Remote 管理。Agent 参数通过现有传输解析，每个操作都保留所选根会话的归属边界。不增加 Session 事件类型。
<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskscheduler--taskschedulergateway"></a>

### `ctx.taskScheduler` — `TaskSchedulerGateway`

Remote-only adapter sharing the tool's ownership, permissions and task database.

```ts cordis-catalog
/**
 * Read this authenticated application's reminder inbox, including closed owners.
 * @returns Retained occurrence notifications with read status.
 */
@Remote notifications(): TaskNotice[]

/** Read all task plans and receipts for this authenticated desktop application.
 * @returns Visible plans, execution history and minimum interval.
 */
@Remote overview(): SchedulerSnapshot

/** Change a task from the authenticated application, including closed owner conversations.
 * @param id - Task identity.
 * @param action - Requested lifecycle operation.
 * @returns Updated application-wide task snapshot.
 */
@Remote async updateTask(id: string, action: 'pause' | 'resume' | 'delete'): Promise<SchedulerSnapshot>

/** Remove a finished receipt from the application-wide history.
 * @param id - Finished execution identity.
 * @returns Updated application-wide task snapshot.
 */
@Remote async removeRun(id: string): Promise<SchedulerSnapshot>

/**
 * Remove a finished record and reminder belonging to the selected session.
 * @param agent - Owning root resolved by Remote.
 * @param id - Finished execution record identity.
 * @returns Updated owner-scoped records and plans.
 */
@Remote async deleteRun(agent: Agent, id: string): Promise<SchedulerSnapshot>

/**
 * Delete one occurrence reminder without cancelling any scheduled execution.
 * @param id - Exact visible reminder identity.
 * @returns Remaining reminders after durable deletion.
 */
@Remote deleteNotification(id: string): TaskNotice[]

/**
 * Mark one reminder read; viewing or closing the panel alone does not acknowledge it.
 * @param id - Exact retained notification identifier.
 * @returns Updated application inbox after durable acknowledgement.
 */
@Remote acknowledge(id: string): TaskNotice[]

/**
 * List open sessions without exposing credentials or changing their lifecycle.
 * @returns Eligible roots with their current workspace and execution settings.
 */
@Remote owners(): SchedulerOwner[]

/**
 * Read only the selected session's tasks and retained receipts.
 * @param agent - Root session resolved by the Remote Agent lookup.
 * @returns Persisted state and the minimum recurring interval.
 */
@Remote list(agent: Agent): SchedulerSnapshot

/**
 * Save a task using the selected session's model and permissions; this does not invoke a model.
 * @param agent - Creating root session resolved by the Remote Agent lookup.
 * @param input - Title, prompt, first target and optional period.
 * @returns The refreshed owner-scoped state after durable creation.
 */
@Remote async create(agent: Agent, input: CreateTaskRequest): Promise<SchedulerSnapshot>

/**
 * Change future admission of an owned task, without cancelling an active occurrence.
 * @param agent - Owning root session resolved by the Remote Agent lookup.
 * @param id - Task identifier belonging to that session.
 * @param action - Pause, resume or delete.
 * @returns Persisted owner-scoped state after the change.
 */
@Remote change(agent: Agent, id: string, action: 'pause' | 'resume' | 'delete'): SchedulerSnapshot
```

Types: [Agent](core.zh.md)

Source: [`packages/automation/task-scheduler/src/gateway.ts`](../../packages/automation/task-scheduler/src/gateway.ts)
<!-- END GENERATED cordis-surface -->
