/** Cordis event declarations for the compatibility Settings face. */
import type { SettingsNamespace, SettingsUpdateSource } from '@deepseek-ai/dsh-settings-definition/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to one registered namespace's resolved value. Emitted
     * after the provider persisted (for `update`) or published (`provider`)
     * the change; never emitted when the resolved value is deep-equal.
     * Listener failures are contained and logged — a sync throw and an async
     * rejection alike — except `INVARIANT`-coded failures, which rethrow
     * after every listener ran; that rethrow reaches the emitter only from
     * synchronous listeners, so invariant checks on this event must not be
     * async functions.
     * @param ns - the namespace whose resolved value changed.
     * @param next - the new resolved value.
     * @param prev - the previous resolved value.
     * @param source - whether the change entered through `update()` or the provider.
     * @mode emit
     */
    'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void
    /**
     * One registered namespace's raw user section changed, whether or not the
     * resolved value did. `settings/updated` is the consumer-facing event and
     * stays deep-equal-gated; this event tells configuration surfaces that a
     * field became overridden and their held revision is stale.
     * @param ns - the namespace whose stored section changed.
     * @param revision - the namespace's new revision.
     * @mode emit
     */
    'settings/document-updated'(ns: SettingsNamespace, revision: number): void
  }
}
