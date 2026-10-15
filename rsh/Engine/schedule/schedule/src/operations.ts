/** Shared durable Schedule management operations for Cordis and Native owners. */

import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import {
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  foldScheduleEvents,
  MIN_EVERY_INTERVAL_SECONDS,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  scheduleView,
} from './domain.ts'
import { runScheduleTransaction } from './transaction.ts'
import type {
  AtInput,
  InternalScheduleError,
  PersistenceUncertainError,
  ScheduleChange,
  ScheduleCreateValue,
  ScheduleDeleteValue,
  ScheduleId as ScheduleIdType,
  ScheduleListValue,
  SchedulePersistenceOperation,
  ScheduleRecord,
  ScheduleToolError,
} from './types.ts'

/** Minimal exact-owner operations required by a management transaction. */
export interface ScheduleOperationOwner {
  /** One identity shared by tools and the timer runtime's FIFO. */
  readonly key: object
  /** Exact inherited event prefix excluded from this Session's Schedule fold. */
  readonly inheritedEventCount: number
  /** Whether the same owner can still admit management work. */
  isCurrent(): boolean
  /** Flush accepted Session writes before a read or decision. */
  flush(): Promise<void>
  /** Read the complete accepted history through the same owner. */
  readEvents(): Promise<readonly SessionEvent[]>
  /** Append one versioned Schedule change through the sole Session writer. */
  append(change: ScheduleChange): void
  /** Ask the live timer projection to recompute after a successful barrier. */
  onDurableChange(): void
}

/** Canonical model arguments accepted by schedule_create. */
export interface ScheduleCreateArgs {
  readonly prompt: string
  readonly after_seconds?: number
  readonly at?: AtInput
  readonly every_seconds?: number
}

/** Closed error for failures that must not expose an internal exception. */
function internalError(): InternalScheduleError {
  return { code: 'internal_error', message: 'The schedule operation failed.' }
}

/** Closed persistence error with the known operation identity. */
function persistenceError(operation: SchedulePersistenceOperation, id?: ScheduleIdType): PersistenceUncertainError {
  return {
    code: 'persistence_uncertain',
    message: 'Schedule persistence is uncertain; retry with schedule_list before relying on this result.',
    operation,
    ...id === undefined ? {} : { id },
  }
}

/** Translate a contained input failure to the public error union. */
function inputError(error: ScheduleInputError): ScheduleToolError {
  return { code: error.code, message: error.message }
}

/** Validate the selector constraints that the open parameter root cannot express. */
export function validateScheduleCreateArgs(args: ScheduleCreateArgs): ScheduleToolError | undefined {
  const keys = Object.keys(args as unknown as Record<string, unknown>)
  if (keys.some(key => key !== 'prompt'
    && key !== 'after_seconds'
    && key !== 'at'
    && key !== 'every_seconds')
    || Number(args.after_seconds !== undefined)
    + Number(args.at !== undefined)
    + Number(args.every_seconds !== undefined) !== 1) {
    return {
      code: 'invalid_selector',
      message: 'schedule_create accepts exactly one of after_seconds, at, or every_seconds.',
    }
  }
  if (args.prompt.trim().length === 0) {
    return { code: 'invalid_prompt', message: 'prompt must be non-empty after trimming.' }
  }
  if (args.after_seconds !== undefined
    && (!Number.isSafeInteger(args.after_seconds) || args.after_seconds <= 0)) {
    return { code: 'invalid_rule', message: 'after_seconds must be a positive safe integer.' }
  }
  if (args.every_seconds !== undefined && !Number.isSafeInteger(args.every_seconds)) {
    return { code: 'invalid_rule', message: 'every_seconds must be a safe integer.' }
  }
  if (args.every_seconds !== undefined && args.every_seconds < MIN_EVERY_INTERVAL_SECONDS) {
    return {
      code: 'frequency_too_high',
      message: `every_seconds must be at least ${MIN_EVERY_INTERVAL_SECONDS}.`,
    }
  }
  return undefined
}

/** Flush and fold one exact owner's accepted Session history. */
async function preflight(
  owner: ScheduleOperationOwner,
  operation: SchedulePersistenceOperation,
  id?: ScheduleIdType,
): Promise<ReturnType<typeof foldScheduleEvents> | ScheduleToolError> {
  try {
    await owner.flush()
  } catch {
    return persistenceError(operation, id)
  }
  owner.onDurableChange()
  try {
    return foldScheduleEvents(await owner.readEvents(), SessionLogOffset(owner.inheritedEventCount))
  } catch (error: unknown) {
    if (error instanceof ScheduleLogError) {
      return { code: 'corrupt_schedule_log', message: 'The session schedule log is corrupt.' }
    }
    return internalError()
  }
}

/** Return one fold failure without conflating it with replay state. */
function isToolError(value: ReturnType<typeof foldScheduleEvents> | ScheduleToolError): value is ScheduleToolError {
  return 'code' in value
}

/** Serialize one management call with the exact owner's other Schedule operations. */
async function transact<T>(owner: ScheduleOperationOwner, signal: AbortSignal, task: () => Promise<T>): Promise<T | InternalScheduleError> {
  return runScheduleTransaction(owner.key, async () => {
    if (signal.aborted || !owner.isCurrent()) return internalError()
    return task()
  })
}

/** Create and durably confirm one reminder in its owning Session. */
export function createSchedule(
  owner: ScheduleOperationOwner,
  args: ScheduleCreateArgs,
  signal: AbortSignal,
): Promise<ScheduleCreateValue | InternalScheduleError> {
  const invalid = validateScheduleCreateArgs(args)
  if (invalid !== undefined) return Promise.resolve(invalid)
  return transact(owner, signal, async () => {
    const folded = await preflight(owner, 'create')
    if (isToolError(folded)) return folded
    const id = allocateScheduleId(folded)
    let record: ScheduleRecord
    try {
      if (args.at !== undefined) {
        record = createAtScheduleRecord(id, args.prompt, args.at, Date.now())
      } else if (args.after_seconds !== undefined) {
        record = createAfterScheduleRecord(id, args.prompt, args.after_seconds, Date.now())
      } else {
        record = createEveryScheduleRecord(id, args.prompt, args.every_seconds as number, Date.now())
      }
    } catch (error: unknown) {
      return error instanceof ScheduleInputError ? inputError(error) : internalError()
    }
    if (signal.aborted || !owner.isCurrent()) return internalError()
    try {
      owner.append({ version: 1, operation: 'create', schedule: record })
    } catch {
      return internalError()
    }
    try {
      await owner.flush()
    } catch {
      return persistenceError('create', id)
    }
    owner.onDurableChange()
    return scheduleView(record, Date.now())
  })
}

/** List all active reminders after the exact owner's persistence preflight. */
export function listSchedules(
  owner: ScheduleOperationOwner,
  signal: AbortSignal,
): Promise<ScheduleListValue | InternalScheduleError> {
  return transact(owner, signal, async () => {
    const folded = await preflight(owner, 'list')
    if (isToolError(folded)) return folded
    const now = Date.now()
    return folded.active.map(record => scheduleView(record, now))
  })
}

/** Delete one active reminder and confirm only after its append is durable. */
export function deleteSchedule(
  owner: ScheduleOperationOwner,
  rawId: string,
  signal: AbortSignal,
): Promise<ScheduleDeleteValue | InternalScheduleError> {
  if (rawId.length === 0 || rawId.trim() !== rawId) {
    return Promise.resolve({
      code: 'invalid_rule',
      message: 'schedule_delete id must be non-empty without surrounding whitespace.',
    })
  }
  const id = ScheduleId(rawId)
  return transact(owner, signal, async () => {
    const folded = await preflight(owner, 'delete', id)
    if (isToolError(folded)) return folded
    if (!folded.active.some(record => record.id === id)) {
      return { id, deleted: false, code: 'schedule_not_found' }
    }
    if (signal.aborted || !owner.isCurrent()) return internalError()
    try {
      owner.append({ version: 1, operation: 'delete', id })
    } catch {
      return internalError()
    }
    try {
      await owner.flush()
    } catch {
      return persistenceError('delete', id)
    }
    owner.onDurableChange()
    return { id, deleted: true }
  })
}
