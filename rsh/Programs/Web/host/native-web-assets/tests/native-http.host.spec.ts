import { once } from 'node:events'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { expect, it } from 'vitest'
import { HttpRouteTable } from '@deepseek-ai/dsh-http-routes'
import { listenNativeHttpHost, type NativeConnectionFetchHandler, type NativeConnectionHandle, type NativeHttpBridge } from '../src/native-http.ts'

function responseBody(
  port: number,
  path: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.on('error', reject)
    if (options.body !== undefined) request.end(options.body)
    else request.end()
  })
}

const testBridge: NativeHttpBridge = async (req, res, handler) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
  const request = new Request(`http://${req.headers.host ?? '127.0.0.1'}${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers: req.headers as Record<string, string>,
    ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
  })
  const response = await handler.fetch(request)
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(await response.text())
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: () => { resolvePromise() } }
}

function fakeConnection(): { handle: NativeConnectionHandle; registry: { forOwner(owner: unknown): NativeConnectionHandle } } {
  let ownerRef: { mount(channel: string, handler: NativeConnectionFetchHandler): () => void | Promise<void> } | undefined
  const handle: NativeConnectionHandle = {
    rpc: {
      handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) {
        const fetchHandler: NativeConnectionFetchHandler = {
          requestBodyMode: () => 'buffered',
          fetch: async (request) => {
            const payload: unknown = await request.json()
            return Response.json({ type: 'server-response', rpcId: 'r1', result: await handler('echo', payload, request.signal) })
          },
        }
        if (ownerRef === undefined) throw new Error('fake registry owner is not bound')
        const disposer = ownerRef.mount(channel, fetchHandler)
        return async () => { await disposer() }
      },
      intercept() { return async () => {} },
    },
    fetch: { register() { return async () => {} } },
    requestRejection: () => undefined,
    authorizeIndex: () => true,
    authenticatedUrl: (baseUrl: string) => `${baseUrl}?token=test`,
    createSharedFetchHandler: (): NativeConnectionFetchHandler => ({
      requestBodyMode: () => 'buffered',
      fetch: async request => Response.json({ ok: true, path: new URL(request.url).pathname }),
    }),
  }
  return {
    handle,
    registry: { forOwner(owner) {
      ownerRef = owner as { mount(channel: string, handler: NativeConnectionFetchHandler): () => void | Promise<void> }
      return handle
    } },
  }
}

it('serves native assets and shared /api through a real node:http listener', async () => {
  const fake = fakeConnection()
  const server = await listenNativeHttpHost(fake.registry, {
    requestBodyMode: () => 'buffered',
    fetch: async request => new Response(`asset:${new URL(request.url).pathname}`),
  }, testBridge)
  try {
    expect((await responseBody(server.port, '/'))).toEqual({ status: 200, body: 'asset:/' })
    expect((await responseBody(server.port, '/api/ping', { method: 'POST', body: '{}' })).status).toBe(200)
  } finally {
    await server.close()
  }
})

it('mounts a native RPC channel and removes the listener when the owner is disposed', async () => {
  const fake = fakeConnection()
  const server = await listenNativeHttpHost(fake.registry, {
    requestBodyMode: () => 'buffered',
    fetch: async () => new Response('asset'),
  }, testBridge)
  try {
    const disposer = server.connection.rpc.handle('/rpc', async (_endpoint, payload) => ({ ok: true, value: payload }))
    const mounted = await responseBody(server.port, '/rpc/echo', { method: 'POST', body: '{"value":1}', headers: { 'content-type': 'application/json' } })
    expect(mounted.status).toBe(200)
    expect(mounted.body).toContain('server-response')
    await disposer()
    expect(await responseBody(server.port, '/rpc/echo', { method: 'POST', body: '{}' })).toEqual({ status: 200, body: 'asset' })
  } finally {
    await server.close()
  }
})

it('closes the listener and rejects requests after close', async () => {
  const fake = fakeConnection()
  const server = await listenNativeHttpHost(fake.registry, { fetch: async () => new Response('asset'), requestBodyMode: () => 'buffered' }, testBridge)
  await server.close()
  await expect(responseBody(server.port, '/')).rejects.toBeDefined()
})

it('waits for a removed route handler before closing the table', async () => {
  const routes = new HttpRouteTable()
  const started = deferred()
  const release = deferred()
  let finished = false
  let closed = false
  const unregister = routes.register({ kind: 'exact', path: '/pending', handler: async () => {
    started.resolve()
    await release.promise
    finished = true
  } })
  const request = { complete: true, destroy() {} } as unknown as IncomingMessage
  const response = {} as unknown as ServerResponse
  const dispatch = routes.dispatch('/pending', request, response)
  let routeDrain: Promise<void> | undefined
  let tableClose: Promise<void> | undefined
  try {
    await started.promise
    routeDrain = unregister()
    tableClose = routes.close().then(() => { closed = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect({ closed, finished }).toEqual({ closed: false, finished: false })
  } finally {
    release.resolve()
    await Promise.allSettled([
      dispatch,
      ...(routeDrain === undefined ? [] : [routeDrain]),
      ...(tableClose === undefined ? [] : [tableClose]),
    ])
  }
  expect({ closed, finished }).toEqual({ closed: true, finished: true })
})

it.each(['route removal', 'listener close'] as const)('aborts incomplete request bodies during %s', async (action) => {
  const fake = fakeConnection()
  const server = await listenNativeHttpHost(fake.registry, {
    requestBodyMode: () => 'buffered',
    fetch: async () => new Response('asset'),
  }, testBridge)
  const started = deferred()
  const aborted = deferred()
  const dispose = server.httpRoutes.register({ kind: 'exact', path: '/partial', handler: async (request) => {
    started.resolve()
    try {
      for await (const _chunk of request) {}
    } catch {
      aborted.resolve()
    }
  } })
  const client = connect(server.port, '127.0.0.1')
  client.on('error', () => {})
  let routeDrain: Promise<void> | undefined
  let listenerClose: Promise<void> | undefined
  try {
    await once(client, 'connect')
    client.write('POST /partial HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{')
    await started.promise
    let stopped = false
    const stopping = action === 'route removal'
      ? (routeDrain = dispose()).then(() => { stopped = true })
      : (listenerClose = server.close()).then(() => { stopped = true })
    await aborted.promise
    await stopping
    expect(stopped).toBe(true)
    if (action === 'route removal') await server.close()
  } finally {
    client.destroy()
    routeDrain ??= dispose()
    listenerClose ??= server.close()
    await Promise.allSettled([routeDrain, listenerClose])
  }
})
