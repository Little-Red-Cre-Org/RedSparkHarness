/** Native permission-preset contract over the Program-owned Session writer. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { PresetSpec } from './presets.ts'
import type {} from './types.ts'

/** The same two durable policy knobs bundled by the Cordis permission service. */
export type NativePermissionPresetSpec = Readonly<Omit<PresetSpec, 'name' | 'description'> & {
  name?: string | undefined
  description?: string | undefined
}>

/** One configured permission choice or the derived current-only custom value. */
export interface NativePermissionPresetOption {
  /** Configured preset id, or the derived `custom` value. */
  readonly value: string
  /** Display label, falling back to the id. */
  readonly name: string
  /** Optional user-facing description. */
  readonly description?: string
}

/** Effective permission selection and the choices the Host can apply. */
export interface NativePermissionPresetControls {
  /** Current matching preset id or the derived `custom` value. */
  readonly currentValue: string
  /** Configured choices and `custom` only when it is current. */
  readonly options: readonly NativePermissionPresetOption[]
}

/** Program-owned validation and durable application of a configured preset. */
export interface NativePermissionPresetOperations {
  /** @param events - complete current Session event log.
   * @param signal - read cancellation.
   * @returns effective policy and configured choices.
   */
  controls(events: readonly SessionEvent[], signal: AbortSignal): Promise<NativePermissionPresetControls>
  /** @param name - exact configured preset id. @returns detached immutable policy bundle. */
  resolve(name: string): Readonly<NativePermissionPresetSpec>
  /**
   * @param owner - exact writable root Session.
   * @param name - configured preset.
   * @param signal - effective maintenance cancellation.
   * @returns a promise fulfilled after the policy events are durable.
   */
  apply(owner: NativeActiveSessionOwner, name: string, signal: AbortSignal): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { permissionPresets: NativePermissionPresetOperations }
}

export type { NativePlugin }
