/** Bridged services: a Cordis plugin reading a Native registry through the translation. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import { apply as applyPersona } from '@deepseek-ai/dsh-persona'
import { bridgedSystemPrompt, personaServices, PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '../src/services.ts'

/**
 * A Native prompt registry recording the sections a bridged row registers.
 * @returns the registry and the rows it currently holds.
 */
function promptRegistry(): {
  registry: NativePromptRegistry
  rows: Map<string, { order: number; text: string }>
  scopes: Map<string, unknown>
} {
  const rows = new Map<string, { order: number; text: string }>()
  const scopes = new Map<string, unknown>()
  const registry = {
    register: (section: { name: string; order: number; text: () => string }, scope?: unknown) => {
      rows.set(section.name, { order: section.order, text: section.text() })
      scopes.set(section.name, scope)
      return () => { rows.delete(section.name); scopes.delete(section.name) }
    },
  } as unknown as NativePromptRegistry
  return { registry, rows, scopes }
}

describe('bridgedSystemPrompt', () => {
  it('forwards a section to the native registry and returns its exact disposer', () => {
    const { registry, rows } = promptRegistry()
    const bridged = bridgedSystemPrompt(registry)

    const dispose = bridged.section({ name: 'probe', order: 5, text: 'hello' })
    expect(rows.get('probe')).toEqual({ order: 5, text: 'hello' })

    dispose()
    expect(rows.has('probe')).toBe(false)
  })

  it('reports the persona orders the Cordis registry states', () => {
    const { registry } = promptRegistry()
    const bridged = bridgedSystemPrompt(registry)

    expect(bridged.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')).toBeLessThan(
      bridged.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'))
  })

  it('accepts a suppression request without claiming it took effect', () => {
    const { registry } = promptRegistry()
    // The Native registry owns suppression at the assembly level; the bridge must not throw.
    expect(() => { bridgedSystemPrompt(registry).suppressRuntimeContext() }).not.toThrow()
  })
})

describe('persona through the bridge', () => {
  it('hosts the shipped persona row unmodified against a native prompt registry', async () => {
    const { registry, rows, scopes } = promptRegistry()
    const scope = { id: 'standard' }
    const context = {
      scope,
      require: (name: string) => (name === 'promptSections' ? registry : undefined),
    } as unknown as NativeContext

    const ctx = new Context()
    for (const [name, service] of Object.entries(personaServices(context))) ctx.provide(name as never, service as never)
    await ctx.plugin({ name: 'persona', apply: applyPersona } as never, { prefix: 'You are bridged.', suffix: 'Done.' } as never)

    expect(rows.get(PERSONA_PREFIX_SECTION)?.text).toBe('You are bridged.')
    expect(rows.get(PERSONA_SUFFIX_SECTION)?.text).toBe('Done.')
    expect(scopes.get(PERSONA_PREFIX_SECTION)).toBe(scope)
    expect(scopes.get(PERSONA_SUFFIX_SECTION)).toBe(scope)

    await ctx.fiber.dispose()
    expect(rows.size).toBe(0)
  })
})
