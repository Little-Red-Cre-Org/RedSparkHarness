/**
 * Native command entry: one session-keyed catalog, the contribution registry,
 * and the localized menu rows the existing palette renders.
 *
 * The provider is installed through the real `NativeHost`, so its declared
 * requires and provided capability are exercised. The Host command face is a
 * hand-written stand-in; the catalog cache under test is the same one the
 * Cordis half runs.
 */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { CommandDescriptor } from '@redspark/rsh-commands/facts'
import type { SessionId } from '@redspark/rsh-session/types'
import { plugin, type NativeCommandCatalogFace, type NativeCommandService } from '../src/native.ts'

const session = 'session-a' as SessionId

/** Catalog rows a Host advertises, in its own order. */
const CATALOG: readonly CommandDescriptor[] = [
  { definitionId: '@redspark/rsh-command-goal', name: 'goal', description: 'Set a goal' },
  { definitionId: '@redspark/rsh-command-compact', name: 'compact', description: 'Compact history' },
  { name: 'deploy', description: 'Deploy the workspace', input: { hint: 'target' } },
]

/** A Host command face that counts its calls and can fail on demand. */
function catalogFace(rows: readonly CommandDescriptor[] = CATALOG) {
  const calls = { commands: 0, executed: [] as string[] }
  let failure: Error | undefined
  const face: NativeCommandCatalogFace & {
    settingsEvents(signal: AbortSignal): AsyncIterable<unknown>
  } = {
    commands: async () => {
      calls.commands += 1
      if (failure !== undefined) throw failure
      return rows
    },
    executeCommand: async (_sessionId, line) => {
      calls.executed.push(line)
      return { commandId: 'c1', result: { kind: 'success' } }
    },
    async *settingsEvents(signal: AbortSignal) {
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        if (signal.aborted) return
        while (frames.length > 0) yield frames.shift()
      }
    },
  }
  const frames: unknown[] = []
  let wake: (() => void) | undefined
  return {
    face,
    calls,
    fail(error: Error | undefined): void { failure = error },
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

/** Install the commands Provider beside its two declared dependencies. */
async function mount(rows?: readonly CommandDescriptor[]) {
  const wire = catalogFace(rows)
  let service: NativeCommandService | undefined
  const observer: NativePlugin = {
    apiVersion: 1, name: 'test-native-commands-observer', targets: ['client'],
    requires: ['clientNativeCommands'], provides: [],
    resolve: () => (context) => { service = context.require('clientNativeCommands') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: stubProvider('clientNativeSession', wire.face as never), scope, config: undefined },
    { plugin: stubProvider('clientLocale', {
      register: () => () => {},
      bind: () => (key: string) => key,
      getSnapshot: () => ({ locale: 'en' as const, revision: 0 }),
      subscribe: () => () => {},
      setLocale: () => {},
    } as never), scope, config: undefined },
    { plugin, scope, config: undefined },
    { plugin: observer, scope, config: undefined },
  ], 'client'))
  await host.start()
  return { wire, host, service: service as NativeCommandService }
}

describe('native command provider', () => {
  it('fetches one Session catalog once and serves it from the cache', async () => {
    const { service, wire, host } = await mount()
    try {
      await service.rows(session, 'comp', 'leading')
      await service.rows(session, 'goal', 'leading')
      expect(wire.calls.commands).toBe(1)
    } finally {
      await host.stop()
    }
  })

  it('filters by name and by the localized built-in label', async () => {
    const { service, host } = await mount()
    try {
      // The translator is the identity stub, so the built-in label IS its key.
      expect((await service.rows(session, 'comp', 'leading')).map(row => row.name)).toEqual(['compact'])
      expect((await service.rows(session, 'label.goal', 'leading')).map(row => row.name)).toEqual(['goal'])
      expect(await service.rows(session, 'nothing-here', 'leading')).toEqual([])
    } finally {
      await host.stop()
    }
  })

  it('offers an argument-taking row for a leading token but not inside the draft', async () => {
    const { service, host } = await mount()
    try {
      // A leading token is the whole draft, so its arguments still fit; an
      // inline token has already committed the surrounding text.
      expect((await service.rows(session, '', 'leading')).map(row => row.name)).toContain('deploy')
      expect((await service.rows(session, '', 'inline')).map(row => row.name)).not.toContain('deploy')
    } finally {
      await host.stop()
    }
  })

  it('sections an empty-query menu and leaves a typed query flat', async () => {
    const { service, host } = await mount()
    try {
      const sectioned = await service.rows(session, '', 'leading')
      expect(sectioned.some(row => row.section !== undefined)).toBe(true)
      const typed = await service.rows(session, 'o', 'leading')
      expect(typed.every(row => row.section === undefined)).toBe(true)
    } finally {
      await host.stop()
    }
  })

  it('marks built-in definitions so a surface knows which copy this package owns', async () => {
    const { service, host } = await mount()
    try {
      const rows = await service.rows(session, '', 'leading')
      expect(rows.find(row => row.name === 'goal')?.builtin).toBe(true)
      expect(rows.find(row => row.name === 'deploy')?.builtin).toBe(false)
      expect(rows.find(row => row.name === 'deploy')?.hint).toBe('target')
    } finally {
      await host.stop()
    }
  })

  it('submits the slashed line the Host executes and reports it', async () => {
    const { service, wire, host } = await mount()
    try {
      expect(await service.pick(session, 'compact')).toEqual({ kind: 'executed' })
      expect(wire.calls.executed).toEqual(['/compact'])
    } finally {
      await host.stop()
    }
  })

  it('runs a registered action contribution instead of the catalog', async () => {
    const { service, wire, host } = await mount()
    try {
      const runs: SessionId[] = []
      const dispose = service.register({
        name: 'theme',
        available: () => true,
        ui: { kind: 'action', run: (sessionId) => { runs.push(sessionId) } },
      })
      expect(await service.pick(session, 'theme')).toEqual({ kind: 'action' })
      expect(runs).toEqual([session])
      expect(wire.calls.executed).toEqual([])
      dispose()
      // Withdrawn contributions fall through to the catalog, which has no such row.
      expect(await service.pick(session, 'theme')).toEqual({ kind: 'unknown' })
    } finally {
      await host.stop()
    }
  })

  it('refuses a popupSelect contribution rather than pretending the pick settled', async () => {
    const { service, host } = await mount()
    try {
      service.register({
        name: 'choose',
        available: () => true,
        ui: { kind: 'popupSelect', options: async () => [], onSelect: () => {} },
      })
      const outcome = await service.pick(session, 'choose')
      expect(outcome.kind).toBe('unsupported')
    } finally {
      await host.stop()
    }
  })

  it('skips a contribution whose availability predicate says no', async () => {
    const { service, wire, host } = await mount()
    try {
      service.register({ name: 'compact', available: () => false, ui: { kind: 'action', run: () => {} } })
      // The unavailable contribution does not shadow the Host row of that name.
      expect(await service.pick(session, 'compact')).toEqual({ kind: 'executed' })
      expect(wire.calls.executed).toEqual(['/compact'])
    } finally {
      await host.stop()
    }
  })

  it('rejects a duplicate contribution and a duplicate decoration', async () => {
    const { service, host } = await mount()
    try {
      const dispose = service.register({ name: 'theme', available: () => true, ui: { kind: 'action', run: () => {} } })
      expect(() => service.register({ name: 'theme', available: () => true, ui: { kind: 'action', run: () => {} } }))
        .toThrow('duplicate contribution')
      dispose()
      const undecorate = service.decorate({ name: 'goal', available: () => true, ui: { kind: 'action', run: () => {} } })
      expect(() => service.decorate({ name: 'goal', available: () => true, ui: { kind: 'action', run: () => {} } }))
        .toThrow('duplicate decoration')
      undecorate()
    } finally {
      await host.stop()
    }
  })

  it('reports an unknown name and a failed catalog read without inventing rows', async () => {
    const { service, wire, host } = await mount()
    try {
      expect(await service.pick(session, 'does-not-exist')).toEqual({ kind: 'unknown' })
      // A Session whose first read fails must reject rather than serve nothing:
      // enter adjudication and the palette both depend on knowing the catalog
      // was never reached. A key that already holds a snapshot keeps serving
      // it, which is the soft-invalidation rule the cache documents.
      wire.fail(new Error('host gone'))
      await expect(service.rows('session-cold' as SessionId, '', 'leading'))
        .rejects.toThrow('command directory warmup failed')
    } finally {
      await host.stop()
    }
  })

  it('drops a Session catalog when the Host reports a preset change', async () => {
    const { service, wire, host } = await mount()
    try {
      await service.rows(session, 'comp', 'leading')
      expect(wire.calls.commands).toBe(1)
      await wire.push({ type: 'agent-presets/updated' })
      await service.rows(session, 'comp', 'leading')
      expect(wire.calls.commands).toBe(2)
    } finally {
      await host.stop()
    }
  })

  it('ignores other settings notifications', async () => {
    const { service, wire, host } = await mount()
    try {
      await service.rows(session, 'comp', 'leading')
      await wire.push({ type: 'settings/document-updated', namespace: 'ui-test', revision: 1 })
      await service.rows(session, 'comp', 'leading')
      expect(wire.calls.commands).toBe(1)
    } finally {
      await host.stop()
    }
  })

  it('rejects configuration, because a command Provider has none', () => {
    expect(() => plugin.resolve({ any: true })).toThrow(TypeError)
  })
})
