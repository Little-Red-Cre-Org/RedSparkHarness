/** Native Desktop module-management DTOs and the Electron IPC admission parser. */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Execution target selected by one Native Desktop installation row. */
export type NativeDesktopTarget = 'host' | 'client'

/** Stable persisted installation identity, distinct from a runtime activation id. */
export type NativeDesktopInstallationId = Branded<'NativeDesktopInstallationId'>

/** Stable persisted Host scope identity, distinct from a runtime NativeScope id. */
export type NativeDesktopScopeId = Branded<'NativeDesktopScopeId'>

/** Opaque revision of the selected Desktop Native profile inputs. */
export type NativeDesktopRevision = Branded<'NativeDesktopRevision'>

/** JSON value accepted for per-installation module configuration. */
export type DesktopModuleJson = null | boolean | number | string
  | readonly DesktopModuleJson[] | { readonly [key: string]: DesktopModuleJson }

/** Explicit target row requested by Native Desktop install. */
export interface NativeHostInstallIntent {
  readonly target: 'host'
  readonly id: NativeDesktopInstallationId
  readonly scope: NativeDesktopScopeId
  readonly config: DesktopModuleJson | undefined
  readonly enabled: boolean
}

/** Explicit Client row requested by Native Desktop install. */
export interface NativeClientInstallIntent {
  readonly target: 'client'
  readonly id: NativeDesktopInstallationId
  readonly config: DesktopModuleJson | undefined
  readonly enabled: boolean
}

/** One explicit Host or Client installation row. */
export type NativeDesktopInstallIntent = NativeHostInstallIntent | NativeClientInstallIntent

/** Optimistic-concurrency token required by every profile mutation. */
export interface NativeDesktopMutationRequest {
  readonly expectedRevision: NativeDesktopRevision
}

/** Install one exact package version with explicit Native target rows. */
export interface NativeDesktopInstallRequest extends NativeDesktopMutationRequest {
  readonly packageName: string
  readonly version: string
  readonly installations: readonly [NativeDesktopInstallIntent, ...NativeDesktopInstallIntent[]]
}

/** Package-level operation on one direct profile dependency. */
export interface NativeDesktopPackageMutationRequest extends NativeDesktopMutationRequest {
  readonly packageName: string
}

/** Update one direct profile dependency to an exact registry version. */
export interface NativeDesktopUpdateRequest extends NativeDesktopPackageMutationRequest {
  readonly version: string
}

/** Target and stable installation identity for a row-level operation. */
export interface NativeDesktopInstallationKey {
  readonly target: NativeDesktopTarget
  readonly id: NativeDesktopInstallationId
}

/** Toggle one installation row without removing its package or configuration. */
export interface NativeDesktopToggleRequest extends NativeDesktopMutationRequest {
  readonly key: NativeDesktopInstallationKey
  readonly enabled: boolean
}

/** Persisted Host scope, including scopes with no installations. */
export interface NativeDesktopScopeView {
  readonly id: NativeDesktopScopeId
  readonly parent?: NativeDesktopScopeId
}

/** Physical package operations available for one package origin. */
export interface NativeDesktopPackageCapabilities {
  readonly canRemovePackage: boolean
  readonly canUpdatePackage: boolean
}

/** Reason an installation must remain enabled by the Desktop composition. */
export type NativeDesktopRetentionReason = 'desktop-host-session' | 'desktop-private-carrier-provider'
  | 'client-boot-requirement' | 'required-provider'

/** Safe package and row details without raw configuration or filesystem paths. */
export interface NativeDesktopInstallationDetails {
  readonly packageName: string
  readonly enabled: boolean
  readonly disabled?: boolean
  readonly hasConfig: boolean
  readonly availableTargets: readonly NativeDesktopTarget[]
  readonly nativeApiVersion: 1
  readonly canEnable: boolean
  readonly canDisable: boolean
  readonly disableReasons?: readonly NativeDesktopRetentionReason[]
}

/** One Host row with a saved scope or one Client row without a Host scope. */
export type NativeDesktopInstallationView = (NativeDesktopInstallationDetails & {
  readonly target: 'host'
  readonly id: NativeDesktopInstallationId
  readonly scope: NativeDesktopScopeId
}) | (NativeDesktopInstallationDetails & {
  readonly target: 'client'
  readonly id: NativeDesktopInstallationId
  readonly scope?: never
})

/** One selected package grouped with every persisted target row. */
export interface NativeDesktopPackageView {
  readonly packageName: string
  readonly packageVersion: string
  readonly managedBy: 'profile' | 'signed-runtime'
  readonly packageCapabilities: NativeDesktopPackageCapabilities
  readonly installations: readonly NativeDesktopInstallationView[]
}

/** Locked projection of the Native Desktop profile and installed packages. */
export interface NativeDesktopInventory {
  readonly runtime: 'native'
  readonly revision: NativeDesktopRevision
  readonly scopes: readonly NativeDesktopScopeView[]
  readonly packages: readonly NativeDesktopPackageView[]
}

/** Safe projection of the current Desktop backend state. */
export interface NativeDesktopBackendProjection {
  readonly phase: 'starting' | 'ready' | 'error'
  readonly profileRecovery?: boolean
}

/** Stable machine-readable failure categories for Native Desktop operations. */
export type NativeDesktopErrorCode = 'wrong-profile' | 'invalid-request' | 'stale-revision'
  | 'unsupported-module' | 'package-immutable' | 'not-found' | 'dependency-conflict' | 'busy'
  | 'host-stop-failed' | 'package-operation-failed' | 'profile-invalid' | 'host-start-failed' | 'recovery-required'

/** Stable operation category with optional composition validation diagnostics. */
export interface NativeDesktopOperationError {
  readonly code: NativeDesktopErrorCode
  readonly messageKey: string
  readonly backend: NativeDesktopBackendProjection
  readonly currentRevision?: NativeDesktopRevision
  readonly blockedBy?: readonly NativeDesktopInstallationKey[]
  readonly detail?: string
  readonly cause?: string
}

/** Refusal or post-handoff recovery result for a Native profile mutation. */
export type NativeDesktopMutationOutcome =
  | { readonly status: 'applied'; readonly revision: NativeDesktopRevision; readonly backend: NativeDesktopBackendProjection }
  | { readonly status: 'refused'; readonly error: NativeDesktopOperationError }
  | { readonly status: 'recovery-required'; readonly error: NativeDesktopOperationError }

/** Locked Native inventory or a safe refusal/recovery result. */
export type NativeDesktopListOutcome =
  | { readonly status: 'listed'; readonly inventory: NativeDesktopInventory }
  | { readonly status: 'refused'; readonly error: NativeDesktopOperationError }
  | { readonly status: 'recovery-required'; readonly error: NativeDesktopOperationError }

/** Main-process diagnostic retained for mapping an operation failure to a safe IPC result. */
export class NativeDesktopOperationFailure extends Error {
  /**
   * @param code - Stable UI error category.
   * @param afterHandoff - Whether Host admission has stopped and writes may have begun.
   * @param currentRevision - Current inventory token returned with a stale-revision refusal.
   * @param blockedBy - Installation identities that prevent a requested row change.
   * @param cause - Original validation failure.
   */
  constructor(
    readonly code: NativeDesktopErrorCode,
    readonly afterHandoff = false,
    readonly currentRevision?: NativeDesktopRevision,
    readonly blockedBy?: readonly NativeDesktopInstallationKey[],
    cause?: unknown,
  ) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'NativeDesktopOperationFailure'
  }
}

/** Parse the tagged Native `plugins:list` payload. */
export function parseNativeDesktopListRequest(value: unknown): void {
  const request = record(value, ['runtime'])
  if (request.runtime !== 'native') invalid()
}

/** Parse and brand one exact Native `plugins:add` payload. */
export function parseNativeDesktopInstallRequest(value: unknown): NativeDesktopInstallRequest {
  const request = envelope(value)
  const input = record(request.request, ['expectedRevision', 'packageName', 'version', 'installations'])
  if (typeof input.packageName !== 'string' || input.packageName.length === 0
    || typeof input.version !== 'string' || input.version.length === 0
    || !Array.isArray(input.installations) || input.installations.length === 0) invalid()
  const installations = input.installations.map(parseInstallIntent)
  for (const target of ['host', 'client'] as const) {
    const ids = installations.filter(row => row.target === target).map(row => row.id)
    if (new Set(ids).size !== ids.length) invalid()
  }
  return {
    expectedRevision: revision(input.expectedRevision), packageName: input.packageName, version: input.version,
    installations: installations as [NativeDesktopInstallIntent, ...NativeDesktopInstallIntent[]],
  }
}

/** Parse and brand one exact Native package-remove payload. */
export function parseNativeDesktopPackageRequest(value: unknown): NativeDesktopPackageMutationRequest {
  const request = envelope(value)
  const input = record(request.request, ['expectedRevision', 'packageName'])
  if (typeof input.packageName !== 'string' || input.packageName.length === 0) invalid()
  return { expectedRevision: revision(input.expectedRevision), packageName: input.packageName }
}

/** Parse and brand one exact Native package-update payload. */
export function parseNativeDesktopUpdateRequest(value: unknown): NativeDesktopUpdateRequest {
  const request = envelope(value)
  const input = record(request.request, ['expectedRevision', 'packageName', 'version'])
  if (typeof input.packageName !== 'string' || input.packageName.length === 0
    || typeof input.version !== 'string' || input.version.length === 0) invalid()
  return { expectedRevision: revision(input.expectedRevision), packageName: input.packageName, version: input.version }
}

/** Parse and brand one exact Native row-toggle payload. */
export function parseNativeDesktopToggleRequest(value: unknown): NativeDesktopToggleRequest {
  const request = envelope(value)
  const input = record(request.request, ['expectedRevision', 'key', 'enabled'])
  const key = record(input.key, ['target', 'id'])
  if ((key.target !== 'host' && key.target !== 'client') || typeof input.enabled !== 'boolean') invalid()
  return { expectedRevision: revision(input.expectedRevision),
    key: { target: key.target, id: identifier(key.id) }, enabled: input.enabled }
}

/** Parse and brand one exact Native `plugins:disableAll` payload. */
export function parseNativeDesktopMutationRequest(value: unknown): NativeDesktopMutationRequest {
  const request = envelope(value)
  return { expectedRevision: revision(record(request.request, ['expectedRevision']).expectedRevision) }
}

function parseInstallIntent(value: unknown): NativeDesktopInstallIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  if ((input.target !== 'host' && input.target !== 'client') || typeof input.enabled !== 'boolean'
    || (Object.hasOwn(input, 'config') && input.config !== undefined && !json(input.config))) invalid()
  if (input.target === 'host') {
    const row = record(input, ['target', 'id', 'scope', 'config', 'enabled'])
    return { target: 'host', id: identifier(row.id), scope: scopeId(row.scope), config: row.config as DesktopModuleJson | undefined,
      enabled: row.enabled as boolean }
  }
  const row = record(input, ['target', 'id', 'config', 'enabled'])
  return { target: 'client', id: identifier(row.id), config: row.config as DesktopModuleJson | undefined,
    enabled: row.enabled as boolean }
}

function envelope(value: unknown): Record<string, unknown> {
  const request = record(value, ['runtime', 'request'])
  if (request.runtime !== 'native' || !Object.hasOwn(request, 'request')) invalid()
  return request
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) invalid()
  return value as Record<string, unknown>
}

function revision(value: unknown): NativeDesktopRevision {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalid()
  return brandString<NativeDesktopRevision>(value)
}

function identifier(value: unknown): NativeDesktopInstallationId {
  if (typeof value !== 'string' || value.length === 0) invalid()
  return brandString<NativeDesktopInstallationId>(value)
}

function scopeId(value: unknown): NativeDesktopScopeId {
  if (typeof value !== 'string' || value.length === 0) invalid()
  return brandString<NativeDesktopScopeId>(value)
}

function json(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || (Array.isArray(value) ? false : Object.getPrototypeOf(value) !== Object.prototype)
    || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = (Array.isArray(value) ? value : Object.values(value)).every(item => json(item, ancestors))
  ancestors.delete(value)
  return valid
}

function invalid(): never {
  throw new Error('dsh desktop: invalid Native module-management request')
}
