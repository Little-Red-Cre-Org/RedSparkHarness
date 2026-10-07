# User Settings

English | [中文](settings.zh.md)

The user-settings seam of [dsh-settings](../../Modules/Official/settings/settings) holds one user-owned document of per-namespace sections and resolves each registered namespace as schema defaults, then the registrant's composition `base`, then the user section. The shared and Native service declarations live in [dsh-settings-definition](../../Core/settings/settings-definition); Cordis `ctx.settings` augmentation and registration options live in [compat-settings-definition](../../Compatibility/DSH/bridge/compat-settings-definition). Providers such as [dsh-settings-file](../../Modules/Official/settings/settings-file) store the raw document and push external edits; consumer plugins register a schema and read or observe the resolved value. Composition config stays in `cordis.yml` — a namespace carries only the user-editable subset.

Source: [`rsh/Core/settings/settings-definition/src/index.ts`](../../Core/settings/settings-definition/src/index.ts), [`rsh/Compatibility/DSH/bridge/compat-settings-definition/src/index.ts`](../../Compatibility/DSH/bridge/compat-settings-definition/src/index.ts)

## Native Host

The [Native Settings declarations](../../Core/settings/settings-definition/src/native.ts) define `NativeSettingsService`, implemented by the Provider in [dsh-settings](../../Modules/Official/settings/settings/src/native.ts). `NativeSettings.register(namespace, base, resolve, validateWrite, presentation)` becomes available after its Provider loads the document. The returned owner scope reads a deep-frozen value, merges or replaces only its raw user section, accepts an optional expected revision, watches valid resolved changes and unregisters on disposal. Native watcher callbacks run serially per callback in commit order; their sync throws and async rejections are logged. A watcher disposer skips queued invocations, and Host teardown waits for started callbacks. The [file Provider](../../Modules/Official/settings/settings-file/src/native.ts) reads and writes the same YAML/JSON document under a cross-process lock; `llm-pi-ai` consumes its namespace on the next model request.

Native configuration UI exposure is opt-in through `presentation`. `describe()` returns only active registrations with presentation metadata; its descriptor carries the serialized schema, redacted resolved/base/user values, secret paths and presence, active credential references, apply timing and user-section revision. `mutate(namespace, ops, expectedRevision)` applies path edits to that user section in one revision-checked commit. A caller must send edits rather than reconstruct a whole section from its redacted view. The Service accepts a `set` on a non-secret array field's parent path, subject to the owner validator; this can replace the whole array with a different length or order. Edits that descend through array indices must use existing indices; they cannot create gaps or unset an array entry. The Service rejects edits to schema-declared secrets or replacement of an ancestor that contains one. Separately, the JSON editor refuses array resizing or row reordering and emits path edits only while array length and row order stay unchanged.

```ts type-equiv
/** Raw per-namespace overrides in the Settings document. */
type NativeSettingsSection = Record<string, unknown>
```

```ts type-equiv
/** Storage commits a complete document against its latest durable revision. */
interface NativeSettingsStorage {
  /** Read the complete persisted settings document. @returns the stored raw sections. */
  load(): Promise<NativeSettingsSection>
  /**
   * Commit a document update against the latest persisted version.
   * @param update - transforms the latest raw document.
   * @returns the committed raw document.
   */
  persist(update: (document: NativeSettingsSection) => NativeSettingsSection): Promise<NativeSettingsSection>
}
```

```ts type-equiv
/** Optional metadata needed before a registration is exposed to Native UI. */
interface NativeSettingsPresentation {
  /** Live schema whose JSON and role metadata describe this registration. */
  readonly schema: { toJSON(): unknown }
  /** When the owner applies changes; defaults to `live`. */
  readonly applies?: SettingsApplies
}
```

```ts type-equiv
/** One redacted registration exposed to a Native settings page. */
interface NativeSettingsDescriptor {
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
```

```ts type-equiv
/** One path-addressed change to a registered namespace's raw user section. */
type NativeSettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }
```

```ts type-equiv
/** Resolved namespace owner with writes restricted to its raw user section. */
interface NativeSettingsScope<T> {
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
```

```ts type-equiv
/** State service implemented by the selected Native Settings Provider. */
interface NativeSettingsService {
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
```

## Identity

A namespace names one plugin-owned section of the user document. The brand prevents callers from mixing settings namespaces with other ids passed between packages or processes; construction validates lowercase kebab-case syntax. Literal API arguments are checked against this syntax at compile time, while dynamic strings and branded namespace ids remain accepted.

```ts type-equiv
/** Nominal id of one registered settings namespace. */
type SettingsNamespace = Branded<'SettingsNamespace'>
```

```ts type-equiv
/** One schema-declared secret position exposed without its value. */
interface SettingsSecret {
  /** Path from the section root to the removed field. */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}
```

## Registration

Registration binds a schemastery schema to a namespace on the calling plugin's fiber — disposing that fiber removes the namespace and its observers. The options carry the composition layer, the owner's effect timing, and an optional check for what the schema cannot express.

```ts type-equiv
/** Registration options accepted by the Cordis Settings Provider. */
interface SettingsRegisterOptions<T> {
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
```

`validate` runs after the schema admits a value, so it sees defaults and the composition base exactly as the owner will. `dsh-llm-pi-ai` uses it to refuse a provider profile it could not serve at the write that produced it, rather than storing one that would disable every route in its namespace.

`applies` is a UI hint, not a mechanism: a `restart` owner never watches, so its value is read once at construction and configuration surfaces can badge the pending change.

```ts type-equiv
/** When a namespace's changes take effect for its owner. */
type SettingsApplies = 'live' | 'restart'
```

## Owner scope

The scope is the owner-facing handle. `update` merges a sparse patch over the user section only (never into `base`); `replace` sets the section wholesale, which is the removal/reset path — keys absent from the replacement re-inherit `base` and schema defaults. Writes to one namespace are serialized in call order, JSON-incompatible writes fail before persistence, and resolved values are deep-frozen snapshots.

```ts type-equiv
/** Owner-facing handle for one registered namespace. */
interface SettingsScope<T> {
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
```

The Core service interface retains the typed namespace arguments used by Cordis consumers: lowercase kebab-case literals are checked at compile time, while runtime strings and branded ids remain accepted.

```ts type-equiv
/** Framework-neutral operations used by the Cordis Settings service. */
interface SettingsService {
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
```

## Descriptors

`describe()` serializes every registered namespace for configuration surfaces: the schemastery `toJSON()` envelope drives schema-rendered forms, the resolved value fills them, and the detached `base`/`user` layers let a form mark user-overridden fields by presence. Redaction defaults to `false` and leaves secret values in descriptors. Every wire surface must call `describe({ redactSecrets: true })`, which strips `role('secret')` fields from all three layers and enumerates their `{path, set}` slots so a page can render write-only inputs without receiving a secret.

```ts type-equiv
/** One registered namespace as surfaced to configuration UIs. */
interface SettingsDescriptor {
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
```

A caller that holds only the redacted descriptor cannot safely rebuild a section, so removals travel as path ops instead. Each descriptor also carries a `revision` over the raw section; a write may send it back as `expectedRevision`, and one that no longer matches is refused rather than applied over the writer that landed first.
```ts type-equiv
/** One path-addressed edit to a namespace's raw user section. */
type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }
```

```ts type-equiv
/** Options controlling secret removal from provider descriptors. */
interface SettingsDescribeOptions {
  /**
   * Remove schema-declared secrets and return only their paths and presence.
   * Defaults to false, which leaves secret values in descriptors; every wire
   * surface must request `true`.
   */
  redactSecrets?: boolean
}
```

## Change commits

Every committed change — an in-process write or an externally observed provider edit — emits `settings/updated (ns, next, prev, source)` after the new value is authoritative, and never when the resolved value is deep-equal. The source tag separates the two entry paths.

```ts type-equiv
/** Origin of one committed settings change. */
type SettingsUpdateSource = 'update' | 'provider'
```

## Browser account authorization

`AuthorizationEntryView` combines an enabled flow's identity and methods with credential metadata, never its payload. `AuthorizationFrame` carries started, notice, prompt, or settled events. Branded `AuthorizationAttemptId` and `AuthorizationPromptId` identify the live attempt and unanswered question; they are process-local, not durable Session ids. The settings controller's `authorizationKeys` selects which registered flows the browser may list and start. Closing the initiating stream is the only browser cancellation path; it withdraws that attempt and releases its pending questions before cleanup completes. Provider failures expose only fixed safe messages and allowlisted authorization codes while retaining the original cause on the Host.

## Native document operations

`SettingsDocumentOpenValue` confirms that `settings/openSettingsDocument` prepared the provider-owned document and handed it to the native text editor. `AgentPresetDirectoryOpenValue` reports either a completed native handoff or the resolved user-preset directory when desktop opening is unavailable. Neither operation accepts a browser-selected Host path.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthorizationcontroller--authorizationcontroller"></a>

### `ctx.authorizationController` — `AuthorizationController`

Host owner of the generated `ctx.remote.authorization` namespace.

```ts cordis-catalog
/**
 * List browser-enabled flows and their stored-record state.
 * @returns Enabled registered flows joined with redacted stored-record state.
 */
@Remote async list(): Promise<AuthorizationEntryView[]>

/**
 * Run one flow and stream its notices and prompts to the initiating browser.
 * @param key - Credential key owned by the registered flow.
 * @param method - Optional flow-owned method identifier.
 * @param signal - Browser stream lifetime.
 * @returns Notices, prompts, and final status for this attempt.
 */
@Remote({ mode: 'stream' }) async * authorize(key: string, method: string | undefined, signal: AbortSignal): AsyncIterable<AuthorizationFrame>

/**
 * Answer the prompt currently displayed for one attempt.
 * @param attemptId - Opaque identifier returned by the stream.
 * @param promptId - Opaque identifier of the pending prompt.
 * @param value - User-entered answer passed to the Host flow.
 */
@Remote answer(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId, value: string): void

/**
 * Decline the prompt currently displayed for one attempt.
 * @param attemptId - Opaque identifier returned by the stream.
 * @param promptId - Opaque identifier of the pending prompt.
 */
@Remote decline(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId): void
```

Source: [`rsh/Programs/Web/api/settings-controller/src/authorization.ts`](../../Programs/Web/api/settings-controller/src/authorization.ts)

<a id="ctxsettings--cordissettingsservice"></a>

### `ctx.settings` — `CordisSettingsService`

Cordis-facing extension of the framework-neutral Settings service.

```ts cordis-catalog
/**
 * Register a namespace schema and receive its owner scope. The registration
 * is tied to the owner's Cordis fiber. Invalid stored data rejects initial
 * registration; a later invalid edit keeps the last good value on reload.
 * @param namespace - unique lowercase namespace; duplicates fail loud.
 * @param schema - schemastery schema resolving the namespace's value.
 * @param options - composition base, effect timing, and owner validation.
 * @returns the scope for reads, observation, and updates.
 */
register<const Namespace extends string, T>( namespace: Namespace & SettingsNamespaceInput<Namespace>, schema: z<T>, options?: SettingsRegisterOptions<T>, ): SettingsScope<T>

/**
 * Install a settings section owned by another Cordis plugin.
 * @param owner - plugin fiber that receives the registered section.
 * @param namespace - unique lowercase namespace for the entry.
 * @param schema - schema resolving the entry and future user edits.
 * @param entry - composition-layer value used when the provider is absent.
 * @param hooks - callbacks for current values, changes, and owner validation.
 * @returns nothing; the registration is disposed with the owner's fiber.
 */
installSection<const Namespace extends string, T>( owner: Context, namespace: Namespace & SettingsNamespaceInput<Namespace>, schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>, ): void

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
update<const Namespace extends string>( namespace: Namespace & SettingsNamespaceInput<Namespace>, patch: object, expectedRevision?: number, ): Promise<void>

/**
 * Replace and persist a namespace's user section.
 * @param namespace - namespace to replace.
 * @param section - complete next user section.
 * @param expectedRevision - optional revision required for the write.
 * @returns a promise settled after the provider commits the write.
 */
replace<const Namespace extends string>( namespace: Namespace & SettingsNamespaceInput<Namespace>, section: object, expectedRevision?: number, ): Promise<void>

/**
 * Apply ordered path edits to a namespace's user section.
 * @param namespace - namespace to edit.
 * @param ops - ordered path edits.
 * @param expectedRevision - optional revision required for the write.
 * @returns a promise settled after the provider commits the write.
 */
mutate<const Namespace extends string>( namespace: Namespace & SettingsNamespaceInput<Namespace>, ops: readonly SettingsPathOp[], expectedRevision?: number, ): Promise<void>
```

Source: [`rsh/Compatibility/DSH/bridge/compat-settings-definition/src/index.ts`](../../Compatibility/DSH/bridge/compat-settings-definition/src/index.ts)

<a id="ctxsettingscontroller--settingscontroller"></a>

### `ctx.settingsController` — `SettingsController`

Host service backing the generated `ctx.remote.settings` namespace. Every remote read uses `redactSecrets: true`, so a `role('secret')` field cannot ride a response. Writes expose the settings service's merge, replacement, and path-addressed operations, and classify every provider refusal as `settings/conflict` or `settings/rejected` with the service's message.

```ts cordis-catalog
/**
 * Describe every registered namespace for a configuration page: redacted
 * layered values plus the serialized schema the page renders its form from.
 * @returns provider writability, local-document presence, and one view per namespace.
 * @throws RemoteError when no settings provider is mounted.
 */
@Remote describe(): SettingsDescribeValue

/**
 * Report whether this deployment can open an authored Agent preset directory natively.
 * @returns true when the matching open operation is available.
 */
@Remote canOpenAgentPresetDirectory(): boolean

/**
 * Merge a patch into one namespace's stored user section.
 * @param ns - namespace key to write.
 * @param patch - fields to merge into the user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote update( ns: string, patch: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Replace one namespace's stored user section wholesale.
 * @param ns - namespace key to write.
 * @param section - complete replacement user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote replace( ns: string, section: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Apply path-addressed edits to one namespace's user section, resolved against
 * the section as stored rather than against whatever the caller last read,
 * then answer with that namespace's new redacted view.
 * @param ns - namespace key to write.
 * @param ops - the edits to apply, in order.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async mutate( ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Materialize the provider-owned settings document and open it in a native text editor.
 * @param signal - caller lifetime; abort terminates preparation or the native command.
 * @returns confirmation after the native opener accepts the document.
 * @throws RemoteError when no document exists, preparation fails, or opening fails.
 */
@Remote async openSettingsDocument(signal: AbortSignal): Promise<SettingsDocumentOpenValue>

/**
 * Open one user-authored Agent preset directory or return its path when no native opener exists.
 * @param agentPreset - preset id resolved against Host-owned roots.
 * @param signal - caller lifetime; abort terminates the native command.
 * @returns an opened confirmation or the resolved directory for text display.
 * @throws RemoteError when the preset is missing, read-only, invalid, or cannot be opened.
 */
@Remote async openAgentPresetDirectory( agentPreset: string, signal: AbortSignal, ): Promise<AgentPresetDirectoryOpenValue>
```

Source: [`rsh/Programs/Web/api/settings-controller/src/index.ts`](../../Programs/Web/api/settings-controller/src/index.ts)

<a id="settings-events"></a>

### `settings/*` events

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — emit

One registered namespace's raw user section changed, whether or not the resolved value did. `settings/updated` is the consumer-facing event and stays deep-equal-gated; this event tells configuration surfaces that a field became overridden and their held revision is stale.

```ts cordis-catalog
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
```

Source: [`rsh/Compatibility/DSH/bridge/compat-settings-definition/src/events.ts`](../../Compatibility/DSH/bridge/compat-settings-definition/src/events.ts)

<a id="settingsupdated--emit"></a>

#### `settings/updated` — emit

Committed change to one registered namespace's resolved value. Emitted after the provider persisted (for `update`) or published (`provider`) the change; never emitted when the resolved value is deep-equal. Listener failures are contained and logged — a sync throw and an async rejection alike — except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
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
```

Source: [`rsh/Compatibility/DSH/bridge/compat-settings-definition/src/events.ts`](../../Compatibility/DSH/bridge/compat-settings-definition/src/events.ts)
<!-- END GENERATED cordis-surface -->
