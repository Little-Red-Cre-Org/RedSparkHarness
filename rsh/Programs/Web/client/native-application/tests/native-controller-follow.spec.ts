import { expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { SESSION_FORMAT_VERSION, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient, NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from '../src/controller.ts'
import { createNativeSessionClient } from '../../native-session/src/native.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const makeHeader = (id: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: id as SessionId,
  createdAt: 1,
  isSeeded: false,
})

it('isolates delayed frames and late carrier errors while retaining title roster refresh', async () => {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
  const firstFollowStarted = deferred<undefined>()
  const secondFollowStarted = deferred<undefined>()
  const thirdFollowStarted = deferred<undefined>()
  const firstSettlement = deferred<{ exitCode: number; answer: string }>()
  const secondSettlement = deferred<{ exitCode: number; answer: string }>()
  const thirdSettlement = deferred<{ exitCode: number; answer: string }>()
  const firstFollowFailure = deferred<unknown>()
  const secondFollowFailure = deferred<unknown>()
  const thirdFollowFailure = deferred<unknown>()
  const alphaTitlePublished = deferred<undefined>()
  const betaTitlePublished = deferred<undefined>()
  const settlements = new Map([
    ['a1', firstSettlement],
    ['a2', secondSettlement],
    ['a3', thirdSettlement],
  ])
  const failedStreams = new Set<string>()
  const encoder = new TextEncoder()
  let admissionCount = 0
  let promptCount = 0
  let rows: NativeSessionListItem[] = [
    { header: makeHeader('session-alpha'), titleProjection: { status: 'absent' } },
    { header: makeHeader('session-beta'), titleProjection: { status: 'absent' } },
  ]
  const rpc = {
    async call(_channel: string, endpoint: string, payload: unknown) {
      if (endpoint === 'session/start') return { ok: true as const, value: { admissionId: `a${++admissionCount}` } }
      const admissionId = (payload as { admissionId: string }).admissionId
      if (endpoint === 'session/await') return { ok: true as const, value: await settlements.get(admissionId)!.promise }
      if (endpoint === 'session/cancel') return { ok: true as const, value: { cancelled: false } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    },
    async response(_channel: string, _endpoint: string, payload: unknown, signal: AbortSignal) {
      const admissionId = (payload as { admissionId: string }).admissionId
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          streams.set(admissionId, stream)
          signal.addEventListener('abort', () => { if (!failedStreams.has(admissionId)) stream.close() }, { once: true })
          if (admissionId === 'a1') firstFollowStarted.resolve(undefined)
          else if (admissionId === 'a2') secondFollowStarted.resolve(undefined)
          else thirdFollowStarted.resolve(undefined)
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    },
  } satisfies ClientConnectionRpc
  const transport = createNativeSessionClient(rpc, { maxFollowBufferChars: 10_000 })
  const followFailures = [firstFollowFailure, secondFollowFailure, thirdFollowFailure]
  const client: NativeSessionClient = {
    ...transport,
    prompt(sessionId, text, resume, signal, observe, images, onFollowError) {
      const failure = followFailures[promptCount++]!
      return transport.prompt(sessionId, text, resume, signal, observe, images, (error) => {
        onFollowError?.(error)
        failure.resolve(error)
      })
    },
    async list() { return rows },
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async history(id) { return { header: makeHeader(id), events: [], inheritedEventCount: 0 } },
  }
  const controller = new NativeConversationController(client, { maxLiveTextChars: 1_000, maxLiveEvents: 100 })
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getSnapshot()
    if (snapshot.sessions.find(row => row.header.id === 'session-alpha')?.titleProjection.status === 'resolved') {
      alphaTitlePublished.resolve(undefined)
    }
    if (snapshot.sessions.find(row => row.header.id === 'session-beta')?.titleProjection.status === 'resolved') {
      betaTitlePublished.resolve(undefined)
    }
  })
  const push = (admissionId: string, frame: object): void => {
    streams.get(admissionId)!.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
  }
  const fail = (admissionId: string, error: Error): void => {
    failedStreams.add(admissionId)
    streams.get(admissionId)!.error(error)
  }

  try {
    await controller.load()
    await controller.select('session-alpha' as SessionId)
    const firstSend = controller.send('first')
    await firstFollowStarted.promise
    firstSettlement.resolve({ exitCode: 0, answer: 'FIRST_ANSWER' })
    await firstSend

    const secondSend = controller.send('second')
    await secondFollowStarted.promise
    push('a2', { type: 'text-start' })
    push('a2', { type: 'text', text: 'SECOND_TURN_TEXT' })
    rows = rows.map(row => row.header.id === 'session-alpha'
      ? { ...row, titleProjection: { status: 'resolved', title: 'Late alpha title' } }
      : row)
    push('a1', { type: 'text-start' })
    push('a1', { type: 'text', text: 'FIRST_TURN_DELAYED_TEXT' })
    push('a1', { type: 'human', prompt: { kind: 'approval', id: 'old-human', toolName: 'old-tool' } })
    push('a1', { type: 'event', event: { type: 'session/end-seed', seq: 0, time: 1, data: {} } })
    push('a1', { type: 'title-updated' })
    await alphaTitlePublished.promise

    expect(controller.getSnapshot()).toMatchObject({ state: 'sending', selected: 'session-alpha', liveText: 'SECOND_TURN_TEXT' })
    expect(controller.getSnapshot().human).toBeUndefined()
    expect(controller.getSnapshot().events).toEqual([])

    fail('a1', new Error('superseded alpha carrier failure'))
    expect(await firstFollowFailure.promise).toMatchObject({ message: 'superseded alpha carrier failure' })
    expect(controller.getSnapshot()).toMatchObject({ state: 'sending', selected: 'session-alpha', error: undefined,
      liveText: 'SECOND_TURN_TEXT' })

    secondSettlement.resolve({ exitCode: 0, answer: 'SECOND_ANSWER' })
    await secondSend
    await controller.select('session-beta' as SessionId)

    rows = rows.map(row => row.header.id === 'session-beta'
      ? { ...row, titleProjection: { status: 'resolved', title: 'Late beta title' } }
      : row)
    push('a2', { type: 'text-start' })
    push('a2', { type: 'text', text: 'OLD_SESSION_TEXT' })
    push('a2', { type: 'human', prompt: { kind: 'approval', id: 'old-human-2', toolName: 'old-tool' } })
    push('a2', { type: 'event', event: { type: 'session/end-seed', seq: 1, time: 2, data: {} } })
    push('a2', { type: 'title-updated' })
    await betaTitlePublished.promise

    fail('a2', new Error('old alpha selection carrier failure'))
    expect(await secondFollowFailure.promise).toMatchObject({ message: 'old alpha selection carrier failure' })

    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', selected: 'session-beta', error: undefined })
    expect(controller.getSnapshot().liveText).toBeUndefined()
    expect(controller.getSnapshot().human).toBeUndefined()
    expect(controller.getSnapshot().events).toEqual([])

    const thirdSend = controller.send('third')
    await thirdFollowStarted.promise
    thirdSettlement.resolve({ exitCode: 0, answer: 'THIRD_ANSWER' })
    await thirdSend
    fail('a3', new Error('late beta carrier failure'))
    expect(await thirdFollowFailure.promise).toMatchObject({ message: 'late beta carrier failure' })
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', selected: 'session-beta', error: 'late beta carrier failure' })
  } finally {
    unsubscribe()
    firstSettlement.resolve({ exitCode: 130, answer: '' })
    secondSettlement.resolve({ exitCode: 130, answer: '' })
    thirdSettlement.resolve({ exitCode: 130, answer: '' })
    await controller.close()
    await transport.close()
  }
})
