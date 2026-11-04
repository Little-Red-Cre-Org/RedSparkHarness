/**
 * The settings-namespace scope the welcome notice binds, named structurally.
 *
 * ui-settings publishes this shape as `SettingsScope` on its Cordis half, and
 * its Native half publishes the same shape through `clientNativeSettings.bind`.
 * Naming only the members the notice reads keeps this controller usable by both
 * clients without importing a service class into a Native closure.
 */

/** Sync state of one settings namespace. */
export interface WelcomeScopeSnapshot<T> {
  /** `loading` until the first accepted section; `unavailable` when not served. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  readonly value: T | undefined
  /** Whether the Host document accepts writes; memory mode never does. */
  readonly writable: boolean
  /** `host` syncs with the Host document; `memory` keeps this process local. */
  readonly mode: 'host' | 'memory'
}

/** Reactive owner handle over one namespace's durable section. */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): WelcomeScopeSnapshot<T>
  /** @param listener - invoked after each snapshot change. @returns the disposer. */
  subscribe(listener: () => void): () => void
  /** @param field - scalar field inside the namespace section. @param value - chosen value. */
  set(field: string, value: unknown): Promise<void>
}
