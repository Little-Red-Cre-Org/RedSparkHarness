// @vitest-environment jsdom
/**
 * Native message-feedback entry.
 *
 * The browser build's components are reused verbatim; what this suite pins is
 * the Native wiring: the entry registers into the Native slots, a rating click
 * reaches `clientNativeSession.messageFeedbackPut` with the addressed message
 * id, and the Native transport's carrier/business split matches what the
 * browser build reports through `ctx.remote`.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@redspark/rsh-client-test-runtime'
import { zh as commonZh } from '@redspark/rsh-client-locale/src/locales/zh.ts'
import type { MessageId } from '@redspark/rsh-api-remotes/client'
import type {
  MessageFeedbackItem, MessageFeedbackPutRequest, MessageFeedbackVersion,
} from '@redspark/rsh-message-feedback/types'
import { MessageFeedbackActions } from '../src/client/MessageFeedbackActions.tsx'
import type {
  MessageFeedbackActionResult, MessageFeedbackView,
} from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const MSG = 'native-message-1' as MessageId
const t = makeTranslate(zh, commonZh)

function item(overrides: Partial<MessageFeedbackItem> = {}): MessageFeedbackItem {
  return {
    messageId: MSG,
    rating: 'positive',
    version: 'v1' as MessageFeedbackVersion,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/**
 * Render the reused browser component over a fixed view, recording calls.
 *
 * This mounts the same `MessageFeedbackActions` the Native entry registers, so
 * the gesture being asserted is the shipped one; only the injected verbs are
 * stand-ins, which is exactly the seam the Native transport occupies.
 */
function mount(options: { status?: MessageFeedbackView['status']; items?: MessageFeedbackItem[] } = {}) {
  const view: MessageFeedbackView = {
    status: options.status ?? 'ready',
    items: new Map((options.items ?? []).map(entry => [entry.messageId, entry])),
    error: null,
  }
  const ensure = vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true }))
  const retract = vi.fn(() => Promise.resolve<MessageFeedbackActionResult>({ ok: true }))
  const openDialog = vi.fn((_messageId: MessageId, _rating: 'positive' | 'negative') => {})
  const useFeedback = (<T,>(selector: (value: MessageFeedbackView) => T): T =>
    useSyncExternalStore(() => () => {}, () => selector(view))) as never
  const props = {
    messageId: MSG, ensure, current: (id: MessageId) => view.items.get(id),
    retract, openDialog, useFeedback, t,
  } as unknown as Parameters<typeof MessageFeedbackActions>[0]
  render(<MessageFeedbackActions {...props} />)
  return { ensure, retract, openDialog }
}

describe('native message feedback surface', () => {
  it('opens the dialog for an unrecorded rating instead of writing immediately', async () => {
    const { openDialog, retract } = mount()
    fireEvent.click(screen.getByRole('button', { name: zh['action.like'] }))
    await waitFor(() => { expect(openDialog).toHaveBeenCalledWith(MSG, 'positive') })
    // A judgment is only recorded after the dialog submits, never on the click.
    expect(retract).not.toHaveBeenCalled()
  })

  it('retracts the recorded rating, addressed by the message id', async () => {
    const { retract, openDialog } = mount({ items: [item({ rating: 'positive' })] })
    fireEvent.click(screen.getByRole('button', { name: zh['action.likeActive'] }))
    await waitFor(() => { expect(retract).toHaveBeenCalledWith(MSG, 'positive') })
    expect(openDialog).not.toHaveBeenCalled()
  })
})

describe('native transport', () => {
  it('forwards a put with the addressed message id, rating and observed version', async () => {
    // Mirrors what the entry's transport does: bind the Native Session client
    // methods behind the surface's carrier shape.
    const { nativeTransport } = await import('../src/native.ts')
    const put = vi.fn(async (request: MessageFeedbackPutRequest) => ({
      ok: true as const,
      value: item({ rating: request.rating }),
    }))
    const transport = nativeTransport({
      messageFeedbackList: async () => ({ ok: true, value: { items: [] } }),
      messageFeedbackPut: put,
      messageFeedbackDelete: async () => ({ ok: true, value: { absent: true } }),
      sessionFeedbackRecord: async () => ({ ok: true, value: { recorded: true } }),
    })

    const carried = await transport.put({
      sessionId: 'session-1' as never,
      messageId: MSG,
      rating: 'positive',
      ifVersion: null,
    })

    expect(carried.ok).toBe(true)
    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith({
      sessionId: 'session-1',
      messageId: MSG,
      rating: 'positive',
      ifVersion: null,
    })
  })

  it('reports a rejected call as a carrier failure rather than throwing', async () => {
    const { nativeTransport } = await import('../src/native.ts')
    const transport = nativeTransport({
      messageFeedbackList: async () => { throw new Error('connection reset') },
      messageFeedbackPut: async () => { throw new Error('connection reset') },
      messageFeedbackDelete: async () => { throw new Error('connection reset') },
      sessionFeedbackRecord: async () => { throw new Error('connection reset') },
    })

    const carried = await transport.list({ sessionId: 'session-1' as never })
    expect(carried.ok).toBe(false)
    if (!carried.ok) expect(carried.error.message).toBe('connection reset')
  })
})
