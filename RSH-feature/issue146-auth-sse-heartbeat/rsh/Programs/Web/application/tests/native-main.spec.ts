// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeClientEntryProgress } from '../src/native-entry.ts'

const { bootNativeClientEntry } = vi.hoisted(() => ({ bootNativeClientEntry: vi.fn() }))

vi.mock('../src/native-entry.ts', () => ({ bootNativeClientEntry }))

describe('native Web page entry', () => {
  beforeEach(() => {
    vi.resetModules()
    bootNativeClientEntry.mockReset()
    document.body.innerHTML = '<div id="root"></div>'
    delete (globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('fails at startup when the page has no mount point', async () => {
    document.body.innerHTML = ''
    await expect(import('../src/native-main.ts')).rejects.toThrow('native web: missing #root')
    expect(bootNativeClientEntry).not.toHaveBeenCalled()
  })

  it('renders a visible failure when the Host did not inject profile data', async () => {
    await import('../src/native-main.ts')

    expect(document.querySelector('#root')?.getAttribute('data-native-boot-state')).toBe('failed')
    expect(document.querySelector('#root [role="alert"]')?.textContent)
      .toBe('Failed to load pluginsnative web: Host did not inject Client profile data')
    expect(bootNativeClientEntry).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('starts with the Host data and stops the active composition on pagehide', async () => {
    const stop = vi.fn(async () => undefined)
    const wire = { formatVersion: 1, modules: [], selections: [] }
    bootNativeClientEntry.mockResolvedValue({ stop, diagnostics: () => [] })
    ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = wire
    const container = document.querySelector<HTMLElement>('#root')

    await import('../src/native-main.ts')
    await vi.waitFor(() => { expect(container?.dataset.nativeBootState).toBe('ready') })

    expect(bootNativeClientEntry).toHaveBeenCalledWith(
      container, wire, document.baseURI, undefined, expect.any(AbortSignal), expect.anything(),
    )
    const signal = (bootNativeClientEntry.mock.calls[0] as unknown[])[4] as AbortSignal
    const progress = (bootNativeClientEntry.mock.calls[0] as unknown[])[5] as NativeClientEntryProgress
    expect(typeof progress.setTotal).toBe('function')
    expect(typeof progress.setState).toBe('function')
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => { expect(stop).toHaveBeenCalledOnce() })
    expect(signal.aborted).toBe(true)
  })

  it('keeps startup errors visible on the page', async () => {
    bootNativeClientEntry.mockRejectedValue(new Error('renderer failed'))
    ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = {}

    await import('../src/native-main.ts')
    await vi.waitFor(() => { expect(document.querySelector('#root')?.getAttribute('data-native-boot-state')).toBe('failed') })

    expect(document.querySelector('#root [role="alert"]')?.textContent).toBe('Failed to load pluginsrenderer failed')
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'renderer failed' }))
  })

  it('renders non-Error startup reasons as text', async () => {
    const reason: unknown = 'profile unavailable'
    bootNativeClientEntry.mockImplementation(async () => { throw reason })
    ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = {}

    await import('../src/native-main.ts')
    await vi.waitFor(() => { expect(document.querySelector('#root')?.getAttribute('data-native-boot-state')).toBe('failed') })

    expect(document.querySelector('#root [role="alert"]')?.textContent).toBe('Failed to load pluginsprofile unavailable')
    expect(console.error).toHaveBeenCalledWith('profile unavailable')
  })

  it('does not render a page failure after pagehide cancels pending startup', async () => {
    ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = {}
    let signal: AbortSignal | undefined
    bootNativeClientEntry.mockImplementation((_container, _wire, _base, _importer, lifetime: AbortSignal) => {
      signal = lifetime
      return new Promise((_resolve, reject) => {
        lifetime.addEventListener('abort', () => { reject(new Error('native web: page is unloading')) }, { once: true })
      })
    })

    await import('../src/native-main.ts')
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => { expect(signal?.aborted).toBe(true) })
    await Promise.resolve()

    expect(document.querySelector('#root')?.hasAttribute('data-native-boot-state')).toBe(false)
    expect(document.querySelector('#root [role="alert"]')).toBeNull()
  })

  it('reports an asynchronous Host cleanup failure', async () => {
    const cleanupError = new Error('cleanup failed')
    const stop = vi.fn(async () => { throw cleanupError })
    bootNativeClientEntry.mockResolvedValue({ stop, diagnostics: () => [] })
    ;(globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__ = {}

    await import('../src/native-main.ts')
    await vi.waitFor(() => { expect(document.querySelector('#root')?.getAttribute('data-native-boot-state')).toBe('ready') })
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => { expect(console.error).toHaveBeenCalledWith('native web: host cleanup failed', cleanupError) })
  })
})
