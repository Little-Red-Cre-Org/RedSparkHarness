/** Legacy and native consumers must classify errors through the same constructor. */
import { expect, it } from 'vitest'
import { HarnessError, errorChain, isHarnessError } from '@deepseek-ai/dsh-errors'
import { HarnessError as LegacyError, errorChain as legacyChain, isHarnessError as legacyGuard } from '@deepseek-ai/dsh-llm'

it('shares constructor and diagnostic identity across native and model consumers', () => {
  expect(LegacyError).toBe(HarnessError)
  expect(legacyChain).toBe(errorChain)
  expect(legacyGuard).toBe(isHarnessError)
  const failure = new LegacyError('read cancelled', 'FS_ABORTED')
  expect(failure).toBeInstanceOf(HarnessError)
  expect(isHarnessError(failure)).toBe(true)
  expect(errorChain(failure)).toBe('read cancelled')
})
