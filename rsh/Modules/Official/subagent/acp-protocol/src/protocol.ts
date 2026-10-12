/** ACP metadata shared by a Native external-subagent client and its server. */
export const NATIVE_ACP_SUBAGENT_METADATA_KEY = 'com.deepseek.ai/dsh-native-subagent'

/** Version of the ACP metadata exchanged by Native external-subagent peers. */
export const NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION = 1 as const

/** Permission behavior requested for a child Session over ACP. */
export type NativeAcpSubagentPermissionMode = 'deny' | 'parent-relay'

/** Session ceilings and permission mode accepted through ACP metadata. */
export interface NativeAcpSubagentPolicy {
  readonly version: typeof NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION
  readonly maxSteps: number
  readonly maxTokens?: number
  readonly permissionMode: NativeAcpSubagentPermissionMode
}

/** Capabilities a Native ACP client advertises during initialize. */
export interface NativeAcpSubagentClientCapabilities {
  /** Whether the client can relay permission requests to its owning Session. */
  readonly permissionRelay: boolean
}

/** Capabilities a Native ACP server advertises during initialize. */
export interface NativeAcpSubagentServerCapabilities {
  /** Whether the server enforces maxSteps on each accepted turn and retains it across Session restore and fork. */
  readonly maxSteps: true
  /** Whether the server validates output-token ceilings against the selected route and refuses unsupported limits. */
  readonly maxTokens: true
  /** Permission modes implemented by this server. */
  readonly permissionModes: readonly NativeAcpSubagentPermissionMode[]
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${description} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], description: string): void {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${description}.${key} is required`)
  const allowed = new Set([...required, ...optional])
  const unsupported = Object.keys(value).find(key => !allowed.has(key))
  if (unsupported !== undefined) throw new TypeError(`${description}.${unsupported} is unsupported`)
}

function positiveInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${description} must be a positive safe integer`)
  }
  return value
}

function extension(meta: unknown, description: string): Record<string, unknown> | undefined {
  if (meta === undefined || meta === null) return undefined
  const metadata = record(meta, `${description}._meta`)
  const value = metadata[NATIVE_ACP_SUBAGENT_METADATA_KEY]
  return value === undefined ? undefined : record(value, `${description}._meta.${NATIVE_ACP_SUBAGENT_METADATA_KEY}`)
}

function version(value: Record<string, unknown>, description: string): void {
  if (value.version !== NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION) {
    throw new TypeError(`${description}.version must be ${NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION}`)
  }
}

/** Read the versioned permission-relay declaration from ACP initialize metadata.
 * @param meta - untrusted initialize metadata from the peer.
 * @returns the declared capabilities, or undefined when the extension is absent.
 */
export function readNativeAcpSubagentClientCapabilities(meta: unknown): NativeAcpSubagentClientCapabilities | undefined {
  const value = extension(meta, 'initialize')
  if (value === undefined) return undefined
  exactKeys(value, ['version', 'permissionRelay'], [], 'initialize native-subagent metadata')
  version(value, 'initialize native-subagent metadata')
  if (typeof value.permissionRelay !== 'boolean') throw new TypeError('initialize native-subagent metadata.permissionRelay must be boolean')
  return { permissionRelay: value.permissionRelay }
}

/** Read versioned Native ACP limits and permission policy from session/new metadata.
 * @param meta - untrusted session/new metadata from the client.
 * @returns the requested limits and permission mode, or undefined when absent.
 */
export function readNativeAcpSubagentPolicy(meta: unknown): NativeAcpSubagentPolicy | undefined {
  const value = extension(meta, 'session/new')
  if (value === undefined) return undefined
  exactKeys(value, ['version', 'maxSteps', 'permissionMode'], ['maxTokens'], 'session/new native-subagent metadata')
  version(value, 'session/new native-subagent metadata')
  if (value.permissionMode !== 'deny' && value.permissionMode !== 'parent-relay') {
    throw new TypeError('session/new native-subagent metadata.permissionMode is unsupported')
  }
  const maxSteps = positiveInteger(value.maxSteps, 'session/new native-subagent metadata.maxSteps')
  const maxTokens = value.maxTokens === undefined ? undefined : positiveInteger(value.maxTokens, 'session/new native-subagent metadata.maxTokens')
  return { version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION, maxSteps,
    ...(maxTokens === undefined ? {} : { maxTokens }), permissionMode: value.permissionMode }
}

/** Return initialize metadata advertising implemented server behavior.
 * @param capabilities - capabilities this server actually enforces.
 * @returns the ACP initialize metadata extension.
 */
export function nativeAcpSubagentServerMetadata(capabilities: NativeAcpSubagentServerCapabilities): Record<string, unknown> {
  return { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: { version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION, capabilities } }
}

/** Return the accepted effective policy in session/new or session/resume metadata.
 * @param policy - limits and permission mode accepted for this Session.
 * @returns the ACP metadata extension containing that effective policy.
 */
export function nativeAcpSubagentPolicyMetadata(policy: NativeAcpSubagentPolicy): Record<string, unknown> {
  return { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: policy }
}
