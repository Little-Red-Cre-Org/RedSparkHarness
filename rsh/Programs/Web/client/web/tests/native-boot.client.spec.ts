// @vitest-environment jsdom
import { ClientModuleSystem, parseBootManifest, type ClientModuleLoaderTarget, type WebBootGraph } from '@deepseek-ai/dsh-client-modules/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { describe, expect, it } from 'vitest'
import { bootNativeClient } from '../src/native-boot.ts'
import type {} from '../src/native-services.d.ts'

function modulesOf(entries: Record<string, unknown>): ClientModuleSystem {
  const ids = Object.keys(entries)
  const graph: WebBootGraph = {
    rev: 'native-test',
    entries: ids.map(id => ({ id, url: `/${id}.js?rev=1`, rev: '1' })),
    batches: [{ phase: 'application', url: '/all.js?rev=1', rev: '1', entries: ids }],
  }
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: [],
    load: () => { throw new Error('unexpected bundle registration') },
    create: () => { throw new Error('unexpected second boot') },
  }
  return new ClientModuleSystem({
    manifest: parseBootManifest(graph), staticModules: entries,
    bootstrapModule: { id: 'bootstrap', exports: {} }, registrationTarget: target,
    loadBundle: async () => { throw new Error('unexpected bundle request') },
  })
}

describe('native browser composition', () => {
  it('mounts through a native renderer service and awaits unmount on stop', async () => {
    const events: string[] = []
    const renderer: NativePlugin = {
      apiVersion: 1, name: 'renderer', targets: ['client'], requires: [], provides: ['clientRenderer'],
      resolve: () => (context) => {
        events.push('activate')
        context.provide('clientRenderer', {
          mount: (container: HTMLElement, signal: AbortSignal) => {
            expect(container.id).toBe('app')
            expect(signal.aborted).toBe(false)
            events.push('mount')
            return () => { events.push('unmount') }
          },
        })
        context.own(() => { events.push('dispose') })
      },
    }
    const modules = modulesOf({ renderer: { plugin: renderer } })
    const container = document.createElement('div')
    container.id = 'app'
    const host = await bootNativeClient({ modules, selections: [{ id: 'renderer', config: {} }], container })
    expect(host.diagnostics().map(item => item.state)).toEqual(['ready', 'ready'])
    expect(events).toEqual(['activate', 'mount'])
    await host.stop()
    expect(events).toEqual(['activate', 'mount', 'unmount', 'dispose'])
  })

  it('rejects missing graph rows and missing native plugin exports', async () => {
    const modules = modulesOf({ legacy: { apply: () => {} } })
    const container = document.createElement('div')
    await expect(bootNativeClient({ modules, selections: [{ id: 'absent', config: {} }], container }))
      .rejects.toThrow('absent is absent from the boot graph')
    await expect(bootNativeClient({ modules, selections: [{ id: 'legacy', config: {} }], container }))
      .rejects.toThrow('legacy has no native plugin export')
  })

  it('rejects malformed browser plugin exports before installation', async () => {
    const modules = modulesOf({ broken: { plugin: { apiVersion: 1, name: 'broken', targets: ['client'] } } })
    await expect(bootNativeClient({
      modules, selections: [{ id: 'broken', config: {} }], container: document.createElement('div'),
    })).rejects.toThrow('broken exports an invalid client plugin')
  })

  it('rejects a composition without a renderer before activating any plugin', async () => {
    let activated = false
    const plugin: NativePlugin = {
      apiVersion: 1, name: 'unrelated', targets: ['client'], requires: [], provides: [],
      resolve: () => () => { activated = true },
    }
    await expect(bootNativeClient({
      modules: modulesOf({ unrelated: { plugin } }),
      selections: [{ id: 'unrelated', config: {} }], container: document.createElement('div'),
    })).rejects.toThrow('native-client-mount requires missing clientRenderer')
    expect(activated).toBe(false)
  })
})
