/** Native profile-owned standing compositions and Program-owned Agent leases. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentPresetFacts } from './selection.ts'

/** Opaque runtime installation generation; not a durable historical revision. */
export type NativePresetGeneration = Branded<'NativePresetGeneration'>

/** Profile-installed composition metadata; the profile owns every scoped module. */
export interface NativePresetComposition {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly scope: NativeScope
}

/** Exact standing installation selected before Agent creation. */
export interface NativeResolvedAgentPreset extends NativePresetComposition {
  readonly generation: NativePresetGeneration
}

/** One Agent's lifetime; descendants acquire the same resolved generation. */
export interface NativeAgentPresetLease extends NativeResolvedAgentPreset {
  readonly signal: AbortSignal
  /**
   * Release after Agent execution and owned resources drain; subsequent calls ignore new failure arguments.
   * @param cleanupFailure - actual teardown failure, excluding execution errors and expected cancellation.
   * @returns idempotent token settlement; standing removal reports recorded cleanup failures.
   */
  release(cleanupFailure?: unknown): Promise<void>
}

/** Registry admission does not create Agents, write Session facts or change scopes. */
export interface NativeAgentPresetOperations {
  /** @param composition - exact profile scope. @returns close-admission, cancellation and lease drain. */
  register(composition: NativePresetComposition): () => Promise<void>
  /** @returns current advertised standing compositions without acquiring Agent leases. */
  list(): readonly NativeResolvedAgentPreset[]
  /**
   * Resolve the explicit choice, recorded choice or fresh deployment default.
   * @param request - creation or historical choice; explicit preset is only for Program-preflighted blank selection.
   * @returns exact standing generation, or null for a restored rosterless Session.
   */
  resolvePreset(request: {
    readonly fresh: boolean
    readonly facts: NativeAgentPresetFacts
    readonly preset?: string
  }): NativeResolvedAgentPreset | null
  /** @param preset - exact previously resolved generation. @returns Agent-owned cancellation and release. */
  acquire(preset: NativeResolvedAgentPreset): NativeAgentPresetLease
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { agentPresets: NativeAgentPresetOperations }
}
