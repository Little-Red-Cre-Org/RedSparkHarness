/** Localized keys consumed by the shared Workspace and Session row views. */
export type WorkspaceRowKey =
  | 'actions.newSession.aria'
  | 'actions.session.aria'
  | 'actions.workspace.aria'
  | 'cancel'
  | 'close'
  | 'copy'
  | 'date.ymd'
  | 'delete.sessionNote'
  | 'delete.workspace'
  | 'group.ungrouped'
  | 'hover.copied'
  | 'hover.created'
  | 'menu.archiveSession'
  | 'menu.fork'
  | 'menu.removeSession'
  | 'rename'
  | 'schedule.active'
  | 'session.new'
  | 'status.completed'
  | 'status.idle'
  | 'status.planReview'
  | 'status.running'
  | 'status.subagentsRunning.one'
  | 'status.subagentsRunning.other'
  | 'status.waitingAnswer'
  | 'status.waitingApproval'
  | 'time.ago'
  | 'time.days'
  | 'time.hours'
  | 'time.minutes'
  | 'time.months'
  | 'time.now'
  | 'time.years'

/** Translation function accepted by the shared row components. */
export type WorkspaceRowTranslate = (key: WorkspaceRowKey, params?: Record<string, unknown>) => string

/** Pending user interactions with dedicated row status labels. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Session facts used by grouped, flat, and search row presentation. */
export interface SessionRowNode<Id extends string = string> {
  id: Id
  title: string
  blank?: boolean
  pendingInteraction?: SessionPendingInteractionStatus
  running?: boolean
  runningSubagentCount?: number
  completed?: boolean
  hasActiveSchedule?: boolean
  updatedAt?: number
}

/** Workspace group data consumed by its expandable heading. */
export interface WorkspaceGroupRow<WorkspaceId extends string = string, SessionId extends string = string> {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessionCount: number
  expanded: boolean
  containsCurrent: boolean
  sessions: readonly SessionRowNode<SessionId>[]
}

/** Search result facts consumed by the flat search row. */
export interface SessionSearchRow<Id extends string = string> {
  id: Id
  title: string
  workspace: string
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  runningSubagentCount: number
  completed: boolean
  hasActiveSchedule: boolean
  snippet?: string
}
