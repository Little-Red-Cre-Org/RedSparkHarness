/** Authorized, revocable browser-page reads over a private authenticated local pipe. */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { receiveFrames, sendFrame } from './wire.ts'

/** Browser-issued identifier; knowing an id never replaces a live grant. */
export type BrowserGrantId = Branded<'BrowserGrantId'>
type ReadId = Branded<'BrowserReadId'>

const id = z.uuid()
const pageUrl = z.url().max(4096).refine((value) => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
}, 'Only HTTP(S) pages without URL credentials are readable')
const grantSchema = z.object({ id, url: pageUrl, title: z.string().max(1024) }).strict()
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('grant'), grant: grantSchema }).strict(),
  z.object({ type: z.literal('revoke'), id }).strict(),
  z.object({ type: z.literal('result'), requestId: id, grantId: id, url: pageUrl,
    title: z.string().max(1024), text: z.string().max(100000), truncated: z.boolean() }).strict(),
  z.object({ type: z.literal('error'), requestId: id, code: z.enum(['PAGE_CHANGED', 'REVOKED', 'READ_FAILED']) }).strict(),
])
const configSchema = z.object({
  connectionFile: z.string().refine(isAbsolute, 'connectionFile must be absolute'),
  readTimeoutMs: z.number().int().min(100).max(120000).default(15000),
  maxTextChars: z.number().int().min(1).max(100000).default(60000),
  maxGrants: z.number().int().min(1).max(64).default(8),
  maxPendingReads: z.number().int().min(1).max(32).default(4),
}).strict()

/** Fully resolved deployment limits and discovery-file location. */
export type BrowserReadConfig = z.infer<typeof configSchema>
/** An explicitly authorized page, without its content. */
export interface BrowserGrant { readonly id: BrowserGrantId; readonly url: string; readonly title: string }
/** A snapshot of untrusted page text, captured under a still-live grant. */
export interface BrowserPage { readonly url: string; readonly title: string; readonly text: string; readonly truncated: boolean }
interface Pending { grant: BrowserGrant; resolve: (page: BrowserPage) => void; reject: (error: Error) => void; dispose: () => void }

/**
 * Resolve and validate the deployment's browser limits.
 * @param input - profile configuration.
 * @returns validated deployment limits.
 */
export function resolveBrowserConfig(input: unknown): BrowserReadConfig { return configSchema.parse(input) }

/** Owns one browser connection, its grants, and bounded outstanding reads. */
export class BrowserReadOnly {
  private readonly token = randomBytes(32).toString('hex')
  private readonly server: Server
  private readonly sockets = new Set<Socket>()
  private peer: Socket | undefined
  private readonly grants = new Map<BrowserGrantId, BrowserGrant>()
  private readonly pending = new Map<ReadId, Pending>()
  private ownsFile = false

  private constructor(private readonly config: BrowserReadConfig) {
    this.server = createServer((socket) => { this.accept(socket) })
  }

  /**
   * Listen on a fresh local pipe and publish its private discovery file exclusively.
   * @param config - validated limits and an unused connection-file path.
   * @returns active provider; an existing discovery file is never overwritten.
   */
  static async open(config: BrowserReadConfig): Promise<BrowserReadOnly> {
    const service = new BrowserReadOnly(config)
    const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\redspark-browser-${randomUUID()}`
      : join(tmpdir(), `redspark-browser-${randomUUID()}.sock`)
    try {
      await new Promise<void>((resolve, reject) => {
        service.server.once('error', reject)
        service.server.listen(pipe, () => { service.server.off('error', reject); resolve() })
      })
      await mkdir(dirname(config.connectionFile), { recursive: true, mode: 0o700 })
      await writeFile(config.connectionFile, `${JSON.stringify({ pipe, token: service.token })}\n`, { flag: 'wx', mode: 0o600 })
      service.ownsFile = true
      return service
    } catch (error) { await service.close(); throw error }
  }

  /**
   * List metadata without reading page contents.
   * @returns connection status and only currently authorized pages.
   */
  status(): { connected: boolean; pages: readonly BrowserGrant[] } {
    return { connected: this.peer !== undefined, pages: [...this.grants.values()] }
  }

  private accept(socket: Socket): void {
    if (this.sockets.size >= 2) { socket.destroy(); return }
    this.sockets.add(socket)
    const handshakeTimer = setTimeout(() => { socket.destroy() }, this.config.readTimeoutMs)
    const detach = receiveFrames(socket, (value) => {
      if (this.peer !== socket) {
        const hello = z.object({ type: z.literal('hello'), token: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(value)
        if (this.peer !== undefined || !timingSafeEqual(Buffer.from(hello.token), Buffer.from(this.token))) {
          socket.destroy(); return
        }
        clearTimeout(handshakeTimer)
        this.peer = socket
        sendFrame(socket, { type: 'connected', maxGrants: this.config.maxGrants })
        return
      }
      const message = messageSchema.parse(value)
      if (message.type === 'grant') {
        const grant = { ...message.grant, id: message.grant.id as BrowserGrantId }
        if (this.grants.has(grant.id) || this.grants.size >= this.config.maxGrants) throw new Error('Grant limit or duplicate')
        this.grants.set(grant.id, grant)
      } else if (message.type === 'revoke') {
        const grantId = message.id as BrowserGrantId
        this.grants.delete(grantId)
        for (const [requestId, pending] of this.pending) {
          if (pending.grant.id === grantId) this.fail(requestId, 'Browser page authorization was revoked')
        }
      } else {
        const requestId = message.requestId as ReadId
        const pending = this.pending.get(requestId)
        if (pending === undefined) return // Late cancelled responses have no recipient.
        if (message.type === 'error') { this.fail(requestId, `Browser read failed: ${message.code}`); return }
        if (message.grantId !== pending.grant.id || message.url !== pending.grant.url
          || this.grants.get(pending.grant.id) !== pending.grant || message.text.length > this.config.maxTextChars) {
          throw new Error('Browser page changed or exceeded the read limit')
        }
        pending.dispose()
        this.pending.delete(requestId)
        pending.resolve({ title: message.title, url: message.url, text: message.text, truncated: message.truncated })
      }
    }, () => { socket.destroy() })
    socket.on('error', () => { socket.destroy() })
    socket.once('close', () => {
      clearTimeout(handshakeTimer); detach(); this.sockets.delete(socket)
      if (this.peer !== socket) return
      this.peer = undefined
      this.grants.clear()
      for (const requestId of this.pending.keys()) this.fail(requestId, 'Browser disconnected; reconnect and authorize the page')
    })
  }

  private fail(requestId: ReadId, message: string): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    pending.dispose(); this.pending.delete(requestId); pending.reject(new Error(message))
  }

  /**
   * Read a currently granted page; revoke, disconnect, cancellation and timeout invalidate results.
   * @param grantId - identifier returned by status().
   * @param signal - consuming application's cancellation signal.
   * @returns bounded, untrusted page text with its verified source URL.
   */
  read(grantId: BrowserGrantId, signal: AbortSignal): Promise<BrowserPage> {
    signal.throwIfAborted()
    const peer = this.peer
    const grant = this.grants.get(grantId)
    if (peer === undefined || grant === undefined) throw new Error('Page is not authorized; connect and authorize it in the browser extension')
    if (this.pending.size >= this.config.maxPendingReads) throw new Error('Browser read concurrency limit reached')
    const requestId = randomUUID() as ReadId
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        this.fail(requestId, 'Browser read was cancelled')
        if (!peer.destroyed) sendFrame(peer, { type: 'cancel', requestId })
      }
      const timer = setTimeout(() => {
        this.fail(requestId, 'Browser read timed out; no automatic retry was made')
        if (!peer.destroyed) sendFrame(peer, { type: 'cancel', requestId })
      }, this.config.readTimeoutMs)
      signal.addEventListener('abort', cancel, { once: true })
      this.pending.set(requestId, { grant, resolve, reject,
        dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
      sendFrame(peer, { type: 'read', requestId, grantId, maxTextChars: this.config.maxTextChars })
    })
  }

  /** Stop admission, invalidate all reads, close sockets, then remove only our discovery file. */
  async close(): Promise<void> {
    for (const requestId of this.pending.keys()) this.fail(requestId, 'Browser provider stopped')
    this.grants.clear(); this.peer = undefined
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve) => { this.server.close(() => { resolve() }) })
    if (!this.ownsFile) return
    const current: unknown = JSON.parse(await readFile(this.config.connectionFile, 'utf8'))
    if (z.object({ token: z.literal(this.token) }).safeParse(current).success) await unlink(this.config.connectionFile)
    this.ownsFile = false
  }
}
