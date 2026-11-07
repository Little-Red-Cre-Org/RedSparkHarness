import { expect, it } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import type { Session } from '@redspark/rsh-session/native'
import { NativeSpawnSubagents } from '../src/index.ts'

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
