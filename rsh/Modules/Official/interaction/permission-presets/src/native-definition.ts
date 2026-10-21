/** Native permission-preset contract over the Program-owned Session writer. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { PresetSpec } from './presets.ts'
import type {} from './types.ts'

/** The same two durable policy knobs bundled by the Cordis permission service. */
export type NativePermissionPresetSpec = Readonly<Omit<PresetSpec, 'name' | 'description'> & {
  name?: string | undefined
  description?: string | undefined
}>

/** Program-owned validation and durable application of a configured preset. */
export interface NativePermissionPresetOperations {
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
