/** Native persona sections over the prompt registry. */
import { describe, expect, it } from 'vitest'
import { NativeScope } from '@redspark/rsh-native-runtime'
import { plugin } from '../src/native.ts'
import { resolveConfig } from '../src/config.ts'
import { NativePromptRegistry, PERSONA_PREFIX_SECTION } from '../src/index.ts'

/** Install the Provider against a real scope and return the published registry. */
function install(config: unknown) {
  const provided: { name: string; value: unknown }[] = []
  const effects: (() => void)[] = []
  const scope = new NativeScope()
  const context = {
    scope,
    effect: (disposer: () => void) => { effects.push(disposer) },
    own: () => undefined,
    provide: (name: string, value: unknown) => { provided.push({ name, value }) },
  }
  ;(plugin.resolve(config) as unknown as (c: unknown) => void)(context)
  const found = provided.find(entry => entry.name === 'promptSections')
  if (found === undefined) throw new Error('native-prompt published no registry')
  return { registry: found.value as NativePromptRegistry, effects, scope }
}

describe('native prompt persona', () => {
  it('renders the configured prefix before the suffix', async () => {
    const { registry } = install({ personaPrefix: 'You are a coding assistant.', personaSuffix: 'Verify your work.' })
    expect(await registry.render()).toBe('You are a coding assistant.\n\nVerify your work.')
  })

  it('lets a scoped section shadow the deployment persona by its Cordis name', async () => {
    const { registry, scope } = install({ personaPrefix: 'deployment persona' })
    expect(await registry.render()).toBe('deployment persona')
    // An Agent preset registers the same name in its own scope; the nearer layer wins.
    const agentScope = new NativeScope(scope)
    registry.register({ name: PERSONA_PREFIX_SECTION, order: 0, text: () => 'preset persona' }, agentScope)
    expect(await registry.render(agentScope)).toBe('preset persona')
    // The deployment persona still applies outside that Agent.
    expect(await registry.render()).toBe('deployment persona')
  })

  it('interpolates strict variables through the registry', async () => {
    const { registry } = install({ personaPrefix: 'Working in {{cwd}}.' })
    expect(await registry.render(undefined, { variables: { cwd: '/work' } })).toBe('Working in /work.')
    await expect(registry.render()).rejects.toThrow(/unknown prompt variable/)
  })

  it('composes no persona when the configuration is absent', async () => {
    const { registry } = install(undefined)
    expect(await registry.render()).toBe('')
  })

  it('registers the suffix after every other section', async () => {
    const { registry } = install({ personaSuffix: 'suffix' })
    registry.register({ name: 'guidance', order: 1000, text: () => 'guidance' })
    expect(await registry.render()).toBe('guidance\n\nsuffix')
  })

  it('rejects an unknown field and an empty template', () => {
    expect(() => resolveConfig({ persona: 'x' })).toThrow(/unsupported configuration field/)
    expect(() => resolveConfig({ personaPrefix: '' })).toThrow(/non-empty string/)
  })

  it('removes the persona section when its registration is disposed', async () => {
    const { registry, effects } = install({ personaPrefix: 'deployment persona' })
    expect(await registry.render()).toBe('deployment persona')
    for (const dispose of effects) dispose()
    expect(await registry.render()).toBe('')
  })
})
