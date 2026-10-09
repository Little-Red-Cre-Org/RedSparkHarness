/** Cordis-free Native Agent identity and event types. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'

/** Opaque identity for one live native Agent. */
export type NativeAgentId = Branded<'NativeAgentId'>

/** A live Agent's identity and scope visibility; Session ownership remains in the application. */
export interface NativeAgent {
  readonly id: NativeAgentId
  readonly scope: NativeScope
}

/** Scoped event dispatch that reports native Agent lifecycle edges. */
export interface NativeAgentEventDispatcher {
  emit(scope: NativeScope, key: 'agent/created' | 'agent/disposed', agent: NativeAgent): void
}
