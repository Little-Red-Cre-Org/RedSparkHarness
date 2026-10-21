/** Legacy credential types and Cordis event declarations. */
export type * from './native-types.ts'
import type { CredentialKey, CredentialRef } from './native-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to a provider-managed credential source: a `set`, an
     * `unset`, or an external edit observed in storage. Ambient
     * process-environment changes are not observable and never emit. Listener
     * failures are contained and logged — a sync throw and an async rejection
     * alike — without changing the committed operation's outcome, except
     * `INVARIANT`-coded failures, which rethrow after every listener ran;
     * that rethrow reaches the emitter only from synchronous listeners, so
     * invariant checks on this event must not be async functions.
     * @param ref - the reference whose stored value changed.
     * @mode emit
     */
    'credentials/reference-updated'(ref: CredentialRef): void

    /**
     * Committed change to a stored credential record: a `modifyRecord` that
     * wrote, a `deleteRecord` that removed, or an external edit observed in
     * storage. Separate from `credentials/reference-updated` because the two key
     * grammars are disjoint — a listener that received both on one event could
     * not tell which space a subject belongs to. Listener failures are
     * contained on the same terms as `credentials/reference-updated`.
     * @param key - the record whose stored value changed.
     * @mode emit
     */
    'credentials/record-updated'(key: CredentialKey): void
  }
}
