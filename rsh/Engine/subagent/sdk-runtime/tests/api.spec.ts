import { describe, expect, it } from 'vitest'
import { finalResponse, normalizeInput } from '../src/api.ts'

describe('SDK runtime API helpers', () => {
  it('normalizes text and preserves supplied prompt blocks', () => {
    expect(normalizeInput('x')).toEqual([{ type: 'text', text: 'x' }])
    const blocks = [{ type: 'text' as const, text: 'y' }]
    expect(normalizeInput(blocks)).toBe(blocks)
  })

  it('projects the latest assistant message and tolerates absent output', () => {
    expect(finalResponse([])).toBe('')
    expect(finalResponse([{ type: 'turn/start', seq: 0, time: 0, data: { turn: 0 } } as never])).toBe('')
    expect(finalResponse([
      { type: 'assistant/message', seq: 0, time: 0, data: { message: { content: [{ type: 'text', text: 'first' }] } } } as never,
      { type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: 'a' }, { type: 'tool-call' }, { type: 'text', text: 'b' }] } } } as never,
    ])).toBe('ab')
  })
})
