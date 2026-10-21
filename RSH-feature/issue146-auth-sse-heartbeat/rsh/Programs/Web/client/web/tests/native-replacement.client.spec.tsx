// @vitest-environment jsdom
/** Client replacement releases real React roots and slot ownership before successor mount. */
import { createElement } from 'react'
import { expect, it } from 'vitest'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import type { SlotRuntime } from '../../ui-renderer/src/slot-runtime.ts'
import { bootNativeClient, type NativeClientModuleSource } from '../src/native-boot.ts'

function modules(entries: Record<string, NativePlugin>): NativeClientModuleSource {
  return {
    manifest: { modules: Object.keys(entries).map(id => ({ id })) },
    import: async id => ({ plugin: entries[id] }),
  }
}

function application(events: string[], inspect: (slots: SlotRuntime) => void): NativePlugin {
  return {
    apiVersion: 1, name: 'test-client-application', targets: ['client'],
    requires: ['clientSlots'], provides: ['clientApplication'],
    resolve: (input) => {
      const config = input as { label: string; fail?: boolean }
      if (typeof config.label !== 'string') throw new Error('application label must be a string')
      return (context) => {
        if (config.fail) throw new Error('successor activation failed')
        const slots = context.require('clientSlots')
        inspect(slots)
        const emptySession = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
        context.own(slots.installScope('session', {
          current: { getSnapshot: () => emptySession, subscribe: () => () => {} }, resolve: () => undefined,
        }))
        context.own(slots.register({ name: 'root' }, () => createElement('main', {}, config.label)))
        context.own(() => { events.push(`disposed:${config.label}`) })
        context.provide('clientApplication', { render: () => {
          events.push(`rendered:${config.label}`)
          return slots.renderSlot('root', {})
        } })
      }
    },
  }
}

it('preserves the renderer and slots on a no-op and releases the old root before mounting changed application configuration', async () => {
  const events: string[] = []
  const slots: SlotRuntime[] = []
  const app = application(events, (value) => { slots.push(value) })
  const source = modules({ renderer, app })
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: source, selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  try {
    expect(container.textContent).toBe('first')
    await host.replace({ modules: source, selections: [
      { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
    ] })
    expect(events).toEqual(['rendered:first'])
    await host.replace({ modules: source, selections: [
      { id: 'renderer', config: {} }, { id: 'app', config: { label: 'second' } },
    ] })
    expect(container.textContent).toBe('second')
    expect(events).toEqual(['rendered:first', 'disposed:first', 'rendered:second'])
    expect(slots[1]).toBe(slots[0])
    expect(host.signal.aborted).toBe(false)
  } finally { await host.stop() }
  expect(container.childNodes).toHaveLength(0)
  expect(events.at(-1)).toBe('disposed:second')
})

it('retains the mounted UI after import, missing-provider and invalid-configuration refusal', async () => {
  const app = application([], () => undefined)
  const source = modules({ renderer, app })
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: source, selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  try {
    await expect(host.replace({ modules: { manifest: source.manifest, import: async () => { throw new Error('module import failed') } },
      selections: [{ id: 'renderer', config: {} }] })).rejects.toThrow('module import failed')
    await expect(host.replace({ modules: source, selections: [{ id: 'app', config: { label: 'second' } }] }))
      .rejects.toThrow('requires missing clientSlots')
    await expect(host.replace({ modules: source, selections: [
      { id: 'renderer', config: {} }, { id: 'app', config: { label: 42 } },
    ] })).rejects.toThrow('application label must be a string')
    expect(container.textContent).toBe('first')
    expect(host.signal.aborted).toBe(false)
  } finally { await host.stop() }
})

it('cancels a pending import on stop and awaits its settlement without late activation', async () => {
  const app = application([], () => undefined)
  const source = modules({ renderer, app })
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: source, selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<unknown>()
  let stopped = false
  const changing = host.replace({ modules: { manifest: source.manifest, import: async () => {
    entered.resolve(undefined); return release.promise
  } }, selections: [{ id: 'renderer', config: {} }] })
  const refused = expect(changing).rejects.toThrow()
  try {
    await entered.promise
    const stopping = host.stop().then(() => { stopped = true })
    expect(host.signal.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    release.resolve({ plugin: renderer })
    await refused
    await stopping
    expect(container.childNodes).toHaveLength(0)
    await expect(host.replace({ modules: source, selections: [] })).rejects.toThrow()
  } finally {
    release.resolve({ plugin: renderer })
    await host.stop()
  }
})

it('serializes competing imports and plans each successor against the last committed composition', async () => {
  const events: string[] = []
  const app = application(events, () => undefined)
  const source = modules({ renderer, app })
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: source, selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<unknown>()
  let secondImports = 0
  const firstChange = host.replace({ modules: { manifest: source.manifest, import: async (id) => {
    if (id === 'renderer') { entered.resolve(undefined); return release.promise }
    return source.import(id, '', {})
  } }, selections: [{ id: 'renderer', config: {} }, { id: 'app', config: { label: 'second' } }] })
  const secondChange = host.replace({ modules: { manifest: source.manifest, import: async (id) => {
    secondImports++; return source.import(id, '', {})
  } }, selections: [{ id: 'renderer', config: {} }, { id: 'app', config: { label: 'third' } }] })
  try {
    await entered.promise
    expect(secondImports).toBe(0)
    expect(container.textContent).toBe('first')
    release.resolve({ plugin: renderer })
    await Promise.all([firstChange, secondChange])
    expect(container.textContent).toBe('third')
    expect(events).toEqual(['rendered:first', 'disposed:first', 'rendered:second', 'disposed:second', 'rendered:third'])
  } finally {
    release.resolve({ plugin: renderer })
    await Promise.allSettled([firstChange, secondChange])
    await host.stop()
  }
})

it('replaces changed module exports under the same selection id without recreating the renderer', async () => {
  const slots: SlotRuntime[] = []
  const app = application([], (value) => { slots.push(value) })
  const successor: NativePlugin = { ...app, resolve: () => app.resolve({ label: 'changed code' }) }
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: modules({ renderer, app }), selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  try {
    await host.replace({ modules: modules({ renderer, app: successor }), selections: [
      { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
    ] })
    expect(container.textContent).toBe('changed code')
    expect(slots[1]).toBe(slots[0])
  } finally { await host.stop() }
})

it('unmounts the old UI and closes the composition when successor activation fails', async () => {
  const app = application([], () => undefined)
  const source = modules({ renderer, app })
  const container = document.createElement('div')
  const host = await bootNativeClient({ modules: source, selections: [
    { id: 'renderer', config: {} }, { id: 'app', config: { label: 'first' } },
  ], container })
  try {
    await expect(host.replace({ modules: source, selections: [
      { id: 'renderer', config: {} }, { id: 'app', config: { label: 'second', fail: true } },
    ] })).rejects.toThrow('successor activation failed')
    expect(host.signal.aborted).toBe(true)
    expect(container.childNodes).toHaveLength(0)
  } finally { await host.stop() }
})
