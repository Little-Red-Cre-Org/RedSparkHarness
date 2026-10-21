/** Session-scoped Native composer selector replies. */
import { z } from 'zod'

/** Installed composition choices and plan-mode state for one Session. */
export interface NativeModeControls {
  /** Selected agent preset recorded by this Session. */
  readonly current: string | null
  /** Installed presets the Host can select. */
  readonly options: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
  /** Last durable preset selection revision. */
  readonly revision: number | null
  /** Whether a turn has permanently locked preset selection. */
  readonly locked: boolean
  /** Whether the Host has an installed preset that can be selected. */
  readonly canSelect: boolean
  /** Plan-mode availability and current or pending state. */
  readonly planMode: { readonly available: boolean; readonly active: boolean; readonly pending?: boolean }
}

/** Effective Host permission selection and configured choices. */
export interface NativePermissionControls {
  /** Whether a permission-preset Provider is installed. */
  readonly available: boolean
  /** Effective preset id, `custom`, or null when no Provider is installed. */
  readonly currentValue: string | null
  /** Configured preset choices, with `custom` present only when it is current. */
  readonly options: readonly { readonly value: string; readonly name: string; readonly description?: string }[]
}

/** Result of selecting plan mode through the Host's pending-step rules. */
export interface NativePlanModeSelection {
  /** Last committed plan-mode value. */
  readonly active: boolean
  /** Selected value waiting for the next accepted step. */
  readonly pending?: boolean
  /** Outcome of this selection. */
  readonly outcome: 'committed' | 'queued' | 'cancelled' | 'noop'
}

const option = z.strictObject({ id: z.string().min(1), name: z.string().min(1), description: z.string().optional() })
const permissionOption = z.strictObject({ value: z.string().min(1), name: z.string().min(1), description: z.string().optional() })

/** Decode one Host mode-controls reply. */
export const nativeModeControlsSchema = z.strictObject({
  current: z.string().min(1).nullable(),
  options: z.array(option),
  revision: z.number().int().nonnegative().nullable(),
  locked: z.boolean(),
  canSelect: z.boolean(),
  planMode: z.strictObject({ available: z.boolean(), active: z.boolean(), pending: z.boolean().optional() }),
}) as unknown as z.ZodType<NativeModeControls>

/** Decode one Host permission-controls reply. */
export const nativePermissionControlsSchema = z.strictObject({
  available: z.boolean(),
  currentValue: z.string().min(1).nullable(),
  options: z.array(permissionOption),
}) as unknown as z.ZodType<NativePermissionControls>

/** Decode one Host plan-mode mutation reply. */
export const nativePlanModeSelectionSchema = z.strictObject({
  active: z.boolean(),
  pending: z.boolean().optional(),
  outcome: z.enum(['committed', 'queued', 'cancelled', 'noop']),
}) as unknown as z.ZodType<NativePlanModeSelection>
