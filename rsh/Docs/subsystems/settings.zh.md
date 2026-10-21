# 用户设置

[English](settings.md) | 中文

[dsh-settings](../../Modules/Official/settings/settings) 的用户设置 seam 持有一份按 namespace 分节的用户文档，并把每个已注册 namespace 解析为：schema 默认值，然后注册方的组合 `base`，最后用户分节。共享与 Native 服务声明位于 [dsh-settings-definition](../../Core/settings/settings-definition)；Cordis `ctx.settings` augmentation 和注册选项位于 [compat-settings-definition](../../Compatibility/DSH/bridge/compat-settings-definition)。[dsh-settings-file](../../Modules/Official/settings/settings-file) 这类提供方存储原始文档并推送外部编辑；消费方插件注册 schema 后读取或观察解析值。组合配置仍留在 `cordis.yml`——namespace 只承载用户可编辑子集。

来源：[`rsh/Core/settings/settings-definition/src/index.ts`](../../Core/settings/settings-definition/src/index.ts)、[`rsh/Compatibility/DSH/bridge/compat-settings-definition/src/index.ts`](../../Compatibility/DSH/bridge/compat-settings-definition/src/index.ts)

## 原生 Host

[Native Settings 声明](../../Core/settings/settings-definition/src/native.ts) 定义了由 [dsh-settings](../../Modules/Official/settings/settings/src/native.ts) Provider 实现的 `NativeSettingsService`。Provider 加载文档后提供 `NativeSettings.register(namespace, base, resolve, validateWrite, presentation)`。返回的 owner scope 读取深冻结值，只合并或替换自己的原始用户分节，支持可选的预期 revision，监听有效的解析值变化，并在释放时注销。原生 watcher 回调按各自的提交顺序串行执行；同步抛错和异步拒绝都会记入日志。释放 watcher 会跳过排队中的调用，Host 卸载会等待已开始的回调。[文件 Provider](../../Modules/Official/settings/settings-file/src/native.ts) 在跨进程锁下读写同一份 YAML/JSON 文档；`llm-pi-ai` 在下一次模型请求消费其 namespace。

原生配置界面通过 `presentation` 选择性公开注册项。`describe()` 只返回带 presentation metadata 的活动注册；descriptor 包含序列化 schema、脱敏后的解析值/base/user、机密路径及其存在状态、当前凭据引用、生效时机和用户分节 revision。`mutate(namespace, ops, expectedRevision)` 在一次 revision 检查提交中按路径编辑用户分节。调用方必须发送路径修改，不能从脱敏视图重建整个分节。只要 owner validator 通过，Service 允许对非机密数组字段的父路径执行整体 `set`，因此可替换为长度或顺序不同的数组。沿数组索引下钻时只能使用现有索引；不能创建空位，也不能 `unset` 删除数组项。Service 会拒绝触及 schema 声明机密字段的修改，也会拒绝替换包含机密字段的祖先。单独作为页面策略，JSON 编辑器会拒绝数组扩缩或行重排；只有数组长度和行顺序不变时才生成路径修改。

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

## 标识

namespace 命名用户文档中一个归插件所有的分节。brand 防止调用方将设置 namespace 与在包或进程之间传递的其他 id 混用；构造时校验小写 kebab-case 语法。API 的字面量参数在编译期按此语法检查；动态字符串和带品牌的 namespace id 仍可使用。

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

## 注册

注册把 schemastery schema 绑定到调用方插件 fiber 上的 namespace——dispose（资源释放）该 fiber 即移除 namespace 及其观察者。options 携带组合层、owner 的生效时机，以及一个可选的、用于校验 schema 表达不了的约束的钩子。

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

`validate` 在 schema 接纳该值之后运行，因此它看到的默认值和组合 base 与 owner 实际看到的完全一致。`dsh-llm-pi-ai` 用它在写入处拒绝自己无法服务的提供方 profile，而不是先存下来、再让该 namespace 下每条路由失效。

`applies` 是 UI 提示而非机制：`restart` 的 owner 从不 watch，其值在构造期读取一次，配置界面可为待生效变更加标。

```ts type-equiv
/** When a namespace's changes take effect for its owner. */
type SettingsApplies = 'live' | 'restart'
```

## Owner scope

scope 是面向 owner 的句柄。`update` 把稀疏 patch 只合并进用户分节（绝不进 `base`）；`replace` 整体替换分节，是删除/重置路径——替换中缺席的键重新继承 `base` 与 schema 默认值。同一 namespace 的写入按调用顺序串行；JSON 不兼容的写入会在持久化前失败；解析值是深冻结快照。

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

核心服务接口保留 Cordis 消费方已有的 namespace 类型约束：小写 kebab-case 字面量会在编译期检查；动态字符串与带品牌的 namespace id 仍可使用。

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

## 描述符

`describe()` 为配置界面序列化每个已注册 namespace：schemastery 的 `toJSON()` 封装结构驱动 schema 渲染的表单，解析值填充表单，分离出的 `base`/`user` 层让表单按字段是否出现在 user 层标注「用户已覆盖」。脱敏默认值为 `false`，descriptor 会保留机密字段。每个对外传输接口都必须调用 `describe({ redactSecrets: true })`；该选项会从三层剥离 `role('secret')` 字段并枚举 `{path, set}` slot，让页面渲染只写输入框而收不到机密值。

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

只持有脱敏 descriptor 的调用方无法安全地重建分节，因此删除改以路径 op 传递。每个 descriptor 还携带针对原始分节的 `revision`；写入可以把它作为 `expectedRevision` 送回，不再匹配的写入会被拒绝，而不会覆盖先落地的写入。
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

## 变更提交

每次提交的变更——进程内写入或提供方观察到的外部编辑——在新值成为权威值之后发出 `settings/updated (ns, next, prev, source)`，解析值深相等时绝不发出。source 标记区分两条入口路径。

```ts type-equiv
/** Origin of one committed settings change. */
type SettingsUpdateSource = 'update' | 'provider'
```

## 浏览器账号授权

`AuthorizationEntryView` 将已启用流程的身份和方法与凭据元数据合并，不包含凭据载荷。`AuthorizationFrame` 承载 started、notice、prompt 或 settled 事件。带品牌的 `AuthorizationAttemptId` 和 `AuthorizationPromptId` 标识实时尝试与待回答问题；它们只存在于进程内，不是持久化 Session id。settings controller 的 `authorizationKeys` 决定浏览器可以列出和启动哪些已注册流程。关闭发起方事件流是浏览器唯一的取消路径；该操作会撤回本次尝试，并在清理完成前释放待回答问题。提供方失败只暴露固定安全文案和白名单授权错误码，原始 cause 保留在 Host。

## 原生文档操作

`SettingsDocumentOpenValue` 确认 `settings/openSettingsDocument` 已准备好 provider 持有的文档，并将其交给原生文本编辑器。`AgentPresetDirectoryOpenValue` 报告已完成的原生交接，或在桌面打开不可用时返回解析后的用户 preset 目录。两项操作都不接受由浏览器选择的 Host 路径。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
