/**
 * The Native preset registry behind the selection settings.
 *
 * The picker preference is a settings field the Host resolves at Session
 * creation, so hiding the picker has to do more than hide a control: an
 * unnamed new Session must fall back to the deployment default even when the
 * user document still names another preset.
 */
import { describe, expect, it } from 'vitest'
import { NativeAgentPresetRegistry, plugin } from '@redspark/rsh-agent-presets/native'
import type { NativeSettingsScope } from '@redspark/rsh-settings-definition/native'
import type { NativeAgentPresetSettings } from '../src/native.ts'
import { resolveNativeAgentPresetsConfig } from '../src/native.ts'
import { NativeScope } from '@redspark/rsh-native-runtime'

/** A settings scope over one mutable value, in the shape the registry reads. */
function settingsScope(initial: NativeAgentPresetSettings, onDispose?: () => void): {
  scope: NativeSettingsScope<NativeAgentPresetSettings>
  set(next: Partial<NativeAgentPresetSettings>): void
  disposed(): boolean
} {
  let value = initial
  return {
    scope: {
      get: () => value,
      revision: 0,
      update: async () => {},
      replace: async () => {},
      watch: () => () => {},
      dispose: () => { onDispose?.() },
    },
    set(next) { value = { ...value, ...next } },
    disposed: () => false,
  }
}

/**
 * Build a registry with two ready standing presets.
 * @param settings - optional settings scope; absent means no settings provider.
 * @returns the registry and its scope.
 */
function registry(settings?: NativeSettingsScope<NativeAgentPresetSettings>) {
  const scope = new NativeScope()
  const registry = new NativeAgentPresetRegistry('standard', scope, [], [], settings)
  for (const id of ['standard', 'ptc']) registry.register({ id, name: id, scope })
  return { registry, scope }
}

const facts = { locked: false } as never

describe('native preset selection policy', () => {
  it('reports the picker as shown and the deployment default when no settings provider is composed', () => {
    const { registry: presets } = registry()
    expect(presets.catalog()).toMatchObject({ default: 'standard', modeSelectionEnabled: true })
    expect(presets.resolvePreset({ fresh: true, facts })?.id).toBe('standard')
  })

  it('uses the saved default while mode selection stays enabled', () => {
    const settings = settingsScope({ default: 'ptc', modeSelectionEnabled: true })
    const { registry: presets } = registry(settings.scope)
    expect(presets.catalog()).toMatchObject({ default: 'ptc', modeSelectionEnabled: true })
    expect(presets.resolvePreset({ fresh: true, facts })?.id).toBe('ptc')
  })

  it('pins an unnamed new Session to the deployment default while the picker is hidden', () => {
    const settings = settingsScope({ default: 'ptc', modeSelectionEnabled: false })
    const { registry: presets } = registry(settings.scope)
    expect(presets.catalog()).toMatchObject({ default: 'standard', modeSelectionEnabled: false })
    // The stale user choice must not compose a Session no control can report.
    expect(presets.resolvePreset({ fresh: true, facts })?.id).toBe('standard')
  })

  it('still honours an explicit preset while the picker is hidden', () => {
    const settings = settingsScope({ default: 'ptc', modeSelectionEnabled: false })
    const { registry: presets } = registry(settings.scope)
    expect(presets.resolvePreset({ fresh: true, facts, preset: 'ptc' })?.id).toBe('ptc')
  })

  it('follows a settings write without rebuilding the registry', () => {
    const settings = settingsScope({ default: 'ptc', modeSelectionEnabled: true })
    const { registry: presets } = registry(settings.scope)
    expect(presets.resolvePreset({ fresh: true, facts })?.id).toBe('ptc')
    settings.set({ modeSelectionEnabled: false })
    expect(presets.resolvePreset({ fresh: true, facts })?.id).toBe('standard')
  })

  it('keeps a restored Session on the preset it already ran', () => {
    const settings = settingsScope({ default: 'ptc', modeSelectionEnabled: false })
    const { registry: presets } = registry(settings.scope)
    expect(presets.resolvePreset({ fresh: false, facts: { locked: true, preset: 'ptc' } as never })?.id).toBe('ptc')
  })
})

describe('native preset plugin registration', () => {
  /** A settings service stand-in that records what the plugin registers. */
  function settingsService() {
    const registered: { namespace: string; base: unknown; resolve: (value: Record<string, unknown>) => unknown }[] = []
    return {
      registered,
      service: {
        start: async () => {},
        register: (namespace: string, base: unknown, resolve: (value: Record<string, unknown>) => unknown) => {
          registered.push({ namespace, base, resolve })
          return { get: () => resolve({}), revision: 0, update: async () => {}, replace: async () => {},
            watch: () => () => {}, dispose: () => {} }
        },
        describe: () => [],
      },
    }
  }

  function activate(settings: unknown) {
    const provided: { agentPresets?: { catalog(): unknown } } = {}
    const owned: unknown[] = []
    const context = {
      scope: new NativeScope(),
      optional: (name: string) => name === 'settings' ? settings : undefined,
      require: () => { throw new Error('no required service') },
      own: (fn: unknown) => { owned.push(fn) },
      provide: (name: string, service: unknown) => { (provided as Record<string, unknown>)[name] = service },
    }
    void plugin.resolve({ default: 'standard' })(context as never)
    return { provided, owned }
  }

  it('registers the agent-presets namespace with the deployment default as its base', () => {
    const bench = settingsService()
    activate(bench.service)
    expect(bench.registered).toHaveLength(1)
    expect(bench.registered[0]?.namespace).toBe('agent-presets')
    expect(bench.registered[0]?.base).toEqual({ default: 'standard', modeSelectionEnabled: true })
    // An empty user section resolves to the base, so the picker defaults to shown.
    expect(bench.registered[0]?.resolve({})).toEqual({ default: 'standard', modeSelectionEnabled: true })
    // A partial write keeps the base for the field it omits.
    expect(bench.registered[0]?.resolve({ modeSelectionEnabled: false })).toEqual({ default: 'standard', modeSelectionEnabled: false })
  })

  it('rejects an unknown field in the stored section', () => {
    const bench = settingsService()
    activate(bench.service)
    expect(() => bench.registered[0]?.resolve({ default: 'x', extra: true })).toThrow()
  })

  it('serves the roster without a settings provider', () => {
    const { provided } = activate(undefined)
    expect(provided.agentPresets?.catalog()).toMatchObject({ default: 'standard', modeSelectionEnabled: true })
  })

  it('owns the settings registration so unloading withdraws the namespace', () => {
    const bench = settingsService()
    const { owned } = activate(bench.service)
    // Two owns: the settings scope, then the registry.
    expect(owned).toHaveLength(2)
  })
})

describe('native preset settings defaults', () => {
  it('requires a preset id as the deployment default', () => {
    expect(resolveNativeAgentPresetsConfig({ default: 'standard' })).toEqual({ default: 'standard' })
    expect(() => resolveNativeAgentPresetsConfig({ default: 'Not An Id' })).toThrow()
  })
})
