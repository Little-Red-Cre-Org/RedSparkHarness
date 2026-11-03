import { expectTypeOf, it } from 'vitest'
import type { SubagentStopReason as ServiceStopReason } from '@redspark/rsh-subagent'
import type {
  SubagentStopReason,
  SubagentStopReasonMap,
} from '@redspark/rsh-subagent-protocol'

declare module '@redspark/rsh-subagent-protocol' {
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
