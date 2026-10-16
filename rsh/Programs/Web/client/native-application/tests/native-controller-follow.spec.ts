import { expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient, NativeSessionListFrame, NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from '../src/controller.ts'
import { createNativeSessionClient } from '../../native-session/src/native.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function frameQueue<T>() {
  const frames: T[] = []
  let deliver: ((frame: T | undefined) => void) | undefined
  return {
    publish(frame: T): void {
      const next = deliver
      deliver = undefined
      if (next === undefined) frames.push(frame)
      else next(frame)
    },
    take(signal: AbortSignal): Promise<T | undefined> {
      const frame = frames.shift()
      if (frame !== undefined) return Promise.resolve(frame)
      if (signal.aborted) return Promise.resolve(undefined)
      return new Promise((resolve) => {
        const abort = (): void => {
          deliver = undefined
          resolve(undefined)
        }
        deliver = (next) => {
          signal.removeEventListener('abort', abort)
          resolve(next)
        }
        signal.addEventListener('abort', abort, { once: true })
      })
    },
  }
}

const makeHeader = (id: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: id as SessionId,
  createdAt: 1,
  isSeeded: false,
})

it('refreshes durable history when restore finds no active turn', async () => {
  const id = 'session-finished-before-attach' as SessionId
  const finalEvent: SessionEvent = { type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} }
  let historyReads = 0
  const client = {
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline' as const, items: [] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(sessionId: SessionId) {
      historyReads++
      return { header: makeHeader(sessionId), events: historyReads === 1 ? [] : [finalEvent], inheritedEventCount: 0 }
    },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    async attach() { return undefined },
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 10 })
  try {
    await controller.load()
    await controller.select(id)
    expect(historyReads).toBe(2)
    expect(controller.getSnapshot().events).toEqual([finalEvent])
  } finally {
    await controller.close()
  }
})

it('waits for controller operations before selecting a connected Session', async () => {
  const id = 'session-after-refresh' as SessionId
  const controlsRefresh = deferred<Awaited<ReturnType<NativeSessionClient['modelControls']>>>()
  let modelControlReads = 0
  const client = {
    modelControls() {
      modelControlReads++
      return modelControlReads === 1
        ? Promise.resolve({ catalog: null, canSelectModel: false, presets: [] })
        : controlsRefresh.promise
    },
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline' as const, items: [] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(sessionId: SessionId) {
      return { header: makeHeader(sessionId), events: [], inheritedEventCount: 0 }
    },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    async attach() { return undefined },
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 10 })
  try {
    await controller.load()
    const refresh = controller.refreshModelControls()
    const idle = controller.idle()
    expect(controller.getSnapshot().state).toBe('loading')
    controlsRefresh.resolve({ catalog: null, canSelectModel: false, presets: [] })
    await idle
    expect(controller.getSnapshot().state).toBe('ready')
    await controller.select(id)
    await refresh
    expect(controller.getSnapshot().selected).toBe(id)
  } finally {
    await controller.close()
  }
})

it('deselects a Session with a running turn by detaching without cancelling the Host turn', async () => {
  let turnSignal: AbortSignal | undefined
  const attached = deferred<undefined>()
  const client = {
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline' as const, items: [] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(sessionId: SessionId) { return { header: makeHeader(sessionId), events: [], inheritedEventCount: 0 } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    attach(_id: SessionId, _lastSeq: number, _observe: unknown, signal: AbortSignal, _onFollowError: unknown, detach: AbortSignal) {
      turnSignal = signal
      attached.resolve(undefined)
      return new Promise((resolve) => { detach.addEventListener('abort', () => { resolve(undefined) }, { once: true }) })
    },
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 10 })
  try {
    await controller.load()
    const selection = controller.select('session-running' as SessionId)
    await attached.promise
    expect(controller.getSnapshot().state).toBe('sending')
    await controller.deselect()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', selected: undefined, events: [] })
    expect(turnSignal?.aborted).toBe(false)
    await selection
    const reselect = controller.select('session-running' as SessionId)
    await expect(controller.deselect()).rejects.toThrow('operation already pending')
    await controller.close()
    await reselect
  } finally {
    await controller.close()
  }
})

it('isolates delayed frames and late carrier errors while retaining title roster refresh', async () => {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
  const firstFollowStarted = deferred<undefined>()
  const secondFollowStarted = deferred<undefined>()
  const thirdFollowStarted = deferred<undefined>()
  const secondTextPublished = deferred<undefined>()
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
  const cursorByAdmission = new Map<string, number>()
  const seedEvent: SessionEvent = { type: 'session/end-seed', seq: SessionSeq(0), time: 1, data: {} }
  let rows: NativeSessionListItem[] = [
    { header: makeHeader('session-alpha'), titleProjection: { status: 'absent' }, updatedAt: 1,
      blank: true, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false },
    { header: makeHeader('session-beta'), titleProjection: { status: 'absent' }, updatedAt: 1,
      blank: true, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false },
  ]
  const rosterFrames = frameQueue<NativeSessionListFrame>()
  const rpc = {
    async call(_channel: string, endpoint: string, payload: unknown) {
      if (endpoint === 'session/attach') return { ok: true as const, value: { admissionId: null } }
      if (endpoint === 'session/start') {
        const admissionId = `a${++admissionCount}`
        cursorByAdmission.set(admissionId, (payload as { lastSeq: number }).lastSeq)
        return { ok: true as const, value: { admissionId } }
      }
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
          const request = payload as { sessionId: string }
          const lastSeq = cursorByAdmission.get(admissionId)!
          stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'baseline', sessionId: request.sessionId,
            fromSeq: lastSeq, throughSeq: lastSeq })}\n\n`))
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
    prompt(sessionId, text, resume, signal, observe, images, onFollowError, lastSeq, detach) {
      const failure = followFailures[promptCount++]!
      return transport.prompt(sessionId, text, resume, signal, observe, images, (error) => {
        onFollowError?.(error)
        failure.resolve(error)
      }, lastSeq, detach)
    },
    async list() { return rows },
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline', items: rows }
      while (true) {
        const frame = await rosterFrames.take(signal)
        if (frame === undefined) return
        yield frame
      }
    },
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    async history(id) { return { header: makeHeader(id), events: [seedEvent], inheritedEventCount: 0 } },
  }
  const controller = new NativeConversationController(client, { maxLiveTextChars: 1_000, maxLiveEvents: 100 })
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getSnapshot()
    if (snapshot.liveText === 'SECOND_TURN_TEXT') secondTextPublished.resolve(undefined)
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
    await secondTextPublished.promise
    rows = rows.map(row => row.header.id === 'session-alpha'
      ? { ...row, titleProjection: { status: 'resolved', title: 'Late alpha title' } }
      : row)
    rosterFrames.publish({ type: 'upsert', item: rows.find(row => row.header.id === 'session-alpha')! })
    push('a1', { type: 'text-start' })
    push('a1', { type: 'text', text: 'FIRST_TURN_DELAYED_TEXT' })
    push('a1', { type: 'human', prompt: { kind: 'approval', id: 'old-human', toolName: 'old-tool' } })
    push('a1', { type: 'event', event: { type: 'session/end-seed', seq: 1, time: 2, data: {} } })
    push('a1', { type: 'title-updated' })
    await alphaTitlePublished.promise

    expect(controller.getSnapshot()).toMatchObject({ state: 'sending', selected: 'session-alpha', liveText: 'SECOND_TURN_TEXT' })
    expect(controller.getSnapshot().human).toBeUndefined()
    expect(controller.getSnapshot().events).toEqual([seedEvent])

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
    rosterFrames.publish({ type: 'upsert', item: rows.find(row => row.header.id === 'session-beta')! })
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
    expect(controller.getSnapshot().events).toEqual([seedEvent])

    const thirdSend = controller.send('third')
    await thirdFollowStarted.promise
    thirdSettlement.resolve({ exitCode: 0, answer: 'THIRD_ANSWER' })
    await thirdSend
    fail('a3', new Error('late beta carrier failure'))
    expect(await thirdFollowFailure.promise).toMatchObject({ message: 'late beta carrier failure' })
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', selected: 'session-beta', error: 'late beta carrier failure' })
    await controller.deselect()
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', selected: undefined, header: undefined, events: [],
      modeControls: undefined, permissionControls: undefined, submissions: undefined, error: undefined })
  } finally {
    unsubscribe()
    firstSettlement.resolve({ exitCode: 130, answer: '' })
    secondSettlement.resolve({ exitCode: 130, answer: '' })
    thirdSettlement.resolve({ exitCode: 130, answer: '' })
    await controller.close()
    await transport.close()
  }
})

it('keeps Host inbox acknowledgement and sequence ordering separate from turn settlement and selection', async () => {
  type Inbox = Awaited<ReturnType<NativeSessionClient['submissions']>>
  const alpha = 'alpha' as SessionId
  const beta = 'beta' as SessionId
  const turn = deferred<{ exitCode: number; answer: string }>()
  const retryTurn = deferred<{ exitCode: number; answer: string }>()
  let activeTurn = turn.promise
  let promptCount = 0
  let observe: Parameters<NativeSessionClient['prompt']>[4]
  let inbox: Inbox = { throughSeq: -1, submissions: [] }
  let durableHistory: SessionEvent[] = []
  const reads: ReturnType<typeof deferred<Inbox>>[] = []
  const calls: { id: string; text: string; placement: string }[] = []
  let delayRead = false
  let rejectNext = false
  let holdQueue = false
  let loseNextQueueAck = false
  const lateAcknowledgement = deferred<Awaited<ReturnType<NativeSessionClient['queue']>>>()
  let requestId: Parameters<NativeSessionClient['queue']>[2] | undefined
  const transport = createNativeSessionClient({ async call() { throw new Error('unexpected transport') } },
    { maxFollowBufferChars: 10_000 })
  const client: NativeSessionClient = {
    ...transport,
    async *follow() { yield { type: 'baseline', items: [] } },
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return { current: null, options: [], revision: null, locked: true, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(id) { return { header: makeHeader(id), events: durableHistory, inheritedEventCount: 0 } },
    async submissions() {
      if (!delayRead) return inbox
      const read = deferred<Inbox>()
      reads.push(read)
      return read.promise
    },
    prompt(_id, text, _resume, signal, next) {
      promptCount++; if (text === 'retry after settle') expect(controller.getSnapshot().events.at(-1)?.seq).toBe(SessionSeq(13))
      observe = next
      signal?.addEventListener('abort', () => { turn.resolve({ exitCode: 130, answer: '' }) }, { once: true })
      return activeTurn
    },
    async queue(_id, text, id) {
      calls.push({ id, text, placement: 'queued' })
      requestId = id
      if (loseNextQueueAck) {
        loseNextQueueAck = false
        inbox = { throughSeq: SessionSeq(12), submissions: [{ requestId: id, placement: 'queued', status: 'accepted', message: {
          id: String(id) as Inbox['submissions'][number]['message']['id'], role: 'user', source: { kind: 'user' },
          content: [{ type: 'text', text }],
        } }] }
        throw new Error('lost acknowledgement')
      }
      if (rejectNext) { rejectNext = false; throw new Error('not accepted') }
      if (holdQueue) return lateAcknowledgement.promise
      return { requestId: id, placement: 'queued', status: 'accepted' }
    },
    async steer(_id, text, id) {
      calls.push({ id, text, placement: 'steering' })
      return { requestId: id, placement: 'steering', status: 'accepted' }
    },
  }
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  try {
    await controller.load()
    await controller.select(alpha)
    const sending = controller.send('start')
    expect(() => controller.create()).toThrow('operation already pending')
    expect(controller.getSnapshot()).toMatchObject({ selected: alpha, state: 'sending' })
    rejectNext = true
    expect(await controller.submitPending('later', 'queued')).toBe(false)
    expect(controller.getSnapshot()).toMatchObject({ state: 'sending', submissionError: 'not accepted' })
    expect(await controller.submitPending('later', 'queued')).toBe(true)
    expect(calls[0]?.id).toBe(calls[1]?.id)
    expect(requestId).toBeDefined()
    expect(await controller.submitPending('next step', 'steering')).toBe(true)
    expect(calls[2]).toMatchObject({ text: 'next step', placement: 'steering' })
    // The mutation reply never invents a pending message absent from the Host snapshot.
    expect(controller.getSnapshot().submissions?.submissions).toEqual([])

    delayRead = true
    observe?.({ type: 'submission-update', requestId: requestId!, status: 'accepted' })
    observe?.({ type: 'submission-update', requestId: requestId!, status: 'settled' })
    expect(reads).toHaveLength(2)
    reads[1]!.resolve({ throughSeq: SessionSeq(9), submissions: [] })
    await reads[1]!.promise
    await Promise.resolve()
    reads[0]!.resolve({ throughSeq: SessionSeq(2), submissions: [] })
    await reads[0]!.promise
    await Promise.resolve()
    expect(controller.getSnapshot().submissions?.throughSeq).toBe(9)

    delayRead = false
    const pendingId = requestId!
    inbox = { throughSeq: SessionSeq(10), submissions: [{ requestId: pendingId, placement: 'queued', status: 'accepted', message: {
      id: String(pendingId) as Inbox['submissions'][number]['message']['id'], role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: 'Still waiting in the last read' }],
    } }] }
    holdQueue = true
    const lateSubmission = controller.submitPending('concurrent settlement', 'queued')
    expect(controller.getSnapshot().submissionBusy).toBe(true)
    expect(await controller.submitPending('duplicate click', 'queued')).toBe(false)
    turn.resolve({ exitCode: 0, answer: '' })
    await sending
    expect(controller.getSnapshot().state).toBe('ready')
    expect(controller.getSnapshot().submissions?.submissions).toHaveLength(1)
    delayRead = true
    observe?.({ type: 'submission-update', requestId: pendingId, status: 'settled' })
    expect(reads).toHaveLength(3)
    const updatedInbox = deferred<undefined>()
    const stopObservingInbox = controller.subscribe(() => {
      if (controller.getSnapshot().submissions?.throughSeq === 11) updatedInbox.resolve(undefined)
    })
    try {
      reads[2]!.resolve({ throughSeq: SessionSeq(11), submissions: [] })
      await updatedInbox.promise
      expect(controller.getSnapshot().submissions).toEqual({ throughSeq: 11, submissions: [] })
    } finally { stopObservingInbox() }
    const oldRead = controller.refreshPendingSubmissions()
    delayRead = false
    inbox = { throughSeq: -1, submissions: [] }
    await controller.select(beta)
    lateAcknowledgement.resolve({ requestId: requestId!, placement: 'queued', status: 'accepted' })
    expect(await lateSubmission).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ selected: beta, state: 'ready', submissionBusy: false })
    reads[3]!.resolve({ throughSeq: SessionSeq(20), submissions: [] })
    await oldRead
    const readCount = reads.length
    observe?.({ type: 'submission-update', requestId: pendingId, status: 'settled' })
    expect(reads).toHaveLength(readCount)
    expect(controller.getSnapshot()).toMatchObject({ selected: beta, state: 'ready', submissions: { throughSeq: -1 } })

    holdQueue = false
    activeTurn = retryTurn.promise
    const retryingTurn = controller.send('lost acknowledgement turn')
    loseNextQueueAck = true
    const callsBeforeLostAck = calls.length
    expect(await controller.submitPending('retry after settle', 'queued')).toBe(false)
    expect(calls).toHaveLength(callsBeforeLostAck + 1)
    const lostAckRequestId = requestId!
    retryTurn.resolve({ exitCode: 0, answer: '' })
    await retryingTurn
    expect(controller.getSnapshot().state).toBe('ready')

    inbox = { throughSeq: SessionSeq(13), submissions: [] }
    durableHistory = [{ type: 'user/message', seq: SessionSeq(13), time: 1,
      data: { id: 'unrelated-request', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'retry after settle' }] }, surfaceOp: 'append' } as unknown as SessionEvent]
    const promptsBeforeRetry = promptCount
    delayRead = true
    const cancellingRetry = controller.send('retry after settle')
    controller.cancel()
    delayRead = false
    reads[4]!.resolve(inbox)
    await cancellingRetry
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', error: 'native conversation: user cancelled' })
    expect(promptCount).toBe(promptsBeforeRetry)
    const callsBeforeRetry = calls.length
    delayRead = true
    const retryingAbsent = controller.send('retry after settle')
    observe?.({ type: 'submission-update', requestId: lostAckRequestId, status: 'settled' })
    delayRead = false
    reads[6]!.resolve(inbox)
    reads[5]!.resolve(inbox)
    await retryingAbsent
    expect(promptCount).toBe(promptsBeforeRetry + 1)
    expect(calls).toHaveLength(callsBeforeRetry)
    expect(inbox.submissions).toEqual([])
    expect(controller.getSnapshot()).toMatchObject({ submissions: { throughSeq: 13, submissions: [] }, submissionError: undefined })
    expect(controller.getSnapshot().events.some(event => event.seq === SessionSeq(13))).toBe(true)
    await controller.send('retry after settle')
    expect(promptCount).toBe(promptsBeforeRetry + 2)
    expect(calls).toHaveLength(callsBeforeRetry)
  } finally {
    lateAcknowledgement.resolve({ requestId: requestId!, placement: 'queued', status: 'accepted' })
    for (const read of reads) read.resolve({ throughSeq: -1, submissions: [] })
    turn.resolve({ exitCode: 130, answer: '' })
    retryTurn.resolve({ exitCode: 130, answer: '' })
    await controller.close()
    await transport.close()
  }
})

it('settles a ready retry from the accepted Host submission before prompting again', async () => {
  type Inbox = Awaited<ReturnType<NativeSessionClient['submissions']>>
  const sessionId = 'accepted-retry' as SessionId
  const item: NativeSessionListItem = { header: makeHeader(sessionId), titleProjection: { status: 'absent' },
    updatedAt: 1, blank: true, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false }
  const turn = deferred<{ exitCode: number; answer: string }>()
  const transport = createNativeSessionClient({ async call() { throw new Error('unexpected transport') } },
    { maxFollowBufferChars: 10_000 })
  let promptCount = 0
  let inbox: Inbox = { throughSeq: -1, submissions: [] }
  const client: NativeSessionClient = {
    ...transport,
    async *follow() { yield { type: 'baseline', items: [item] } },
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return { current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } } },
    async permissionControls() { return { available: false, currentValue: null, options: [] } },
    async history(id) { return { header: makeHeader(id), events: [], inheritedEventCount: 0 } },
    async submissions() { return inbox },
    prompt() { promptCount++; return turn.promise },
    async queue(_id, text, requestId) {
      inbox = { throughSeq: SessionSeq(1), submissions: [{ requestId, placement: 'queued', status: 'accepted', message: {
        id: String(requestId) as Inbox['submissions'][number]['message']['id'], role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text }],
      } }] }
      throw new Error('lost acknowledgement')
    },
  }
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 100 })
  try {
    await controller.load()
    await controller.select(sessionId)
    const firstSend = controller.send('retry this accepted text')
    expect(await controller.submitPending('retry this accepted text', 'queued')).toBe(false)
    expect(inbox.submissions[0]).toMatchObject({ status: 'accepted', message: { content: [{ text: 'retry this accepted text' }] } })
    turn.resolve({ exitCode: 0, answer: '' })
    await firstSend
    expect(controller.getSnapshot().state).toBe('ready')

    await controller.send('retry this accepted text')
    expect(promptCount).toBe(1)
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', submissions: { throughSeq: 1 }, error: undefined })
  } finally {
    turn.resolve({ exitCode: 130, answer: '' })
    await controller.close()
    await transport.close()
  }
})
