/** JSON /api responses share one follow bus; unary calls keep their own request. */

import { Context } from '@redspark/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { randomUuid } from '../src/client/random-uuid.ts'
import { createWebConnectionRpc } from '../src/client/rpc.ts'
import { createFollowBusClient, FOLLOW_BUS_FRAME_OVERHEAD_BYTES, FOLLOW_BUS_ID_HEADER, FOLLOW_BUS_PATH } from '../src/follow-bus.ts'
import { HostConnectionService } from '../src/rpc-host.ts'
import type { ConnectionFetchHandler } from '../src/rpc.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SESSION_COOKIE = 'dsh-test=live'

interface TestSession {
  cookie: string
  expiresAt: number
  host: string
}

const RESIDENT = [
  'native-session/list-follow',
  'workspaces/follow',
  'session/jobs/follow',
  'schedules/follow',
  'native-session/settings-events',
] as const

interface WireFrame {
  readonly type: string
  readonly id: string
  readonly status?: number
  readonly headers?: readonly (readonly [string, string])[]
  readonly data?: string
  readonly endpoint?: string
}

function fakeBrowserAuth(session: TestSession): BrowserAuth {
  return {
    isAuthenticated(request: { readonly headers: Headers | { readonly cookie?: string } }): boolean {
      const headers = request.headers
      const cookie = headers instanceof Headers ? headers.get('cookie') ?? undefined : headers.cookie
      return cookie === session.cookie && session.cookie !== '' && Date.now() < session.expiresAt
    },
  } as BrowserAuth
}

async function harness(maxRequestBodyBytes?: number): Promise<{
  readonly connection: HostConnectionService
  readonly handler: ConnectionFetchHandler
  readonly session: TestSession
  readonly dispose: () => Promise<void>
}> {
  const session: TestSession = { cookie: SESSION_COOKIE, expiresAt: Number.POSITIVE_INFINITY, host: '127.0.0.1' }
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], fakeBrowserAuth(session), maxRequestBodyBytes)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionService
  return {
    connection,
    handler: connection.createSharedFetchHandler('/api'),
    session,
    dispose: () => fiber.dispose(),
  }
}

function register(
  connection: HostConnectionService,
  path: string,
  requestBody: 'buffered' | 'streaming',
  fetch: (request: Request) => Promise<Response>,
): () => Promise<void> {
  return connection.fetch.register({ path, methods: ['POST'], requestBody, fetch })
}

function sseRoute(label: string): {
  readonly fetch: (request: Request) => Promise<Response>
  readonly signals: AbortSignal[]
} {
  const signals: AbortSignal[] = []
  return {
    signals,
    fetch: (request) => {
      signals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${label}\n\n`))
          request.signal.addEventListener('abort', () => {
            try { controller.close() } catch {
              // The route already closed this body after a previous abort.
            }
          }, { once: true })
        },
      })
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    },
  }
}

function pageFetch(
  connection: HostConnectionService,
  handler: ConnectionFetchHandler,
  calls: string[],
  session: TestSession,
  hold?: { gate: Promise<undefined> | undefined },
): (input: URL, init: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input))
    if (init.body instanceof ReadableStream || (init as { duplex?: unknown }).duplex !== undefined) {
      throw new Error('follow bus client used a streaming request body')
    }
    const open = typeof init.body === 'string' && init.body.includes('"type":"open"')
    calls.push(`${open ? 'OPEN' : init.method ?? 'GET'} ${url.pathname}`)
    const headers = new Headers(init.headers)
    headers.set('host', session.host)
    headers.set('cookie', session.cookie)
    const rejection = connection.requestRejection({ headers })
    if (rejection !== undefined) {
      return new Response(rejection === 401 ? 'unauthorized' : 'forbidden', { status: rejection })
    }
    const response = await handler.fetch(new Request(url, { ...init, headers }))
    if (hold === undefined || hold.gate === undefined || !open) return response
    const gate = hold.gate
    hold.gate = undefined
    if (response.body === null) return response
    const source = response.body
    const delayed = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader()
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          controller.enqueue(next.value)
        }
        await gate
        controller.close()
      },
    })
    return new Response(delayed, { status: response.status, headers: response.headers })
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

async function textChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('missing body')
  const next = await reader.read()
  if (next.done || next.value === undefined) throw new Error('empty body')
  return decoder.decode(next.value)
}

function openBus(
  handler: ConnectionFetchHandler,
  options?: {
    readonly url?: string
    readonly headers?: Readonly<Record<string, string>>
  },
): {
  readonly request: Request
  readonly response: Promise<Response>
  readonly send: (frame: unknown) => Promise<void>
  readonly sendRaw: (text: string) => Promise<void>
  readonly close: () => Promise<void>
  readonly abort: () => void
} {
  const lifetime = new AbortController()
  const url = options?.url ?? 'http://dsh.internal/api/connection/follow-bus'
  const request = new Request(url, {
    method: 'POST',
    headers: {
      host: '127.0.0.1',
      cookie: SESSION_COOKIE,
      [FOLLOW_BUS_ID_HEADER]: randomUuid(),
      ...options?.headers,
    },
    body: '{"type":"open"}\n',
    signal: lifetime.signal,
  })
  const response = handler.fetch(request)
  const post = async (body: string): Promise<void> => {
    await handler.fetch(new Request(url, {
      method: 'POST',
      headers: new Headers(request.headers),
      body,
    }))
  }
  return {
    request,
    response,
    send(frame) { return post(`${JSON.stringify(frame)}\n`) },
    sendRaw(text) { return post(text) },
    async close() { lifetime.abort() },
    abort() { lifetime.abort() },
  }
}

function collect(response: Response): {
  readonly frames: WireFrame[]
  readonly until: (ready: (frames: readonly WireFrame[]) => boolean) => Promise<void>
  readonly finished: Promise<void>
} {
  const frames: WireFrame[] = []
  let notify: (() => void) | undefined
  const finished = (async () => {
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing bus body')
    let buffer = ''
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.length > 0) frames.push(JSON.parse(line) as WireFrame)
        newline = buffer.indexOf('\n')
      }
      notify?.()
    }
    notify?.()
  })()
  return {
    frames,
    until(ready) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`follow bus timed out after ${String(frames.length)} frames`))
        }, 2000)
        const finish = (error?: Error): void => {
          clearTimeout(timer)
          if (error === undefined) resolve()
          else reject(error)
        }
        const check = (): void => {
          if (ready(frames)) finish()
        }
        notify = check
        check()
        void finished.then(() => {
          if (!ready(frames)) finish(new Error('follow bus closed before the expected frames'))
        }, (error: unknown) => { finish(error instanceof Error ? error : new Error(String(error))) })
      })
    },
    finished,
  }
}

function framesFor(frames: readonly WireFrame[], id: string): readonly WireFrame[] {
  return frames.filter(frame => frame.id === id)
}

function header(frame: WireFrame, name: string): string | undefined {
  return frame.headers?.find(entry => entry[0] === name)?.[1]
}

function decoded(frame: WireFrame): Uint8Array {
  const binary = atob(frame.data ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}


function busLocate(): URL {
  return new URL('http://page.invalid/api/connection/follow-bus')
}

function scriptedFetch(
  status: number,
  body: BodyInit | null,
  commandStatus = 204,
): (input: URL, init: RequestInit) => Promise<Response> {
  return (_input, init) => {
    if (typeof init.body === 'string' && init.body.includes('"type":"open"')) {
      return Promise.resolve(new Response(body, {
        status,
        headers: { 'content-type': 'application/x-ndjson' },
      }))
    }
    return Promise.resolve(new Response(commandStatus === 204 ? null : 'no', { status: commandStatus }))
  }
}

function rejectingFetch(): (input: URL, init: RequestInit) => Promise<Response> {
  return (_input, init) => {
    const stream = init.body
    if (stream instanceof ReadableStream) void stream.cancel(new Error('abandoned'))
    return Promise.reject(new Error('follow bus fetch failed'))
  }
}

async function rejectBus(
  send: (input: URL, init: RequestInit) => Promise<Response>,
  message: string,
  abortAfter: boolean,
): Promise<void> {
  const follow = createFollowBusClient(send, busLocate, () => 'mine')
  const controller = new AbortController()
  const pending = follow('session/files/read', { path: 'a.png' }, controller.signal)
  if (abortAfter) controller.abort(new Error('stop follow'))
  await expect(pending).rejects.toThrow(message)
  if (!abortAfter) controller.abort()
  await tick()
}

async function exerciseClientEdges(): Promise<void> {
  const head = JSON.stringify({ type: 'head', id: 'mine', status: 201, headers: [['x-follow', 'alpha']] })
  const again = JSON.stringify({ type: 'head', id: 'mine', status: 500, headers: [['x-follow', 'nope']] })
  const unknown = JSON.stringify({ type: 'bytes', id: 'other', data: btoa('z') })
  const bytes = JSON.stringify({ type: 'bytes', id: 'mine', data: btoa('png') })
  const end = JSON.stringify({ type: 'end', id: 'mine' })
  const late = JSON.stringify({ type: 'bytes', id: 'mine', data: btoa('late') })
  const script = [unknown, bytes, head, again, end, late].join('\n') + '\n\n'
  const follow = createFollowBusClient(scriptedFetch(200, script), busLocate, () => 'mine')
  const done = new AbortController()
  const opened = await follow('session/files/read', { path: 'a.png' }, done.signal)
  expect(opened.status).toBe(201)
  expect(opened.headers.get('x-follow')).toBe('alpha')
  expect(await opened.text()).toBe('png')
  done.abort()
  await tick()

  await rejectBus(scriptedFetch(200, JSON.stringify({ type: 'end', id: 'mine' }) + '\n'), 'missing response head', false)
  await rejectBus(scriptedFetch(503, 'down'), 'HTTP 503', false)
  await rejectBus(scriptedFetch(200, null), 'missing body', false)
  await rejectBus(rejectingFetch(), 'follow bus fetch failed', false)
  await rejectBus(rejectingFetch(), 'stop follow', true)

  let releaseOpen: ((response: Response) => void) | undefined
  const openedLate = new Promise<Response>((resolve) => { releaseOpen = resolve })
  const lateFollow = createFollowBusClient((_input, init) => {
    if (typeof init.body === 'string' && init.body.includes('"type":"open"')) return openedLate
    return Promise.resolve(new Response(null, { status: 204 }))
  }, busLocate, () => 'late-open')
  const lateAbort = new AbortController()
  const latePending = lateFollow('session/files/read', { path: 'a.png' }, lateAbort.signal)
  await tick()
  lateAbort.abort(new Error('stop follow'))
  releaseOpen?.(new Response('', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
  await expect(latePending).rejects.toThrow('stop follow')

  let releaseSubscribe: ((response: Response) => void) | undefined
  let closeLive: () => void = () => undefined
  const liveBody = new ReadableStream<Uint8Array>({
    start(controller) {
      closeLive = () => {
        try { controller.close() } catch {
          // The reader may already have finished this downlink.
        }
      }
    },
  })
  const liveFollow = createFollowBusClient((_input, init) => {
    const body = typeof init.body === 'string' ? init.body : ''
    if (body.includes('"type":"open"')) {
      init.signal?.addEventListener('abort', () => { closeLive() }, { once: true })
      return Promise.resolve(new Response(liveBody, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    }
    if (body.includes('"type":"cancel"')) return Promise.reject(new Error('cancel failed'))
    return new Promise<Response>((resolve) => { releaseSubscribe = resolve })
  }, busLocate, () => 'live-command')
  const liveAbort = new AbortController()
  const livePending = liveFollow('session/files/read', { path: 'a.png' }, liveAbort.signal)
  await tick()
  liveAbort.abort(new Error('stop follow'))
  releaseSubscribe?.(new Response(null, { status: 204 }))
  await expect(livePending).rejects.toThrow('stop follow')
  closeLive()

  let rejectOpen: ((error: Error) => void) | undefined
  const failingOpen = new Promise<Response>((_resolve, reject) => { rejectOpen = reject })
  const failedFollow = createFollowBusClient((_input, init) => {
    if (typeof init.body === 'string' && init.body.includes('"type":"open"')) return failingOpen
    return Promise.resolve(new Response(null, { status: 204 }))
  }, busLocate, () => 'fail-open')
  const failAbort = new AbortController()
  const failPending = failedFollow('session/files/read', { path: 'a.png' }, failAbort.signal)
  await tick()
  failAbort.abort(new Error('stop follow'))
  rejectOpen?.(new Error('open failed'))
  await expect(failPending).rejects.toThrow('stop follow')
  let closeHang = (): void => undefined
  const hanging = new ReadableStream<Uint8Array>({
    start(controller) {
      closeHang = () => {
        try { controller.close() } catch {
          // The downlink reader can already have closed this body.
        }
      }
    },
  })
  await rejectBus((_input, init) => {
    if (typeof init.body === 'string' && init.body.includes('"type":"open"')) {
      const signal = init.signal
      if (signal != null) {
        if (signal.aborted) closeHang()
        else signal.addEventListener('abort', () => { closeHang() }, { once: true })
      }
      return Promise.resolve(new Response(hanging, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    }
    return Promise.resolve(new Response('no', { status: 409 }))
  }, 'HTTP 409', false)

  const invalid = [
    'null',
    '{"type":1,"id":"mine"}',
    '{"type":"end","id":1}',
    '{"type":"bytes","id":"mine","data":1}',
    '{"type":"head","id":"mine","status":"200","headers":[]}',
    '{"type":"head","id":"mine","status":200,"headers":{}}',
    '{"type":"head","id":"mine","status":200,"headers":[1]}',
    '{"type":"head","id":"mine","status":200,"headers":[["only"]]}',
    '{"type":"head","id":"mine","status":200,"headers":[[1,"b"]]}',
    '{"type":"head","id":"mine","status":200,"headers":[["a",1]]}',
    '{"type":"nope","id":"mine"}',
    '{"type":"error","id":"mine"}',
    '{"type":"error","id":"mine","message":""}',
    '{"type":"error","id":"mine","message":1}',
  ]
  for (const line of invalid) {
    await rejectBus(scriptedFetch(200, `${line}\n`), 'follow bus: invalid frame', false)
  }
}

describe('native follow connection bus', () => {
  it('keeps a unary call on its own request while five follows share one socket', async () => {
    const { connection, handler, session, dispose } = await harness()
    const routes = RESIDENT.map(endpoint => sseRoute(endpoint))
    const disposers = RESIDENT.map((endpoint, index) => register(
      connection, `/api/${endpoint}`, 'buffered', routes[index]?.fetch ?? (() => Promise.reject(new Error('missing route'))),
    ))
    const describe = connection.rpc.intercept('/api', endpoint => endpoint === 'settings/describe', () => Promise.resolve({
      ok: true,
      value: { hasDocument: true },
    }))
    const disposeRead = register(connection, '/api/session/files/read', 'buffered', () => Promise.resolve(
      new Response(JSON.stringify({ text: 'png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    const calls: string[] = []
    const releaseBus = Promise.withResolvers<undefined>()
    const hold = { gate: releaseBus.promise as Promise<undefined> | undefined }
    vi.stubGlobal('fetch', pageFetch(connection, handler, calls, session, hold))
    const controllers = RESIDENT.map(() => new AbortController())
    const readAbort = new AbortController()
    const nextAbort = new AbortController()
    try {
      const rpc = createWebConnectionRpc()
      const open = rpc.response
      if (open === undefined) throw new Error('missing response')
      const pending = RESIDENT.map((endpoint, index) => {
        const signal = controllers[index]?.signal
        if (signal === undefined) throw new Error('missing follow signal')
        return open('/api', endpoint, {}, signal)
      })
      const responses = await Promise.all(pending)
      expect(responses).toHaveLength(5)
      const chunks = await Promise.all(responses.map((response) => {
        if (response === undefined) throw new Error('missing follow response')
        expect(response.ok).toBe(true)
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        return textChunk(response)
      }))
      expect(chunks).toEqual(RESIDENT.map(endpoint => `data: ${endpoint}\n\n`))
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toEqual([`OPEN ${FOLLOW_BUS_PATH}`])
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(RESIDENT.length)
      expect(routes.every(route => route.signals.length === 1 && route.signals[0]?.aborted === false)).toBe(true)

      const described = await rpc.call('/api', 'settings/describe', {})
      expect(described).toEqual({ ok: true, value: { hasDocument: true } })
      expect(calls).toContain('POST /api/settings/describe')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      expect(routes.every(route => route.signals[0]?.aborted === false)).toBe(true)

      const stopped = new AbortController()
      stopped.abort('already stopped')
      await expect(rpc.response?.('/api', 'workspaces/follow', {}, stopped.signal)).rejects.toThrow('already stopped')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

      const read = await rpc.response?.('/api', 'session/files/read', { path: 'a.png' }, readAbort.signal)
      expect(await read?.text()).toBe('{"text":"png"}')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      expect(routes.every(route => route.signals[0]?.aborted === false)).toBe(true)

      for (const controller of controllers) controller.abort()
      await vi.waitFor(() => {
        expect(routes.every(route => route.signals[0]?.aborted === true)).toBe(true)
      })
      await tick()
      readAbort.abort()
      const next = await rpc.response?.('/api', 'session/files/read', { path: 'b.png' }, nextAbort.signal)
      expect(await next?.text()).toBe('{"text":"png"}')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(2)
    } finally {
      releaseBus.resolve(undefined)
      await tick()
      await tick()
      for (const controller of controllers) controller.abort()
      readAbort.abort()
      nextAbort.abort()
      await describe()
      await disposeRead()
      await Promise.all(disposers.map(disposeRoute => disposeRoute()))
      vi.unstubAllGlobals()
      await dispose()
    }
  })

  it('cancels one resident follow without stopping another, and keeps raw and explicit fetches direct', async () => {
    const { connection, handler, session, dispose } = await harness()
    let releaseBeta: (() => void) | undefined
    const betaGate = new Promise<void>((resolve) => { releaseBeta = resolve })
    const alphaSignals: AbortSignal[] = []
    const betaSignals: AbortSignal[] = []
    const disposeAlpha = register(connection, '/api/workspaces/follow', 'buffered', (request) => {
      alphaSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('alpha:1'))
          request.signal.addEventListener('abort', () => {
            try { controller.close() } catch {
              // Abort can arrive after the body has already closed.
            }
          }, { once: true })
        },
      })
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    })
    const disposeBeta = register(connection, '/api/schedules/follow', 'buffered', (request) => {
      betaSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('beta:1'))
          await betaGate
          if (request.signal.aborted) return
          controller.enqueue(encoder.encode('beta:2'))
        },
      })
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    })
    const calls: string[] = []
    vi.stubGlobal('fetch', pageFetch(connection, handler, calls, session))
    const alphaAbort = new AbortController()
    const betaAbort = new AbortController()
    const rawAbort = new AbortController()
    const otherAbort = new AbortController()
    try {
      const rpc = createWebConnectionRpc()
      const alpha = await rpc.response?.('/api', 'workspaces/follow', {}, alphaAbort.signal)
      const beta = await rpc.response?.('/api', 'schedules/follow', {}, betaAbort.signal)
      if (alpha === undefined || beta === undefined) throw new Error('missing follow response')
      const alphaReader = alpha.body?.getReader()
      const betaReader = beta.body?.getReader()
      if (alphaReader === undefined || betaReader === undefined) throw new Error('missing follow body')
      expect(decoder.decode((await alphaReader.read()).value)).toBe('alpha:1')
      expect(decoder.decode((await betaReader.read()).value)).toBe('beta:1')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

      alphaAbort.abort()
      await vi.waitFor(() => { expect(alphaSignals[0]?.aborted).toBe(true) })
      expect(betaSignals[0]?.aborted).toBe(false)
      releaseBeta?.()
      expect(decoder.decode((await betaReader.read()).value)).toBe('beta:2')
      expect(betaSignals[0]?.aborted).toBe(false)

      const raw = await rpc.response?.('/api', 'native-session/file-upload?sessionId=s1', undefined, rawAbort.signal, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Uint8Array.of(7, 8),
      })
      expect(raw?.status).toBe(404)
      expect(calls).toContain('POST /api/native-session/file-upload')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

      const other = await rpc.response?.('/rpc', 'workspaces/follow', {}, otherAbort.signal)
      expect(other?.status).toBe(404)
      expect(calls).toContain('POST /rpc/workspaces/follow')

      const direct = vi.fn((_input: URL) => Promise.resolve(new Response('direct')))
      const explicit = createWebConnectionRpc(direct)
      const explicitResponse = await explicit.response?.('/api', 'workspaces/follow', {}, new AbortController().signal)
      expect(explicitResponse?.status).toBe(200)
      expect(direct).toHaveBeenCalledOnce()
      expect(direct.mock.calls[0]?.[0].pathname).toBe('/api/workspaces/follow')
      expect(calls.filter(call => call === `OPEN ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      await exerciseClientEdges()
      let broke = false
      const disposeBreak = register(connection, '/api/bytes/break', 'buffered', () => {
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!broke) {
              broke = true
              controller.enqueue(encoder.encode('part'))
              return
            }
            controller.error(new Error('broke'))
          },
        })
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }))
      })
      const denyCalls: string[] = []
      const disposeDeny = register(connection, '/api/bytes/deny', 'buffered', () => {
        denyCalls.push('deny')
        return Promise.resolve(new Response('no'))
      })
      try {
        const brokenAbort = new AbortController()
        const broken = await rpc.response?.('/api', 'bytes/break', {}, brokenAbort.signal)
        expect(broken?.status).toBe(200)
        await expect(broken?.text()).rejects.toThrow('follow bus: stream failed')
        expect(betaSignals[0]?.aborted).toBe(false)

        session.cookie = ''
        const clearedAbort = new AbortController()
        const cleared = await rpc.response?.('/api', 'bytes/deny', {}, clearedAbort.signal)
        expect(cleared?.status).toBe(401)
        expect(await cleared?.text()).toBe('unauthorized')
        expect(denyCalls).toEqual([])
        await vi.waitFor(() => { expect(betaSignals[0]?.aborted).toBe(true) })

        session.cookie = SESSION_COOKIE
        session.host = 'attacker.test'
        const forbiddenAbort = new AbortController()
        const forbidden = await rpc.response?.('/api', 'bytes/deny', {}, forbiddenAbort.signal)
        expect(forbidden?.status).toBe(403)
        expect(await forbidden?.text()).toBe('forbidden')
        expect(denyCalls).toEqual([])
        session.host = '127.0.0.1'
        brokenAbort.abort()
        clearedAbort.abort()
        forbiddenAbort.abort()
      } finally {
        await disposeBreak()
        await disposeDeny()
      }
    } finally {
      alphaAbort.abort()
      betaAbort.abort()
      rawAbort.abort()
      otherAbort.abort()
      releaseBeta?.()
      await disposeAlpha()
      await disposeBeta()
      vi.unstubAllGlobals()
      await dispose()
    }
  })

  it('preserves each route response and rejects a bus request that cannot start', async () => {
    const { connection, handler, dispose } = await harness()
    const streaming = vi.fn(() => Promise.resolve(new Response('raw')))
    const splitCalls: string[] = []
    const disposeSplit = register(connection, '/api/bytes/split', 'buffered', () => {
      splitCalls.push('split')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2, 255))
          controller.enqueue(Uint8Array.of(0, 9))
          controller.close()
        },
      })
      return Promise.resolve(new Response(body, {
        status: 201,
        headers: { 'x-follow': 'alpha', 'content-type': 'application/octet-stream' },
      }))
    })
    const disposeStream = register(connection, '/api/bytes/stream', 'streaming', streaming)
    const disposeBoom = register(connection, '/api/bytes/explode', 'buffered', () => Promise.reject(new Error('route exploded')))
    const disposeReturned = register(connection, '/api/bytes/returned', 'buffered', () => Promise.resolve(
      new Response('nope', { status: 500, headers: { 'x-follow': 'kept' } }),
    ))
    const heldSignals: AbortSignal[] = []
    const emptyFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    const disposeEmpty = register(connection, '/api/bytes/empty', 'buffered', emptyFetch)
    const getOnly = vi.fn(() => Promise.resolve(new Response('get')))
    const disposeGet = connection.fetch.register({
      path: '/api/bytes/get-only',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: getOnly,
    })
    const disposeHeld = register(connection, '/api/bytes/held', 'buffered', (request) => {
      heldSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          request.signal.addEventListener('abort', () => {
            try { controller.close() } catch {
              // The held body has no bytes to flush after abort.
            }
          }, { once: true })
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    try {
      expect(handler.requestBodyMode({
        method: 'POST', url: new URL('http://dsh.internal/api/connection/follow-bus'),
      })).toBe('streaming')
      expect(handler.requestBodyMode({
        method: 'GET', url: new URL('http://dsh.internal/api/connection/follow-bus'),
      })).toBe('buffered')
      expect((await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus'))).status).toBe(405)
      expect((await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus', { method: 'POST' }))).status).toBe(400)
      expect((await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus', {
        method: 'POST', body: '{"type":"open"}',
      }))).status).toBe(400)
      expect((await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus', {
        method: 'POST', body: '\n',
      }))).status).toBe(400)
      const early = new AbortController()
      early.abort()
      const earlyResponse = await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus', {
        method: 'POST',
        headers: { [FOLLOW_BUS_ID_HEADER]: 'already-aborted', host: '127.0.0.1', cookie: SESSION_COOKIE },
        body: '{"type":"open"}\n',
        signal: early.signal,
      }))
      expect(earlyResponse.status).toBe(200)
      const earlyReader = earlyResponse.body?.getReader()
      if (earlyReader === undefined) throw new Error('missing aborted downlink')
      expect((await earlyReader.read()).done).toBe(true)
      const unknown = await handler.fetch(new Request('http://dsh.internal/api/connection/follow-bus', {
        method: 'POST',
        headers: { [FOLLOW_BUS_ID_HEADER]: 'missing-bus' },
        body: '{"type":"subscribe","id":"z","endpoint":"bytes/split","payload":null}\n',
      }))
      expect(unknown.status).toBe(404)
      expect(splitCalls).toEqual([])
      expect(() => register(connection, FOLLOW_BUS_PATH, 'streaming', () => Promise.resolve(new Response()))).toThrow('reserved')

      const direct = await handler.fetch(new Request('http://dsh.internal/api/bytes/split', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null',
      }))
      expect(direct.status).toBe(201)
      expect(splitCalls).toEqual(['split'])

      const bus = openBus(handler)
      const response = await bus.response
      const duplicate = await handler.fetch(new Request(bus.request.url, {
        method: 'POST',
        headers: new Headers(bus.request.headers),
        body: '{"type":"open"}\n',
      }))
      expect(duplicate.status).toBe(409)
      const wire = collect(response)
      await bus.send({ type: 'cancel', id: 'nobody' })
      await bus.send({ type: 'subscribe', id: 'split', endpoint: 'bytes/split', payload: { image: true } })
      await bus.send({ type: 'subscribe', id: 'split', endpoint: 'bytes/split', payload: { again: true } })
      await bus.send({ type: 'subscribe', id: 'missing', endpoint: 'bytes/missing', payload: {} })
      await bus.send({ type: 'subscribe', id: 'stream', endpoint: 'bytes/stream', payload: {} })
      await bus.send({ type: 'subscribe', id: 'explode', endpoint: 'bytes/explode', payload: {} })
      await bus.send({ type: 'subscribe', id: 'returned', endpoint: 'bytes/returned', payload: null })
      await bus.send({ type: 'subscribe', id: 'reserved', endpoint: 'connection/follow-bus', payload: {} })
      await bus.send({ type: 'subscribe', id: 'escape', endpoint: '../secret', payload: {} })
      await bus.send({ type: 'subscribe', id: 'held', endpoint: 'bytes/held' })
      await bus.send({ type: 'subscribe', id: 'empty', endpoint: 'bytes/empty', payload: {} })
      await bus.send({ type: 'subscribe', id: 'get-only', endpoint: 'bytes/get-only', payload: {} })
      await wire.until(frames => framesFor(frames, 'split').some(frame => frame.type === 'end')
        && framesFor(frames, 'missing').some(frame => frame.type === 'end')
        && framesFor(frames, 'stream').some(frame => frame.type === 'end')
        && framesFor(frames, 'explode').some(frame => frame.type === 'end')
        && framesFor(frames, 'returned').some(frame => frame.type === 'end')
        && framesFor(frames, 'reserved').some(frame => frame.type === 'end')
        && framesFor(frames, 'escape').some(frame => frame.type === 'end')
        && framesFor(frames, 'held').some(frame => frame.type === 'head')
        && framesFor(frames, 'empty').some(frame => frame.type === 'end')
        && framesFor(frames, 'get-only').some(frame => frame.type === 'end'))

      const split = framesFor(wire.frames, 'split')
      const splitHead = split.find(frame => frame.type === 'head')
      expect(splitHead?.status).toBe(201)
      expect(header(splitHead ?? split[0]!, 'x-follow')).toBe('alpha')
      expect(header(splitHead ?? split[0]!, 'content-type')).toBe('application/octet-stream')
      expect(split.filter(frame => frame.type === 'bytes').map(frame => [...decoded(frame)])).toEqual([[1, 2, 255], [0, 9]])
      expect(splitCalls).toEqual(['split', 'split'])
      expect(streaming).not.toHaveBeenCalled()
      expect(framesFor(wire.frames, 'missing').find(frame => frame.type === 'head')?.status).toBe(404)
      expect(framesFor(wire.frames, 'stream').find(frame => frame.type === 'head')?.status).toBe(415)
      expect(decoder.decode(decoded(framesFor(wire.frames, 'explode').find(frame => frame.type === 'bytes')!))).toContain('route exploded')
      expect(framesFor(wire.frames, 'explode').find(frame => frame.type === 'head')?.status).toBe(500)
      expect(framesFor(wire.frames, 'returned').find(frame => frame.type === 'head')?.status).toBe(500)
      expect(header(framesFor(wire.frames, 'returned').find(frame => frame.type === 'head')!, 'x-follow')).toBe('kept')
      expect(decoder.decode(decoded(framesFor(wire.frames, 'returned').find(frame => frame.type === 'bytes')!))).toBe('nope')
      expect(framesFor(wire.frames, 'reserved').find(frame => frame.type === 'head')?.status).toBe(404)
      expect(framesFor(wire.frames, 'escape').find(frame => frame.type === 'head')?.status).toBe(404)
      expect(heldSignals[0]?.aborted).toBe(false)
      expect(framesFor(wire.frames, 'empty').find(frame => frame.type === 'head')?.status).toBe(204)
      expect(framesFor(wire.frames, 'empty').some(frame => frame.type === 'bytes')).toBe(false)
      expect(emptyFetch).toHaveBeenCalledOnce()
      expect(framesFor(wire.frames, 'get-only').find(frame => frame.type === 'head')?.status).toBe(404)
      expect(getOnly).not.toHaveBeenCalled()

      await bus.sendRaw('\n')
      await bus.close()
      await wire.finished
      expect(heldSignals[0]?.aborted).toBe(true)

      const invalidRequests = [
        'null',
        '{"type":1,"id":"a"}',
        '{"type":"cancel","id":1}',
        '{"type":"cancel","id":""}',
        '{"type":"subscribe","id":"a"}',
        '{"type":"subscribe","id":"a","endpoint":1}',
        '{"type":"nope","id":"a"}',
        '{',
      ]
      for (const line of invalidRequests) {
        const bad = openBus(handler)
        try {
          const badResponse = await bad.response
          const finished = collect(badResponse).finished
          await bad.sendRaw(`${line}\n`)
          await finished
        } finally {
          bad.abort()
        }
      }

      const paused = openBus(handler)
      try {
        const pausedResponse = await paused.response
        await paused.send({ type: 'subscribe', id: 'paused', endpoint: 'bytes/split', payload: { paused: true } })
        await vi.waitFor(() => { expect(splitCalls).toHaveLength(3) })
        await tick()
        const pausedWire = collect(pausedResponse)
        await pausedWire.until(frames => framesFor(frames, 'paused').some(frame => frame.type === 'end'))
        const pausedBytes = framesFor(pausedWire.frames, 'paused').filter(frame => frame.type === 'bytes')
        expect(pausedBytes.map(frame => [...decoded(frame)])).toEqual([[1, 2, 255], [0, 9]])
        await paused.close()
        await pausedWire.finished
      } finally {
        paused.abort()
      }

      const limited = await harness(32)
      const bodies: string[] = []
      const disposeSized = register(limited.connection, '/api/bytes/sized', 'buffered', async (request) => {
        bodies.push(await request.text())
        return new Response('ok')
      })
      try {
        const sized = openBus(limited.handler)
        const sizedWire = collect(await sized.response)
        const accepted = 'x'.repeat(10)
        const wide = '\uFFFF'.repeat(11)
        const overChars = 'x'.repeat(40)
        await sized.send({ type: 'subscribe', id: 'fit', endpoint: 'bytes/sized', payload: accepted })
        await sized.send({ type: 'subscribe', id: 'wide', endpoint: 'bytes/sized', payload: wide })
        await sized.send({ type: 'subscribe', id: 'chars', endpoint: 'bytes/sized', payload: overChars })
        await sized.send({ type: 'subscribe', id: 'again', endpoint: 'bytes/sized', payload: accepted })
        await sizedWire.until(frames => framesFor(frames, 'again').some(frame => frame.type === 'end'))
        expect(framesFor(sizedWire.frames, 'fit').find(frame => frame.type === 'head')?.status).toBe(200)
        expect(framesFor(sizedWire.frames, 'wide').find(frame => frame.type === 'head')?.status).toBe(413)
        expect(framesFor(sizedWire.frames, 'chars').find(frame => frame.type === 'head')?.status).toBe(413)
        expect(framesFor(sizedWire.frames, 'again').find(frame => frame.type === 'head')?.status).toBe(200)
        expect(bodies).toHaveLength(2)
        await sized.close()
        await sizedWire.finished

        const overflow = openBus(limited.handler)
        const overflowResponse = await overflow.response
        const overflowWire = collect(overflowResponse)
        await overflow.send({ type: 'subscribe', id: 'line', endpoint: 'bytes/sized', payload: 'y'.repeat(FOLLOW_BUS_FRAME_OVERHEAD_BYTES + 64) })
        await overflowWire.finished
        expect(bodies).toHaveLength(2)
        expect(overflowWire.frames.some(frame => frame.id === 'line')).toBe(false)
      } finally {
        await disposeSized()
        await limited.dispose()
      }

      const authed = await harness()
      const hits: string[] = []
      let resident: AbortSignal | undefined
      const disposeResident = register(authed.connection, '/api/bytes/resident', 'buffered', (request) => {
        resident = request.signal
        hits.push('resident')
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('stay'))
            request.signal.addEventListener('abort', () => {
              try { controller.close() } catch {
                // The resident body may already be closed when the bus stops.
              }
            }, { once: true })
          },
        })
        return Promise.resolve(new Response(body))
      })
      const disposeNext = register(authed.connection, '/api/bytes/next', 'buffered', () => {
        hits.push('next')
        return Promise.resolve(new Response('next'))
      })
      const disposeRouteDenied = register(authed.connection, '/api/bytes/route-denied', 'buffered', () => {
        hits.push('route-denied')
        return Promise.resolve(new Response('no', { status: 401 }))
      })
      try {
        expect(authed.connection.requestRejection({ headers: { host: '127.0.0.1', cookie: authed.session.cookie } })).toBe(undefined)
        expect(authed.connection.requestRejection({ headers: { host: '127.0.0.1' } })).toBe(401)
        expect(authed.connection.requestRejection({ headers: { host: 'attacker.test', cookie: authed.session.cookie } })).toBe(403)

        const bus = openBus(authed.handler)
        const wire = collect(await bus.response)
        await bus.send({ type: 'subscribe', id: 'resident', endpoint: 'bytes/resident', payload: {} })
        await bus.send({ type: 'subscribe', id: 'route-denied', endpoint: 'bytes/route-denied', payload: {} })
        await bus.send({ type: 'subscribe', id: 'next', endpoint: 'bytes/next', payload: {} })
        await wire.until(frames => framesFor(frames, 'next').some(frame => frame.type === 'end')
          && framesFor(frames, 'resident').some(frame => frame.type === 'bytes'))
        expect(framesFor(wire.frames, 'route-denied').find(frame => frame.type === 'head')?.status).toBe(401)
        expect(framesFor(wire.frames, 'next').find(frame => frame.type === 'head')?.status).toBe(200)
        expect(resident?.aborted).toBe(false)
        expect(hits).toEqual(['resident', 'route-denied', 'next'])

        authed.session.expiresAt = 0
        await bus.send({ type: 'subscribe', id: 'expired', endpoint: 'bytes/next', payload: {} })
        await wire.until(frames => framesFor(frames, 'expired').some(frame => frame.type === 'end'))
        expect(framesFor(wire.frames, 'expired').find(frame => frame.type === 'head')?.status).toBe(401)
        expect(decoder.decode(decoded(framesFor(wire.frames, 'expired').find(frame => frame.type === 'bytes')!))).toBe('unauthorized')
        expect(hits.filter(hit => hit === 'next')).toEqual(['next'])
        await vi.waitFor(() => { expect(resident?.aborted).toBe(true) })
        await wire.finished

        authed.session.expiresAt = Number.POSITIVE_INFINITY
        const cleared = openBus(authed.handler)
        const clearedWire = collect(await cleared.response)
        cleared.request.headers.set('cookie', '')
        await cleared.send({ type: 'subscribe', id: 'cleared', endpoint: 'bytes/next', payload: {} })
        await clearedWire.until(frames => framesFor(frames, 'cleared').some(frame => frame.type === 'end'))
        expect(framesFor(clearedWire.frames, 'cleared').find(frame => frame.type === 'head')?.status).toBe(401)
        expect(hits.filter(hit => hit === 'next')).toEqual(['next'])
        await clearedWire.finished

        const forbidden = openBus(authed.handler, { headers: { host: 'attacker.test', cookie: SESSION_COOKIE } })
        const forbiddenWire = collect(await forbidden.response)
        await forbidden.send({ type: 'subscribe', id: 'forbidden', endpoint: 'bytes/next', payload: {} })
        await forbiddenWire.until(frames => framesFor(frames, 'forbidden').some(frame => frame.type === 'end'))
        expect(framesFor(forbiddenWire.frames, 'forbidden').find(frame => frame.type === 'head')?.status).toBe(403)
        expect(hits.filter(hit => hit === 'next')).toEqual(['next'])
        await forbiddenWire.finished

        const desktop = openBus(authed.handler, {
          url: 'dsh-app://app/api/connection/follow-bus',
          headers: { host: 'attacker.test', cookie: 'cleared' },
        })
        const desktopWire = collect(await desktop.response)
        await desktop.send({ type: 'subscribe', id: 'desktop', endpoint: 'bytes/next', payload: {} })
        await desktopWire.until(frames => framesFor(frames, 'desktop').some(frame => frame.type === 'end'))
        expect(framesFor(desktopWire.frames, 'desktop').find(frame => frame.type === 'head')?.status).toBe(200)
        expect(hits.filter(hit => hit === 'next')).toEqual(['next', 'next'])
        await desktop.close()
        await desktopWire.finished

        const blocked = openBus(authed.handler)
        authed.session.expiresAt = 0
        await blocked.send({ type: 'subscribe', id: 'blocked', endpoint: 'bytes/next', payload: {} })
        await blocked.send({ type: 'cancel', id: 'blocked' })
        const blockedWire = collect(await blocked.response)
        await blockedWire.until(frames => framesFor(frames, 'blocked').some(frame => frame.type === 'end'))
        authed.session.expiresAt = Number.POSITIVE_INFINITY
        await blocked.send({ type: 'subscribe', id: 'after', endpoint: 'bytes/next', payload: {} })
        await blockedWire.until(frames => framesFor(frames, 'after').some(frame => frame.type === 'end'))
        expect(framesFor(blockedWire.frames, 'after').find(frame => frame.type === 'head')?.status).toBe(200)
        expect(hits.filter(hit => hit === 'next')).toEqual(['next', 'next', 'next'])
        await blocked.close()
        await blockedWire.finished
      } finally {
        await disposeResident()
        await disposeNext()
        await disposeRouteDenied()
        await authed.dispose()
      }
    } finally {
      await Promise.all([
        disposeSplit(), disposeStream(), disposeBoom(), disposeReturned(), disposeHeld(), disposeEmpty(), disposeGet(),
      ])
      await dispose()
    }
  })

  it('aborts only the cancelled route, then aborts routes still open when the bus request closes', async () => {
    const { connection, handler, dispose } = await harness()
    const alphaSignals: AbortSignal[] = []
    const betaSignals: AbortSignal[] = []
    let releaseBeta: (() => void) | undefined
    const betaGate = new Promise<void>((resolve) => { releaseBeta = resolve })
    const disposeAlpha = register(connection, '/api/bytes/alpha', 'buffered', (request) => {
      alphaSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('alpha:1'))
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) resolve()
            else request.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          try { controller.close() } catch {
            // Cancel can close the body before this wait returns.
          }
        },
      })
      return Promise.resolve(new Response(body))
    })
    const disposeBeta = register(connection, '/api/bytes/beta', 'buffered', (request) => {
      betaSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('beta:1'))
          const aborted = new Promise<void>((resolve) => {
            if (request.signal.aborted) resolve()
            else request.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          await Promise.race([betaGate, aborted])
          if (!request.signal.aborted) controller.enqueue(encoder.encode('beta:2'))
          await aborted
          try { controller.close() } catch {
            // The request abort can win the race with the second chunk.
          }
        },
      })
      return Promise.resolve(new Response(body))
    })
    const fastSignals: AbortSignal[][] = [[], []]
    const disposeFast = ['/api/bytes/fast-a', '/api/bytes/fast-b'].map((path, index) => register(
      connection, path, 'buffered', (request) => {
        fastSignals[index]?.push(request.signal)
        return Promise.resolve(new Response(encoder.encode(path)))
      },
    ))
    let releaseLate: () => void = () => undefined
    const lateGate = new Promise<void>((resolve) => { releaseLate = resolve })
    const lateDone: string[] = []
    const lateSignals: AbortSignal[] = []
    const disposeLate = register(connection, '/api/bytes/late', 'buffered', (request) => {
      lateSignals.push(request.signal)
      return lateGate.then(() => {
        lateDone.push('late')
        return new Response('late')
      })
    })
    const disposeBoomLate = register(connection, '/api/bytes/late-boom', 'buffered', (request) => {
      lateSignals.push(request.signal)
      return lateGate.then(() => {
        lateDone.push('boom')
        return Promise.reject(new Error('late boom'))
      })
    })
    let pushChunk: (bytes: Uint8Array) => void = () => { throw new Error('missing push') }
    let closePush: () => void = () => undefined
    const pushSignals: AbortSignal[] = []
    let pushCancelled = false
    const disposePush = register(connection, '/api/bytes/push', 'buffered', (request) => {
      pushSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          pushChunk = (bytes) => { controller.enqueue(bytes) }
          closePush = () => {
            try { controller.close() } catch {
              // The pump may already have left this body.
            }
          }
        },
        cancel() { pushCancelled = true },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    const loopSignals: AbortSignal[] = []
    let loopCancelled = false
    const disposeLoop = register(connection, '/api/bytes/loop', 'buffered', (request) => {
      loopSignals.push(request.signal)
      const body = new ReadableStream<Uint8Array>({
        cancel() { loopCancelled = true },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    const liveSignals: AbortSignal[] = []
    const disposeLive = register(connection, '/api/bytes/live', 'buffered', (request) => {
      liveSignals.push(request.signal)
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() { return undefined } }), { status: 200 }))
    })
    const bus = openBus(handler)
    try {
      const response = await bus.response
      const wire = collect(response)
      await bus.send({ type: 'subscribe', id: 'alpha', endpoint: 'bytes/alpha', payload: {} })
      await bus.send({ type: 'subscribe', id: 'beta', endpoint: 'bytes/beta', payload: {} })
      await wire.until(frames => frames.some(frame => frame.id === 'alpha' && frame.type === 'bytes')
        && frames.some(frame => frame.id === 'beta' && frame.type === 'bytes'))
      await bus.send({ type: 'cancel', id: 'alpha' })
      await vi.waitFor(() => { expect(alphaSignals[0]?.aborted).toBe(true) })
      expect(betaSignals[0]?.aborted).toBe(false)
      releaseBeta?.()
      await wire.until(frames => frames.some(frame => frame.id === 'beta'
        && frame.data !== undefined && decoder.decode(decoded(frame)) === 'beta:2'))
      expect(betaSignals[0]?.aborted).toBe(false)
      expect(decoder.decode(decoded(framesFor(wire.frames, 'alpha').find(frame => frame.type === 'bytes')!))).toBe('alpha:1')

      bus.abort()
      await vi.waitFor(() => { expect(betaSignals[0]?.aborted).toBe(true) })
      await wire.finished

      const fast = openBus(handler)
      try {
        const fastResponse = await fast.response
        await fast.send({ type: 'subscribe', id: 'a', endpoint: 'bytes/fast-a', payload: {} })
        await fast.send({ type: 'subscribe', id: 'b', endpoint: 'bytes/fast-b', payload: {} })
        await vi.waitFor(() => { expect(fastSignals.every(list => list.length === 1)).toBe(true) })
        await tick()
        fast.abort()
        await collect(fastResponse).finished
        expect(fastSignals.every(list => list[0]?.aborted === true)).toBe(true)
      } finally {
        fast.abort()
      }

      const late = openBus(handler)
      try {
        const lateResponse = await late.response
        const lateWire = collect(lateResponse)
        await late.send({ type: 'subscribe', id: 'late', endpoint: 'bytes/late', payload: {} })
        await late.send({ type: 'subscribe', id: 'boom', endpoint: 'bytes/late-boom', payload: {} })
        await vi.waitFor(() => { expect(lateSignals).toHaveLength(2) })
        await late.send({ type: 'cancel', id: 'late' })
        await late.send({ type: 'cancel', id: 'boom' })
        await vi.waitFor(() => { expect(lateSignals.every(signal => signal.aborted)).toBe(true) })
        releaseLate()
        await vi.waitFor(() => { expect(lateDone.slice().sort()).toEqual(['boom', 'late']) })
        await tick()
        const lateIds = lateWire.frames.some(frame => frame.id === 'late' || frame.id === 'boom')
        expect(lateIds).toBe(false)
        await late.close()
        await lateWire.finished
      } finally {
        releaseLate()
        late.abort()
      }

      const pushed = openBus(handler)
      try {
        const pushedResponse = await pushed.response
        const pushedWire = collect(pushedResponse)
        await pushed.send({ type: 'subscribe', id: 'push', endpoint: 'bytes/push', payload: {} })
        await pushedWire.until(frames => frames.some(frame => frame.id === 'push' && frame.type === 'head'))
        await tick()
        await pushed.send({ type: 'cancel', id: 'push' })
        await vi.waitFor(() => { expect(pushSignals[0]?.aborted).toBe(true) })
        pushChunk(encoder.encode('late'))
        await tick()
        expect(framesFor(pushedWire.frames, 'push').some(frame => frame.type === 'bytes')).toBe(false)
        expect(pushCancelled).toBe(false)
        closePush()
        await pushed.close()
        await pushedWire.finished
      } finally {
        closePush()
        pushed.abort()
      }

      const loop = openBus(handler)
      try {
        const loopResponse = await loop.response
        await loop.send({ type: 'subscribe', id: 'loop', endpoint: 'bytes/loop', payload: {} })
        await vi.waitFor(() => { expect(loopSignals).toHaveLength(1) })
        await tick()
        await loop.send({ type: 'cancel', id: 'loop' })
        await vi.waitFor(() => { expect(loopSignals[0]?.aborted).toBe(true) })
        const loopWire = collect(loopResponse)
        await loopWire.until(frames => frames.some(frame => frame.id === 'loop' && frame.type === 'head'))
        await tick()
        expect(loopCancelled).toBe(true)
        expect(framesFor(loopWire.frames, 'loop').some(frame => frame.type === 'bytes')).toBe(false)
        await loop.close()
        await loopWire.finished
      } finally {
        loop.abort()
      }

      const live = openBus(handler)
      try {
        const liveResponse = await live.response
        await live.send({ type: 'subscribe', id: 'live', endpoint: 'bytes/live', payload: {} })
        const reader = liveResponse.body?.getReader()
        if (reader === undefined) throw new Error('missing bus body')
        let sawHead = false
        while (!sawHead) {
          const next = await reader.read()
          if (next.done) throw new Error('bus ended before the live head')
          const text = decoder.decode(next.value)
          sawHead = text.includes('"id":"live"') && text.includes('"type":"head"')
        }
        await reader.cancel()
        await vi.waitFor(() => { expect(liveSignals[0]?.aborted).toBe(true) })
      } finally {
        live.abort()
      }
    } finally {
      releaseBeta?.()
      releaseLate()
      closePush()
      bus.abort()
      await disposeAlpha()
      await disposeBeta()
      await Promise.all(disposeFast.map(disposeRoute => disposeRoute()))
      await disposeLate()
      await disposeBoomLate()
      await disposePush()
      await disposeLoop()
      await disposeLive()
      await dispose()
    }
  })
})
