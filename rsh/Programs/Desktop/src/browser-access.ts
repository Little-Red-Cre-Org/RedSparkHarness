/** On-demand loopback access to the running Desktop Host, without a second data owner. */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Authenticated local browser transport owned by the Desktop application lifetime. */
export class DesktopBrowserAccess {
  private readonly token = randomBytes(32).toString('hex')
  private origin = ''
  private opening: Promise<string> | undefined
  private readonly server = createServer((request, response) => {
    void this.serve(request, response).catch(() => {
      // Aborted streams and backend failures end only this HTTP response.
      if (response.headersSent) response.destroy()
      else { response.writeHead(502); response.end() }
    })
  })

  /** @param fetchApplication - forward requests to the current Desktop Host. */
  constructor(private readonly fetchApplication: (request: Request) => Promise<Response>) {}

  /** @returns a private browser entry URL; starts listening only on first use. */
  open(): Promise<string> {
    this.opening ??= new Promise<string>((resolve, reject) => {
      const failed = (error: Error): void => { this.opening = undefined; reject(error) }
      this.server.once('error', failed)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', failed)
        const address = this.server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('Desktop browser listener has no TCP address'))
          return
        }
        this.origin = `http://127.0.0.1:${address.port}`
        resolve(`${this.origin}/?desktop-access=${this.token}`)
      })
    })
    return this.opening
  }

  /** Stop active browser streams and release the local listener. */
  async close(): Promise<void> {
    if (this.opening === undefined) return
    await this.opening
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => { if (error) reject(error); else resolve() })
      this.server.closeAllConnections()
    })
    this.opening = undefined
  }

  private async serve(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const url = new URL(incoming.url ?? '/', this.origin)
    const cookieName = `rsh-desktop-${new URL(this.origin).port}`
    outgoing.setHeader('Cache-Control', 'no-store')
    outgoing.setHeader('Referrer-Policy', 'no-referrer')
    outgoing.setHeader('X-Frame-Options', 'DENY')
    if (incoming.headers.host !== new URL(this.origin).host || url.origin !== this.origin
      || (incoming.headers.origin !== undefined && incoming.headers.origin !== this.origin)
      || incoming.headers['sec-fetch-site'] === 'cross-site') {
      outgoing.writeHead(403); outgoing.end(); return
    }
    if (incoming.method === 'GET' && url.pathname === '/' && url.searchParams.get('desktop-access') === this.token) {
      outgoing.setHeader('Set-Cookie', `${cookieName}=${this.token}; HttpOnly; SameSite=Strict; Path=/`)
      outgoing.writeHead(303, { Location: '/' }); outgoing.end(); return
    }
    if (!(incoming.headers.cookie ?? '').split(';').some(value => value.trim() === `${cookieName}=${this.token}`)) {
      outgoing.writeHead(403); outgoing.end(); return
    }
    const abort = new AbortController()
    const cancel = (): void => { abort.abort() }
    outgoing.once('close', cancel)
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined && !['host', 'cookie', 'origin', 'referer', 'connection', 'transfer-encoding'].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      const method = incoming.method ?? 'GET'
      const response = await this.fetchApplication(new Request(`dsh-app://app${url.pathname}${url.search}`, {
        method, headers, signal: abort.signal,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' }),
      }))
      response.headers.forEach((value, key) => {
        if (!['connection', 'transfer-encoding', 'set-cookie', 'cache-control'].includes(key)) outgoing.setHeader(key, value)
      })
      outgoing.writeHead(response.status)
      if (response.body === null) outgoing.end()
      else await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), outgoing)
    } finally {
      outgoing.removeListener('close', cancel)
    }
  }
}
