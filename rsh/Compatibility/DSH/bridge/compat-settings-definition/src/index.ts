/** Cordis-only Settings Context and event declarations for legacy consumers. */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type {
  SettingsApplies,
  SettingsNamespaceInput,
  SettingsScope,
  SettingsService,
} from '@deepseek-ai/dsh-settings-definition'
export type {} from './events.ts'

/** Registration options accepted by the Cordis Settings Provider. */
export interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the user layer. */
  base?: Partial<T>
  /** Owner's effect timing, surfaced to configuration UIs. */
  applies?: SettingsApplies
  /**
   * Reject a schema-valid resolved section the owner cannot act on. An invalid
   * stored section rejects initial registration; a later invalid stored edit
   * keeps the last good value when the provider reloads.
   */
  validate?: (value: T) => void
}

/** Hooks that keep an optional settings consumer on its composition entry when the Provider is absent. */
export interface SettingsSectionHooks<T> {
  /** Receive the current Settings source or its composition fallback. */
  setSource(current: () => T): void
  /** Re-evaluate values derived from the current source. */
  onChange(): void
  /** Reject a resolved section the consumer cannot act on. */
  validate?: (value: T) => void
}

/** Cordis-facing extension of the framework-neutral Settings service. */
export interface CordisSettingsService extends SettingsService {
  /**
   * Register a namespace schema and receive its owner scope. The registration
   * is tied to the owner's Cordis fiber. Invalid stored data rejects initial
   * registration; a later invalid edit keeps the last good value on reload.
   * @param namespace - unique lowercase namespace; duplicates fail loud.
   * @param schema - schemastery schema resolving the namespace's value.
   * @param options - composition base, effect timing, and owner validation.
   * @returns the scope for reads, observation, and updates.
   */
  register<const Namespace extends string, T>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    schema: z<T>,
    options?: SettingsRegisterOptions<T>,
  ): SettingsScope<T>
  /**
   * Install a settings section owned by another Cordis plugin.
   * @param owner - plugin fiber that receives the registered section.
   * @param namespace - unique lowercase namespace for the entry.
   * @param schema - schema resolving the entry and future user edits.
   * @param entry - composition-layer value used when the provider is absent.
   * @param hooks - callbacks for current values, changes, and owner validation.
   * @returns nothing; the registration is disposed with the owner's fiber.
   */
  installSection<const Namespace extends string, T>(
    owner: Context,
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    schema: z<T>,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settings: CordisSettingsService
  }
}
