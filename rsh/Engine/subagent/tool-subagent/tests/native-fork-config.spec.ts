import { expect, it } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import { plugin } from '../src/native.ts'

it('rejects a non-boolean completed-turn seed flag', () => {
  expect(() => plugin.resolve({ toolName: 'subagent_fork', maxDepth: 1, inheritCompletedTurns: 'yes' }))
    .toThrow('native tool-subagent: inheritCompletedTurns must be a boolean')
})

it('rejects a continuable completed-turn seed', () => {
  expect(() => plugin.resolve({ toolName: 'subagent_fork', maxDepth: 1, inheritCompletedTurns: true, backgroundMode: 'continuable' }))
    .toThrow('native tool-subagent: completed-turn seed supports one-shot runs only')
})

it('rejects a completed-turn seed on an external provider', () => {
  const install = plugin.resolve({ toolName: 'subagent_fork', maxDepth: 1, inheritCompletedTurns: true })
  const context = {
    require: (name: string) => {
      if (name === 'subagents') return { providerName: 'dsh-sdk' }
      throw new Error(name)
    },
    optional: () => undefined,
  } as unknown as NativeContext
  expect(() => install(context)).toThrow('native tool-subagent: completed-turn seed requires the in-process executor')
})
