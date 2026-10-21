/** Client-safe GUI requests and snapshots. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Task, Run } from './types.ts'

/** A durable occurrence notification, independent of whether its owning conversation is open. */
export interface TaskNotice {
  taskId?: string
  occurrenceCount?: number
  directReminder?: boolean
  recurring?: boolean
  nextAt?: number | null
  endAt?: string
  planState?: Task['state']
  id: string
  title: string
  body: string
  time: number
  phase: 'due' | 'completed' | 'failed' | 'blocked' | 'interrupted'
  sessionId: string | null
  read: boolean
  dismissed?: boolean
}

/** Human-authored scheduling fields; execution configuration comes from the selected session. */
export interface CreateTaskRequest {
  delaySeconds?: number | undefined
  delayFromAt?: boolean | undefined
  kind?: 'goal' | 'scheduled' | undefined
  completionCriteria?: string | undefined
  maxGoalRounds?: number | undefined
  title: string
  prompt: string
  at: string
  endAt?: string | undefined
  everySeconds?: number | undefined
}
/** A currently open root session eligible to own scheduled tasks. */
export interface SchedulerOwner {
  id: SessionId
  title: string
  workspace: string
  model: string
  permission: string
}
/** Owner-scoped persisted state shown by the task panel. */
export interface SchedulerSnapshot {
  tasks: Task[]
  runs: (Run & { reminderStartedAt?: number | null; title?: string; kind?: 'goal' | 'scheduled' | undefined })[]
  minEverySeconds: number
}
