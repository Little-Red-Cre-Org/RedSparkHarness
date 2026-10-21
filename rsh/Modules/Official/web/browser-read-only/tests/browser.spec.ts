/** Local wire admission and grant lifetime, without browser or model credentials. */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { BrowserReadOnly, resolveBrowserConfig, type BrowserGrantId } from '../src/index.ts'
import { receiveFrames, sendFrame } from '../src/wire.ts'

it.each(['admission', 'grant lifetime'] as const)('enforces %s over the local pipe', async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-read-'))
  const connectionFile = join(directory, 'connection.json')
  const browser = await BrowserReadOnly.open(resolveBrowserConfig({ connectionFile, readTimeoutMs: 200 }))
  const discovery = JSON.parse(await readFile(connectionFile, 'utf8')) as { pipe: string; token: string }
  const sockets: Socket[] = []
  const connect = async (token: string) => {
    const socket = createConnection(discovery.pipe)
    sockets.push(socket)
    const messages: Array<Record<string, unknown>> = []
    receiveFrames(socket, (value) => { messages.push(value as Record<string, unknown>) }, () => { socket.destroy() })
    await once(socket, 'connect')
    sendFrame(socket, { type: 'hello', token })
    return { socket, messages }
  }
  try {
    if (scenario === 'admission') {
      const rejected = await connect('0'.repeat(64))
      await once(rejected.socket, 'close')
      expect(browser.status()).toEqual({ connected: false, pages: [] })
      const accepted = await connect(discovery.token)
      await expect.poll(() => accepted.messages.length).toBe(1)
      const badHeader = Buffer.alloc(4)
      badHeader.writeUInt32LE(1024 * 1024 + 1)
      accepted.socket.write(badHeader)
      await once(accepted.socket, 'close')
      expect(browser.status().connected).toBe(false)
      await expect(BrowserReadOnly.open(resolveBrowserConfig({ connectionFile }))).rejects.toMatchObject({ code: 'EEXIST' })
      expect(JSON.parse(await readFile(connectionFile, 'utf8'))).toEqual(discovery)
    } else {
      const { socket, messages } = await connect(discovery.token)
      await expect.poll(() => messages.length).toBe(1)
      const grant = { id: randomUUID() as BrowserGrantId, title: 'Authorized page', url: 'https://example.test/article' }
      sendFrame(socket, { type: 'grant', grant })
      await expect.poll(() => browser.status().pages).toEqual([grant])
      const read = browser.read(grant.id, new AbortController().signal)
      const rejected = expect(read).rejects.toThrow('revoked')
      await expect.poll(() => messages.length).toBe(2)
      sendFrame(socket, { type: 'revoke', id: grant.id })
      await rejected
      sendFrame(socket, { type: 'result', requestId: messages[1]?.requestId, grantId: grant.id,
        url: grant.url, title: grant.title, text: 'Late result', truncated: false })
      expect(() => browser.read(grant.id, new AbortController().signal)).toThrow('not authorized')
      sendFrame(socket, { type: 'grant', grant })
      await expect.poll(() => browser.status().pages.length).toBe(1)
      const controller = new AbortController()
      const cancelled = expect(browser.read(grant.id, controller.signal)).rejects.toThrow('cancelled')
      controller.abort()
      await cancelled
      await expect(browser.read(grant.id, new AbortController().signal)).rejects.toThrow('timed out')
      const stopped = expect(browser.read(grant.id, new AbortController().signal)).rejects.toThrow('provider stopped')
      await browser.close()
      await stopped
      expect(browser.status()).toEqual({ connected: false, pages: [] })
      await expect(access(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  } finally {
    sockets.forEach(socket => socket.destroy())
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
