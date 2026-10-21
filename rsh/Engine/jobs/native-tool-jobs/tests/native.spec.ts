/** Model-facing job controls with real native services and exact Agent ownership. */
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as jobsPlugin, type NativeJobOutcome, type NativeJobRegistry } from '@deepseek-ai/dsh-native-jobs/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { plugin as jobToolsPlugin } from '../src/index.ts'

async function fixture(config?: unknown) {
  const scope = new NativeScope()
  let agents: NativeAgentRegistry | undefined
  let jobs: NativeJobRegistry | undefined
  let tools: NativeToolRegistry | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture-native-job-tools', targets: ['host'],
    requires: ['agents', 'jobs', 'tools'], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      jobs = context.require('jobs')
      tools = context.require('tools')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: jobToolsPlugin, scope, config },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: jobsPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (agents === undefined || jobs === undefined || tools === undefined) throw new Error('missing native service')
  const id = SessionId('job-tool-test')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/', isSeeded: false, delegationDepth: 0,
  })
  return { host, scope, agents, jobs, tools, session }
}

function agent(id: string, scope: NativeScope): NativeAgent {
  return { id: NativeAgentId(id), scope: new NativeScope(scope) }
}

describe('native job tools', () => {
  it('lists, waits, reads, and cancels an Agent-owned job through the native tool registry', async () => {
    const state = await fixture({ waitTimeoutMs: 10, maxWaitTimeoutMs: 1_000 })
    const owner = agent('owner', state.scope)
    const unregister = state.agents.register(owner)
    const release = Promise.withResolvers<undefined>()
    try {
      const id = state.jobs.start({
        agent: owner, kind: 'subagent', label: 'inspect',
        async run(signal): Promise<NativeJobOutcome> {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => { resolve() }, { once: true })
            void release.promise.then(resolve)
          })
          return signal.aborted ? { status: 'cancelled' } : { status: 'completed', output: 'inspection result' }
        },
      })
      const execute = (name: string, args: unknown, actor = owner) => state.tools.execute({
        agent: actor, callId: ToolCallId(name), name, arguments: args, session: state.session, signal: new AbortController().signal,
      })
      expect((await execute('job_list', {})).content).toMatchObject([{ text: 'subagent-1 [subagent] running — inspect' }])
      expect((await execute('job_output', { job_id: id, wait: true, timeout_ms: 1 })).content)
        .toMatchObject([{ text: '(no output yet)\n[status: running]' }])
      expect((await execute('job_kill', { job_id: id, reason: 'no longer needed' })).content)
        .toMatchObject([{ text: 'requested cancellation of job subagent-1' }])
      await expect(state.jobs.wait(id, owner, 1_000)).resolves.toMatchObject({ status: 'cancelled' })
      expect((await execute('job_output', { job_id: id })).content)
        .toMatchObject([{ text: '(no output yet)\n[status: cancelled]' }])
    } finally {
      release.resolve(undefined)
      await unregister()
      await state.host.stop()
    }
  })

  it('does not reveal or cancel a foreign job and rejects invalid model arguments', async () => {
    const state = await fixture()
    const alice = agent('alice', state.scope)
    const bob = agent('bob', state.scope)
    const releaseAlice = state.agents.register(alice)
    const releaseBob = state.agents.register(bob)
    try {
      const id = state.jobs.start({ agent: alice, kind: 'shell', label: 'private', run: async () => ({ status: 'completed' }) })
      await state.jobs.wait(id, alice, 1_000)
      const call = (name: string, args: unknown) => state.tools.execute({
        agent: bob, callId: ToolCallId(name), name, arguments: args, session: state.session, signal: new AbortController().signal,
      })
      expect((await call('job_list', {})).content).toMatchObject([{ text: '(no background jobs)' }])
      await expect(call('job_output', { job_id: id })).rejects.toThrow('belongs to another Agent')
      await expect(call('job_kill', { job_id: id })).rejects.toThrow('belongs to another Agent')
      await expect(call('job_output', { job_id: id, timeout_ms: 10 })).rejects.toThrow('requires wait: true')
      await expect(call('job_list', { extra: true })).rejects.toThrow('unexpected argument')
    } finally {
      await releaseBob()
      await releaseAlice()
      await state.host.stop()
    }
  })

  it('bounds model-visible output while retaining the terminal status', async () => {
    const state = await fixture({ maxOutputBytes: 128 })
    const owner = agent('owner', state.scope)
    const unregister = state.agents.register(owner)
    try {
      const id = state.jobs.start({
        agent: owner, kind: 'subagent', label: 'large result',
        run: async () => ({ status: 'completed', output: '界'.repeat(200) }),
      })
      await state.jobs.wait(id, owner, 1_000)
      const result = await state.tools.execute({
        agent: owner, callId: ToolCallId('large'), name: 'job_output', arguments: { job_id: id },
        session: state.session, signal: new AbortController().signal,
      })
      const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(128)
      expect(text).toContain('[output truncated]')
      expect(text).toContain('[status: completed]')
      expect(text).not.toContain('�')
    } finally {
      await unregister()
      await state.host.stop()
    }
  })

  it('stops a waiting tool call on Host cancellation without cancelling its job', async () => {
    const state = await fixture()
    const owner = agent('owner', state.scope)
    const unregister = state.agents.register(owner)
    const release = Promise.withResolvers<undefined>()
    try {
      const id = state.jobs.start({
        agent: owner, kind: 'subagent', label: 'continuing',
        async run() { await release.promise; return { status: 'completed' } },
      })
      const controller = new AbortController()
      const waiting = state.tools.execute({
        agent: owner, callId: ToolCallId('wait'), name: 'job_output',
        arguments: { job_id: id, wait: true, timeout_ms: 60_000 },
        session: state.session, signal: controller.signal,
      })
      controller.abort(new Error('turn cancelled'))
      await expect(waiting).rejects.toThrow('turn cancelled')
      expect(state.jobs.get(id, owner).status).toBe('running')
      release.resolve(undefined)
      await expect(state.jobs.wait(id, owner, 1_000)).resolves.toMatchObject({ status: 'completed' })
    } finally {
      release.resolve(undefined)
      await unregister()
      await state.host.stop()
    }
  })

  it('removes only its contributions when the native Host stops', async () => {
    const state = await fixture()
    expect(state.tools.schemas().map(schema => schema.name)).toEqual(['job_output', 'job_list', 'job_kill'])
    await state.host.stop()
    expect(state.tools.schemas()).toEqual([])
  })
})
