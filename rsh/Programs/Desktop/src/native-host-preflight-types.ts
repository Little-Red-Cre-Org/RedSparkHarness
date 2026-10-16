/** Serialized Native Host graph sent from the Desktop main process to its validation worker. */
import type { NativeEntryManifest, NativePlugin } from '@deepseek-ai/dsh-native-runtime'

/** Serializable declaration for a loader-owned Host Provider that is not a profile package row. */
export interface NativeHostPreflightProvider {
  readonly scope: string
  readonly apiVersion: NativePlugin['apiVersion']
  readonly name: NativePlugin['name']
  readonly targets: NativePlugin['targets']
  readonly requires: NativePlugin['requires']
  readonly optional: NativePlugin['optional']
  readonly provides: NativePlugin['provides']
}

/** Host installations and injected Providers needed to validate one candidate profile. */
export interface NativeHostPreflightInput {
  readonly scopes: readonly { readonly id: string; readonly parent?: string }[]
  readonly installations: readonly {
    readonly entryPath: string
    readonly entry: NativeEntryManifest
    readonly scope: string
    readonly config: unknown
  }[]
  /** Actual supplemental Provider declarations from the native profile loader. */
  readonly providers: readonly NativeHostPreflightProvider[]
  readonly carrierScope: string
  readonly carrier: {
    readonly apiVersion: 1
    readonly name: string
    readonly targets: readonly ('host' | 'client')[]
    readonly requires: readonly string[]
    readonly optional: readonly string[]
    readonly provides: readonly string[]
  }
}

/** Result returned after the worker validates the current Host installation graph. */
export interface NativeHostPreflightReply {
  readonly valid: boolean
  readonly message?: string
  readonly cause?: string
}
