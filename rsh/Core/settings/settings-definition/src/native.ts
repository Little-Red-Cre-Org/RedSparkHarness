/** Framework-free Native Settings service and storage contracts. */
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { SettingsApplies } from './index.ts'
import type { SettingsNamespaceInput } from './types.ts'
export type { SettingsNamespaceInput } from './types.ts'

/** Raw per-namespace overrides in the Settings document. */
export type NativeSettingsSection = Record<string, unknown>

/** Storage commits a complete document against its latest durable revision. */
export interface NativeSettingsStorage {
  /** Read the complete persisted settings document. @returns the stored raw sections. */
  load(): Promise<NativeSettingsSection>
  /**
   * Commit a document update against the latest persisted version.
   * @param update - transforms the latest raw document.
   * @returns the committed raw document.
   */
  persist(update: (document: NativeSettingsSection) => NativeSettingsSection): Promise<NativeSettingsSection>
}

/** One redacted registration exposed to a Native settings page. */
export interface NativeSettingsDescriptor {
  /** Owning Settings namespace. */
  readonly namespace: string
  /** Serialized schema without defaults. */
  readonly schema: unknown
  /** Redacted resolved values. */
  readonly value: unknown
  /** Redacted composition base. */
  readonly base: unknown
  /** Redacted stored user overrides. */
  readonly user: unknown
  /** When the owner applies changes. */
  readonly applies: SettingsApplies
  /** Secret paths and whether each hidden value is currently present. */
  readonly secrets: readonly { readonly path: string[]; readonly set: boolean }[]
  /** Active credential references. */
  readonly credentialRefs: readonly string[]
  /** Revision of the stored user section. */
  readonly revision: number
}

/** One path-addressed change to a registered namespace's raw user section. */
export type NativeSettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Optional metadata needed before a registration is exposed to Native UI. */
export interface NativeSettingsPresentation {
  /** Live schema whose JSON and role metadata describe this registration. */
  readonly schema: { toJSON(): unknown }
  /** When the owner applies changes; defaults to `live`. */
  readonly applies?: SettingsApplies
}

/** Resolved namespace owner with writes restricted to its raw user section. */
export interface NativeSettingsScope<T> {
  /** Read the current resolved namespace value. @returns the frozen value. */
  get(): T
  /** Current persisted revision of this namespace's user section. */
  readonly revision: number
  /**
   * Merge changes into this namespace's user section.
   * @param patch - raw user-section fields to merge.
   * @param expectedRevision - required current revision.
   * @returns a promise settled after persistence and resolved-value publication.
   *   Watcher callbacks run asynchronously and are drained at service disposal.
   */
  update(patch: NativeSettingsSection, expectedRevision?: number): Promise<void>
  /**
   * Replace this namespace's user section.
   * @param section - complete raw user section.
   * @param expectedRevision - required current revision.
   * @returns a promise settled after persistence and resolved-value publication.
   *   Watcher callbacks run asynchronously and are drained at service disposal.
   */
  replace(section: NativeSettingsSection, expectedRevision?: number): Promise<void>
  /**
   * Observe committed resolved values serially in commit order. The disposer
   * prevents queued callbacks from starting; a started callback settles
   * normally, and service disposal waits for started callbacks to finish.
   * @param callback - receives the next and previous resolved values.
   * @returns a disposer that stops queued and future callbacks from starting.
   */
  watch(callback: (next: T, previous: T) => void | Promise<void>): () => void
  /** Stop observing and release this registered namespace. */
  dispose(): void
}

/** State service implemented by the selected Native Settings Provider. */
export interface NativeSettingsService {
  /**
   * Load persisted state before namespace owners register.
   * @returns a promise settled when the document is ready.
   */
  start(): Promise<void>
  /**
   * Register one namespace owner.
   * @param namespace - lowercase namespace identifier.
   * @param base - composition values beneath stored user overrides.
   * @param resolve - validates and resolves the effective section.
   * @param validateWrite - optionally rejects a candidate before persistence.
   * @param presentation - metadata required for Native UI exposure.
   * @returns an owner scope for reads, updates, observation, and disposal.
   */
  register<const Namespace extends string, T>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    base: NativeSettingsSection,
    resolve: (value: NativeSettingsSection) => T,
    validateWrite?: (next: T, previous: T) => void,
    presentation?: NativeSettingsPresentation,
  ): NativeSettingsScope<T>
  /** Describe registrations exposed to Native configuration surfaces. @returns redacted descriptors. */
  describe(): NativeSettingsDescriptor[]
  /**
   * Apply ordered path edits to a namespace's raw user section.
   * @param namespace - namespace to edit.
   * @param ops - ordered path operations.
   * @param expectedRevision - required current revision.
   * @returns a promise settled after persistence and resolved-value publication.
   *   Watcher callbacks run asynchronously and are drained at service disposal.
   */
  mutate<const Namespace extends string>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    ops: readonly NativeSettingsPathOp[], expectedRevision: number,
  ): Promise<void>
  /** Reload the stored document and publish valid resolved changes. @returns a promise settled after all work completes. */
  reload(): Promise<void>
  /** Drain writes and observers before releasing the service. @returns a promise settled after disposal. */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    settings: NativeSettingsService
  }
}
