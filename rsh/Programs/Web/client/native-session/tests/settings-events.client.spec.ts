/** Settings callers share one HTTP stream so the shell does not fill the browser connection limit. */
import { expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@redspark/rsh-client-connection/native'
import { createNativeSessionClient } from '../src/native.ts'

const ADAPTERS = { type: 'llm/adapters-updated' }
const encoder = new TextEncoder()

function frame(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

function responseRpc(response: NonNullable<ClientConnectionRpc['response']>): ClientConnectionRpc {
  return { call: async () => ({ ok: true, value: undefined }), response }
}

it('shares one Settings stream and keeps it open until the last caller aborts', async () => {
  let calls = 0
  let responseSignal: AbortSignal | undefined
  let enqueue: (bytes: Uint8Array) => void = () => { throw new Error('stream not open') }
  let finish: () => void = () => { throw new Error('stream not open') }
  const client = createNativeSessionClient(responseRpc(async (_channel, endpoint, _payload, signal) => {
    calls += 1
    expect(endpoint).toBe('native-session/settings-events')
    responseSignal = signal
    return new Response(new ReadableStream({
      start(controller) {
        enqueue = (chunk) => { controller.enqueue(chunk) }
        finish = () => { controller.close() }
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }), { maxFollowBufferChars: 1000 })
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const first = client.settingsEvents(firstAbort.signal)[Symbol.asyncIterator]()
  const second = client.settingsEvents(secondAbort.signal)[Symbol.asyncIterator]()
  const pending = Promise.all([first.next(), second.next()])
  await viWait(() => calls === 1)
  enqueue(frame(ADAPTERS))
  expect(await pending).toEqual([
    { done: false, value: ADAPTERS },
    { done: false, value: ADAPTERS },
  ])
  expect(calls).toBe(1)
  firstAbort.abort()
  expect(await first.next()).toEqual({ done: true, value: undefined })
  expect(responseSignal?.aborted).toBe(false)
  const later = second.next()
  enqueue(frame({ type: 'agent-presets/updated' }))
  expect(await later).toEqual({ done: false, value: { type: 'agent-presets/updated' } })
  finish()
  expect(await second.next()).toEqual({ done: true, value: undefined })
  expect(responseSignal?.aborted).toBe(false)
  const thirdAbort = new AbortController()
  const third = client.settingsEvents(thirdAbort.signal)[Symbol.asyncIterator]()
  const restarted = third.next()
  await viWait(() => calls === 2)
  enqueue(frame(ADAPTERS))
  expect(await restarted).toEqual({ done: false, value: ADAPTERS })
  thirdAbort.abort()
  expect(await third.next()).toEqual({ done: true, value: undefined })
  expect(responseSignal?.aborted).toBe(true)
})

it('rejects a Settings stream that is not an event stream', async () => {
  const cases = [
    new Response('nope', { status: 500, headers: { 'content-type': 'text/plain' } }),
    new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
  ]
  for (const response of cases) {
    const client = createNativeSessionClient(responseRpc(async () => response), { maxFollowBufferChars: 1000 })
    const iterator = client.settingsEvents(new AbortController().signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('native settings events: invalid response HTTP')
  }
})

it('fails every Settings caller when a frame is not JSON', async () => {
  const client = createNativeSessionClient(responseRpc(async () => new Response(
    encoder.encode('data: not-json\n\n'),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )), { maxFollowBufferChars: 1000 })
  const first = client.settingsEvents(new AbortController().signal)[Symbol.asyncIterator]()
  const second = client.settingsEvents(new AbortController().signal)[Symbol.asyncIterator]()
  const pendingFirst = first.next()
  const pendingSecond = second.next()
  await expect(pendingFirst).rejects.toThrow(SyntaxError)
  await expect(pendingSecond).rejects.toThrow(SyntaxError)
})

it('cancels a Settings response that arrives after the caller has left', async () => {
  const pendingCalls: { release?: ((response: Response) => void) | undefined } = {}
  const releasePending = (response: Response): void => { pendingCalls.release?.(response) }
  const client = createNativeSessionClient(
    responseRpc(() => new Promise((resolve) => { pendingCalls.release = resolve })),
    { maxFollowBufferChars: 1000 },
  )
  const abort = new AbortController()
  const pending = client.settingsEvents(abort.signal)[Symbol.asyncIterator]().next()
  await viWait(() => pendingCalls.release !== undefined)
  abort.abort()
  let cancelled = false
  releasePending(new Response(new ReadableStream({ cancel() { cancelled = true } }), {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  }))
  expect(await pending).toEqual({ done: true, value: undefined })
  await viWait(() => cancelled)
  pendingCalls.release = undefined
  const late = createNativeSessionClient(
    responseRpc(() => new Promise((resolve) => { pendingCalls.release = resolve })),
    { maxFollowBufferChars: 1000 },
  )
  const lateAbort = new AbortController()
  const latePending = late.settingsEvents(lateAbort.signal)[Symbol.asyncIterator]().next()
  await viWait(() => pendingCalls.release !== undefined)
  lateAbort.abort()
  releasePending(new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  expect(await latePending).toEqual({ done: true, value: undefined })
})

it('does not open a Settings stream for a missing carrier or an aborted caller', async () => {
  const missing = createNativeSessionClient({ call: async () => ({ ok: true, value: undefined }) }, { maxFollowBufferChars: 1000 })
  await expect(missing.settingsEvents(new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow(
    'selected carrier has no Fetch response operation',
  )
  let calls = 0
  const client = createNativeSessionClient(responseRpc(async () => {
    calls += 1
    return new Response(null, { status: 500 })
  }), { maxFollowBufferChars: 1000 })
  const aborted = client.settingsEvents(AbortSignal.abort())[Symbol.asyncIterator]()
  expect(await aborted.next()).toEqual({ done: true, value: undefined })
  expect(calls).toBe(0)
})

it('ends a shared Settings stream when the client closes', async () => {
  let responseSignal: AbortSignal | undefined
  let opened: () => void = () => {}
  const openedPromise = new Promise<void>((resolve) => { opened = resolve })
  const client = createNativeSessionClient(responseRpc((_channel, _endpoint, _payload, signal) => {
    responseSignal = signal
    opened()
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
  }), { maxFollowBufferChars: 1000 })
  const iterator = client.settingsEvents(new AbortController().signal)[Symbol.asyncIterator]()
  const pending = iterator.next()
  await openedPromise
  await client.close()
  expect(await pending).toEqual({ done: true, value: undefined })
  expect(responseSignal?.aborted).toBe(true)
})

async function viWait(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('settings stream did not open')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
