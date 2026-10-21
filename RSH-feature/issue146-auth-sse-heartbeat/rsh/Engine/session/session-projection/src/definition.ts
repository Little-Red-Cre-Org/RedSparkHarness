/** Shared pure fold Definition used by Cordis and Native projection registries. */

import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { ZodType } from 'zod'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

/**
 * One domain's synchronous projection unit. The registry applies each committed
 * event to its state; domain code owns no subscriptions or Session lifecycle.
 * State must be plain JSON for checkpoints, and an unrelated event must return
 * the same state reference so the registry can skip downstream work.
 */
export interface ProjectionDefinition<
  K extends keyof SessionProjectionStateMap,
  S extends SessionProjectionStateMap[K] = SessionProjectionStateMap[K],
> {
  /** The key owned in the merge-extensible state table. */
  key: K
  /** Validates persisted state before it seeds a fold or a whole client view. */
  stateSchema: ZodType<S>
  /**
   * State for the empty log and its immutable Session metadata.
   * @param header - immutable metadata for the Session being projected.
   * @param inheritedEventCount - exact fork-inherited prefix length.
   * @returns the initial state.
   */
  init(header: SessionHeader, inheritedEventCount: SessionLogOffset): NoInfer<S>
  /**
   * Pure transition from one committed event. An unaffected unit MUST return
   * the same state reference; changed references invalidate its cached view.
   * @param state - state covering all prior events.
   * @param event - the next accepted session event.
   * @returns next state, or the same reference when unaffected.
   */
  apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>
  /** Client view. Omit for host-only units. */
  wire?: K extends keyof SessionProjectionMap ? {
    /** Validates the wire payload before it leaves the host. */
    viewSchema: ZodType<SessionProjectionMap[K]>
    /**
     * Projects internal state to a whole client-visible value. Reuse the same
     * reference when the visible value has not changed; the registry compares
     * successive views with `Object.is`.
     * @param state - the current state.
     * @returns the complete value for this projection key.
     */
    view(state: NoInfer<S>): SessionProjectionMap[K]
  } : never
  /**
   * Non-negative cache version. Bump when serialized state or fold semantics
   * change so old checkpoint rows are discarded instead of forward-applied.
   */
  stateVersion: number
}
