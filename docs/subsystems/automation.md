# Agent automation

English | [中文](automation.zh.md)

The [task scheduler](../../packages/automation/task-scheduler/README.md) composes independent Agent executions from persisted plans. Its [decision record](../../.agents/notes/implemented/feature/2026-09-15-agent-task-scheduler.md) owns restart and duplicate-execution tradeoffs. Existing [session-local reminders](schedule.md) have a separate owner and delivery contract.

## Records and authority

[TaskInput and Task](../../packages/automation/task-scheduler/src/types.ts) capture the title, prompt, absolute workspace, provider and model identifiers, preset identifiers, first target and optional fixed interval. A plan belongs to its creating session. Its state controls future admission; a null next target means a one-shot occurrence has already been claimed. Credentials remain in the provider's credential service.

[Run](../../packages/automation/task-scheduler/src/types.ts) identifies one occurrence and records its scheduled time, start, deadline, settlement, execution-session link and outcome. All numeric times are Unix milliseconds. SQLite owns plans and receipts; the execution session owns model messages and tool results. A completed receipt means the durable Agent turn ended, not that generated code passed verification.

## Admission window

The optional RFC 3339 `TaskInput.endAt` is exclusive and later than `at`. Plan expiry clears future admission without cancelling a running receipt. Startup does not catch up plans whose end has passed. A null `Task.nextAt` also represents an exhausted bounded interval plan, not only a claimed one-shot. The `CreateTaskRequest` and `task_schedule.end_at` inputs share this storage validation.

## Admission and lifecycle

[TaskStore](../../packages/automation/task-scheduler/src/store.ts) creates a running receipt and advances the next target in one immediate SQLite transaction. A unique task/target pair and the running-claim check prevent duplicate admission of the same occurrence and overlapping claims for one task. Missed recurring periods coalesce to the latest due target. Expired claims become interrupted and pause their task; their external effects are uncertain.

[SchedulerEngine](../../packages/automation/task-scheduler/src/engine.ts) owns polling and cancellation. The [execution adapter](../../packages/automation/task-scheduler/src/execute.ts) resolves existing presets, creates an independent Agent, preserves permission checks, and reads its durable turn settlement. Plugin unload stops admission and drains cancellation before closing its connection. Application shutdown stops execution; stored plans remain for the next mount.

## Notification records

`TaskNotice` describes one application-scoped occurrence card that transitions from due to its actual outcome: stable occurrence/phase identity, title, bounded body, timestamp, optional execution-session identifier and read flag. Committed plans and run receipts are its authority; queued and admitted due notices share the task/target identity. The additive SQLite version 2 `notice_reads` table owns explicit acknowledgement only; pruning a receipt prunes its acknowledgement rows. A due notice does not assert execution success. Native notifications are best-effort projections of unread notices.

## Migration boundary

The GUI contracts are `CreateTaskRequest` (human scheduling fields), `SchedulerOwner` (an eligible open root session) and `SchedulerSnapshot` (owner-scoped plans, receipts and interval limits). Their declarations live in [gui-types.ts](../../packages/automation/task-scheduler/src/gui-types.ts).

[Plugin composition](../../packages/automation/task-scheduler/src/index.ts) and the [scoped management tool](../../packages/automation/task-scheduler/src/tools.ts) connect these components without changing AgentLoop. A runtime refactor can replace the execution adapter while retaining plan storage and admission semantics. The `taskScheduler` Context service exposes authenticated Remote management for the optional settings panel. Agent arguments resolve through the existing carrier, and every operation retains the selected root session ownership boundary. No Session event variants are added.
<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

Source: [`packages/automation/task-scheduler/src/gateway.ts`](../../packages/automation/task-scheduler/src/gateway.ts)
<!-- END GENERATED cordis-surface -->
