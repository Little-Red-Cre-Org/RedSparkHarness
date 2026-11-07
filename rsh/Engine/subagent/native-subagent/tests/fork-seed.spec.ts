import { expect, it } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import type { Session } from '@redspark/rsh-session/native'
import { NativeSpawnSubagents, type NativeSubagentRequest } from '../src/index.ts'

it('rejects a completed-turn seed when the provider is external', () => {
  const driver = { name: 'remote' }
  const context = {
    signal: new AbortController().signal,
    optional: (name: string) => name === 'externalSubagentDriver' ? driver : undefined,
    require: (name: string) => {
      if (name === 'activeSessions') return { onDetached: () => async () => {} }
      throw new Error(name)
    },
  } as unknown as NativeContext
  const provider = new NativeSpawnSubagents(context, 'remote')
  expect(() => provider.resolve({
    agent: {} as NativeAgent,
    session: {} as Session,
    label: 'child',
    prompt: [],
    options: { maxDepth: 1, inheritCompletedTurns: true },
  })).toThrow('native-subagent: completed-turn seed requires the in-process executor')
})
it('rejects a completed-turn seed on the continuable entry', () => {
  const context = {
    signal: new AbortController().signal,
    optional: () => undefined,
    require: (name: string) => {
      if (name === 'activeSessions') return { onDetached: () => async () => {} }
      throw new Error(name)
    },
  } as unknown as NativeContext
  const provider = new NativeSpawnSubagents(context, 'spawn')
  expect(() => provider.startContinuable({
    agent: {} as NativeAgent,
    session: {} as Session,
    label: 'child',
    prompt: [],
    config: {} as NativeSubagentRequest['config'],
    maxDepth: 1,
    routeOverrides: {},
    inheritCompletedTurns: true,
  }, new AbortController().signal)).toThrow('native-subagent: completed-turn seed supports one-shot runs only')
})
