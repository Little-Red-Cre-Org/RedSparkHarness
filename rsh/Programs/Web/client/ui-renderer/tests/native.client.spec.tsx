// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as renderer } from '../src/native.ts'
import type { SlotRuntime } from '../src/slot-runtime.ts'

let activeSlots: SlotRuntime | undefined
let injectedStarts = 0
let injectedStops = 0

const application: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-application',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: ['clientApplication'],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    activeSlots = slots
    context.own(slots.inject('root', () => {
      injectedStarts += 1
      return () => { injectedStops += 1 }
    }))
    const emptySession = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
    context.own(slots.installScope('session', {
      current: { getSnapshot: () => emptySession, subscribe: () => () => {} },
      resolve: () => undefined,
    }))
    const disposeRoot = slots.register({ name: 'root' }, () =>
      createElement('main', { 'data-native-app': '' }, 'native React application'))
    context.own(disposeRoot)
    context.provide('clientApplication', {
      render: () => slots.renderSlot('root', {}),
    })
  },
}

function mount(container: HTMLElement): NativePlugin {
  return {
    apiVersion: 1,
    name: 'test-client-mount',
    targets: ['client'],
    requires: ['clientApplication', 'clientRenderer'],
    provides: [],
    resolve: () => (context) => {
      const unmount = context.require('clientRenderer').mount(
        container,
        context.require('clientApplication'),
        context.signal,
      )
      context.own(() => { unmount(); unmount() })
    },
  }
}

afterEach(() => {
  activeSlots = undefined
  injectedStarts = 0
  injectedStops = 0
  document.body.replaceChildren()
})

describe('native Client React renderer', () => {
  it('mounts the selected application and releases its React root when the host stops', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: application, scope, config: undefined },
      { plugin: renderer, scope, config: undefined },
      { plugin: mount(container), scope, config: undefined },
    ], 'client'))

    await host.start()
    expect(container.querySelector('[data-native-app]')?.textContent).toBe('native React application')
    expect(activeSlots?.entries('root')).toHaveLength(1)
    expect(injectedStarts).toBe(1)

    await host.stop()
    expect(container.childElementCount).toBe(0)
    expect(activeSlots?.entries('root')).toHaveLength(0)
    expect(injectedStops).toBe(1)
    await host.stop()
  })

  it('releases a failed React root so a later composition can mount in the same container', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const failingApplication: NativePlugin = {
      apiVersion: 1,
      name: 'test-failing-application',
      targets: ['client'],
      requires: [],
      provides: ['clientApplication'],
      resolve: () => (context) => {
        context.provide('clientApplication', { render: () => { throw new Error('native render failed') } })
      },
    }
    const failedScope = new NativeScope()
    const failed = new NativeHost(resolveInstallation([
      { plugin: failingApplication, scope: failedScope, config: undefined },
      { plugin: renderer, scope: failedScope, config: undefined },
      { plugin: mount(container), scope: failedScope, config: undefined },
    ], 'client'))
    const errors: string[] = []
    const report = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      errors.push(values.map(String).join(' '))
    })
    let recovery: NativeHost | undefined
    try {
      await expect(failed.start()).rejects.toThrow('native render failed')
      await expect(failed.stop()).rejects.toThrow('native render failed')
      expect(container.childElementCount).toBe(0)

      const recoveryScope = new NativeScope()
      recovery = new NativeHost(resolveInstallation([
        { plugin: application, scope: recoveryScope, config: undefined },
        { plugin: renderer, scope: recoveryScope, config: undefined },
        { plugin: mount(container), scope: recoveryScope, config: undefined },
      ], 'client'))
      await recovery.start()
      expect(container.querySelector('[data-native-app]')?.textContent).toBe('native React application')
      expect(errors.join('\n')).not.toMatch(/already been passed to createRoot/u)
    } finally {
      await recovery?.stop()
      report.mockRestore()
    }
  })

})
