/**
 * The slice of the Client Remote assembly the Models page drives.
 *
 * The browser build reads it from `ctx.remote`; a Native host reaches the same
 * facts through `clientNativeSession` and adapts them into this shape. Naming
 * the slice here is what lets one page implementation serve both clients: the
 * store, the operations and every provider card stay identical, and only the
 * object satisfying this interface changes.
 */

/** One schema-declared secret slot; the value itself never rides. */
export interface ModelsSecretView {
  /** Path from the section root to the field. */
  readonly path: string[]
  /** Whether the slot currently holds a value. */
  readonly set: boolean
}

/** Wire view of one settings namespace, always read under secret redaction. */
export interface SettingsNamespaceView {
  /** Namespace key. */
  readonly ns: string
  /** Serialized schemastery schema envelope. */
  readonly schema: unknown
  /** Redacted resolved value. */
  readonly value: unknown
  /** Redacted composition base layer, when declared. */
  readonly base?: unknown
  /** Redacted raw user layer, when present. */
  readonly user?: unknown
  /** When the owner applies changes. */
  readonly applies: 'live' | 'restart'
  /** Schema-declared secret slots with their configured state. */
  readonly secrets: readonly ModelsSecretView[]
  /** Monotonic revision of the raw user section. */
  readonly revision: number
}

/** One path edit sent over the Settings carrier. */
export type SettingsPathOpView =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Safe credential presence facts. */
export interface CredentialInfo {
  /** Whether a provider resolves a value for this ref. */
  readonly configured: boolean
  /** Provider source label, when configured. */
  readonly source?: string
  /** Whether the current provider accepts writes. */
  readonly writable: boolean
}

/** Provider route advertised by the selected model adapter. */
export interface LlmProviderInfo {
  /** Route id. */
  readonly id: string
  /** Human-facing route name. */
  readonly name: string
}

/** Configurable provider entry and its optional diagnostic. */
export interface LlmConfigurableProvider {
  /** Provider route id. */
  readonly provider: string
  /** Human-facing provider name. */
  readonly displayName: string
  /** Settings namespace owning this provider's profile. */
  readonly settingsNs: string
  /** Path inside that namespace naming the profile. */
  readonly settingsPath: readonly string[]
  /** Whether the adapter reports this route as one it does not ship. */
  readonly declared?: boolean
  /** Adapter-reported diagnostic for this entry. */
  readonly error?: string
}

/** The describe answer a settings page derives from. */
export interface ModelsDescribeView {
  /** Every registered namespace. */
  readonly namespaces: readonly SettingsNamespaceView[]
  /** Whether the settings provider accepts writes. */
  readonly writable: boolean
  /** Whether a Host document exists to open. */
  readonly hasDocument: boolean
}

/** One settings-page describe answer and its freshness. */
export interface ModelsDescribeSnapshot {
  /** Sync state of the shared document read. */
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Last good answer; undefined until the first success. */
  readonly view: ModelsDescribeView | undefined
  /** Latest refresh failure, cleared by the next success. */
  readonly error: string | null
}

/** The describe face a settings page reads. */
export interface ModelsDescribeFace {
  /** @returns the current sync snapshot (stable until the next change). */
  getSnapshot(): ModelsDescribeSnapshot
  /** @param listener - invoked after each snapshot change. @returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Resolve once an answer is held, reading only from `idle`. */
  ensure(): Promise<void>
  /** @param view - a write answer's namespace view to fold in without a wire read. */
  acceptView(view: SettingsNamespaceView): void
}

/** Carrier envelope the browser Remote assembly answers with. */
export type ModelsCarried<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One candidate model a provider endpoint disclosed. */
export interface DiscoveredModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** The Models page's read and write surface, independent of who supplies it. */
export interface ModelsRemoteFace {
  readonly llm: {
    /** @returns the live provider routes in registration order. */
    listProviders(): Promise<ModelsCarried<readonly LlmProviderInfo[]>>
    /** @returns the declared configurable providers in declaration order. */
    listConfigurableProviders(): Promise<ModelsCarried<readonly LlmConfigurableProvider[]>>
    /**
     * Ask a provider endpoint for its models.
     * @param settingsNs - namespace owning discovery.
     * @param request - endpoint facts for this request only.
     * @returns the candidate models the endpoint disclosed.
     */
    discoverModels(settingsNs: string, request: unknown): Promise<ModelsCarried<readonly DiscoveredModel[]>>
  }
  readonly credentials: {
    /** @param refs - credential reference names. @returns presence facts keyed by reference. */
    describe(refs: readonly string[]): Promise<ModelsCarried<Readonly<Record<string, CredentialInfo>>>>
    /** @param ref - credential reference. @param value - write-only value. */
    set(ref: string, value: string): Promise<ModelsCarried<unknown>>
    /** @param ref - credential reference to remove. */
    unset(ref: string): Promise<ModelsCarried<unknown>>
  }
  readonly settings: {
    /**
     * Apply one atomic namespace mutation.
     * @param ns - settings namespace.
     * @param ops - ordered path operations.
     * @param expectedRevision - revision the editor read.
     * @returns the namespace view after the write.
     */
    mutate(ns: string, ops: SettingsPathOpView[], expectedRevision?: number): Promise<ModelsCarried<SettingsNamespaceView>>
  }
}

/** A Client context reduced to the Remote slice the Models page reads. */
export interface ModelsRemoteHost {
  /** Remote namespaces used by the page. */
  readonly remote: ModelsRemoteFace
}
