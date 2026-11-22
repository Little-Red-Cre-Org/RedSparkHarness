/** JSON /api responses share one follow bus; unary calls keep their own request. */

import { Context } from '@redspark/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { createWebConnectionRpc } from '../src/client/rpc.ts'
import { createFollowBusClient, FOLLOW_BUS_PATH } from '../src/follow-bus.ts'
import { HostConnectionService } from '../src/rpc-host.ts'
import type { ConnectionFetchHandler } from '../src/rpc.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

async function harness(): Promise<{
  readonly connection: HostConnectionService
  readonly handler: ConnectionFetchHandler
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth)
  })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionService
  return {
    connection,
    handler: connection.createSharedFetchHandler('/api'),
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
  handler: ConnectionFetchHandler,
  calls: string[],
  hold?: { gate: Promise<undefined> | undefined },
): (input: URL, init: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input))
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`)
    const response = await handler.fetch(new Request(url, init))
    if (hold === undefined || hold.gate === undefined || url.pathname !== FOLLOW_BUS_PATH) return response
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

function openBus(): {
  readonly request: Request
  readonly send: (frame: unknown) => Promise<void>
  readonly sendRaw: (text: string) => Promise<void>
  readonly close: () => Promise<void>
  readonly abort: () => void
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const ready = Promise.withResolvers<undefined>()
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      ready.resolve(undefined)
    },
  })
  const lifetime = new AbortController()
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    body,
    duplex: 'half',
    signal: lifetime.signal,
  }
  const request = new Request('http://dsh.internal/api/connection/follow-bus', init)
  return {
    request,
    async send(frame) {
      await ready.promise
      controller?.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
    },
    async close() {
      await ready.promise
      controller?.close()
    },
    async sendRaw(text: string) {
      await ready.promise
      controller?.enqueue(encoder.encode(text))
    },
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

function scriptedFetch(status: number, body: BodyInit | null): (input: URL, init: RequestInit) => Promise<Response> {
  return () => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/x-ndjson' },
  }))
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
  ]
  for (const line of invalid) {
    await rejectBus(scriptedFetch(200, `${line}\n`), 'follow bus: invalid frame', false)
  }
}

describe('native follow connection bus', () => {
  it('keeps a unary call on its own request while five follows share one socket', async () => {
    const { connection, handler, dispose } = await harness()
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
    vi.stubGlobal('fetch', pageFetch(handler, calls, hold))
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
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toEqual([`POST ${FOLLOW_BUS_PATH}`])
      expect(routes.every(route => route.signals.length === 1 && route.signals[0]?.aborted === false)).toBe(true)

      const described = await rpc.call('/api', 'settings/describe', {})
      expect(described).toEqual({ ok: true, value: { hasDocument: true } })
      expect(calls).toContain('POST /api/settings/describe')
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      expect(routes.every(route => route.signals[0]?.aborted === false)).toBe(true)

      const stopped = new AbortController()
      stopped.abort('already stopped')
      await expect(rpc.response?.('/api', 'workspaces/follow', {}, stopped.signal)).rejects.toThrow('already stopped')
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

      const read = await rpc.response?.('/api', 'session/files/read', { path: 'a.png' }, readAbort.signal)
      expect(await read?.text()).toBe('{"text":"png"}')
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      expect(routes.every(route => route.signals[0]?.aborted === false)).toBe(true)

      for (const controller of controllers) controller.abort()
      await vi.waitFor(() => {
        expect(routes.every(route => route.signals[0]?.aborted === true)).toBe(true)
      })
      await tick()
      readAbort.abort()
      const next = await rpc.response?.('/api', 'session/files/read', { path: 'b.png' }, nextAbort.signal)
      expect(await next?.text()).toBe('{"text":"png"}')
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(2)
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
    const { connection, handler, dispose } = await harness()
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
    vi.stubGlobal('fetch', pageFetch(handler, calls))
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
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

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
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)

      const other = await rpc.response?.('/rpc', 'workspaces/follow', {}, otherAbort.signal)
      expect(other?.status).toBe(404)
      expect(calls).toContain('POST /rpc/workspaces/follow')

      const direct = vi.fn((_input: URL) => Promise.resolve(new Response('direct')))
      const explicit = createWebConnectionRpc(direct)
      const explicitResponse = await explicit.response?.('/api', 'workspaces/follow', {}, new AbortController().signal)
      expect(explicitResponse?.status).toBe(200)
      expect(direct).toHaveBeenCalledOnce()
      expect(direct.mock.calls[0]?.[0].pathname).toBe('/api/workspaces/follow')
      expect(calls.filter(call => call === `POST ${FOLLOW_BUS_PATH}`)).toHaveLength(1)
      await exerciseClientEdges()
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
      expect(() => register(connection, FOLLOW_BUS_PATH, 'streaming', () => Promise.resolve(new Response()))).toThrow('reserved')

      const direct = await handler.fetch(new Request('http://dsh.internal/api/bytes/split', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null',
      }))
      expect(direct.status).toBe(201)
      expect(splitCalls).toEqual(['split'])

      const bus = openBus()
      const response = await handler.fetch(bus.request)
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
      ]
      for (const line of invalidRequests) {
        const bad = openBus()
        try {
          const badResponse = await handler.fetch(bad.request)
          const finished = collect(badResponse).finished
          await bad.sendRaw(`${line}\n`)
          await finished
        } finally {
          bad.abort()
        }
      }

      const paused = openBus()
      try {
        const pausedResponse = await handler.fetch(paused.request)
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
    const bus = openBus()
    try {
      const response = await handler.fetch(bus.request)
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

      const fast = openBus()
      try {
        const fastResponse = await handler.fetch(fast.request)
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

      const late = openBus()
      try {
        const lateResponse = await handler.fetch(late.request)
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

      const pushed = openBus()
      try {
        const pushedResponse = await handler.fetch(pushed.request)
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

      const loop = openBus()
      try {
        const loopResponse = await handler.fetch(loop.request)
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

      const live = openBus()
      try {
        const liveResponse = await handler.fetch(live.request)
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
