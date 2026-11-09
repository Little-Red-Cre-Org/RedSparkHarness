/** Native default-model policy: composed entry, settings override, and rejection. */
import { describe, expect, it } from 'vitest'
import { plugin, NativeAgentDefaultModel, resolveConfig } from '../src/native.ts'

interface Scope { current: Record<string, unknown>; watch(cb: (next: Record<string, unknown>) => void): () => void }

/** Install the Provider against a stub settings service and capture the published policy. */
function install(config: unknown, stored?: Record<string, unknown>) {
  const provided: { name: string; value: unknown }[] = []
  const watchers: ((next: Record<string, unknown>) => void)[] = []
  const scope: Scope | undefined = stored === undefined ? undefined : {
    current: stored,
    watch(cb) { watchers.push(cb); return () => undefined },
  }
  const context = {
    optional: (name: string) => name === 'settings'
      ? { register: () => scope === undefined ? undefined : { ...scope, get: () => scope.current, dispose: () => undefined } }
      : undefined,
    own: () => undefined,
    provide: (name: string, value: unknown) => { provided.push({ name, value }) },
  }
  ;(plugin.resolve(config) as unknown as (context: unknown) => void)(context)
  const found = provided.find(entry => entry.name === 'agentDefaultModel')
  if (found === undefined) throw new Error('native default-model provider published no service')
  return { policy: found.value as NativeAgentDefaultModel, watchers, scope }
}

describe('native agent default model', () => {
  it('publishes the composed default when no settings provider is installed', () => {
    const { policy } = install({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(policy.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('lets a stored settings section outrank the composed entry', () => {
    const { policy } = install(
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    )
    expect(policy.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high',
    })
  })

  it('adopts a committed settings change for the next Agent', () => {
    const { policy, watchers } = install(
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    )
    for (const watch of watchers) watch({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(policy.currentSelection().model).toBe('deepseek-v4-pro')
    expect(policy.currentSelection().provider).toBe('deepseek-official')
  })

  it('rejects an unknown configuration field and an empty route', () => {
    expect(() => resolveConfig({ provider: 'p', model: 'm', extra: 1 })).toThrow(/unsupported configuration field/)
    expect(() => resolveConfig({ provider: '', model: 'm' })).toThrow()
    expect(() => resolveConfig({ provider: 'p' })).toThrow()
  })
})
