/** The built native page loads only Host-routed Client modules and drains them on pagehide. */
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const PLUGIN_SOURCE = `export const plugins = { renderer: { plugin: {
  apiVersion: 1,
  name: 'renderer',
  targets: ['client'],
  requires: [],
  provides: ['clientRenderer'],
  resolve: () => (context) => context.provide('clientRenderer', {
    mount: (container) => {
      container.textContent = 'native-client-ready'
      return () => { container.dataset.unmounted = 'true' }
    },
  }),
} } }
`
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

let browser: Browser

beforeAll(async () => { browser = await chromium.launch() }, 30_000)
afterAll(async () => { await browser?.close() })

async function routeBuiltApplication(page: Page, boot?: unknown): Promise<void> {
  if (boot !== undefined) {
    await page.addInitScript((wire) => {
      ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = wire
    }, boot)
  }
  await page.route('https://dsh.example/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/.dsh/native-client/renderer.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: PLUGIN_SOURCE })
      return
    }
    const target = resolve(DIST_ROOT, `.${decodeURIComponent(url.pathname)}`)
    if (target !== DIST_ROOT && !target.startsWith(`${DIST_ROOT}${sep}`)) {
      await route.fulfill({ status: 403 })
      return
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
        body: await readFile(target),
      })
    } catch {
      await route.fulfill({ status: 404 })
    }
  })
}

it('boots a Cordis-free native page from Host-routed modules and awaits pagehide cleanup', async () => {
  const page = await browser.newPage()
  const requests: string[] = []
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname) })
  await routeBuiltApplication(page, {
    formatVersion: 1,
    bundle: '/.dsh/native-client/renderer.js',
    styles: [],
    modules: [{ id: 'renderer' }],
    selections: [{ id: 'renderer', config: {} }],
  })

  try {
    await page.goto('https://dsh.example/native.html')
    await page.waitForFunction(() => document.querySelector('#root')?.textContent === 'native-client-ready')
    expect(await page.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    expect(requests.some(path => /cordis|loader/iu.test(path))).toBe(false)

    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')) })
    await page.waitForFunction(() => document.querySelector('#root')?.getAttribute('data-unmounted') === 'true')
  } finally {
    await page.close()
  }
})

it('shows a visible error when Host profile data is absent', async () => {
  const page = await browser.newPage()
  const requests: string[] = []
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname) })
  await routeBuiltApplication(page)

  try {
    await page.goto('https://dsh.example/native.html')
    await page.waitForFunction(() => document.querySelector('#root')?.getAttribute('data-native-boot-state') === 'failed')
    expect(await page.getByRole('alert').textContent()).toBe('native web: Host did not inject Client profile data')
    expect(requests.some(path => path.startsWith('/.dsh/native-client/'))).toBe(false)
  } finally {
    await page.close()
  }
})
