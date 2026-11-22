/** A later successful submissions read clears the banner from an earlier failure. */
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionHeader, type SessionId } from '@redspark/rsh-session/types'
import type { NativeSessionClient } from '@redspark/rsh-client-native-session/native'
import { NativeConversationController } from '../src/controller.ts'

const header = (id: SessionId): SessionHeader => ({
  version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false,
})

it('clears submissionError when a later submissions read succeeds', async () => {
  const id = 'session-submission-error' as SessionId
  let reads = 0
  const client = {
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline' as const, items: [] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history() { return { header: header(id), events: [], inheritedEventCount: 0 } },
    async submissions() {
      reads += 1
      if (reads === 1) throw new Error('native-agent: Agent is busy')
      return { throughSeq: SessionSeq(4), submissions: [] }
    },
    async attach() { return undefined },
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 10 })
  try {
    await controller.load()
    await controller.select(id)
    expect(reads).toBeGreaterThanOrEqual(2)
    expect(controller.getSnapshot()).toMatchObject({
      selected: id, state: 'ready', submissions: { throughSeq: 4, submissions: [] }, submissionError: undefined,
    })
  } finally {
    await controller.close()
  }
})
