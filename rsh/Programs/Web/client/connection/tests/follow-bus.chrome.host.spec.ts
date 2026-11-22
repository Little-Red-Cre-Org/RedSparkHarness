/** Real Chrome against cleartext node:http: five resident follows share one finite downlink. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Context } from '@redspark/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { FOLLOW_BUS_PATH } from '../src/follow-bus.ts'
import { bridge } from '../src/http-bridge.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

const OPEN_CONTENT_LENGTH = String(Buffer.byteLength('{"type":"open"}\n'))
const SESSION_COOKIE = 'dsh-test=live'
const RESIDENT = [
  'native-session/list-follow',
  'workspaces/follow',
  'session/jobs/follow',
  'schedules/follow',
  'native-session/settings-events',
] as const

interface PageResult {
  readonly ok: boolean
  readonly chunks?: readonly string[]
  readonly described?: unknown
  readonly message?: string
}

interface FollowPost {
  readonly contentLength: string | undefined
  readonly transferEncoding: string | undefined
  done: boolean
}

interface Esbuild {
  build(options: {
    readonly absWorkingDir: string
    readonly bundle: true
    readonly entryPoints: readonly string[]
    readonly format: 'esm'
    readonly platform: 'browser'
    readonly write: false
  }): Promise<{ readonly outputFiles?: readonly { readonly text: string }[] }>
}

interface ChromePage {
  goto(url: string, options: { readonly timeout: number; readonly waitUntil: 'domcontentloaded' }): Promise<unknown>
  waitForFunction(
    pageFunction: () => boolean,
    arg: undefined,
    options: { readonly timeout: number },
  ): Promise<unknown>
  evaluate<T>(pageFunction: () => T): Promise<T>
  on(event: 'pageerror', listener: (error: Error) => void): void
  on(event: 'requestfailed', listener: (request: { url(): string; failure(): { errorText?: string } | null }) => void): void
  on(event: 'console', listener: (message: { type(): string; text(): string }) => void): void
  close(): Promise<void>
}

interface ChromeContext {
  addCookies(cookies: readonly { readonly name: string; readonly url: string; readonly value: string }[]): Promise<void>
  newPage(): Promise<ChromePage>
  close(): Promise<void>
}

interface PlaywrightChromium {
  readonly chromium: {
    launch(options: {
      readonly args: readonly string[]
      readonly channel: 'chrome'
      readonly headless: true
    }): Promise<{ newContext(): Promise<ChromeContext>; close(): Promise<void> }>
  }
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function fakeBrowserAuth(): BrowserAuth {
  return {
    isAuthenticated(request: { readonly headers: Headers | { readonly cookie?: string } }): boolean {
      const headers = request.headers
      const cookie = headers instanceof Headers ? headers.get('cookie') ?? undefined : headers.cookie
      return cookie === SESSION_COOKIE
    },
  } as BrowserAuth
}

async function bundleClient(): Promise<string> {
  const requireFromVite = createRequire(import.meta.resolve('vite'))
  const esbuild = requireFromVite('esbuild') as Esbuild
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    bundle: true,
    entryPoints: [fileURLToPath(new URL('../src/client/rpc.ts', import.meta.url))],
    format: 'esm',
    platform: 'browser',
    write: false,
  })
  const source = built.outputFiles?.[0]?.text
  if (source === undefined) throw new Error('missing follow-bus client bundle')
  return source
}

function pageHtml(): string {
  return `<!doctype html>
<meta charset="utf-8">
<script type="module">
import { createWebConnectionRpc } from '/client.js'
const endpoints = ${JSON.stringify(RESIDENT)}
const rpc = createWebConnectionRpc()
const open = rpc.response
if (open === undefined) throw new Error('missing response')
const controllers = endpoints.map(() => new AbortController())
try {
  const responses = await Promise.all(endpoints.map((endpoint, index) => {
    const signal = controllers[index]?.signal
    if (signal === undefined) throw new Error('missing follow signal')
    return open('/api', endpoint, {}, signal)
  }))
  const decoder = new TextDecoder()
  const chunks = []
  for (const response of responses) {
    if (!response.ok) throw new Error('follow HTTP ' + response.status)
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing follow body')
    let text = ''
    for (let attempt = 0; attempt < 8 && !text.includes('\\n\\n'); attempt += 1) {
      const next = await reader.read()
      if (next.done) break
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
    chunks.push(text)
  }
  const described = await rpc.call('/api', 'settings/describe', {})
  globalThis.__result = { ok: true, chunks, described }
} catch (error) {
  globalThis.__result = { ok: false, message: error instanceof Error ? error.message : String(error) }
}
</script>
`
}

describe('native follow connection bus in Chrome', () => {
  it('loads a session-list follow and still completes a unary call while five follows are resident', async () => {
    const clientSource = await bundleClient()
    expect(clientSource).toContain('{"type":"open"}')
    expect(clientSource.includes('TransformStream')).toBe(false)
    expect(clientSource.includes("duplex: 'half'")).toBe(false)

    const ctx = new Context()
    const fiber = ctx.plugin((pluginCtx) => {
      new HostConnectionService(pluginCtx, [], fakeBrowserAuth())
    })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionService
    const handler = connection.createSharedFetchHandler('/api')
    const encoder = new TextEncoder()
    const disposers = RESIDENT.map(endpoint => connection.fetch.register({
      path: `/api/${endpoint}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${endpoint}\n\n`))
        },
      }), { headers: { 'content-type': 'text/event-stream' } })),
    }))
    const disposeDescribe = connection.rpc.intercept('/api', endpoint => endpoint === 'settings/describe', () => Promise.resolve({
      ok: true,
      value: { hasDocument: true },
    }))
    const followPosts: FollowPost[] = []
    const apiPosts: string[] = []
    const serverErrors: string[] = []
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(pageHtml())
          return
        }
        if (req.method === 'GET' && url.pathname === '/client.js') {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
          res.end(clientSource)
          return
        }
        if (!url.pathname.startsWith('/api/')) {
          res.writeHead(404)
          res.end()
          return
        }
        apiPosts.push(url.pathname)
        if (url.pathname === FOLLOW_BUS_PATH) {
          const record: FollowPost = {
            contentLength: headerValue(req.headers['content-length']),
            transferEncoding: headerValue(req.headers['transfer-encoding']),
            done: false,
          }
          followPosts.push(record)
          res.on('finish', () => { record.done = true })
        }
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        await bridge(req, res, handler)
      })().catch((error: unknown) => {
        serverErrors.push(error instanceof Error ? error.message : String(error))
        if (!res.headersSent) res.writeHead(500)
        if (!res.writableEnded) res.end()
      })
    })
    const requireFromApplication = createRequire(new URL('../../../application/package.json', import.meta.url))
    const playwright = requireFromApplication('playwright') as PlaywrightChromium
    let browser: Awaited<ReturnType<PlaywrightChromium['chromium']['launch']>> | undefined
    let context: ChromeContext | undefined
    const pageErrors: string[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { resolve() })
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('follow bus listener has no port')
      const origin = `http://127.0.0.1:${String(address.port)}`
      browser = await playwright.chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
      context = await browser.newContext()
      await context.addCookies([{ name: 'dsh-test', value: 'live', url: origin }])
      const page = await context.newPage()
      page.on('pageerror', (error) => { pageErrors.push(error.message) })
      page.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(message.text())
      })
      page.on('requestfailed', (request) => { pageErrors.push(`${request.url()} ${request.failure()?.errorText ?? ''}`) })
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForFunction(() => {
        const holder = globalThis as { __result?: { ok: boolean } }
        return holder.__result !== undefined
      }, undefined, { timeout: 20_000 })
      const result = await page.evaluate(() => {
        const holder = globalThis as { __result?: PageResult }
        return holder.__result
      })
      expect(result?.ok, `${result?.message ?? ''}\n${pageErrors.join('\n')}`).toBe(true)
      expect(result?.chunks?.[0]).toBe('data: native-session/list-follow\n\n')
      expect(result?.chunks).toEqual(RESIDENT.map(endpoint => `data: ${endpoint}\n\n`))
      expect(result?.described).toEqual({ ok: true, value: { hasDocument: true } })
      expect(apiPosts).toContain('/api/settings/describe')
      expect(followPosts).toHaveLength(1 + RESIDENT.length)
      expect(followPosts.every(post => post.contentLength !== undefined && Number(post.contentLength) > 0)).toBe(true)
      expect(followPosts.every(post => post.transferEncoding === undefined)).toBe(true)
      expect(followPosts.filter(post => post.contentLength === OPEN_CONTENT_LENGTH)).toHaveLength(1)
      expect(serverErrors, serverErrors.join('\n')).toEqual([])
      await vi.waitFor(() => {
        expect(followPosts.filter(post => !post.done)).toHaveLength(1)
      }, { timeout: 5_000 })
      expect(followPosts.find(post => !post.done)?.contentLength).toBe(OPEN_CONTENT_LENGTH)
    } finally {
      await context?.close()
      await browser?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      await disposeDescribe()
      await Promise.all(disposers.map(dispose => dispose()))
      await fiber.dispose()
    }
  }, 60_000)
})
