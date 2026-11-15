import { expect, it } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type { NativeSubagentOptions } from '@redspark/rsh-native-subagent'
import { plugin } from '../src/native.ts'

const allowed = [{ provider: 'mock', model: 'mock-routed' }]

function install(config: Record<string, unknown>, providerName = 'dsh-sdk'): {
  readonly tool: NativeValueToolContribution
  readonly seen: { readonly options: NativeSubagentOptions }[]
} {
  const seen: { options: NativeSubagentOptions }[] = []
  const installPlugin = plugin.resolve({ toolName: 'subagent', maxDepth: 1, ...config })
  let registered: NativeValueToolContribution | undefined
  const context = {
    require: (name: string) => {
      if (name === 'subagents') return {
        providerName,
        resolve: (request: { options: NativeSubagentOptions }) => {
          seen.push({ options: request.options })
          return request
        },
        run: () => Promise.resolve({ id: 'child', provider: providerName, remoteId: 'remote', stopReason: 'completed', output: [] }),
      }
      if (name === 'tools') return { registerValueTool: (value: NativeValueToolContribution) => {
        registered = value
        return () => {}
      } }
      throw new Error(name)
    },
    optional: () => undefined,
    own: () => {},
  } as unknown as NativeContext
  void installPlugin(context)
  if (registered === undefined) throw new Error('tool was not registered')
  return { tool: registered, seen }
}

function call(argumentsValue: Record<string, unknown>): NativeToolExecution {
  return { arguments: argumentsValue, signal: new AbortController().signal } as NativeToolExecution
}

it('rejects malformed allowed model lists before registration', () => {
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [] }))
    .toThrow('allowedModels must list at least one route')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: 'mock' }))
    .toThrow('allowedModels must list at least one route')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [null] }))
    .toThrow('allowedModels entries must be provider/model objects')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [['mock', 'mock-routed']] }))
    .toThrow('allowedModels entries must be provider/model objects')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [{ provider: 'mock', model: 'mock-routed', extra: true }] }))
    .toThrow('allowedModels entries accept only provider and model')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [{ provider: '', model: 'mock-routed' }] }))
    .toThrow('allowedModels.provider must be a nonempty string')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [{ provider: 1, model: 'mock-routed' }] }))
    .toThrow('allowedModels.provider must be a nonempty string')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [{ provider: 'mock', model: '' }] }))
    .toThrow('allowedModels.model must be a nonempty string')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: [allowed[0], { ...allowed[0] }] }))
    .toThrow('allowedModels repeats route "mock/mock-routed"')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: allowed, provider: 'mock' }))
    .toThrow('allowedModels requires configured provider and model together')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: allowed, model: 'mock-routed' }))
    .toThrow('allowedModels requires configured provider and model together')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: allowed, reasoningEffort: 'max' }))
    .toThrow('allowedModels requires configured provider and model together')
  expect(() => plugin.resolve({ toolName: 'subagent', maxDepth: 1, allowedModels: allowed, provider: 'other', model: 'model' }))
    .toThrow('configured route "other/model" is not allowed')
})

it('publishes optional route fields and keeps an omitted selection on the configured ceiling', async () => {
  const { tool, seen } = install({ allowedModels: allowed, maxTokens: 777 })
  expect(tool.schema.description).toContain('Configured maxTokens remains the ceiling.')
  expect(tool.schema.parameters).toMatchObject({ properties: { provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' } } })
  await tool.execute(call({ description: 'route probe', prompt: 'report' }))
  expect(seen[0]?.options).toEqual({ maxDepth: 1, maxTokens: 777 })
})

it('merges a selected route over the configured token ceiling', async () => {
  const { tool, seen } = install({
    allowedModels: [...allowed, { provider: 'parent', model: 'parent-model' }],
    maxTokens: 777, provider: 'parent', model: 'parent-model', reasoningEffort: 'low',
  })
  await tool.execute(call({
    description: 'route probe', prompt: 'report', provider: 'mock', model: 'mock-routed', reasoning_effort: 'max',
  }))
  expect(seen[0]?.options).toMatchObject({ provider: 'mock', model: 'mock-routed', reasoningEffort: 'max', maxTokens: 777, maxDepth: 1 })
})

it('drops a configured effort when the selected route does not name one', async () => {
  const { tool, seen } = install({
    allowedModels: [...allowed, { provider: 'parent', model: 'parent-model' }, { provider: 'parent', model: 'other' }, { provider: 'other', model: 'parent-model' }],
    maxTokens: 777, provider: 'parent', model: 'parent-model', reasoningEffort: 'low',
  })
  await tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'mock', model: 'mock-routed' }))
  await tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'parent', model: 'other' }))
  await tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'other', model: 'parent-model' }))
  await tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'parent', model: 'parent-model' }))
  expect(seen[0]?.options).toEqual({ maxDepth: 1, maxTokens: 777, provider: 'mock', model: 'mock-routed' })
  expect(seen[1]?.options).toEqual({ maxDepth: 1, maxTokens: 777, provider: 'parent', model: 'other' })
  expect(seen[2]?.options).toEqual({ maxDepth: 1, maxTokens: 777, provider: 'other', model: 'parent-model' })
  expect(seen[3]?.options).toMatchObject({ provider: 'parent', model: 'parent-model', reasoningEffort: 'low', maxTokens: 777 })
})

it('applies an effort-only selection to the configured allowed route', async () => {
  const { tool, seen } = install({ allowedModels: allowed, provider: 'mock', model: 'mock-routed', maxTokens: 777 })
  await tool.execute(call({ description: 'route probe', prompt: 'report', reasoning_effort: 'max' }))
  expect(seen[0]?.options).toMatchObject({ provider: 'mock', model: 'mock-routed', reasoningEffort: 'max', maxTokens: 777 })
})

it('rejects route fields the tool did not publish and routes outside the list', async () => {
  const closed = install({})
  await expect(closed.tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'mock', model: 'mock-routed' })))
    .rejects.toThrow('child route fields require allowedModels')
  const { tool } = install({ allowedModels: allowed, maxTokens: 777 })
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'mock' })))
    .rejects.toThrow('provider and model must be supplied together')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', model: 'mock-routed' })))
    .rejects.toThrow('provider and model must be supplied together')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', reasoning_effort: 'max' })))
    .rejects.toThrow('provider and model must be supplied together')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', provider: '', model: 'mock-routed' })))
    .rejects.toThrow('provider must be a nonempty string')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'mock', model: '' })))
    .rejects.toThrow('model must be a nonempty string')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'mock', model: 'mock-routed', reasoning_effort: '' })))
    .rejects.toThrow('reasoning_effort must be a nonempty string')
  await expect(tool.execute(call({ description: 'route probe', prompt: 'report', provider: 'other', model: 'model' })))
    .rejects.toThrow('child route "other/model" is not allowed')
})
