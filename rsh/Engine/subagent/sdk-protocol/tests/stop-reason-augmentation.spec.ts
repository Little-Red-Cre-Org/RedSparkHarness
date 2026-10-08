import { expectTypeOf, it } from 'vitest'
import type { SubagentStopReason as ServiceStopReason } from '@deepseek-ai/dsh-subagent'
import type {
  SubagentStopReason,
  SubagentStopReasonMap,
} from '@deepseek-ai/dsh-subagent-protocol'

declare module '@deepseek-ai/dsh-subagent-protocol' {
  interface SubagentStopReasonMap {
    'provider-specific': 'provider-specific'
  }
}

type ExpectedStopReason =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'max-tokens'
  | 'refusal'
  | 'provider-specific'

it('keeps the service re-export derived from the pure protocol extension map', () => {
  expectTypeOf<SubagentStopReason>().toEqualTypeOf<ExpectedStopReason>()
  expectTypeOf<ServiceStopReason>().toEqualTypeOf<ExpectedStopReason>()
  expectTypeOf<SubagentStopReasonMap['provider-specific']>().toEqualTypeOf<'provider-specific'>()
})
