/**
 * Native settings entry: one document mirror, one schema operation set, and
 * scopes bound to the Native Session transport.
 *
 * The plugin is installed through the real `NativeHost`, so the declared
 * requires, the provided capability and effect cleanup are exercised rather
 * than simulated. The transports are hand-written faces; the engine under test
 * is the same one the Cordis half runs.
 */
import { describe, expect, it, vi } from 'vitest'
import z from '@redspark/schemastery'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@redspark/rsh-client-native-session/native'
import { plugin, toNamespace, type NativeSettingsService } from '../src/native.ts'

/** The wire envelope for the test namespace, as an owning plugin would publish it. */
const ENVELOPE = z.object({
  preference: z.union(['light', 'dark']).default('dark'),
}).toJSON()

/** One namespace as the Native RPC reports it. */
function descriptor(namespace: string, value: unknown, revision = 0): NativeSettingsDescriptor {
  return {
    namespace, schema: ENVELOPE, value: value as Record<string, unknown>, base: {}, user: {},
    applies: 'live', secrets: [], credentialRefs: [], revision,
  }
}

/** The Session operations this Provider drives, scripted by the test. */
interface TransportOptions {
  readonly describe?: () => Promise<{ hasDocument: boolean; namespaces: readonly NativeSettingsDescriptor[] }>
  readonly mutate?: (namespace: string, ops: readonly unknown[], revision: number) => Promise<NativeSettingsDescriptor>
}

/** A transport whose document read, write and notification stream the test owns. */
function transport(options: TransportOptions = {}) {
  const calls = { describe: 0, mutate: [] as Array<{ namespace: string; ops: readonly unknown[]; revision: number }> }
  const frames: unknown[] = []
  let wake: (() => void) | undefined
  const describe = async () => {
    calls.describe += 1
    return options.describe === undefined
      ? { hasDocument: false, namespaces: [descriptor('ui-test', { preference: 'dark' }, 3)] }
      : await options.describe()
  }
  const mutate = async (namespace: string, ops: readonly unknown[], revision: number) => {
    calls.mutate.push({ namespace, ops, revision })
    return options.mutate === undefined
      ? descriptor(namespace, { preference: 'light' }, revision + 1)
      : await options.mutate(namespace, ops, revision)
  }
  const settingsEvents = async function* (signal: AbortSignal): AsyncGenerator<unknown> {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        wake = resolve
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      if (signal.aborted) return
      while (frames.length > 0) yield frames.shift()
    }
  }
  return {
    calls,
    client: { settingsDescribe: describe, settingsMutate: mutate, settingsEvents } as unknown as NativeSessionClient,
    /** Publish one Host settings notification and let the consumer run. */
    async push(frame: unknown): Promise<void> {
      frames.push(frame)
      wake?.()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

/** Stand-in Provider for one capability, so the installed plugin can require it. */
function stubProvider<K extends keyof import('@redspark/rsh-native-runtime').NativeServices>(
  name: K,
  value: import('@redspark/rsh-native-runtime').NativeServices[K],
): NativePlugin {
  return {
    apiVersion: 1, name: `test-${String(name)}`, targets: ['client'], requires: [], provides: [name],
    resolve: () => (context) => { context.provide(name, value) },
  }
}

/** Install the settings Provider beside its two declared dependencies. */
async function mount(options: TransportOptions = {}) {
  const wire = transport(options)
  const locale = {
    register: () => () => {},
    bind: () => (key: string) => key,
    getSnapshot: () => ({ locale: 'en' as const, revision: 0 }),
    subscribe: () => () => {},
    setLocale: () => {},
  }
  let service: NativeSettingsService | undefined
  const observer: NativePlugin = {
    apiVersion: 1, name: 'test-native-settings-observer', targets: ['client'],
    requires: ['clientNativeSettings'], provides: [],
    resolve: () => (context) => { service = context.require('clientNativeSettings') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: stubProvider('clientNativeSession', wire.client), scope, config: undefined },
    { plugin: stubProvider('clientLocale', locale as never), scope, config: undefined },
    { plugin, scope, config: undefined },
    { plugin: observer, scope, config: undefined },
  ], 'client'))
  await host.start()
  return { wire, host, service: service as NativeSettingsService }
}

describe('native settings provider', () => {
  it('publishes one document mirror the scopes derive from', async () => {
    const { service, host } = await mount()
    try {
      await service.describe().ensure()
      expect(service.describe().getSnapshot()).toMatchObject({ status: 'ready', error: null })
      expect(service.describe().getSnapshot().view?.namespaces.map(row => row.ns)).toEqual(['ui-test'])
    } finally {
      await host.stop()
    }
  })

  it('derives every bound scope from the one shared document', async () => {
    const { service, host } = await mount()
    try {
      // The provider starts its own read during activation, so a scope bound
      // afterwards derives without a second document read.
      await service.describe().ensure()
      const binding = service.bind<{ preference: string }>({ namespace: 'ui-test' })
      expect(binding.scope.getSnapshot()).toMatchObject({
        status: 'ready', value: { preference: 'dark' }, revision: 3, writable: true, mode: 'host',
      })
      await binding.dispose()
    } finally {
      await host.stop()
    }
  })

  it('leaves an unserved namespace unavailable instead of inventing a section', async () => {
    const { service, host } = await mount()
    try {
      await service.describe().ensure()
      const binding = service.bind<{ preference: string }>({ namespace: 'not-served' })
      expect(binding.scope.getSnapshot()).toMatchObject({ status: 'unavailable', value: undefined })
      await binding.dispose()
    } finally {
      await host.stop()
    }
  })

  it('writes through settingsMutate against the newest known revision', async () => {
    const { service, wire, host } = await mount()
    try {
      const binding = service.bind<{ preference: string }>({ namespace: 'ui-test' })
      await service.describe().ensure()
      await binding.scope.set('preference', 'light')
      expect(wire.calls.mutate).toEqual([
        { namespace: 'ui-test', ops: [{ op: 'set', path: ['preference'], value: 'light' }], revision: 3 },
      ])
      // The accepted view folds into the mirror without another document read.
      expect(service.describe().getSnapshot().view?.namespaces[0]?.revision).toBe(4)
      await binding.dispose()
    } finally {
      await host.stop()
    }
  })

  it('re-reads the document when a write is refused', async () => {
    const { service, wire, host } = await mount({
      mutate: async () => { throw new Error('native/settings-conflict') },
    })
    try {
      const binding = service.bind<{ preference: string }>({ namespace: 'ui-test' })
      await service.describe().ensure()
      const before = wire.calls.describe
      await binding.scope.set('preference', 'light')
      expect(wire.calls.describe).toBe(before + 1)
      expect(binding.scope.getSnapshot().value).toEqual({ preference: 'dark' })
      await binding.dispose()
    } finally {
      await host.stop()
    }
  })

  it('reloads the document on a Host settings notification', async () => {
    const { service, wire, host } = await mount()
    try {
      await service.describe().ensure()
      const before = wire.calls.describe
      await wire.push({ type: 'settings/document-updated', namespace: 'ui-test', revision: 4 })
      await vi.waitFor(() => { expect(wire.calls.describe).toBe(before + 1) })
    } finally {
      await host.stop()
    }
  })

  it('rejects an unexpected configuration, because a settings Provider has none', () => {
    expect(() => plugin.resolve({ any: true })).toThrow(TypeError)
  })

  it('adapts a Host descriptor onto the shared document model', () => {
    const adapted = toNamespace(descriptor('shell', { a: 1 }, 7))
    expect(adapted).toMatchObject({ ns: 'shell', revision: 7 })
    expect(adapted.descriptor.namespace).toBe('shell')
  })
})
