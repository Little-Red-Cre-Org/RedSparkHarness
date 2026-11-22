/** One duplex Fetch that carries every page-owned JSON `/api` response. */

import { API_PATH } from './api-path.ts'

/** Reserved exact path of the shared JSON Fetch follow bus. */
export const FOLLOW_BUS_PATH = `${API_PATH}/connection/follow-bus`

/** UTF-8 bytes allowed around a buffered payload so one maximum body still fits in a frame. */
export const FOLLOW_BUS_FRAME_OVERHEAD_BYTES = 64 * 1024

const BUS_MEDIA_TYPE = 'application/x-ndjson'
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
const textEncoder = new TextEncoder()

interface FollowBusRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** Per-frame checks for one already-opened follow bus. */
export interface FollowBusDispatch {
  /** Maximum buffered route body, in UTF-8 bytes. A larger subscribe is refused before `fetch`. */
  readonly maxRequestBodyBytes: number
  /**
   * Re-run the carrier's trust and browser-session check for one subscribe.
   * Implementations must read the request's current headers, not a cookie copied at open.
   * @param request - the opening follow-bus request.
   * @returns 401 or 403 when that subscribe must not dispatch.
   */
  authorize(request: Request): 401 | 403 | undefined
}

interface SubscribeFrame {
  readonly type: 'subscribe'
  readonly id: string
  readonly endpoint: string
  readonly payload: unknown
}

interface CancelFrame {
  readonly type: 'cancel'
  readonly id: string
}

type RequestFrame = SubscribeFrame | CancelFrame

interface HeadFrame {
  readonly type: 'head'
  readonly id: string
  readonly status: number
  readonly headers: readonly (readonly [string, string])[]
}

interface BytesFrame {
  readonly type: 'bytes'
  readonly id: string
  readonly data: string
}

interface EndFrame {
  readonly type: 'end'
  readonly id: string
}

interface ErrorFrame {
  readonly type: 'error'
  readonly id: string
  readonly message: string
}

type ResponseFrame = HeadFrame | BytesFrame | EndFrame | ErrorFrame

class SessionRejected extends Error {
  /** Fresh browser request was refused with the same status as a direct POST. */
  readonly status: 401 | 403

  constructor(status: 401 | 403) {
    super(`follow bus: HTTP ${status}`)
    this.status = status
  }
}

/**
 * Serve the shared follow bus for one already-authenticated request.
 * `POST` reads newline-delimited subscribe and cancel frames and dispatches each
 * subscribe to the registered exact `POST` route. `GET` is 405. A `POST` with
 * no body is 400. Each subscribe re-runs `authorize`. A failed check closes the
 * bus. Route failures stay on their own subscription; a failure after the status
 * frame is an error frame rather than a second status.
 * @param request - authenticated Fetch request for {@link FOLLOW_BUS_PATH}.
 * @param routes - exact Fetch routes keyed by absolute path.
 * @param dispatch - live session check and buffered body cap.
 * @returns the framed bus response, or a terminal status when the request cannot start.
 */
export function createFollowBusResponse(
  request: Request,
  routes: ReadonlyMap<string, FollowBusRoute>,
  dispatch: FollowBusDispatch,
): Response {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })
  if (request.body === null) return new Response('missing body', { status: 400 })
  return new Response(busResponseBody(request, request.body, routes, dispatch), {
    headers: { 'content-type': BUS_MEDIA_TYPE, 'cache-control': 'no-store' },
  })
}

/**
 * Multiplex JSON `/api` responses onto one duplex `POST` of {@link FOLLOW_BUS_PATH}.
 * Before each subscribe, a new `GET` of the bus path lets the browser attach the
 * current cookie. A 401 or 403 from that request refuses the subscribe and closes
 * the bus. The returned caller resolves when the route's status and headers arrive.
 * Cancelling `signal` cancels only that route. The socket closes after the last
 * response settles, and the next response opens another socket.
 * @param send - page fetch, invoked once per open bus and once per session check.
 * @param locate - absolute bus URL, including the page origin.
 * @param newId - subscription identity, unique among responses sharing the socket.
 * @returns caller for one JSON response body.
 */
export function createFollowBusClient(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  locate: () => URL,
  newId: () => string,
): (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<Response> {
  let current: Bus | undefined
  let turn: Promise<void> = Promise.resolve()
  const enqueue = (work: () => Promise<void>): void => {
    const run = turn.then(work, work)
    turn = run.then(ignoreSettled, ignoreSettled)
  }
  return (endpoint, payload, signal) => {
    if (signal.aborted) return Promise.reject(abortReason(signal))
    const id = newId()
    const sub = createSubscription()
    let attached: Bus | undefined
    const onAbort = (): void => {
      const bus = attached
      sub.fail(abortReason(signal))
      if (bus === undefined || !bus.subs.delete(id)) return
      void writeFrame(bus, { type: 'cancel', id }).then(
        () => { releaseIfIdle(bus) },
        () => { releaseIfIdle(bus) },
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    enqueue(async () => {
      if (aborted(signal)) return
      try {
        await assertSession(send, locate, signal)
      } catch (error) {
        if (aborted(signal)) return
        if (error instanceof SessionRejected) {
          closeForSession(current, sub, error.status)
          return
        }
        sub.fail(error)
        return
      }
      if (aborted(signal)) return
      let bus = current
      if (bus === undefined || bus.closing) {
        const opened = openBus(send, locate, () => {
          if (current === opened) current = undefined
        })
        bus = opened
        current = opened
      }
      attached = bus
      if (aborted(signal)) {
        releaseIfIdle(bus)
        return
      }
      bus.subs.set(id, sub)
      if (aborted(signal)) {
        bus.subs.delete(id)
        releaseIfIdle(bus)
        return
      }
      try {
        await writeFrame(bus, { type: 'subscribe', id, endpoint, payload })
      } catch (error) {
        if (aborted(signal)) return
        bus.subs.delete(id)
        sub.fail(error)
        releaseIfIdle(bus)
      }
    })
    return sub.head.promise
  }
}

interface Bus {
  readonly writer: WritableStreamDefaultWriter<Uint8Array>
  readonly subs: Map<string, Subscription>
  closing: boolean
  writeTail: Promise<void>
}

function openBus(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  locate: () => URL,
  onClosed: () => void,
): Bus {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const bus: Bus = { writer, subs: new Map(), closing: false, writeTail: Promise.resolve() }
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: { 'content-type': BUS_MEDIA_TYPE },
    body: stream.readable,
    duplex: 'half',
  }
  void send(locate(), init).then(
    (response) => { void readBus(bus, response, onClosed) },
    (error: unknown) => {
      failBus(bus, error)
      onClosed()
      void bus.writer.close().then(ignoreSettled, ignoreSettled)
    },
  )
  return bus
}

async function assertSession(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  locate: () => URL,
  signal: AbortSignal,
): Promise<void> {
  // A new request is the only time the browser attaches the current cookie.
  const response = await send(locate(), { method: 'GET', cache: 'no-store', signal })
  if (response.body !== null) await response.body.cancel().then(ignoreSettled, ignoreSettled)
  if (response.status === 401 || response.status === 403) throw new SessionRejected(response.status)
}

function closeForSession(bus: Bus | undefined, sub: Subscription, status: 401 | 403): void {
  sub.refuse(status)
  if (bus === undefined) return
  failBus(bus, new SessionRejected(status))
  void bus.writer.close().then(ignoreSettled, ignoreSettled)
}

function releaseIfIdle(bus: Bus): void {
  if (bus.subs.size > 0 || bus.closing) return
  bus.closing = true
  void bus.writer.close().then(ignoreSettled, ignoreSettled)
}

async function readBus(bus: Bus, response: Response, onClosed: () => void): Promise<void> {
  try {
    if (!response.ok || response.body === null) {
      throw new Error(`follow bus: HTTP ${response.ok ? 'missing body' : response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      buffer = takeLines(buffer, (line) => { deliver(bus, parseResponseFrame(line)) })
    }
  } catch (error) {
    failBus(bus, error)
  } finally {
    failBus(bus, new Error('follow bus: closed'))
    onClosed()
    bus.closing = true
    await bus.writer.close().then(ignoreSettled, ignoreSettled)
  }
}

function deliver(bus: Bus, frame: ResponseFrame): void {
  const sub = bus.subs.get(frame.id)
  if (sub === undefined) return
  if (frame.type === 'head') {
    sub.open(frame.status, frame.headers)
    return
  }
  if (frame.type === 'bytes') {
    sub.push(decodeBase64(frame.data))
    return
  }
  if (frame.type === 'error') {
    bus.subs.delete(frame.id)
    sub.fail(new Error(frame.message))
    releaseIfIdle(bus)
    return
  }
  bus.subs.delete(frame.id)
  sub.finish()
  releaseIfIdle(bus)
}

interface Subscription {
  readonly head: PromiseWithResolvers<Response>
  fail(error: unknown): void
  /** Resolve a terminal session status without using the route body. */
  refuse(status: 401 | 403): void
  open(status: number, headers: readonly (readonly [string, string])[]): void
  push(bytes: Uint8Array): void
  finish(): void
}

function createSubscription(): Subscription {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let settled = false
  let ended = false
  let failure: unknown
  const head = Promise.withResolvers<Response>()
  const body = new ReadableStream<Uint8Array>({
    start(next) { controller = next },
  })
  /* v8 ignore next -- ReadableStream calls start() before the constructor returns. */
  if (controller === undefined) throw new Error('follow bus: subscription stream did not start')
  const locked = controller
  const rejectHead = (error: unknown): void => {
    if (settled) return
    settled = true
    head.reject(error)
  }
  return {
    head,
    fail(error) {
      if (failure !== undefined || ended) return
      failure = error
      rejectHead(error)
      locked.error(error)
    },
    refuse(status) {
      if (settled || ended || failure !== undefined) return
      settled = true
      ended = true
      locked.close()
      head.resolve(new Response(status === 401 ? 'unauthorized' : 'forbidden', {
        status,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
      }))
    },
    open(status, headers) {
      if (settled) return
      settled = true
      head.resolve(new Response(body, {
        status,
        headers: headers.map((entry): [string, string] => [entry[0], entry[1]]),
      }))
    },
    push(bytes) {
      locked.enqueue(bytes)
    },
    finish() {
      ended = true
      if (!settled) rejectHead(new Error('follow bus: missing response head'))
      locked.close()
    },
  }
}

function writeFrame(bus: Bus, frame: RequestFrame): Promise<void> {
  const next = bus.writeTail.then(() => bus.writer.write(textEncoder.encode(`${JSON.stringify(frame)}\n`)))
  bus.writeTail = next.then(ignoreSettled, ignoreSettled)
  return next
}

function failBus(bus: Bus, error: unknown): void {
  bus.closing = true
  for (const sub of bus.subs.values()) sub.fail(error)
  bus.subs.clear()
}

function busResponseBody(
  request: Request,
  body: ReadableStream<Uint8Array>,
  routes: ReadonlyMap<string, FollowBusRoute>,
  dispatch: FollowBusDispatch,
): ReadableStream<Uint8Array> {
  const subscriptions = new Map<string, AbortController>()
  let resumeWaiting: (() => void) | undefined
  let writeTail = Promise.resolve()
  let stopped = false
  const decoder = new TextDecoder()
  const lineLimit = dispatch.maxRequestBodyBytes + FOLLOW_BUS_FRAME_OVERHEAD_BYTES
  /* v8 ignore next -- start() replaces this before a consumer can cancel. */
  let stopBus: (closeResponse: boolean) => void = () => undefined
  /* v8 ignore next -- start() replaces this before a consumer can cancel. */
  let cancelRequest: () => Promise<unknown> = () => Promise.resolve()

  const resumeWrite = (): void => {
    const resume = resumeWaiting
    resumeWaiting = undefined
    if (resume !== undefined) resume()
  }
  return new ReadableStream<Uint8Array>({
    start(outbound) {
      const reader = body.getReader()
      cancelRequest = () => reader.cancel()
      stopBus = (closeResponse: boolean): void => {
        if (stopped) return
        stopped = true
        for (const controller of subscriptions.values()) controller.abort()
        subscriptions.clear()
        resumeWrite()
        if (!closeResponse) return
        outbound.close()
      }
      const write = (frame: ResponseFrame): Promise<void> => {
        const encoded = textEncoder.encode(`${JSON.stringify(frame)}\n`)
        const next = writeTail.then(async () => {
          if (stopped) return
          outbound.enqueue(encoded)
          if (Number(outbound.desiredSize) > 0) return
          await new Promise<void>((resolve) => { resumeWaiting = resolve })
        })
        writeTail = Promise.allSettled([next]).then(ignoreSettled)
        return next
      }
      const closeBus = (): void => {
        void cancelRequest().then(ignoreSettled, ignoreSettled)
        stopBus(true)
      }
      request.signal.addEventListener('abort', () => {
        closeBus()
      }, { once: true })
      void readRequest(reader, decoder, routes, subscriptions, write, closeBus, request, dispatch, lineLimit)
    },
    pull() { resumeWrite() },
    cancel() {
      void cancelRequest().then(ignoreSettled, ignoreSettled)
      stopBus(false)
    },
  }, { highWaterMark: 1 })
}

async function readRequest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  routes: ReadonlyMap<string, FollowBusRoute>,
  subscriptions: Map<string, AbortController>,
  write: (frame: ResponseFrame) => Promise<void>,
  stop: () => void,
  request: Request,
  dispatch: FollowBusDispatch,
  lineLimit: number,
): Promise<void> {
  let buffer = ''
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      const decoded = decoder.decode(next.value, { stream: true })
      const newline = decoded.indexOf('\n')
      const addition = newline === -1 ? decoded.length : newline
      if (buffer.length + addition > lineLimit) throw new Error('follow bus: frame exceeds limit')
      buffer += decoded
      buffer = takeLines(buffer, (line) => {
        if (exceedsByteLimit(line, lineLimit)) throw new Error('follow bus: frame exceeds limit')
        acceptRequestLine(line, routes, subscriptions, write, request, dispatch, stop)
      })
      if (exceedsByteLimit(buffer, lineLimit)) throw new Error('follow bus: frame exceeds limit')
    }
  } catch {
    // Request abort, a malformed frame, and an oversized line all end every route still open.
  } finally {
    stop()
  }
}

function acceptRequestLine(
  line: string,
  routes: ReadonlyMap<string, FollowBusRoute>,
  subscriptions: Map<string, AbortController>,
  write: (frame: ResponseFrame) => Promise<void>,
  request: Request,
  dispatch: FollowBusDispatch,
  closeBus: () => void,
): void {
  const frame = parseRequestFrame(line)
  if (frame.type === 'cancel') {
    const controller = subscriptions.get(frame.id)
    if (controller === undefined) return
    subscriptions.delete(frame.id)
    controller.abort()
    return
  }
  if (subscriptions.has(frame.id)) return
  const controller = new AbortController()
  subscriptions.set(frame.id, controller)
  void pumpRoute(frame, controller, routes, write, request, dispatch, closeBus).finally(() => {
    if (subscriptions.get(frame.id) === controller) subscriptions.delete(frame.id)
  })
}

async function pumpRoute(
  frame: SubscribeFrame,
  controller: AbortController,
  routes: ReadonlyMap<string, FollowBusRoute>,
  write: (frame: ResponseFrame) => Promise<void>,
  request: Request,
  dispatch: FollowBusDispatch,
  closeBus: () => void,
): Promise<void> {
  const rejection = dispatch.authorize(request)
  if (rejection !== undefined) {
    try {
      if (!aborted(controller.signal)) {
        await writePlain(write, frame.id, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
        if (!aborted(controller.signal)) closeBus()
      }
    } catch {
      // The status frame could not be written; closing still stops every resident route.
      if (!aborted(controller.signal)) closeBus()
    }
    return
  }
  let sentHead = false
  try {
    const response = await dispatchRoute(frame, controller.signal, routes, dispatch.maxRequestBodyBytes)
    if (aborted(controller.signal)) return
    await write({ type: 'head', id: frame.id, status: response.status, headers: [...response.headers.entries()] })
    sentHead = true
    if (response.body !== null) {
      const reader = response.body.getReader()
      for (;;) {
        if (aborted(controller.signal)) {
          await reader.cancel().then(ignoreSettled, ignoreSettled)
          return
        }
        const next = await reader.read()
        if (next.done) break
        if (aborted(controller.signal)) return
        await write({ type: 'bytes', id: frame.id, data: encodeBase64(next.value) })
      }
    }
    if (!aborted(controller.signal)) await write({ type: 'end', id: frame.id })
  } catch (error) {
    if (aborted(controller.signal)) return
    try {
      if (sentHead) await write({ type: 'error', id: frame.id, message: 'follow bus: stream failed' })
      else await writePlain(write, frame.id, 500, `handler failure: ${String(error)}`)
    } catch {
      // The bus socket is already closing, so this subscription cannot report another frame.
    }
  }
}

async function dispatchRoute(
  frame: SubscribeFrame,
  signal: AbortSignal,
  routes: ReadonlyMap<string, FollowBusRoute>,
  maxRequestBodyBytes: number,
): Promise<Response> {
  const path = `${API_PATH}/${frame.endpoint}`
  const route = isFollowEndpoint(frame.endpoint) && path !== FOLLOW_BUS_PATH ? routes.get(path) : undefined
  if (route === undefined || !route.methods.has('POST')) return plainResponse(404, 'not found')
  if (route.requestBody === 'streaming') return plainResponse(415, 'streaming request body')
  const body = JSON.stringify(frame.payload ?? null)
  if (exceedsByteLimit(body, maxRequestBodyBytes)) return plainResponse(413, 'payload too large')
  return route.fetch(new Request(`http://dsh.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal,
  }))
}

async function writePlain(
  write: (frame: ResponseFrame) => Promise<void>,
  id: string,
  status: number,
  message: string,
): Promise<void> {
  await write({
    type: 'head',
    id,
    status,
    headers: [['content-type', 'text/plain;charset=UTF-8']],
  })
  await write({ type: 'bytes', id, data: encodeBase64(textEncoder.encode(message)) })
  await write({ type: 'end', id })
}

function plainResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain;charset=UTF-8' } })
}

function parseRequestFrame(line: string): RequestFrame {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('follow bus: invalid frame')
  }
  if (value.type === 'cancel') return { type: 'cancel', id: value.id }
  if (value.type === 'subscribe' && typeof value.endpoint === 'string') {
    return { type: 'subscribe', id: value.id, endpoint: value.endpoint, payload: 'payload' in value ? value.payload : null }
  }
  throw new Error('follow bus: invalid frame')
}

function parseResponseFrame(line: string): ResponseFrame {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string') {
    throw new Error('follow bus: invalid frame')
  }
  if (value.type === 'end') return { type: 'end', id: value.id }
  if (value.type === 'error' && typeof value.message === 'string' && value.message.length > 0) {
    return { type: 'error', id: value.id, message: value.message }
  }
  if (value.type === 'bytes' && typeof value.data === 'string') return { type: 'bytes', id: value.id, data: value.data }
  if (value.type === 'head' && typeof value.status === 'number' && validHeaders(value.headers)) {
    return { type: 'head', id: value.id, status: value.status, headers: value.headers }
  }
  throw new Error('follow bus: invalid frame')
}

function validHeaders(value: unknown): value is readonly (readonly [string, string])[] {
  return Array.isArray(value) && value.every(entry => Array.isArray(entry)
    && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string')
}

function takeLines(buffer: string, accept: (line: string) => void): string {
  let rest = buffer
  let newline = rest.indexOf('\n')
  while (newline !== -1) {
    const line = rest.slice(0, newline).replace(/\r$/, '')
    rest = rest.slice(newline + 1)
    if (line.length > 0) accept(line)
    newline = rest.indexOf('\n')
  }
  return rest
}

/** True when `value` is larger than `limit` UTF-8 bytes. */
function exceedsByteLimit(value: string, limit: number): boolean {
  if (value.length > limit) return true
  if (value.length * 3 <= limit) return false
  return textEncoder.encode(value).byteLength > limit
}

function isFollowEndpoint(endpoint: string): boolean {
  const segments = endpoint.split('/')
  return segments.every(segment => ENDPOINT_SEGMENT.test(segment))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Read abort after an await. The property can change while a route or write is in flight. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Both outcomes are expected when the peer already finished this stream. */
function ignoreSettled(): void {
  return undefined
}
