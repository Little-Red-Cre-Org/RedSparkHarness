// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/native'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { NativeTranscript } from '../src/native-transcript.tsx'
import type { ConversationSnapshot } from '../src/controller.ts'
import type { ChatRenderMessageImages } from '@deepseek-ai/dsh-client-ui-chat/native'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

afterEach(cleanup)

it('renders durable turns, reasoning, live text, and recorded Chat statistics', () => {
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(1), time: 10, data: { turn: 1, step: 1 } },
    {
      type: 'user/message', seq: SessionSeq(2), time: 12, data: {
        id: MessageId('user-1'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }],
      }, surfaceOp: 'append',
    },
    {
      type: 'assistant/message', seq: SessionSeq(3), time: 50, data: {
        turn: 1, step: 1, message: {
          id: MessageId('assistant-1'), role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
          content: [{ type: 'reasoning', text: 'Because' }, { type: 'text', text: 'Answer' }],
        },
        stream: [{ type: 'chunk', time: 20, chunk: { type: 'text-delta', index: 0, text: 'Answer' } }],
        usage: { inputTokens: 8, outputTokens: 4 },
      }, surfaceOp: 'append',
    },
    { type: 'step/end', seq: SessionSeq(4), time: 60, data: { turn: 1, step: 1 } },
    { type: 'turn/start', seq: SessionSeq(5), time: 70, data: { turn: 2 } },
    { type: 'step/start', seq: SessionSeq(6), time: 80, data: { turn: 2, step: 1 } },
    {
      type: 'user/message', seq: SessionSeq(7), time: 82, data: {
        id: MessageId('user-2'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Again' }],
      }, surfaceOp: 'append',
    },
    {
      type: 'assistant/message', seq: SessionSeq(8), time: 120, data: {
        turn: 2, step: 1, message: {
          id: MessageId('assistant-2'), role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
          content: [{ type: 'text', text: 'Done' }],
        },
        stream: [{ type: 'chunk', time: 95, chunk: { type: 'text-delta', index: 0, text: 'Done' } }],
        usage: { inputTokens: 9, outputTokens: 6 },
      }, surfaceOp: 'append',
    },
    { type: 'step/end', seq: SessionSeq(9), time: 125, data: { turn: 2, step: 1 } },
  ]
  const snapshot: ConversationSnapshot = { sessions: [], events, state: 'ready', liveText: 'Still streaming' }
  const t = (key: string): string => key
  const renderMessageImages: ChatRenderMessageImages = () => null

  render(<NativeTranscript snapshot={snapshot} locale="en" renderMessageImages={renderMessageImages}
    t={t as TranslateNS<'nativeApplication'>} />)

  expect(screen.getByText('Hello')).toBeTruthy()
  expect(screen.getByText('Because')).toBeTruthy()
  expect(screen.getByText('Answer')).toBeTruthy()
  expect(screen.getByText('Still streaming')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Turn navigation' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Jump to turn 1' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /2 turns 2 steps/ }))
  expect(screen.getByText('Avg time to first token (TTFT)')).toBeTruthy()
  expect(screen.getByText('Tokens per second (TPS)')).toBeTruthy()
})
