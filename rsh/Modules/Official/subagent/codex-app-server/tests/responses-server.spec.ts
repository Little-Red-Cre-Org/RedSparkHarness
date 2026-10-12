import { once } from 'node:events'
import { connect } from 'node:net'
import { expect, it } from 'vitest'
import { startNativeResponsesServer } from '../src/responses-server.ts'

it('awaits listener cleanup when startup is cancelled during listen', async () => {
  const controller = new AbortController()
  const reason = new Error('startup cancelled')
  const starting = startNativeResponsesServer(async () => new Response(), 'fixture-token', controller.signal)

  controller.abort(reason)

  try {
    const server = await starting
    await server.close()
    throw new Error('cancelled listener unexpectedly started')
  } catch (error: unknown) {
    expect(error).toBe(reason)
  }
})

it('closes owned sockets that have not sent an HTTP request', async () => {
  const server = await startNativeResponsesServer(async () => new Response(), 'fixture-token', new AbortController().signal)
  const port = new URL(server.baseUrl).port
  const socket = connect({ host: '127.0.0.1', port: Number(port) })

  try {
    await once(socket, 'connect')
    const closed = once(socket, 'close')
    await server.close()
    await closed
    expect(socket.destroyed).toBe(true)
  } finally {
    socket.destroy()
    await server.close()
  }
})
