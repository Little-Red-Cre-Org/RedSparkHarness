import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Readable } from 'node:stream'

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Running per-operation loopback endpoint for the pinned Codex process. */
export interface NativeResponsesServer {
  readonly baseUrl: string
  readonly requestToken: string
  close(): Promise<void>
}

function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

function writeFailure(response: ServerResponse): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(502, { 'content-type': 'application/json', connection: 'close' })
  response.end('{"error":{"message":"Native model operation stopped","type":"api_error"}}')
}

/** Bind one authenticated Responses handler to an ephemeral IPv4 loopback port.
 * @param handler - Buffered gateway for the captured Native operation.
 * @param requestToken - Per-run bearer secret passed only to the Codex child.
 * @param signal - Operation cancellation signal.
 * @returns The endpoint address, secret, and awaited listener teardown.
 */
export async function startNativeResponsesServer(
  handler: (request: Request) => Promise<Response>,
  requestToken: string,
  signal: AbortSignal,
): Promise<NativeResponsesServer> {
  const controllers = new Set<AbortController>()
  const requests = new Set<Promise<void>>()
  const sockets = new Set<Socket>()
  const origin: { value: string | undefined } = { value: undefined }
  let closing: Promise<void> | undefined
  let listening = false
  let closingRequested = false
  const server: Server = createServer((incoming, outgoing) => {
    const controller = new AbortController()
    controllers.add(controller)
    const abort = (): void => {
      if (!controller.signal.aborted) controller.abort(new Error('Native Responses client disconnected'))
    }
    const onRequestAborted = (): void => { abort() }
    const onResponseClosed = (): void => {
      if (!outgoing.writableEnded) abort()
    }
    incoming.once('aborted', onRequestAborted)
    outgoing.once('close', onResponseClosed)
    const work = (async (): Promise<void> => {
      try {
        const requestOrigin = origin.value
        if (requestOrigin === undefined) throw new Error('Native Responses listener is not ready')
        const method = incoming.method ?? 'GET'
        const body = method === 'GET' || method === 'HEAD'
          ? undefined
          : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
        const request = new Request(new URL(incoming.url ?? '/', requestOrigin), {
          method,
          headers: headersOf(incoming),
          ...(body === undefined ? {} : { body, duplex: 'half' as const }),
          signal: controller.signal,
        })
        const result = await handler(request)
        const bytes = new Uint8Array(await result.arrayBuffer())
        if (outgoing.destroyed || outgoing.writableEnded) return
        outgoing.writeHead(result.status, {
          'content-type': result.headers.get('content-type') ?? 'application/json',
          'content-length': bytes.byteLength,
          'cache-control': 'no-store',
          connection: 'close',
        })
        outgoing.end(bytes)
      } catch {
        writeFailure(outgoing)
      } finally {
        controllers.delete(controller)
        incoming.off('aborted', onRequestAborted)
        outgoing.off('close', onResponseClosed)
      }
    })()
    requests.add(work)
    void work.finally(() => { requests.delete(work) })
  })
  server.on('connection', (socket) => {
    if (closingRequested) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  })
  server.on('clientError', (_error, socket) => { socket.destroy() })

  const close = (): Promise<void> => closing ??= (async (): Promise<void> => {
    closingRequested = true
    signal.removeEventListener('abort', onAbort)
    if (!listening) return
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    for (const controller of controllers) {
      if (!controller.signal.aborted) controller.abort(new Error('Native Responses listener closed'))
    }
    for (const socket of sockets) socket.destroy()
    await Promise.all([...requests])
    await closed
  })()
  const onAbort = (): void => {
    closingRequested = true
    for (const controller of controllers) {
      if (!controller.signal.aborted) controller.abort(signal.reason)
    }
    // Automatic cancellation starts teardown; an explicit close still observes its rejection.
    if (listening) void close().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) {
    onAbort()
    signal.removeEventListener('abort', onAbort)
    throw signal.reason instanceof Error ? signal.reason : new Error('Native Responses startup was cancelled')
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        listening = true
        server.off('error', onError)
        resolve()
        // The startup continuation awaits this shared close promise after observing the abort.
        if (signal.aborted) void close().catch(() => {})
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
  } catch (error: unknown) {
    signal.removeEventListener('abort', onAbort)
    throw error
  }
  if (signalIsAborted(signal)) {
    await close()
    signal.throwIfAborted()
  }
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await close()
    throw new Error('Native Responses listener did not acquire a TCP port')
  }
  origin.value = `http://127.0.0.1:${address.port}`
  const baseUrl = `${origin.value}/v1`

  return {
    baseUrl,
    requestToken,
    close,
  }
}
