/** Durable Session-message acceptance across committed history and pending inboxes. */
import { expect, it } from 'vitest'
import { createUserMessage } from '@redspark/rsh-llm/native'
import { Session, SessionId } from '@redspark/rsh-session/native'
import { messageAccepted } from '../src/session-message.ts'

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function session() {
  return Session.create(SessionId('acceptance'))
}

it('accepts a message already committed to history', () => {
  const log = session()
  const admitted = message('hello')
  log.append('user/message', admitted, { surfaceOp: 'append' })

  expect(messageAccepted(log.snapshotEvents(), candidate => candidate.id === admitted.id)).toBe(true)
})

it('accepts a message still pending at the next turn', () => {
  const log = session()
  const admitted = message('queued')
  log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [admitted] })

  expect(messageAccepted(log.snapshotEvents(), candidate => candidate.id === admitted.id)).toBe(true)
})

it('accepts a message moved from the next turn to the next step', () => {
  const log = session()
  const admitted = message('promoted')
  log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [admitted] })
  log.append('agent/inbox/moved', { messageId: admitted.id })

  expect(messageAccepted(log.snapshotEvents(), candidate => candidate.id === admitted.id)).toBe(true)
})

it('rejects a message absent from both history and the inbox', () => {
  const log = session()
  const admitted = message('queued')
  log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [admitted] })

  expect(messageAccepted(log.snapshotEvents(), candidate => candidate.id !== admitted.id)).toBe(false)
})

it('rejects an inbox move whose message is no longer pending', () => {
  const log = session()
  const admitted = message('queued')
  log.append('agent/inbox/moved', { messageId: admitted.id })

  expect(() => messageAccepted(log.snapshotEvents(), () => true)).toThrow('invalid persisted inbox move')
})

it('rejects moving an already moved message', () => {
  const log = session()
  const admitted = message('promoted')
  log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [admitted] })
  log.append('agent/inbox/moved', { messageId: admitted.id })
  log.append('agent/inbox/moved', { messageId: admitted.id })

  expect(() => messageAccepted(log.snapshotEvents(), () => true)).toThrow('invalid persisted inbox move')
})
