/** Copy keys shared by the provider cards and model editors. */
export type ModelEditorCopyKey =
  | 'addModel' | 'advancedHint' | 'applying' | 'apply' | 'baseUrl' | 'baseUrlDefault' | 'close'
  | 'conflict' | 'contextWindow' | 'contextWindowPlaceholder' | 'modelsCreate' | 'modelsCreating' | 'customApi' | 'customApiUnset' | 'customBaseUrlInvalid'
  | 'customBaseUrlPlaceholder' | 'customDisplayName' | 'customNeedsBaseUrl' | 'customNeedsModels'
  | 'customRoute' | 'customRouteHint' | 'customTitle' | 'customized' | 'fetchAdopt' | 'fetchDescription'
  | 'customRouteInvalid' | 'customRouteTaken' | 'fetchDeselectAll' | 'fetchEmpty' | 'fetchModels'
  | 'fetchNeedsBaseUrl' | 'fetchNoMatches' | 'fetchSearch' | 'fetchSelectAll' | 'fetchTitle'
  | 'fetching' | 'keyBlank' | 'keyBlankNew' | 'keyEnvLocked' | 'keyIllegalCharacters' | 'keyInput' | 'keyPlaceholder'
  | 'keyPlaceholderNative' | 'keyRequired' | 'keyStored' | 'maxTokens' | 'maxTokensPlaceholder' | 'model' | 'modelAdvanced' | 'modelContextInvalid'
  | 'modelContextWindow' | 'modelId' | 'modelIdDuplicate' | 'modelIdRequired' | 'modelMaxTokens'
  | 'modelMaxTokensInvalid' | 'modelName' | 'modelNameInvalid' | 'models' | 'modelsCustomized' | 'modelsEmpty'
  | 'modelsCancel' | 'modelsInherited' | 'removeModel' | 'resetModels' | 'settingsPathUnresolvable'

/** One schema-backed settings namespace used by a provider editor. */
export interface ModelSettingsNamespace {
  readonly ns: string
  readonly schema: unknown
  readonly value: unknown
  readonly base?: unknown
  readonly user?: unknown
  readonly revision: number
}

/** One path-addressed user settings change. */
export type ModelSettingsPathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Settings mutation result consumed by an editor card. */
export type ModelSettingsWriteOutcome =
  | { readonly kind: 'written'; readonly view: { readonly user: unknown; readonly revision: number } }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string }

/** Credential state exposed to provider cards without a secret value. */
export interface ModelCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Endpoint facts sent only for the current discovery request. */
export interface ModelDiscoveryRequest {
  readonly provider?: string
  readonly baseURL?: string
  readonly api?: string
  readonly apiKey?: string
}

/** A model disclosed by a provider endpoint. */
export interface ModelDiscoveryEntry {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** Result of a provider discovery request. */
export type ModelDiscoveryOutcome =
  | { readonly kind: 'found'; readonly models: readonly ModelDiscoveryEntry[] }
  | { readonly kind: 'refused'; readonly message: string }

/** Callbacks used by the shared provider cards; services stay in the caller. */
export interface ModelSettingsOperations {
  describeCredential(ref: string): Promise<ModelCredentialInfo | undefined>
  storeCredential(ref: string, value: string): Promise<string | undefined>
  removeCredential(ref: string): Promise<string | undefined>
  writeSettings(ns: string, ops: ModelSettingsPathOp[], expectedRevision: number | undefined): Promise<ModelSettingsWriteOutcome>
  discoverModels(settingsNs: string, request: ModelDiscoveryRequest, signal?: AbortSignal): Promise<ModelDiscoveryOutcome>
}

/** Schema operations used by provider cards without exposing a schema service. */
export interface ModelSchemaNode {
  readonly type?: string
  readonly list?: readonly { readonly value?: unknown }[]
  readonly meta?: { readonly default?: unknown }
}

/** Synchronous schema reads and immutable draft edits needed by provider cards. */
export interface ModelSettingsSchemaOperations {
  rehydrate(serialized: unknown): ModelSchemaNode
  validate(schema: ModelSchemaNode, draft: unknown): string | undefined
  nodeAtPath(root: ModelSchemaNode, path: readonly string[]): ModelSchemaNode | undefined
  getPath(value: unknown, path: readonly string[]): unknown
  hasPath(value: unknown, path: readonly string[]): boolean
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown>
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown>
}
