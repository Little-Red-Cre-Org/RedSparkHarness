import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeClientBundle } from '../src/native-client.ts'
import { createDesktopAssetHandler } from '../src/web-assets.ts'

const roots: string[] = []

async function desktopFixture(): Promise<{ runtime: string; dist: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-assets-'))
  roots.push(root)
  const runtime = join(root, 'runtime')
  const packageRoot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-web-frontend')
  const dist = join(packageRoot, 'dist')
  await mkdir(dist, { recursive: true })
  await writeFile(join(runtime, 'package.json'), '{}')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-web-frontend',
    exports: { './dist/*': './dist/*' },
  }))
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  await writeFile(join(dist, 'native.html'), '<!doctype html><html><head></head><body><div id="root"></div></body></html>')
  await writeFile(join(dist, 'favicon.svg'), '<svg></svg>')
  await writeFile(join(dist, 'notes.txt'), 'desktop asset')
  return { runtime, dist }
}

function nativeBundle(): NativeClientBundle {
  return {
    wire: {
      formatVersion: 1,
      bundle: '/.dsh/native-client/profile.js',
      styles: [],
      modules: [{ id: 'renderer' }],
      selections: [{ id: 'renderer', config: { theme: 'violet' } }],
    },
    assets: new Map([
      ['/.dsh/native-client/profile.js', { contentType: 'text/javascript; charset=utf-8', body: new TextEncoder().encode('export const plugins = {}') }],
      ['/.dsh/native-client/theme.css', { contentType: 'text/css; charset=utf-8', body: new TextEncoder().encode('.root { color: purple; }') }],
    ]),
  }
}

function context(): { value: Context; emit: ReturnType<typeof vi.fn>; fetchBundle: ReturnType<typeof vi.fn> } {
  const emit = vi.fn()
  const fetchBundle = vi.fn(async (request: Request) => new Response(new URL(request.url).pathname))
  return {
    value: { emit, clientModules: { fetchBundle } } as unknown as Context,
    emit,
    fetchBundle,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop Web asset routes', () => {
  it('keeps the legacy page, delegates plugin bundles, and hides the native page without a profile', async () => {
    const { runtime } = await desktopFixture()
    const host = context()
    const handler = createDesktopAssetHandler(host.value, runtime, undefined)

    expect(handler.requestBodyMode({ method: 'GET', url: new URL('https://dsh.example/') })).toBe('buffered')
    expect((await handler.fetch(new Request('https://dsh.example/', { method: 'POST' }))).status).toBe(405)
    expect((await handler.fetch(new Request('https://dsh.example/native.html'))).status).toBe(404)
    const page = await handler.fetch(new Request('https://dsh.example/'))
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('globalThis.__DSH_TRANSPORT__')
    expect(host.emit).toHaveBeenCalledOnce()

    const pluginRequest = new Request('https://dsh.example/plugins/renderer.js')
    expect(await (await handler.fetch(pluginRequest)).text()).toBe('/plugins/renderer.js')
    expect(host.fetchBundle).toHaveBeenCalledWith(pluginRequest)
  })

  it('injects native profile data and serves Host-built JavaScript and styles', async () => {
    const { runtime } = await desktopFixture()
    const host = context()
    const bundle = nativeBundle()
    const handler = createDesktopAssetHandler(host.value, runtime, bundle)

    const page = await handler.fetch(new Request('https://dsh.example/native.html'))
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain('__DSH_NATIVE_CLIENT_BOOT__')
    expect(html).toContain('profile.js')

    const script = await handler.fetch(new Request(`https://dsh.example${bundle.wire.bundle}`))
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toContain('export const plugins')
    const stylePath = '/.dsh/native-client/theme.css'
    const head = await handler.fetch(new Request(`https://dsh.example${stylePath}`, { method: 'HEAD' }))
    expect(head.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await head.text()).toBe('')
    expect((await handler.fetch(new Request('https://dsh.example/.dsh/native-client/unknown.js'))).status).toBe(404)
  })

  it('serves frontend files safely and falls back to the legacy page for missing paths', async () => {
    const { runtime, dist } = await desktopFixture()
    const host = context()
    const handler = createDesktopAssetHandler(host.value, runtime, undefined)

    const favicon = await handler.fetch(new Request('https://dsh.example/favicon.svg'))
    expect(favicon.headers.get('content-type')).toBe('image/svg+xml')
    expect(await favicon.text()).toBe('<svg></svg>')
    const head = await handler.fetch(new Request('https://dsh.example/favicon.svg', { method: 'HEAD' }))
    expect(await head.text()).toBe('')
    const unknownMime = await handler.fetch(new Request('https://dsh.example/notes.txt'))
    expect(unknownMime.headers.get('content-type')).toBe('application/octet-stream')
    const missing = await handler.fetch(new Request('https://dsh.example/missing-route'))
    expect(missing.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect((await handler.fetch(new Request('https://dsh.example/%ZZ'))).status).toBe(400)
    expect((await handler.fetch(new Request('https://dsh.example/%2e%2e%2fsecret'))).status).toBe(403)

    const outside = join(runtime, 'private-assets')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'private')
    await symlink(outside, join(dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await handler.fetch(new Request('https://dsh.example/linked/secret.txt'))).status).toBe(403)
  })
})
