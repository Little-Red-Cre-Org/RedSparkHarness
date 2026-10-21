/**
 * Event-only filesystem observation policy; it registers no service. A weak owner/target map
 * records every authoritative presence/absence observation, single-slot intent listeners derive
 * guards from that state, and the provider performs the atomic freshness/no-clobber check. Without
 * this plugin, tools retain the bare provider's unconditional mutation behavior. See the package
 * README for composition rules.
 * @module @deepseek-ai/dsh-fs-observation-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { ObservedStateGate } from './gate.ts'

export type { FsObservationActor } from './types.ts'

/**
 * Per-context observed-file state and the three `fs/*` decisions over it. One
 * instance is created per `apply()` so disposal can drop all state for HMR.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-observation-policy'

/**
 * Register the three `fs/*` listeners. No `inject` — this plugin reads no
 * services; it operates only on its own `WeakMap`. The waterfalls are unbound
 * (the tool dispatches them with no `this`), so the listeners take the raw
 * `(target, actor, next)` arguments.
 */
export function apply(ctx: Context): void {
  const gate = new ObservedStateGate()

  ctx.effect(() => () => {
    // Drop all recorded state on disposal so a reloaded plugin starts clean
    // (HMR safety). The WeakMap itself would be GC'd, but replacing it makes the
    // release observable and immediate for tests.
    gate.clear()
  }, 'fs-observation-policy observed-state teardown')

  // fs/write-intent: occupy the single decision slot — do NOT call next().
  // Deferred through Promise.resolve().then so the declared Promise return type
  // holds (a throw rejects, never escapes synchronously through the waterfall).
  ctx.on('fs/write-intent', (target, actor) => Promise.resolve().then(() => gate.writeIntent(target, actor)))

  // fs/edit-intent: occupy the single decision slot — do not call next().
  ctx.on('fs/edit-intent', (target, actor) => Promise.resolve().then(() => gate.editIntent(target, actor)))

  // fs/observed must remain synchronous and non-throwing: emit does not await
  // promises, and successful mutations have already committed. WeakMap.set
  // satisfies that contract for both presence and absence.
  ctx.on('fs/observed', (target, observation, actor) => {
    gate.observe(target, observation, actor)
  })
}
