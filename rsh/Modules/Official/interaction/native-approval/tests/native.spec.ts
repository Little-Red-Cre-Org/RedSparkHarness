/** Native approval policy, ordered answerers, cancellation, and Agent identity. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { NativeApprovalService, plugin as approvalPlugin } from '../src/index.ts'

async function fixture(policy: 'ask' | 'never' = 'ask'): Promise<{
  host: NativeHost
  root: NativeScope
  agents: NativeAgentRegistry
  approval: NativeApprovalService
}> {
  const root = new NativeScope()
  let agents: NativeAgentRegistry | undefined
  let approval: NativeApprovalService | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-approval-capture', targets: ['host'], requires: ['agents', 'approval'], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      approval = context.require('approval')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope: root, config: undefined },
    { plugin: approvalPlugin, scope: root, config: { policy } },
    { plugin: agentPlugin, scope: root, config: undefined },
  ], 'host'))
  await host.start()
  if (agents === undefined || approval === undefined) throw new Error('native approval fixture lost a Provider')
  return { host, root, agents, approval }
}

function agent(id: string, parent: NativeScope): NativeAgent {
  return { id: NativeAgentId(id), scope: new NativeScope(parent) }
}

describe('NativeApprovalService', () => {
  it('walks ordered answerers, fails closed when none claims a request, and requires the exact live Agent', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const answers: string[] = []
    try {
      const removeFirst = state.approval.registerAnswerer((request) => {
        answers.push(`first:${request.toolName}`)
        return undefined
      })
      const removeSecond = state.approval.registerAnswerer((request) => {
        answers.push(`second:${request.toolName}`)
        return 'allowed-once' as const
      })
      await expect(state.approval.request({ agent: owner, toolName: 'write_file' })).resolves.toMatchObject({
        policy: 'ask', outcome: 'allowed-once',
      })
      expect(answers).toEqual(['first:write_file', 'second:write_file'])
      removeFirst()
      removeSecond()
      await expect(state.approval.request({ agent: owner, toolName: 'write_file' })).resolves.toMatchObject({ outcome: 'unavailable' })
      const replacement: NativeAgent = { id: owner.id, scope: new NativeScope(state.root) }
      expect(() => state.approval.request({ agent: replacement, toolName: 'write_file' })).toThrow('is not registered')
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('rejects every request under the never policy without invoking answerers', async () => {
    const state = await fixture('never')
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    let called = false
    try {
      state.approval.registerAnswerer(() => {
        called = true
        return 'allowed-once'
      })
      await expect(state.approval.request({ agent: owner, toolName: 'write_file' })).resolves.toMatchObject({
        policy: 'never', outcome: 'rejected',
      })
      expect(called).toBe(false)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('cancels a pending answer when the Provider is disposed', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    try {
      state.approval.registerAnswerer(async () => {
        entered.resolve(undefined)
        await release.promise
        return 'allowed-once' as const
      })
      const pending = state.approval.request({ agent: owner, toolName: 'write_file' })
      await entered.promise
      await state.approval.dispose()
      await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
      expect(() => state.approval.registerAnswerer(() => 'allowed-once')).toThrow('service is disposed')
    } finally {
      release.resolve(undefined)
      await unregister()
      await state.host.stop()
    }
  })
})
