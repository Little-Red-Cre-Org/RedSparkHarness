// @vitest-environment jsdom
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootNativeClientEntry } from '../src/native-entry.ts'

const MODULE_URL = '/.dsh/native-client/profile.js'
const invalidInputs: readonly { label: string; value: unknown; message: string; baseUrl?: string }[] = [
  { label: 'null', value: null, message: 'injected boot data must be an object' },
  { label: 'array', value: [], message: 'injected boot data must be an object' },
  { label: 'primitive', value: 'wire', message: 'injected boot data must be an object' },
  { label: 'unknown root field', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [], fallback: true }, message: 'injected boot data has unknown fields' },
  { label: 'unsupported format', value: { formatVersion: 2, bundle: MODULE_URL, styles: [], modules: [], selections: [] }, message: 'unsupported injected boot format' },
  { label: 'missing bundle', value: { formatVersion: 1, styles: [], modules: [], selections: [] }, message: 'bundle must be a nonempty string' },
  { label: 'invalid stylesheet type', value: { formatVersion: 1, bundle: MODULE_URL, styles: [null], modules: [], selections: [] }, message: 'stylesheet must be a nonempty string' },
  { label: 'empty stylesheet', value: { formatVersion: 1, bundle: MODULE_URL, styles: [''], modules: [], selections: [] }, message: 'stylesheet must be a nonempty string' },
  { label: 'malformed bundle URL', value: { formatVersion: 1, bundle: 'http://[', styles: [], modules: [], selections: [] }, message: 'invalid URL for bundle' },
  { label: 'malformed base URL', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [] }, baseUrl: 'not a URL', message: 'invalid base URL for bundle' },
  { label: 'foreign origin', value: { formatVersion: 1, bundle: 'https://elsewhere.example/.dsh/native-client/profile.js', styles: [], modules: [], selections: [] }, message: 'bundle is outside the native module route' },
  { label: 'foreign route', value: { formatVersion: 1, bundle: '/plugins/profile.js', styles: [], modules: [], selections: [] }, message: 'bundle is outside the native module route' },
  { label: 'bundle username', value: { formatVersion: 1, bundle: 'https://user@dsh.example/.dsh/native-client/profile.js', styles: [], modules: [], selections: [] }, message: 'bundle is outside the native module route' },
  { label: 'bundle password', value: { formatVersion: 1, bundle: 'https://user:secret@dsh.example/.dsh/native-client/profile.js', styles: [], modules: [], selections: [] }, message: 'bundle is outside the native module route' },
  { label: 'bundle fragment', value: { formatVersion: 1, bundle: '/.dsh/native-client/profile.js#fragment', styles: [], modules: [], selections: [] }, message: 'bundle is outside the native module route' },
  { label: 'missing style array', value: { formatVersion: 1, bundle: MODULE_URL, modules: [], selections: [] }, message: 'styles, modules, and selections must be arrays' },
  { label: 'foreign stylesheet', value: { formatVersion: 1, bundle: MODULE_URL, styles: ['https://elsewhere.example/style.css'], modules: [], selections: [] }, message: 'stylesheet is outside the native module route' },
  { label: 'duplicate stylesheets', value: { formatVersion: 1, bundle: MODULE_URL, styles: ['/.dsh/native-client/style.css', '/.dsh/native-client/style.css'], modules: [], selections: [] }, message: 'stylesheets must be unique' },
  { label: 'null module row', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [null], selections: [] }, message: 'module row must be an object' },
  { label: 'unknown module field', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [{ id: 'renderer', url: MODULE_URL }], selections: [] }, message: 'module row has unknown fields' },
  { label: 'empty module id', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [{ id: '' }], selections: [] }, message: 'module row requires a nonempty id' },
  { label: 'duplicate module ids', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [{ id: 'renderer' }, { id: 'renderer' }], selections: [] }, message: 'module ids must be unique' },
  { label: 'null selection row', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [null] }, message: 'selection row must be an object' },
  { label: 'unknown selection field', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [{ id: 'renderer', extra: true }] }, message: 'selection row has unknown fields' },
  { label: 'empty selection id', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [{ id: '' }] }, message: 'selection row requires a nonempty id' },
  { label: 'duplicate selection ids', value: { formatVersion: 1, bundle: MODULE_URL, styles: [], modules: [], selections: [{ id: 'renderer' }, { id: 'renderer' }] }, message: 'selection ids must be unique' },
]

function bootWire(styles: readonly string[] = []): unknown {
  return {
    formatVersion: 1,
    bundle: MODULE_URL,
    styles,
    modules: [{ id: 'renderer' }],
    selections: [{ id: 'renderer', config: {} }],
  }
}

function clientRenderer(unmount: () => void): NativePlugin {
  return {
    apiVersion: 1,
    name: 'renderer',
    targets: ['client'],
    requires: [],
    provides: ['clientRenderer'],
    resolve: () => (context) => {
      context.provide('clientRenderer', {
        mount: (root: HTMLElement) => {
          root.textContent = 'native-ui'
          return unmount
        },
      })
    },
  }
}

afterEach(() => { document.head.replaceChildren() })

describe('native Web entry', () => {
  it('loads the Host bundle and awaits renderer and stylesheet cleanup', async () => {
    const container = document.createElement('div')
    const unmount = vi.fn(() => { container.replaceChildren() })
    const importModule = vi.fn(async (url: string) => {
      expect(url).toBe(`https://dsh.example${MODULE_URL}`)
      return { plugins: { renderer: { plugin: clientRenderer(unmount) } } }
    })
    const starting = bootNativeClientEntry(container, bootWire(['/.dsh/native-client/theme.css?v=1']), 'https://dsh.example/', importModule)
    expect(importModule).not.toHaveBeenCalled()
    const link = document.head.querySelector('link[rel="stylesheet"]')
    expect(link?.getAttribute('href')).toBe('https://dsh.example/.dsh/native-client/theme.css?v=1')
    link?.dispatchEvent(new Event('load'))
    const host = await starting

    expect(container.textContent).toBe('native-ui')
    expect(importModule).toHaveBeenCalledOnce()
    await host.stop()
    expect(unmount).toHaveBeenCalledOnce()
    expect(container.textContent).toBe('')
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull()
  })

  it('removes style links when a stylesheet fails to load', async () => {
    const starting = bootNativeClientEntry(document.createElement('div'), bootWire(['/.dsh/native-client/theme.css']),
      'https://dsh.example/', vi.fn(async () => ({})))
    const link = document.head.querySelector('link[rel="stylesheet"]')
    link?.dispatchEvent(new Event('error'))
    await expect(starting).rejects.toThrow('stylesheet failed to load')
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull()
  })

  it('cancels a pending stylesheet wait on page unload', async () => {
    const lifetime = new AbortController()
    const starting = bootNativeClientEntry(document.createElement('div'), bootWire(['/.dsh/native-client/theme.css']),
      'https://dsh.example/', vi.fn(async () => ({})), lifetime.signal)
    lifetime.abort(new Error('pagehide'))
    await expect(starting).rejects.toThrow('pagehide')
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull()
  })

  it('normalizes a non-Error cancellation reason while waiting for styles', async () => {
    const lifetime = new AbortController()
    const starting = bootNativeClientEntry(document.createElement('div'), bootWire(['/.dsh/native-client/theme.css']),
      'https://dsh.example/', vi.fn(async () => ({})), lifetime.signal)
    lifetime.abort('pagehide')

    await expect(starting).rejects.toThrow('pagehide')
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull()
  })

  it('does not activate a module whose bundle import completes after page unload', async () => {
    const lifetime = new AbortController()
    let resolveImport!: (value: unknown) => void
    let activated = false
    const plugin: NativePlugin = {
      apiVersion: 1,
      name: 'renderer',
      targets: ['client'],
      requires: [],
      provides: ['clientRenderer'],
      resolve: () => (context) => {
        activated = true
        context.provide('clientRenderer', { mount: () => undefined })
      },
    }
    const importModule = vi.fn(() => new Promise<unknown>((resolve) => { resolveImport = resolve }))
    const starting = bootNativeClientEntry(document.createElement('div'), bootWire(),
      'https://dsh.example/', importModule, lifetime.signal)

    expect(importModule).toHaveBeenCalledOnce()
    lifetime.abort(new Error('pagehide'))
    resolveImport({ plugins: { renderer: { plugin } } })

    await expect(starting).rejects.toThrow('pagehide')
    expect(activated).toBe(false)
  })

  it('rejects module URLs outside the Host native-client route before importing', async () => {
    const importModule = vi.fn(async () => ({}))
    await expect(bootNativeClientEntry(document.createElement('div'), {
      ...(bootWire() as Record<string, unknown>),
      bundle: 'https://attacker.example/renderer.js',
    }, 'https://dsh.example/', importModule)).rejects.toThrow(
      'native web: bundle is outside the native module route',
    )
    expect(importModule).not.toHaveBeenCalled()
  })

  it('rejects bundles that do not publish a plugin table', async () => {
    const importModule = vi.fn(async () => ({ plugin: {} }))
    await expect(bootNativeClientEntry(document.createElement('div'), bootWire(),
      'https://dsh.example/', importModule)).rejects.toThrow(
      'native web: Host module bundle must export a plugin table',
    )
  })

  it('rejects Host bundles that omit a selected module', async () => {
    const importModule = vi.fn(async () => ({ plugins: {} }))
    await expect(bootNativeClientEntry(document.createElement('div'), bootWire(),
      'https://dsh.example/', importModule)).rejects.toThrow(
      'native web: Host bundle omitted module renderer',
    )
  })

  it('rejects unknown Host boot fields before loading plugins', async () => {
    const importModule = vi.fn(async () => ({}))
    await expect(bootNativeClientEntry(document.createElement('div'), {
      ...(bootWire() as Record<string, unknown>),
      compatibilityFallback: true,
    }, 'https://dsh.example/', importModule)).rejects.toThrow(
      'native web: injected boot data has unknown fields',
    )
    expect(importModule).not.toHaveBeenCalled()
  })

  it.each(invalidInputs)('rejects $label before loading plugins', async ({ value, message, baseUrl }) => {
    const importModule = vi.fn(async () => ({}))
    await expect(bootNativeClientEntry(
      document.createElement('div'), value, baseUrl ?? 'https://dsh.example/', importModule,
    )).rejects.toThrow(`native web: ${message}`)
    expect(importModule).not.toHaveBeenCalled()
  })
})
