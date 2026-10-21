/** Native terminal ownership and unpublished allocation cleanup. */
import { expect, it } from 'vitest'
import { NativeAgentId, NativeAgentRegistry, type NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import { NativeTerminalRegistry, type NativeTerminalSession } from '../src/native.ts'

it('fences sessions to one Agent and awaits close during Agent release', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const terminals = new NativeTerminalRegistry(agents)
  const first: NativeAgent = { id: NativeAgentId('first'), scope: new NativeScope(scope) }
  const second: NativeAgent = { id: NativeAgentId('second'), scope: new NativeScope(scope) }
  const releaseFirst = agents.register(first)
  const releaseSecond = agents.register(second)
  const closed = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  let closeCalls = 0
  const session: NativeTerminalSession = {
    pid: 123, status: () => 'running', close: async () => { closeCalls++; closed.resolve(undefined); await finish.promise },
  }
  const remove = terminals.registerBackend({ type: 'shell', spawn: async () => session })
  try {
    const opened = await terminals.open(first, {} as Session, 'shell')
    expect(terminals.list(first)).toEqual([opened])
    expect(terminals.list(second)).toEqual([])
    await expect(terminals.close(second, opened.sessionId)).rejects.toThrow('belongs to another Agent')
    const releasing = releaseFirst()
    await closed.promise
    expect(closeCalls).toBe(1)
    expect(terminals.list(second)).toEqual([])
    finish.resolve(undefined)
    await releasing
    expect(closeCalls).toBe(1)
  } finally {
    finish.resolve(undefined)
    await remove()
    await releaseFirst()
    await releaseSecond()
    await terminals.dispose()
    await agents.dispose()
  }
})

it('cancels an unpublished allocation and closes a late result before owner release completes', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const terminals = new NativeTerminalRegistry(agents)
  const owner: NativeAgent = { id: NativeAgentId('owner'), scope }
  const release = agents.register(owner)
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<undefined>()
  let closes = 0
  const remove = terminals.registerBackend({ type: 'shell', async spawn(spec) {
    spec.signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
    entered.resolve(undefined)
    await finish.promise
    return { pid: 456, status: () => 'running', close: async () => { closes++ } }
  } })
  try {
    const opening = terminals.open(owner, {} as Session, 'shell')
    await entered.promise
    const releasing = release()
    await cancelled.promise
    finish.resolve(undefined)
    await expect(opening).rejects.toThrow('terminal: Agent disposed')
    await releasing
    expect(closes).toBe(1)
  } finally {
    finish.resolve(undefined)
    await remove()
    await release()
    await terminals.dispose()
    await agents.dispose()
  }
})
