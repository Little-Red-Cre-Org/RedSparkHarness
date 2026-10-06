/** Framework-neutral fatal workflow failure vocabulary. */
import { HarnessError } from '@deepseek-ai/dsh-llm/native'

/**
 * Machine-routable fatal workflow failures: parse/meta/argument/schema errors,
 * resource caps, subagent infrastructure failures, unserializable boundary
 * values, and cancellation. An ordinary child failure resolves its item to
 * `null` and is not one of these fatal codes.
 */
export type WorkflowErrorCode =
  | 'SCRIPT_PARSE'
  | 'META_INVALID'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_OPTION'
  | 'UNSUPPORTED_SCHEMA'
  | 'AGENT_CAP'
  | 'ITEM_CAP'
  | 'AGENT_START'
  | 'AGENT_RESULT'
  | 'RESULT_UNSERIALIZABLE'
  | 'CANCELLED'

/**
 * Typed error for workflow-seam failures. Extends {@link HarnessError}, so the
 * `code` is machine-routable taxonomy. `fatal` drives the combinator
 * discipline: `parallel()`/`pipeline()` re-throw a fatal error (a typo'd
 * option or a tripped cap must kill the script loudly), and reserve the
 * per-item `null` for child-run failures and ordinary in-stage script errors.
 * Every {@link WorkflowErrorCode} is fatal; the flag exists so the
 * distinction is explicit at every catch site rather than implied.
 */
export class WorkflowError extends HarnessError {
  /** Whether combinators must propagate this error instead of nulling the item. */
  readonly fatal: boolean

  constructor(message: string, code: WorkflowErrorCode, options?: ErrorOptions & { fatal?: boolean }) {
    super(message, code, options)
    this.name = 'WorkflowError'
    this.fatal = options?.fatal ?? true
  }
}

/**
 * Whether combinators must re-throw `error` instead of mapping the item to `null`.
 * @param error - any thrown value; fatality is host `instanceof` (unforgeable from a script realm).
 * @returns true iff `error` is a {@link WorkflowError} whose `fatal` flag is set.
 */
export function isFatalWorkflowError(error: unknown): boolean {
  return error instanceof WorkflowError && error.fatal
}
