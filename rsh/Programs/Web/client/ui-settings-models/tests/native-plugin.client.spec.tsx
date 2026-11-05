// @vitest-environment jsdom
/**
 * Native half: once the settings host declares `settings.section`, this
 * plugin contributes the existing Models section under id `models`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import { plugin as locale } from '../../locale/src/native.ts'
import { plugin } from '../src/native.ts'

function untilAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

const session: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-session-stub',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeSession'],
  resolve: () => (context) => {
    context.provide('clientNativeSession', {
      settingsEvents: (signal: AbortSignal) => ({
        [Symbol.asyncIterator]() {
          return { next: () => untilAbort(signal).then(() => ({ done: true, value: undefined })) }
        },
      }),
    } as never)
  },
}

const settings: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-settings-stub',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeSettings'],
  resolve: () => (context) => {
    context.provide('clientNativeSettings', { schema: {} } as never)
  },
}

/** Declare `settings.section` the way the Native settings host does. */
const sectionDeclaration: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-settings-section-declaration',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    context.own(slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null))
  },
}

const started: NativeHost[] = []

type SlotProbe = {
  entries(key: string): { options: { id?: string }; inject?: () => { t?: (key: string) => string } }[]
}

function probePlugin(seen: SlotProbe[]): NativePlugin {
  return {
    apiVersion: 1,
    name: 'test-client-native-models-probe',
    targets: ['client'],
    requires: ['clientSlots'],
    provides: [],
    resolve: () => (context) => { seen.push(context.require('clientSlots') as never) },
  }
}

afterEach(async () => {
  while (started.length > 0) await started.pop()?.stop()
})

describe('models native half', () => {
  it('contributes the existing Models section once settings.section is declared', async () => {
    const seen: { entries(key: string): { options: { id?: string }; inject?: () => { t?: (key: string) => string } }[] }[] = []
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: renderer, scope, config: undefined },
      { plugin: locale, scope, config: { locale: 'en' } },
      { plugin: session, scope, config: undefined },
      { plugin: settings, scope, config: undefined },
      { plugin: sectionDeclaration, scope, config: undefined },
      { plugin: probePlugin(seen), scope, config: undefined },
      { plugin, scope, config: undefined },
    ], 'client'))
    await host.start()
    started.push(host)
    const entries = seen[0]?.entries('settings.section') ?? []
    expect(entries.map(entry => entry.options.id)).toEqual(['models'])
    expect(entries[0]?.inject?.().t?.('nav')).toBe('Models')
    await host.stop()
    started.pop()
    expect(seen[0]?.entries('settings.section') ?? []).toHaveLength(0)
  })

  it('contributes nothing while the section seat is undeclared', async () => {
    const seen: SlotProbe[] = []
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: renderer, scope, config: undefined },
      { plugin: locale, scope, config: { locale: 'en' } },
      { plugin: session, scope, config: undefined },
      { plugin: settings, scope, config: undefined },
      { plugin: probePlugin(seen), scope, config: undefined },
      { plugin, scope, config: undefined },
    ], 'client'))
    await host.start()
    started.push(host)
    expect(seen[0]?.entries('settings.section') ?? []).toHaveLength(0)
  })
})
