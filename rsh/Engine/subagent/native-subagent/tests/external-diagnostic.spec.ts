import { expect, it } from 'vitest'
import { acceptExternalOutcome, limitExternalDiagnostic } from '../src/external-driver.ts'

const completed = { output: [{ type: 'text' as const, text: 'done' }], stopReason: 'completed' as const }

it('keeps a short product diagnostic on a failed outcome', () => {
  const outcome = acceptExternalOutcome({ ...completed, stopReason: 'error', diagnostic: 'permission denied' })
  expect(outcome.diagnostic).toBe('permission denied')
})

it('omits a diagnostic from a completed outcome and a blank detail', () => {
  expect(acceptExternalOutcome({ ...completed, diagnostic: 'ignored' }).diagnostic).toBeUndefined()
  expect(acceptExternalOutcome({ ...completed, stopReason: 'error', diagnostic: '   ' }).diagnostic).toBeUndefined()
  expect(acceptExternalOutcome(completed)).toBe(completed)
})

it('truncates an over-long diagnostic on a UTF-8 boundary and marks the cut', () => {
  const diagnostic = 'a'.repeat(4072) + '😀' + 'b'.repeat(100)
  const limited = limitExternalDiagnostic(diagnostic)
  expect(new TextEncoder().encode(limited).byteLength).toBeLessThanOrEqual(4096)
  expect(limited.endsWith('\n[diagnostic truncated]')).toBe(true)
  expect(limited.includes('😀')).toBe(false)
  expect(acceptExternalOutcome({ ...completed, stopReason: 'error', diagnostic }).diagnostic).toBe(limited)
})
