/** Diagnose: does a Provider-root persona reach the Agent scope? */
import { expect, it } from 'vitest'
import { NativeScope } from '@redspark/rsh-native-runtime'
import { NativePromptRegistry } from '../src/index.ts'

it('a Provider-root section is visible from a descendant Agent scope', async () => {
  const providerRoot = new NativeScope()
  const registry = new NativePromptRegistry(providerRoot)
  registry.register({ name: 'deployment:persona-prefix', order: 0, text: () => 'persona' })
  const applicationScope = new NativeScope(providerRoot)
  const agentScope = new NativeScope(applicationScope)
  expect(await registry.render(agentScope)).toBe('persona')
})
