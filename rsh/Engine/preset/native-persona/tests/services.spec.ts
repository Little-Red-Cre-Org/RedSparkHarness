/** Native persona registration against the prompt registry. */
import { describe, expect, it } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import type { NativePromptRegistry } from '@redspark/rsh-native-prompt'
import { applyPersonaSections } from '@redspark/rsh-persona/native'
import { plugin, resolveNativePersonaConfig } from '../src/native.ts'
import { nativePromptSections, PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '../src/services.ts'

/**
 * A Native prompt registry recording the sections a persona row registers.
 * @returns the registry and the rows it currently holds.
 */
function promptRegistry(): {
  registry: NativePromptRegistry
  rows: Map<string, { order: number; text: string; complete?: boolean }>
  scopes: Map<string, unknown>
  suppressed: unknown[]
} {
  const rows = new Map<string, { order: number; text: string; complete?: boolean }>()
  const scopes = new Map<string, unknown>()
  const suppressed: unknown[] = []
  const registry = {
    register: (section: { name: string; order: number; text: () => string; complete?: boolean }, scope?: unknown) => {
      rows.set(section.name, { order: section.order, text: section.text(),
        ...(section.complete === true ? { complete: true } : {}) })
      scopes.set(section.name, scope)
      return () => { rows.delete(section.name); scopes.delete(section.name) }
    },
    suppressRuntimeContext: (scope?: unknown) => {
      suppressed.push(scope)
      return () => { suppressed.splice(suppressed.indexOf(scope), 1) }
    },
  } as unknown as NativePromptRegistry
  return { registry, rows, scopes, suppressed }
}

describe('nativePromptSections', () => {
  it('forwards a section to the native registry and returns its exact disposer', () => {
    const { registry, rows } = promptRegistry()
    const sections = nativePromptSections(registry)

    const dispose = sections.section({ name: 'probe', order: 5, text: 'hello' })
    expect(rows.get('probe')).toEqual({ order: 5, text: 'hello' })

    dispose()
    expect(rows.has('probe')).toBe(false)
  })

  it('reports the persona orders the registry states', () => {
    const { registry } = promptRegistry()
    const sections = nativePromptSections(registry)

    expect(sections.prefixOrder).toBe(0)
    expect(sections.prefixOrder).toBeLessThan(sections.suffixOrder)
  })

  it('records runtime-context suppression on the installation scope', () => {
    const { registry, suppressed } = promptRegistry()
    const scope = { id: 'minimal' }
    const sections = nativePromptSections(registry, scope as never)

    const dispose = sections.suppressRuntimeContext()
    expect(suppressed).toEqual([scope])

    dispose()
    expect(suppressed).toEqual([])
  })
})

describe('native persona row', () => {
  it('registers both persona sections on the preset scope', async () => {
    const { registry, rows, scopes } = promptRegistry()
    const scope = { id: 'standard' }
    const effects: (() => void)[] = []
    const context = {
      scope,
      require: (name: string) => {
        expect(name).toBe('promptSections')
        return registry
      },
      effect: (dispose: () => void) => { effects.push(dispose); return () => {} },
    } as unknown as NativeContext

    await plugin.resolve({ prefix: 'You are native.', suffix: 'Done.' })(context)

    expect(rows.get(PERSONA_PREFIX_SECTION)?.text).toBe('You are native.')
    expect(rows.get(PERSONA_SUFFIX_SECTION)?.text).toBe('Done.')
    expect(scopes.get(PERSONA_PREFIX_SECTION)).toBe(scope)
    expect(scopes.get(PERSONA_SUFFIX_SECTION)).toBe(scope)

    for (const dispose of effects) dispose()
    expect(rows.size).toBe(0)
  })

  it('binds a complete prompt and runtime-context suppression to the row', async () => {
    const { registry, rows, suppressed } = promptRegistry()
    const scope = { id: 'minimal' }
    const effects: (() => void)[] = []
    const context = {
      scope,
      require: () => registry,
      effect: (dispose: () => void) => { effects.push(dispose); return () => {} },
    } as unknown as NativeContext

    await plugin.resolve({ prefix: 'fixed', complete: true, includeRuntimeContext: false })(context)

    expect(rows.get(PERSONA_PREFIX_SECTION)).toMatchObject({ text: 'fixed', complete: true })
    expect(suppressed).toEqual([scope])
    expect(effects).toHaveLength(3)
  })

  it('rejects unknown configuration fields', () => {
    expect(() => resolveNativePersonaConfig({ prefix: 'x', unknown: true }))
      .toThrow()
  })
})

describe('shared persona owner', () => {
  it('owns registration through the caller effect', () => {
    const { registry, rows } = promptRegistry()
    const effects: (() => void)[] = []

    applyPersonaSections(
      nativePromptSections(registry),
      { prefix: 'shared', suffix: '' },
      (register) => { effects.push(register()) },
    )

    expect(rows.get(PERSONA_PREFIX_SECTION)?.text).toBe('shared')
    for (const dispose of effects) dispose()
    expect(rows.size).toBe(0)
  })
})
