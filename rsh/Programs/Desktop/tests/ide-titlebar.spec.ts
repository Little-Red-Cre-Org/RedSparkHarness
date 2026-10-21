/** Workbench chrome is Windows-owned and menu requests must originate in the workbench. */
import { expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { installIdeWebviews } from '../src/ide-webview.ts'

it.each([true, false])('workbench titlebar enabled=%s', async (enabled) => {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const html = '<html><head><meta id="vscode-workbench-web-configuration" data-settings="{}"><script src="/stable/static/out/vs/code/browser/workbench/workbench.js"></script></head><body></body></html>'
  const browser = {
    fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    protocol: {
      handle: (scheme: string, handler: (request: Request) => Promise<Response>) => { handlers.set(scheme, handler) },
      unhandle: (scheme: string) => { handlers.delete(scheme) },
    },
  } as unknown as Session
  const openMenu = vi.fn()
  const origin = 'http://127.0.0.1:1234'
  const dispose = installIdeWebviews(browser, origin, undefined, enabled ? { icon: '<svg/>', openMenu } : undefined)
  try {
    const handle = handlers.get('http')!
    const body = await (await handle(new Request(origin))).text()
    expect(body.includes('/__rsh_titlebar/script.js')).toBe(enabled)
    if (enabled) {
      const rejected = await handle(new Request(`${origin}/__rsh_titlebar/menu`, { method: 'POST', headers: { origin: 'https://other.example', 'x-rsh-workbench': '1' } }))
      expect(rejected.status).toBe(403)
      expect(openMenu).not.toHaveBeenCalled()
      expect((await handle(new Request(`${origin}/__rsh_titlebar/menu`, { method: 'OPTIONS' }))).status).toBe(403)
      expect((await handle(new Request(`${origin}/__rsh_titlebar/menu`, { method: 'POST' }))).status).toBe(403)
      const accepted = await handle(new Request(`${origin}/__rsh_titlebar/menu`, { method: 'POST', headers: { 'x-rsh-workbench': '1' } }))
      expect(accepted.status).toBe(204)
      expect(openMenu).toHaveBeenCalledOnce()
      expect((await handle(new Request(`${origin}/__rsh_titlebar/style.css`))).headers.get('content-type')).toBe('text/css')
    }
  } finally { dispose() }
  expect(handlers.size).toBe(0)
})
