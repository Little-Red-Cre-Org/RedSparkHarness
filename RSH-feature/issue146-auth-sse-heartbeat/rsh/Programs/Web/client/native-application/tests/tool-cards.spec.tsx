import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ToolCard, toolCardRecords } from '../src/tool-cards.tsx'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq: SessionSeq(seq), time: 1_700_000_000_000 + seq, type, data } as unknown as SessionEvent
}

const call = (callId = 'call-1') => event(1, 'tool/call', {
  turn: 1, step: 1, callId, name: 'read', arguments: '{"file_path":"tool-card.txt"}',
})

const result = (callId = 'call-1', over: Record<string, unknown> = {}, seq = 2) => event(seq, 'tool/result', {
  turn: 1, step: 1,
  message: {
    id: 'message-1', role: 'user', source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', toolCallId: callId, isError: true, content: [{ type: 'text', text: 'failed' }] }],
  },
  error: { name: 'Error', code: 'READ_FAILED' },
  meta: { path: 'tool-card.txt' },
  ...over,
})

describe('native Tool card projection', () => {
  it('pairs durable call and result facts under the call sequence', () => {
    const record = toolCardRecords([
      event(0, 'assistant/message', {}), call(),
      event(2, 'tool/ptc-dispatch-start', {
        rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'call-1:ptc:1',
        name: 'read', arguments: { path: 'child.txt' },
      }),
      event(3, 'tool/ptc-dispatch', {
        rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'call-1:ptc:1',
        name: 'read', arguments: { path: 'child.txt' }, isError: false, content: [{ type: 'text', text: 'child' }],
      }),
      result('call-1', {}, 4),
    ])[0]!
    expect(record).toMatchObject({
      seq: 1,
      block: {
        kind: 'tool-result', callId: 'call-1', call: { name: 'read', argsRaw: '{"file_path":"tool-card.txt"}' },
        callTime: 1_700_000_000_001, content: [{ type: 'text', text: 'failed' }], isError: true,
        error: { name: 'Error', code: 'READ_FAILED' }, meta: { path: 'tool-card.txt' },
        subCalls: [{ kind: 'tool-result', callId: 'call-1:ptc:1', call: { name: 'read', argsRaw: '{"path":"child.txt"}' },
          callTime: 1_700_000_000_002, content: [{ type: 'text', text: 'child' }], isError: false }],
      },
    })
  })

  it('keeps an in-flight call and uses its name for the card', () => {
    const record = toolCardRecords([call()])[0]!
    expect(record.block).toMatchObject({ callId: 'call-1', name: 'read', turn: 1, step: 1, subCalls: [] })
    expect(ToolCard({ block: record.block, locale: 'en' }).props).toMatchObject({ toolName: 'read', locale: 'en' })
  })

  it('keeps result-only window history and uses its call id as the title key', () => {
    const record = toolCardRecords([result('windowed', { error: undefined, meta: undefined })])[0]!
    expect(record).toMatchObject({ seq: 2, block: { kind: 'tool-result', callId: 'windowed', call: null, callTime: null } })
    expect(ToolCard({ block: record.block, locale: 'zh' }).props).toMatchObject({ toolName: 'windowed', locale: 'zh' })
  })
})
