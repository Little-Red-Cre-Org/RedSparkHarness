/** Deterministic persisted source Session for the native reference snapshot. */

import { Session, SessionId } from '@redspark/rsh-session/native'
import { createMessage, createUserMessage } from '@redspark/rsh-llm/native'

interface WriteHandle {
  append(events: readonly unknown[]): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

interface SeedStorage {
  create(header: unknown): Promise<WriteHandle>
}

/**
 * Create the 8922-byte source projection and persist it, so `sessionQuery` can read it.
 *
 * `Session.create` assigns each event's `seq` and produces the header the store encodes;
 * a hand-written JSONL supplies neither, which is why it lists but reads back empty.
 * @param storage - persistence operations for the scenario's session root.
 * @returns the persisted source session id.
 */
export async function seedReferenceSource(storage: SeedStorage): Promise<string> {
  const session = Session.create(SessionId('reference-source'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'EARLY_SOURCE_FACT\n' + 'Historical detail 界.\n'.repeat(30)
      + 'x'.repeat(4096) + 'GIANT_LINE_MIDDLE_FACT' + 'y'.repeat(4096) }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'NESTED_REFERENCE_MUST_NOT_PROPAGATE' }],
    source: { kind: 'session-reference', form: 'recall', version: 1, references: [] },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_PROPAGATE' },
        { type: 'text', text: 'LATEST_SOURCE_FACT\nThe captured answer is forty-two.' },
      ],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  const handle = await storage.create(session.header)
  await handle.append([...session.ownEvents()])
  await handle.flush()
  await handle.close()
  return String(session.id)
}
