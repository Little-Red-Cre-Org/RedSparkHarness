/**
 * Runtime-neutral `/compact` argument validation and result presentation
 * shared by the Cordis and native command Consumers.
 * @module @deepseek-ai/dsh-command-compact/common
 */

import { ManualCompactionError } from '@deepseek-ai/dsh-compaction/native'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction/native'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandResult } from '@deepseek-ai/dsh-commands/facts'

/** Stable command definition identity shared by both runtimes. */
export const COMPACT_DEFINITION_ID = '@deepseek-ai/dsh-command-compact'
/** Registered command name. */
export const COMPACT_COMMAND_NAME = 'compact'
/** Human-facing command description. */
export const COMPACT_COMMAND_DESCRIPTION = 'Compact older conversation history'

/** The invocation fields one `/compact` execution reads. */
export interface CompactInvocation {
  readonly commandId: CommandId
  readonly rawInput: string
  readonly signal: AbortSignal
}

const USAGE = 'Usage: /compact (no arguments)'

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
function expectedFailure(error: ManualCompactionError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'summary':
      return {
        kind: 'error',
        text: 'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.',
      }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/**
 * Execute one argument-free manual compaction request.
 * @param invocation - command identity, raw arguments and cancellation.
 * @param compactNow - the selected backend's explicit idle compaction.
 * @returns the human-only command outcome.
 * @throws unexpected backend failures that are not {@link ManualCompactionError}.
 */
export async function executeCompact(
  invocation: CompactInvocation,
  compactNow: (signal: AbortSignal, sourceCommandId: CommandId) => Promise<CompactionResult | null>,
): Promise<CommandResult> {
  if (invocation.rawInput.trim().length > 0) {
    return { kind: 'error', text: USAGE }
  }
  try {
    const result = await compactNow(invocation.signal, invocation.commandId)
    if (result === null) return { kind: 'success', text: 'No compactable history yet.' }
    return {
      kind: 'success',
      text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
      sourceEventSeq: result.summarySeq,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    throw error
  }
}
