/** Native default-model contract over the deployment's settings authority. */
import type { ReasoningEffortId } from '@redspark/rsh-llm/native'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-settings-definition/native'

/** The route a root step falls back to when its Session recorded no selection. */
export interface NativeModelSelection {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned reasoning effort, or provider behavior when absent. */
  readonly reasoningEffort?: string
}

/** The same selection in the branded form the model execution layer accepts. */
export interface NativeBrandedModelSelection extends Omit<NativeModelSelection, 'reasoningEffort'> {
  /** Adapter-owned reasoning effort branded for the execution layer. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** Deployment default model policy a Native Program consults per root step. */
export interface NativeAgentDefaultModelOperations {
  /**
   * Read the effective default for the next Agent.
   * @returns a detached selection in the branded form the execution layer accepts.
   */
  currentSelection(): NativeBrandedModelSelection
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { agentDefaultModel: NativeAgentDefaultModelOperations }
}

export type { NativePlugin }
