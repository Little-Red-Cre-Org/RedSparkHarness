/** Cordis lifecycle adapter for the framework-independent SlotRuntime. */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof SlotMap & string` is the declare-merge key pattern: SlotMap only
 * holds this package's 'root' row in this compilation unit, but consumers
 * merge keys in; the rule fires on the narrow-map view, not on real
 * redundancy. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  LiveSlotNode, LocaleFace, OwnerOf, SlotMap, SlotRenderer, SlotScope, SlotScopeAdapter,
  RootStandardSourceContribution, ScopedStandardSourceBinding, SlotSpec,
  StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRuntime, type SlotInjectionEffect } from '../slot-runtime.ts'

export type { RootOwnerProps } from '../slot-runtime.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A slot declaration or registration set changed.
     * @mode emit
     * @param key - mutated SlotMap key.
     */
    'slots/changed'(key: string): void
  }
  interface Context {
    /** Renderer-owned UI composition registry. */
    slots: SlotRegistry
  }
}

/** Cordis service that owns SlotRuntime registrations by plugin fiber. */
export class SlotRegistry extends Service {
  private readonly _runtime: SlotRuntime

  /** @param ctx - application context used to publish slot mutations and own effects. */
  constructor(ctx: Context) {
    super(ctx, 'slots')
    this._runtime = new SlotRuntime(
      (key) => { ctx.emit('slots/changed', key) },
      (callback, label) => {
        const dispose = ctx.effect(callback, label)
        return () => { void dispose() }
      },
    )
  }

  /** The typed registration face is the SlotCore API; Cordis owns its disposer. */
  declare readonly register: SlotCore['register']

  /**
   * Run setup for each live declaration and bind the controller to the caller's fiber.
   * @param key - declared SlotMap key to depend on.
   * @param callback - creates one disposer or an iterable of disposers.
   * @returns idempotent disposer for the wait and active effect.
   */
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void {
    const caller = this.ctx
    const dispose = this.ctx.effect(
      () => this._runtime.inject(key, callback, (setup, label) => {
        const stop = caller.effect(setup, label)
        return () => { void stop() }
      }),
      `slots.inject(${JSON.stringify(key)})`,
    )
    return () => { void dispose() }
  }

  /**
   * Install the shell renderer under the installing plugin's lifetime.
   * @param renderer - shell renderer used by root slot outlets.
   */
  install(renderer: SlotRenderer): void {
    this.ctx.effect(() => this._runtime.install(renderer), 'slots.install()')
  }

  /**
   * Install the locale face under the installing plugin's lifetime.
   * @param face - locale namespace binder and revision source.
   */
  installLocale(face: LocaleFace): void {
    this.ctx.effect(() => this._runtime.installLocale(face), 'slots.installLocale()')
  }

  /**
   * Contribute domain-owned root sources under the caller's plugin lifetime.
   * @param contribution - observable sources and stable props.
   * @returns disposer for the contribution.
   */
  provideRoot(contribution: RootStandardSourceContribution): () => void {
    const dispose = this.ctx.effect(
      () => this._runtime.provideRoot(contribution),
      'slots.provideRoot()',
    )
    return () => { void dispose() }
  }

  /**
   * Install one scope adapter under the caller's plugin lifetime.
   * @param scope - strict slot scope handled by the adapter.
   * @param adapter - owner lookup and release notifications for the scope.
   */
  installScope(
    scope: Exclude<SlotScope, 'root' | 'session-maybe'>,
    adapter: SlotScopeAdapter,
  ): void {
    this.ctx.effect(
      () => this._runtime.installScope(scope, adapter),
      `slots.installScope(${JSON.stringify(scope)})`,
    )
  }

  /**
   * Bind scoped store cleanup to the supplied owner lifetime.
   * @param binding - store key and lifetime that owns its cleanup.
   */
  bindStoreScope(binding: Pick<ScopedStandardSourceBinding, 'key' | 'lifetime'>): void {
    this._runtime.bindStoreScope(binding)
  }

  /**
   * Render a slot through the installed React renderer.
   * @param key - declared SlotMap key to render.
   * @param owner - props accepted by the selected slot.
   * @returns rendered slot tree.
   */
  renderSlot<K extends keyof SlotMap & string>(key: K, owner: OwnerOf<K>): ReturnType<SlotRenderer['renderRoot']> {
    return this._runtime.renderSlot(key, owner)
  }

  /**
   * Snapshot registrations for one key.
   * @param key - declared SlotMap key to inspect.
   * @returns entries registered under the key.
   */
  entries(key: keyof SlotMap & string): readonly StoredEntry[] {
    return this._runtime.entries(key)
  }

  /**
   * Return the active entries selected for each slot cell.
   * @param key - declared SlotMap key to inspect.
   * @returns active entries selected for the key.
   */
  entriesOfSlot(key: keyof SlotMap & string): readonly StoredEntry[] {
    return this._runtime.entriesOfSlot(key)
  }

  /**
   * Export the live declaration tree.
   * @param root - exact live slot root to inspect; omit to include every root.
   * @returns JSON-safe declaration nodes under the selected root or roots.
   */
  snapshot(root?: string): LiveSlotNode[] {
    return this._runtime.snapshot(root)
  }

  /**
   * Observe render-boundary failures.
   * @param fn - observer called with the slot, entry, cause, and retirement state.
   * @returns disposer that stops notifications.
   */
  onEntryError(fn: Parameters<SlotRuntime['onEntryError']>[0]): () => void {
    return this._runtime.onEntryError(fn)
  }

  /**
   * Look up a declared or built-in slot.
   * @param key - declared SlotMap key to look up.
   * @returns the slot specification, or undefined when no declaration exists.
   */
  spec<K extends keyof SlotMap & string>(key: K): SlotSpec<SlotMap[K]> | undefined {
    return this._runtime.spec(key)
  }

  /**
   * Subscribe to one slot's registration changes.
   * @param key - declared SlotMap key to observe.
   * @param fn - callback invoked after the key's registration changes.
   * @returns disposer that removes the subscription.
   */
  subscribe(key: keyof SlotMap & string, fn: () => void): () => void {
    return this._runtime.subscribe(key, fn)
  }

  /**
   * Read the current external-store version for one slot.
   * @param key - declared SlotMap key to read.
   * @returns current version used by external-store subscribers.
   */
  getVersion(key: keyof SlotMap & string): number {
    return this._runtime.getVersion(key)
  }
}

// The service proxy binds `this.ctx` to the caller, so each registration is
// owned by the plugin that contributes the entry rather than by this service.
;(SlotRegistry.prototype as { register: (options: object, component: unknown) => () => void }).register
  = function register(this: SlotRegistry, rawOptions: object, component: unknown): () => void {
    const options = rawOptions as Record<string, unknown>
    const registrant = options['registrant'] ?? (this.ctx.fiber as { name?: string } | undefined)?.name
    const ownedOptions = registrant === undefined ? options : { ...options, registrant }
    const register = this['_runtime'].register as unknown as (options: object, component: unknown) => () => void
    const dispose = this.ctx.effect(
      () => register.call(this['_runtime'], ownedOptions, component),
      'slots.register()',
    )
    return () => { void dispose() }
  }
