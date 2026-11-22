/** Page-owned JSON `/api` responses share one HTTP/1.1 follow bus.
 *
 * Chrome cannot send a streaming request body to this Host's cleartext
 * `node:http` listener. The bus therefore uses one finite `open` POST whose
 * response stays open, plus one finite POST per subscribe or cancel. Downlink
 * frames travel on the open response. Each command POST carries the browser's
 * current cookie, Origin, Host, and `sec-fetch-site`.
 */

import { API_PATH } from './api-path.ts'

/** Reserved exact path of the shared JSON follow bus. */
export const FOLLOW_BUS_PATH = `${API_PATH}/connection/follow-bus`

/** UTF-8 bytes allowed around a buffered payload so one maximum body still fits in a frame. */
export const FOLLOW_BUS_FRAME_OVERHEAD_BYTES = 64 * 1024

/** Header that names the open downlink a command POST belongs to. */
export const FOLLOW_BUS_ID_HEADER = 'x-dsh-follow-bus'

const BUS_MEDIA_TYPE = 'application/x-ndjson'
const OPEN_BODY = '{"type":"open"}\n'
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
const textEncoder = new TextEncoder()

interface FollowBusRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** Per-command checks for one follow-bus hub. */
export interface FollowBusDispatch {
  /** Maximum buffered route body, in UTF-8 bytes. A larger subscribe is refused before `fetch`. */
  readonly maxRequestBodyBytes: number
  /**
   * Re-run the carrier's trust and browser-session check for one subscribe.
   * Implementations must read this subscribe request's headers, not a cookie copied when the downlink opened.
   * @param request - the finite subscribe POST.
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

interface ServerBus {
  readonly subscriptions: Map<string, AbortController>
  write(frame: ResponseFrame): Promise<void>
  stop(closeResponse: boolean): void
}

class SessionRejected extends Error {
  /** Fresh browser request was refused with the same status as a direct POST. */
  readonly status: 401 | 403

  constructor(status: 401 | 403) {
    super(`follow bus: HTTP ${status}`)
    this.status = status
  }
}

/**
 * Serve finite follow-bus commands for one carrier.
 * `POST` with `{"type":"open"}` and {@link FOLLOW_BUS_ID_HEADER} starts the
 * downlink. Later `POST`s on that id subscribe or cancel. `GET` is 405. A
 * `POST` with no body is 400. Each subscribe re-runs `authorize` on that
 * command. A failed check closes the bus. Route failures stay on their own
 * subscription; a failure after the status frame is an error frame rather than
 * a second status.
 * @param routes - exact Fetch routes keyed by absolute path.
 * @param dispatch - live session check and buffered body cap.
 * @returns handler for one follow-bus HTTP request.
 */
export function createFollowBusHub(
  routes: ReadonlyMap<string, FollowBusRoute>,
  dispatch: FollowBusDispatch,
): { handle(request: Request): Promise<Response> } {
  const buses = new Map<string, ServerBus>()
  const lineLimit = dispatch.maxRequestBodyBytes + FOLLOW_BUS_FRAME_OVERHEAD_BYTES
  return {
    async handle(request: Request): Promise<Response> {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } })
      if (request.body === null) return new Response('missing body', { status: 400 })
      const busId = request.headers.get(FOLLOW_BUS_ID_HEADER) ?? ''
      let text: string
      try {
        text = await readFrame(request.body, lineLimit)
      } catch {
        buses.get(busId)?.stop(true)
        return new Response('follow bus: frame exceeds limit', { status: 400 })
      }
      if (text.length === 0) {
        if (buses.has(busId)) return noContent()
        return new Response('missing body', { status: 400 })
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        buses.get(busId)?.stop(true)
        return new Response('follow bus: invalid frame', { status: 400 })
      }
      if (isOpenValue(value)) {
        if (busId.length === 0) return new Response('missing bus', { status: 400 })
        if (buses.has(busId)) return new Response('follow bus: already open', { status: 409 })
        return openDownlink(request, busId, buses)
      }
      const bus = buses.get(busId)
      if (bus === undefined) return new Response('follow bus: unknown bus', { status: 404 })
      try {
        acceptRequestLine(parseRequestFrame(text), bus, routes, request, dispatch)
      } catch {
        bus.stop(true)
        return new Response('follow bus: invalid frame', { status: 400 })
      }
      return noContent()
    },
  }
}

/**
 * Multiplex JSON `/api` responses onto one long-lived follow-bus response.
 * The caller opens that response with a finite POST, then sends each subscribe
 * and cancel as its own finite POST. A 401 or 403 from either request refuses
 * the subscribe and closes the bus. The returned caller resolves when the
 * route's status and headers arrive. Cancelling `signal` cancels only that
 * route. The downlink closes after the last response settles, and the next
 * response opens another.
 * @param send - page fetch. Every call uses a finite body; none sets `duplex`.
 * @param locate - absolute bus URL, including the page origin.
 * @param newId - subscription and downlink identity. A downlink id stays unique while that response is open.
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
      void postCommand(send, locate, bus, { type: 'cancel', id }).then(
        () => { releaseIfIdle(bus) },
        () => { releaseIfIdle(bus) },
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    enqueue(async () => {
      if (aborted(signal)) return
      let bus = current
      if (bus === undefined || bus.closing) {
        const opened = openDownlinkClient(send, locate, newId, () => {
          if (current === opened) current = undefined
        })
        bus = opened
        current = opened
      }
      attached = bus
      bus.subs.set(id, sub)
      try {
        await bus.ready
        if (aborted(signal) || bus.closing) {
          bus.subs.delete(id)
          releaseIfIdle(bus)
          return
        }
        const response = await postCommand(send, locate, bus, { type: 'subscribe', id, endpoint, payload }, signal)
        if (response.body !== null) await response.body.cancel().then(ignoreSettled, ignoreSettled)
        if (aborted(signal)) return
        if (response.status === 401 || response.status === 403) {
          bus.subs.delete(id)
          closeForSession(bus, sub, response.status)
          return
        }
        if (response.status !== 204) {
          bus.subs.delete(id)
          sub.fail(new Error(`follow bus: HTTP ${response.status}`))
          releaseIfIdle(bus)
        }
      } catch (error) {
        if (aborted(signal)) return
        bus.subs.delete(id)
        if (error instanceof SessionRejected) {
          closeForSession(bus, sub, error.status)
          return
        }
        sub.fail(error)
        releaseIfIdle(bus)
      }
    })
    return sub.head.promise
  }
}

interface Bus {
  readonly id: string
  readonly abort: AbortController
  readonly ready: Promise<void>
  readonly subs: Map<string, Subscription>
  closing: boolean
}

function openDownlinkClient(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  locate: () => URL,
  newId: () => string,
  onClosed: () => void,
): Bus {
  const id = newId()
  const abort = new AbortController()
  const ready = Promise.withResolvers<void>()
  const bus: Bus = { id, abort, ready: ready.promise, subs: new Map(), closing: false }
  void bus.ready.then(ignoreSettled, ignoreSettled)
  void send(locate(), {
    method: 'POST',
    headers: { 'content-type': BUS_MEDIA_TYPE, [FOLLOW_BUS_ID_HEADER]: id },
    body: OPEN_BODY,
    cache: 'no-store',
    signal: abort.signal,
  }).then(
    (response) => {
      if (response.status === 401 || response.status === 403) {
        ready.reject(new SessionRejected(response.status))
        onClosed()
        return
      }
      if (!response.ok || response.body === null) {
        ready.reject(new Error(`follow bus: HTTP ${response.ok ? 'missing body' : response.status}`))
        onClosed()
        return
      }
      ready.resolve()
      void readBus(bus, response.body, onClosed)
    },
    (error: unknown) => {
      ready.reject(error)
      failBus(bus, error)
      onClosed()
    },
  )
  return bus
}

function postCommand(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  locate: () => URL,
  bus: Bus,
  frame: RequestFrame,
  signal?: AbortSignal,
): Promise<Response> {
  return send(locate(), {
    method: 'POST',
    headers: { 'content-type': BUS_MEDIA_TYPE, [FOLLOW_BUS_ID_HEADER]: bus.id },
    body: `${JSON.stringify(frame)}\n`,
    cache: 'no-store',
    ...signal === undefined ? {} : { signal },
  })
}

function closeForSession(bus: Bus, sub: Subscription, status: 401 | 403): void {
  sub.refuse(status)
  failBus(bus, new SessionRejected(status))
  bus.abort.abort()
}

function releaseIfIdle(bus: Bus): void {
  if (bus.subs.size > 0 || bus.closing) return
  bus.closing = true
  bus.abort.abort()
}

async function readBus(bus: Bus, body: ReadableStream<Uint8Array>, onClosed: () => void): Promise<void> {
  try {
    const reader = body.getReader()
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
    bus.abort.abort()
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
      /* v8 ignore next -- session refusal is the first settlement of this subscription. */
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

function failBus(bus: Bus, error: unknown): void {
  bus.closing = true
  for (const sub of bus.subs.values()) sub.fail(error)
  bus.subs.clear()
}

function openDownlink(
  request: Request,
  busId: string,
  buses: Map<string, ServerBus>,
): Response {
  const subscriptions = new Map<string, AbortController>()
  let resumeWaiting: (() => void) | undefined
  let writeTail = Promise.resolve()
  let stopped = false
  let outbound: ReadableStreamDefaultController<Uint8Array> | undefined
  const resumeWrite = (): void => {
    const resume = resumeWaiting
    resumeWaiting = undefined
    if (resume !== undefined) resume()
  }
  const stop = (closeResponse: boolean): void => {
    if (stopped) return
    stopped = true
    buses.delete(busId)
    for (const controller of subscriptions.values()) controller.abort()
    subscriptions.clear()
    resumeWrite()
    if (!closeResponse || outbound === undefined) return
    try {
      outbound.close()
    } catch {
      // The downlink consumer already cancelled this stream.
    }
  }
  const write = (frame: ResponseFrame): Promise<void> => {
    const encoded = textEncoder.encode(`${JSON.stringify(frame)}\n`)
    const next = writeTail.then(async () => {
      if (stopped) return
      const controller = outbound
      /* v8 ignore next -- start() sets the controller before any command can write. */
      if (controller === undefined) return
      controller.enqueue(encoded)
      if (Number(controller.desiredSize) > 0) return
      await new Promise<void>((resolve) => { resumeWaiting = resolve })
    })
    writeTail = Promise.allSettled([next]).then(ignoreSettled)
    return next
  }
  const bus: ServerBus = { subscriptions, write, stop }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      outbound = controller
      buses.set(busId, bus)
      if (request.signal.aborted) {
        stop(true)
        return
      }
      request.signal.addEventListener('abort', () => { stop(true) }, { once: true })
    },
    pull() { resumeWrite() },
    cancel() { stop(false) },
  }, { highWaterMark: 1 })
  return new Response(stream, {
    headers: { 'content-type': BUS_MEDIA_TYPE, 'cache-control': 'no-store' },
  })
}

function acceptRequestLine(
  frame: RequestFrame,
  bus: ServerBus,
  routes: ReadonlyMap<string, FollowBusRoute>,
  request: Request,
  dispatch: FollowBusDispatch,
): void {
  if (frame.type === 'cancel') {
    const controller = bus.subscriptions.get(frame.id)
    if (controller === undefined) return
    bus.subscriptions.delete(frame.id)
    controller.abort()
    return
  }
  if (bus.subscriptions.has(frame.id)) return
  const controller = new AbortController()
  bus.subscriptions.set(frame.id, controller)
  void pumpRoute(frame, controller, routes, bus, request, dispatch).finally(() => {
    if (bus.subscriptions.get(frame.id) === controller) bus.subscriptions.delete(frame.id)
  })
}

async function pumpRoute(
  frame: SubscribeFrame,
  controller: AbortController,
  routes: ReadonlyMap<string, FollowBusRoute>,
  bus: ServerBus,
  request: Request,
  dispatch: FollowBusDispatch,
): Promise<void> {
  const rejection = dispatch.authorize(request)
  if (rejection !== undefined) {
    try {
      await writePlain(bus.write.bind(bus), frame.id, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
      if (!aborted(controller.signal)) bus.stop(true)
    } catch {
      // enqueue throws only after the downlink controller is already closed.
      /* v8 ignore next 2 -- the downlink is already stopping when a write throws. */
      if (!aborted(controller.signal)) bus.stop(true)
    }
    return
  }
  let sentHead = false
  try {
    const response = await dispatchRoute(frame, controller.signal, routes, dispatch.maxRequestBodyBytes)
    if (aborted(controller.signal)) return
    await bus.write({ type: 'head', id: frame.id, status: response.status, headers: [...response.headers.entries()] })
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
        await bus.write({ type: 'bytes', id: frame.id, data: encodeBase64(next.value) })
      }
    }
    if (!aborted(controller.signal)) await bus.write({ type: 'end', id: frame.id })
  } catch (error) {
    if (aborted(controller.signal)) return
    try {
      if (sentHead) await bus.write({ type: 'error', id: frame.id, message: 'follow bus: stream failed' })
      else await writePlain(bus.write.bind(bus), frame.id, 500, `handler failure: ${String(error)}`)
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

function noContent(): Response {
  return new Response(null, { status: 204 })
}

async function readFrame(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) throw new Error('follow bus: frame exceeds limit')
      buffer += decoder.decode(next.value, { stream: true })
    }
  } catch (error) {
    await reader.cancel().then(ignoreSettled, ignoreSettled)
    throw error
  }
  buffer += decoder.decode()
  const newline = buffer.indexOf('\n')
  return (newline === -1 ? buffer : buffer.slice(0, newline)).replace(/\r$/, '')
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

function isOpenValue(value: unknown): boolean {
  return isRecord(value) && value.type === 'open'
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
