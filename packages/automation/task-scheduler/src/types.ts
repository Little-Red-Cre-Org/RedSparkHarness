/** Persisted task definitions and execution receipts. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identity of one scheduled plan. */
export type TaskId = Branded<'ScheduledTaskId'>
/** Durable identity of one claimed occurrence. */
export type RunId = Branded<'ScheduledTaskRunId'>
/** User intent plus the creating session's captured execution configuration. */
export interface TaskInput {
  countdownStartedAt?: string | undefined
  kind?: 'goal' | 'scheduled' | undefined
  completionCriteria?: string | undefined
  maxGoalRounds?: number | undefined
  title: string
  prompt: string
  workspace: string
  agentPreset: string
  permissionPreset: string
  provider: string
  model: string
  at: string
  /** Optional exclusive admission deadline; running work is not cancelled. */
  endAt?: string | undefined
  everySeconds?: number | undefined
}
/** Persisted plan; null nextAt means no further admission (claimed one-shot or exhausted schedule window). */
export interface Task extends TaskInput {
  /** Frozen delay to the next occurrence while a scheduled task is paused. */
  pausedRemainingMs?: number
  journalSessionId?: string
  resumeSessionId?: string
  id: TaskId
  ownerSessionId: string
  state: 'active' | 'paused' | 'deleted'
  nextAt: number | null
}
/** Occurrence receipt; all numeric timestamps use Unix milliseconds. */
export interface Run {
  id: RunId
  taskId: TaskId
  scheduledAt: number
  startedAt: number
  deadline: number
  finishedAt: number | null
  state: 'running' | 'completed' | 'failed' | 'blocked' | 'interrupted'
  sessionId: string | null
  detail: string
}
/** Adapter settlement; completed certifies an Agent turn, not code correctness. */
export interface ExecutionResult {
  state: 'completed' | 'failed' | 'blocked'
  sessionId: string
  detail: string
}
/** Run one occurrence and honor cancellation before releasing its execution resources. */
export type ExecuteTask = (task: Task, run: Run, signal: AbortSignal, progress?: (detail: string) => void) => Promise<ExecutionResult>
/** Polling, execution and retention limits validated by the plugin configuration. */
export interface SchedulerOptions {
  /** Milliseconds between due-time checks; does not change the stored target time. */
  pollMs: number
  /** Maximum milliseconds allowed for one execution before cancellation and uncertain settlement. */
  runTimeoutMs: number
  /** Maximum simultaneous running claims across users of the same database. */
  maxConcurrent: number
  /** Finished receipts retained per task and maximum receipts returned by a history query. */
  historyLimit: number
  /** Minimum fixed recurring interval accepted at creation, in seconds. */
  minEverySeconds: number
}
