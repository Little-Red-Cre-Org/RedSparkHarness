// @vitest-environment jsdom
/**
 * Native per-message action contributions.
 *
 * The Native transcript owns a standard assistant action row (copy plus the
 * token/duration/time metadata) and additionally renders whatever the
 * `native.conversation.message.actions` slot contributes for that message.
 * These tests pin the three properties that make the slot safe to open:
 *
 * 1. a contribution appears beside the standard row, not instead of it;
 * 2. an empty slot leaves the standard row exactly as it was (no blank row);
 * 3. the contribution is addressed by the durable message id.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { NativeTranscript } from '../src/native-transcript.tsx'
import { en } from '../src/locales.ts'

/** The dispatcher shape the transcript actually accepts. */
type RenderSlotFn = PropsRenderSlots<'native.conversation.message.actions'>['renderSlot']

afterEach(cleanup)

const SESSION = 'native-feedback-session' as SessionId

/** One settled assistant message with a stable durable id. */
function assistantMessage(messageId: string): SessionEvent[] {
  return [
    { seq: 0, time: 1_000, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: 1_100, type: 'step/start', data: { turn: 1, step: 1 } },
    {
      seq: 2,
      time: 2_500,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: messageId,
          role: 'assistant',
          content: [{ type: 'text', text: 'The answer body.' }],
          source: { kind: 'model', provider: 'test', model: 'test-model' },
        },
        stream: [],
        usage: { inputTokens: 10, outputTokens: 20 },
      },
    },
    { seq: 3, time: 2_600, type: 'turn/end', data: { turn: 1 } },
  ] as unknown as SessionEvent[]
}

function transcriptProps(renderSlot: RenderSlotFn, events: SessionEvent[]) {
  return {
    sessionId: SESSION,
    locale: 'en' as const,
    loadImage: async () => new Blob(),
    t: makeTranslate(en),
    markdownLabels: { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' },
    imageGroupClassName: undefined,
    truncatedClassName: undefined,
    snapshot: { sessions: [], events, state: 'ready' as const },
    renderSlot,
  }
}

describe('native.conversation.message.actions', () => {
  it('renders a contribution beside the standard copy and metadata row', () => {
    const contributions: string[] = []
    const events = assistantMessage('msg-contributed')
    const renderSlot = ((_key: string, owner: { messageId: string }) => {
      contributions.push(owner.messageId)
      return <button type="button" data-feedback="like">Like</button>
    }) as unknown as RenderSlotFn
    const { container } = render(<NativeTranscript {...transcriptProps(renderSlot, events)} />)

    // The contribution is present…
    expect(screen.getByRole('button', { name: 'Like' })).toBeTruthy()
    // …and the standard row survived beside it: the copy control is still there.
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    // …inside the same action row the transcript owns.
    const row = container.querySelector('[data-chat-message-action-row]')
    expect(row).toBeTruthy()
    expect(row?.querySelector('[data-feedback="like"]')).toBeTruthy()
    // The slot was addressed by the durable message id.
    expect(contributions).toEqual(['msg-contributed'])
  })

  it('keeps the standard copy and metadata row when the slot contributes nothing', () => {
    const events = assistantMessage('msg-empty-slot')
    const renderSlot = vi.fn(() => null) as unknown as RenderSlotFn
    const { container } = render(<NativeTranscript {...transcriptProps(renderSlot, events)} />)

    // The slot was consulted for this message…
    expect(renderSlot).toHaveBeenCalledOnce()
    expect(renderSlot).toHaveBeenCalledWith('native.conversation.message.actions', { messageId: 'msg-empty-slot' })
    // …and the row did not collapse into blank: copy and metadata still render.
    const row = container.querySelector('[data-chat-message-action-row]')
    expect(row).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(row?.textContent).toContain('30')
  })

  it('does not address an interrupted partial, which has no settled message', () => {
    const events = assistantMessage('msg-interrupted')
    const interrupted = events.map((event): SessionEvent => event.type === 'assistant/message'
      ? { ...event, data: { ...event.data, interrupted: true as const } }
      : event)
    const renderSlot = vi.fn(() => null) as unknown as RenderSlotFn
    render(<NativeTranscript {...transcriptProps(renderSlot, interrupted)} />)

    expect(renderSlot).not.toHaveBeenCalled()
  })
})
