/** Framework-neutral Settings contracts shared by Host providers and consumers. */
export type {
  SettingsDescribeValue,
  SettingsNamespace,
  SettingsNamespaceInput,
  SettingsNamespaceView,
  SettingsPathOpView,
  SettingsSecretView,
  SettingsUpdateSource,
} from './types.ts'
import type { SettingsNamespace, SettingsNamespaceInput } from './types.ts'

/** When a namespace's changes take effect for its owner. */
export type SettingsApplies = 'live' | 'restart'

/** One schema-declared secret position exposed without its value. */
export interface SettingsSecret {
  /** Path from the section root to the removed field. */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** One registered namespace as surfaced to configuration UIs. */
export interface SettingsDescriptor {
  /** The registered namespace. */
  ns: SettingsNamespace
  /** Serialized schemastery schema (`schema.toJSON()`). */
  schema: unknown
  /** Current resolved value. */
  value: unknown
  /** Monotonic revision of the raw user section. */
  revision: number
  /** Registrant's composition `base` layer, when one was declared. */
  base?: unknown
  /** Raw user section, when one exists and is well-formed. */
  user?: unknown
  /** Owner's declared effect timing. */
  applies: SettingsApplies
  /** Schema-declared secret positions; present only when redaction is requested. */
  secrets?: SettingsSecret[]
}

/** Options controlling secret removal from provider descriptors. */
export interface SettingsDescribeOptions {
  /**
   * Remove schema-declared secrets and return only their paths and presence.
   * Defaults to false, which leaves secret values in descriptors; every wire
   * surface must request `true`.
   */
  redactSecrets?: boolean
}

/** One path-addressed edit to a namespace's raw user section. */
export type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** Owner-facing handle for one registered namespace. */
export interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the user layer. */
  get(): T
  /**
   * Observe resolved changes serially in commit order. The disposer prevents
   * queued callbacks from starting; a started callback settles normally, and
   * service disposal waits for started callbacks to finish.
   * @param callback - receives the next and previous resolved value.
   * @returns a disposer that stops queued and future callbacks from starting.
   */
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  /**
   * Merge a patch into the namespace's user section.
   * @param patch - plain-object changes to merge.
   * @returns a promise settled after the provider commits the write.
   */
  update(patch: object): Promise<void>
  /**
   * Replace the namespace's user section wholesale.
   * @param section - complete next user section.
   * @returns a promise settled after the provider commits the write.
   */
  replace(section: object): Promise<void>
}

/** Framework-neutral operations used by the Cordis Settings service. */
export interface SettingsService {
  /** Whether the provider accepts writes. */
  readonly writable: boolean
  /** Absolute path of a provider-owned local document, when applicable. */
  readonly documentPath: string | undefined
  /**
   * Prepare and return the provider-owned document path when one exists.
   * @returns the prepared path, or `undefined` when the provider has no document.
   */
  prepareDocument(): Promise<string | undefined>
  /**
   * Describe registered namespaces for configuration surfaces.
   * @param options - optional secret-redaction settings.
   * @returns descriptors for active namespaces.
   */
  describe(options?: SettingsDescribeOptions): SettingsDescriptor[]
  /**
   * Read a namespace's resolved value, or `undefined` while unregistered.
   * @param namespace - namespace to read.
   * @returns the resolved value, or `undefined` when unregistered.
   */
  get<const Namespace extends string>(namespace: Namespace & SettingsNamespaceInput<Namespace>): unknown
  /**
   * Merge and persist a namespace's user section.
   * @param namespace - namespace to update.
   * @param patch - plain-object changes to merge into the user section.
   * @param expectedRevision - optional revision required for the write.
   * @returns a promise settled after the provider commits the write.
   */
  update<const Namespace extends string>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>, patch: object, expectedRevision?: number,
  ): Promise<void>
  /**
   * Replace and persist a namespace's user section.
   * @param namespace - namespace to replace.
   * @param section - complete next user section.
   * @param expectedRevision - optional revision required for the write.
   * @returns a promise settled after the provider commits the write.
   */
  replace<const Namespace extends string>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>, section: object, expectedRevision?: number,
  ): Promise<void>
  /**
   * Apply ordered path edits to a namespace's user section.
   * @param namespace - namespace to edit.
   * @param ops - ordered path edits.
   * @param expectedRevision - optional revision required for the write.
   * @returns a promise settled after the provider commits the write.
   */
  mutate<const Namespace extends string>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>, ops: readonly SettingsPathOp[], expectedRevision?: number,
  ): Promise<void>
}
