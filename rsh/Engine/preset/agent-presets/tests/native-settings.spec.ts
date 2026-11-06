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
import { NativeSettings } from '@redspark/rsh-settings/native'
import type { NativeSettingsScope } from '@redspark/rsh-settings-definition/native'
import type { AgentPresetSettings } from '../src/index.ts'
import { resolveNativeAgentPresetsConfig } from '../src/native.ts'
import { NativeScope } from '@redspark/rsh-native-runtime'

/** A settings document held in memory, in the shape the real service persists. */
function memoryStorage() {
  let document: Record<string, unknown> = {}
  return {
    load: async () => document,
    persist: async (update: (current: Record<string, unknown>) => Record<string, unknown>) => {
      document = update(document)
      return document
    },
  }
}

/** A settings scope over one mutable value, in the shape the registry reads. */
function settingsScope(initial: AgentPresetSettings): {
  scope: NativeSettingsScope<AgentPresetSettings>
  set(next: Partial<AgentPresetSettings>): void
} {
  let value = initial
  return {
    scope: {
      get: () => value,
      revision: 0,
      update: async () => {},
      replace: async () => {},
      watch: () => () => {},
      dispose: () => {},
    },
    set(next) { value = { ...value, ...next } },
  }
}

/**
 * Build a registry with two ready standing presets.
 * @param settings - optional settings scope; absent means no settings provider.
 * @returns the registry and its scope.
 */
function registry(settings?: NativeSettingsScope<AgentPresetSettings>) {
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

  it('publishes the namespace so the Native settings page can list and edit it', async () => {
    const settings = new NativeSettings(memoryStorage())
    await settings.start()
    activate(settings)
    // describe() lists only registrations carrying a presentation; mutate()
    // refuses one that does not, so an unpublished namespace would be
    // invisible to the page and unwritable through it.
    const row = settings.describe().find(entry => entry.namespace === 'agent-presets')
    expect(row).toMatchObject({ base: { default: 'standard', modeSelectionEnabled: true }, applies: 'live' })
    await settings.mutate('agent-presets' as never, [{ op: 'set', path: ['modeSelectionEnabled'], value: false }], row?.revision ?? 0)
    expect(settings.describe().find(entry => entry.namespace === 'agent-presets')?.value)
      .toEqual({ default: 'standard', modeSelectionEnabled: false })
  })

  it('rejects an unknown field in the stored section', async () => {
    const settings = new NativeSettings(memoryStorage())
    await settings.start()
    activate(settings)
    await expect(settings.mutate('agent-presets' as never,
      [{ op: 'set', path: ['extra'], value: true }], 0)).rejects.toThrow(/extra|unknown|Unrecognized/iu)
  })

  it('serves the roster without a settings provider', () => {
    const { provided } = activate(undefined)
    expect(provided.agentPresets?.catalog()).toMatchObject({ default: 'standard', modeSelectionEnabled: true })
  })

  it('unloading the installation withdraws the namespace from the page', async () => {
    const settings = new NativeSettings(memoryStorage())
    await settings.start()
    const owned: (() => void)[] = []
    const context = {
      scope: new NativeScope(),
      optional: (name: string) => name === 'settings' ? settings : undefined,
      require: () => { throw new Error('no required service') },
      own: (fn: () => void) => { owned.push(fn) },
      provide: () => {},
    }
    void plugin.resolve({ default: 'standard' })(context as never)
    expect(settings.describe().some(entry => entry.namespace === 'agent-presets')).toBe(true)
    for (const dispose of owned.splice(0)) dispose()
    expect(settings.describe().some(entry => entry.namespace === 'agent-presets')).toBe(false)
  })
})

describe('native preset settings defaults', () => {
  it('requires a preset id as the deployment default', () => {
    expect(resolveNativeAgentPresetsConfig({ default: 'standard' })).toEqual({ default: 'standard' })
    expect(() => resolveNativeAgentPresetsConfig({ default: 'Not An Id' })).toThrow()
  })
})
