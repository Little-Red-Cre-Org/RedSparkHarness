/** Tests for built-site server-render validation. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failOnSsrRenderErrors } from '../Docs/website/build.ts'
import { homePageFiles, inspectSiteRender } from './verify-doc-site-render.ts'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const page = (app: string): string => `<!DOCTYPE html><html><head><title>t</title></head><body><div id="app">${app}</div></body></html>`
// Shapes VitePress 1.6 emits: a `layout: false` home renders only <Content />;
// a split Vue runtime renders the home as a bare comment and drops .vp-doc.
const healthyHome = page('<div style="position:relative;" data-v-80ed7aac><div></div></div>')
const brokenHome = page('<!---->')
const healthyDoc = page('<div class="Layout"><main><div class="vp-doc"><div><h1 id="start">快速开始</h1><p>正文</p></div></div></main></div>')
const brokenDoc = page('<div class="Layout"><!--[--><!--]--><header class="VPNav"></header><!----></div>')
const homes = ['en/index.html', 'index.html']

function site(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-render-'))
  roots.push(root)
  for (const [file, html] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), html)
  }
  return root
}

describe('inspectSiteRender', () => {
  it('rejects a directory with no built pages', () => {
    expect(() => inspectSiteRender(site({}), homes)).toThrow('no HTML files found')
  })

  it('accepts rendered homes, rendered documents, and the client-rendered 404 page', () => {
    const root = site({
      'index.html': healthyHome,
      'en/index.html': healthyHome,
      'guide/quickstart.html': healthyDoc,
      '404.html': page(''),
    })

    expect(inspectSiteRender(root, homes)).toEqual({ checked: 3, empty: [] })
  })

  it('rejects home pages whose server render is only a comment', () => {
    const root = site({ 'index.html': brokenHome, 'en/index.html': brokenHome, 'guide/quickstart.html': healthyDoc })

    expect(inspectSiteRender(root, homes).empty).toEqual([
      { file: 'en/index.html', reason: '#app has no rendered markup: "<!---->"' },
      { file: 'index.html', reason: '#app has no rendered markup: "<!---->"' },
    ])
  })

  it('rejects document pages that render the layout without content', () => {
    const root = site({ 'index.html': healthyHome, 'en/index.html': healthyHome, 'guide/quickstart.html': brokenDoc })

    expect(inspectSiteRender(root, homes).empty).toEqual([
      { file: 'guide/quickstart.html', reason: '#app renders no document content (.vp-doc is absent or empty)' },
    ])
  })

  it('rejects pages without an app container and absent home pages', () => {
    const root = site({ 'index.html': '<html><body></body></html>', 'guide/quickstart.html': healthyDoc })

    expect(inspectSiteRender(root, homes).empty).toEqual([
      { file: 'en/index.html', reason: 'home page was not emitted' },
      { file: 'index.html', reason: 'no #app container' },
    ])
  })
})

describe('homePageFiles', () => {
  it('lists the Chinese root and English locale homes', () => {
    expect(homePageFiles()).toEqual(['en/index.html', 'index.html'])
  })
})

describe('failOnSsrRenderErrors', () => {
  it('fails a build that logged a VitePress injection error and still forwards the log', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const original = console.error

    await expect(failOnSsrRenderErrors(async () => {
      console.error(new Error('vitepress data not properly injected in app'))
      console.error(new TypeError('Cannot read properties of null (reading \'ce\')'))
      return 'built'
    })).rejects.toThrow('server rendering logged 2 render error(s)')
    expect(logged).toHaveBeenCalledTimes(2)
    expect(console.error).toBe(original)
  })

  it('returns the result of a build that logged only unrelated errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(failOnSsrRenderErrors(async () => {
      console.error('unrelated warning')
      return 'built'
    })).resolves.toBe('built')
    expect(logged).toHaveBeenCalledWith('unrelated warning')
  })

  it('restores console.error when the build itself throws', async () => {
    const original = console.error

    await expect(failOnSsrRenderErrors(() => Promise.reject(new Error('bundle failed')))).rejects.toThrow('bundle failed')
    expect(console.error).toBe(original)
  })
})
