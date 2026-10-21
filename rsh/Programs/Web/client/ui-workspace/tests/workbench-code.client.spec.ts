import { expect, it } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { completedAnswerCode } from '../src/client/workbench-code.ts'

it.each(['completed', 'interrupted', 'no-code'] as const)('opens only new completed answer code: %s', mode => {
  const read = completedAnswerCode()
  const snapshot = (turn: number, interrupted = false): ChatSnapshot => ({ legacy: {
    turnEnds: new Map([[turn, 100]]),
    nodes: [{ kind: 'assistant', turn, seq: turn, messageId: `message-${turn}`, interrupted: interrupted || undefined,
      blocks: [{ kind: 'text', text: mode === 'no-code' ? 'Explanation only' : 'Example:\n```javascript\nconst value = 1\n```' }] }],
  } } as unknown as ChatSnapshot)
  expect(read(snapshot(1))).toEqual([])
  const current = snapshot(2, mode === 'interrupted')
  expect(read(current)).toEqual(mode === 'completed' ? [{ language: 'javascript', content: 'const value = 1' }] : [])
  expect(read(current)).toEqual([])
})

it('opens code arriving after the turn-end snapshot exactly once', () => {
  const read = completedAnswerCode(10)
  const snapshot = (nodes: unknown[]): ChatSnapshot => ({ legacy: {
    turnEnds: new Map([[2, 100]]), turnTimings: new Map([[2, { startTime: 20 }]]), nodes,
  } } as unknown as ChatSnapshot)
  read({ legacy: { turnEnds: new Map(), nodes: [] } } as unknown as ChatSnapshot)
  expect(read(snapshot([]))).toEqual([])
  const ready = snapshot([{ kind: 'assistant', turn: 2, messageId: 'late', blocks: [
    { kind: 'text', text: '```javascript\nconst value = 42\n```' },
  ] }])
  expect(read({ ...ready, legacy: { ...ready.legacy, turnTimings: new Map([[2, { startTime: 5 }]]) } })).toEqual([])
  expect(read(ready)).toEqual([{ language: 'javascript', content: 'const value = 42' }])
  expect(read(ready)).toEqual([])
})
