/** Native profile composition: agentDefaultModel supplies the root fallback route. */
import { describe, expect, it } from 'vitest'
import { plugin as defaultModelPlugin } from '@redspark/rsh-agent-default-model/native'

describe('native agent default model entry', () => {
  it('publishes the service the headless application consults for a root fallback', () => {
    expect(defaultModelPlugin.provides).toEqual(['agentDefaultModel'])
    expect(defaultModelPlugin.name).toBe('@redspark/rsh-agent-default-model')
    expect(defaultModelPlugin.targets).toEqual(['host'])
    expect(defaultModelPlugin.optional).toEqual(['settings'])
  })

  it('exposes the composed route before any settings provider is installed', () => {
    const provided: { name: string; value: unknown }[] = []
    const context = {
      optional: () => undefined,
      own: () => undefined,
      provide: (name: string, value: unknown) => { provided.push({ name, value }) },
    }
    ;(defaultModelPlugin.resolve({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }) as unknown as (c: unknown) => void)(context)
    const service = provided.find(entry => entry.name === 'agentDefaultModel')
    if (service === undefined) throw new Error('no service published')
    const policy = service.value as { currentSelection(): { provider: string; model: string } }
    expect(policy.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })
})
