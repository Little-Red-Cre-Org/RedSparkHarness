/** Native managed shell-environment capability shared by Providers and Consumers. */
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { DshEnvironment, DshEnvironmentKey } from '@deepseek-ai/dsh-shell/native'

/** Model-visible metadata for one managed environment variable. */
export interface ShellEnvVariable {
  /** Concise description of the environment fact. */
  description: string
}

/** Declared variable ownership and a per-execution resolver. */
export interface ShellEnvContributor<Execution> {
  /** Stable contributor name used for diagnostics and duplicate detection. */
  name: string
  /** Complete set of managed keys this contributor may return. */
  variables: Readonly<Record<DshEnvironmentKey, ShellEnvVariable>>
  /**
   * Resolve values available for this execution.
   * @param execution - the current shell tool invocation.
   * @returns only declared keys with available string values.
   */
  resolve(execution: Execution): Readonly<Partial<Record<DshEnvironmentKey, string>>>
}

/** Enumerated declaration without evaluating its resolver. */
export interface ShellEnvVariableInfo extends ShellEnvVariable {
  /** Contributor that owns the variable. */
  contributor: string
  /** Declared managed key. */
  key: DshEnvironmentKey
}

/** Registration and per-execution collection offered by a selected Provider. */
export interface ShellEnvironment<Execution> {
  /**
   * Claim keys until the returned disposer is called.
   * @param contributor - declared ownership and per-call resolver.
   * @returns disposer for this contribution.
   */
  register(contributor: ShellEnvContributor<Execution>): () => void
  /**
   * Resolve a fresh managed environment for one call.
   * @param execution - current shell tool invocation.
   * @returns built-in and contributed facts.
   */
  collect(execution: Execution): DshEnvironment
  /**
   * Enumerate contributed declarations without evaluating resolvers.
   * @returns declarations sorted by variable name.
   */
  list(): ShellEnvVariableInfo[]
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { shellEnv: ShellEnvironment<NativeToolExecution> }
}
