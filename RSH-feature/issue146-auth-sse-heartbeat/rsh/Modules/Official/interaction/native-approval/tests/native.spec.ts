/** Native approval policy, ordered answerers, cancellation, and Agent identity. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { sessionApprovalPolicy, type NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import { SessionId, Session } from '@deepseek-ai/dsh-session/native'
import { NativeApprovalRequestId, plugin as approvalPlugin } from '../src/index.ts'

async function fixture(policy?: 'ask' | 'never'): Promise<{
  host: NativeHost
  root: NativeScope
  agents: NativeAgentRegistry
  approval: NativeApprovalServiceDefinition
}> {
  const root = new NativeScope()
  let agents: NativeAgentRegistry | undefined
  let approval: NativeApprovalServiceDefinition | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'native-approval-capture', targets: ['host'], requires: ['agents', 'approval'], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      approval = context.require('approval')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope: root, config: undefined },
    { plugin: approvalPlugin, scope: root, config: policy === undefined ? undefined : { policy } },
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
  it('validates policy configuration before installing the Provider', () => {
    expect(() => approvalPlugin.resolve(null)).toThrow('configuration must be an object')
    expect(() => approvalPlugin.resolve('ask')).toThrow('configuration must be an object')
    expect(() => approvalPlugin.resolve([])).toThrow('configuration must be an object')
    expect(() => approvalPlugin.resolve({ unexpected: true })).toThrow('unknown configuration field unexpected')
    expect(() => approvalPlugin.resolve({ policy: null })).toThrow('policy must be ask or never')
    expect(() => approvalPlugin.resolve({ policy: 'always' })).toThrow('policy must be ask or never')
  })

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
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-1'), agent: owner, toolName: 'write_file' })).resolves.toMatchObject({
        id: 'approval-1',
        policy: 'ask', outcome: 'allowed-once',
      })
      expect(answers).toEqual(['first:write_file', 'second:write_file'])
      removeFirst()
      removeFirst()
      removeSecond()
      removeSecond()
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-2'), agent: owner, toolName: 'write_file' })).resolves.toMatchObject({ outcome: 'unavailable' })
      const replacement: NativeAgent = { id: owner.id, scope: new NativeScope(state.root) }
      expect(() => state.approval.request({ id: NativeApprovalRequestId('approval-3'), agent: replacement, toolName: 'write_file' })).toThrow('is not registered')
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
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-4'), agent: owner, toolName: 'write_file' })).resolves.toMatchObject({
        policy: 'never', outcome: 'rejected',
      })
      expect(called).toBe(false)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('uses the exact Session policy override ahead of the deployment default', async () => {
    const state = await fixture('never')
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const session = Session.create(SessionId('approval-session-policy'))
    session.append('approval/policy', { policy: 'ask' })
    const askPolicy = sessionApprovalPolicy(session)
    if (askPolicy === undefined) throw new Error('approval session policy was not projected')
    let called = false
    try {
      state.approval.registerAnswerer((request) => {
        called = true
        return request.policy === 'ask' ? 'allowed-once' : undefined
      })
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-session-ask'), agent: owner,
        sessionPolicy: askPolicy, toolName: 'write_file' })).resolves.toMatchObject({ policy: 'ask', outcome: 'allowed-once' })
      expect(called).toBe(true)

      session.append('approval/policy', { policy: 'never' })
      const neverPolicy = sessionApprovalPolicy(session)
      if (neverPolicy === undefined) throw new Error('approval session policy was not projected')
      called = false
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-session-never'), agent: owner,
        sessionPolicy: neverPolicy, toolName: 'write_file' })).resolves.toMatchObject({ policy: 'never', outcome: 'rejected' })
      expect(called).toBe(false)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('normalizes a synchronous answerer failure to unavailable', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    try {
      state.approval.registerAnswerer(() => { throw new Error('answerer failed') })
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-sync-failure'), agent: owner, toolName: 'write_file' }))
        .resolves.toMatchObject({ id: 'approval-sync-failure', policy: 'ask', outcome: 'unavailable' })
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('normalizes a rejected answerer promise to unavailable', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    try {
      state.approval.registerAnswerer(async () => { throw new Error('answerer rejected') })
      await expect(state.approval.request({ id: NativeApprovalRequestId('approval-async-failure'), agent: owner, toolName: 'write_file' }))
        .resolves.toMatchObject({ id: 'approval-async-failure', policy: 'ask', outcome: 'unavailable' })
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('returns cancelled without dispatch when the caller signal is already aborted', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const caller = new AbortController()
    caller.abort()
    let called = false
    try {
      state.approval.registerAnswerer(() => {
        called = true
        return 'allowed-once'
      })
      await expect(state.approval.request({
        id: NativeApprovalRequestId('approval-already-cancelled'), agent: owner, toolName: 'write_file', signal: caller.signal,
      })).resolves.toMatchObject({ outcome: 'cancelled' })
      expect(called).toBe(false)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('does not dispatch the next answerer when the caller cancels after delegation settles', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const caller = new AbortController()
    let nextCalled = false
    try {
      state.approval.registerAnswerer(() => {
        queueMicrotask(() => {
          queueMicrotask(() => { caller.abort() })
        })
        return undefined
      })
      state.approval.registerAnswerer(() => {
        nextCalled = true
        return 'allowed-once'
      })
      await expect(state.approval.request({
        id: NativeApprovalRequestId('approval-cancel-between-answerers'),
        agent: owner,
        toolName: 'write_file',
        signal: caller.signal,
      })).resolves.toMatchObject({ outcome: 'cancelled' })
      expect(nextCalled).toBe(false)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('aborts answerer work when the caller cancels', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const caller = new AbortController()
    const entered = Promise.withResolvers<AbortSignal>()
    const stopped = Promise.withResolvers<undefined>()
    let answererStopped = false
    try {
      state.approval.registerAnswerer(async (request) => {
        entered.resolve(request.signal)
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve()
          else request.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        answererStopped = true
        stopped.resolve(undefined)
        return 'allowed-once' as const
      })
      const pending = state.approval.request({
        id: NativeApprovalRequestId('approval-caller-cancelled'), agent: owner, toolName: 'write_file', signal: caller.signal,
      })
      const answererSignal = await entered.promise
      caller.abort()
      await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
      await stopped.promise
      expect(answererSignal.aborted).toBe(true)
      expect(answererStopped).toBe(true)
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('aborts answerer work and waits for it when the Provider is disposed', async () => {
    const state = await fixture()
    const owner = agent('owner', state.root)
    const unregister = state.agents.register(owner)
    const entered = Promise.withResolvers<AbortSignal>()
    let answererStopped = false
    try {
      state.approval.registerAnswerer(async (request) => {
        entered.resolve(request.signal)
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve()
          else request.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        answererStopped = true
        return 'allowed-once' as const
      })
      const pending = state.approval.request({ id: NativeApprovalRequestId('approval-dispose'), agent: owner, toolName: 'write_file' })
      const answererSignal = await entered.promise
      await state.approval.dispose()
      await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
      expect(answererSignal.aborted).toBe(true)
      expect(answererStopped).toBe(true)
      expect(() => state.approval.registerAnswerer(() => 'allowed-once')).toThrow('service is disposed')
    } finally {
      await unregister()
      await state.host.stop()
    }
  })
})
