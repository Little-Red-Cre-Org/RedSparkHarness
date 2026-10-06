/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. Providers
 * extend this map through declaration merging on
 * `@deepseek-ai/dsh-subagent-protocol`. The known cases mirror the harness
 * turn-end vocabulary so the tool layer can map a non-`completed` result to an
 * `isError` tool result.
 */
export interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}

/** The union over {@link SubagentStopReasonMap} — widens as backends add variants. */
export type SubagentStopReason = SubagentStopReasonMap[keyof SubagentStopReasonMap]
