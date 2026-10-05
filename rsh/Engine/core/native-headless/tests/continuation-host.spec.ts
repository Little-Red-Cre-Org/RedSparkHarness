/** Real native Host continuation turns share the selected model executor and released Session writer. */
import { mkdtemp, rm } from 'node:fs/promises'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin, NativeAgentId, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin, type NativeSessionExecutionOperations, type NativeSessionContinuation,
  type NativeActiveSessionOperations, type NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { plugin as presetsPlugin, type NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { MockAdapter, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { NativeHeadlessApplication, plugin as appPlugin } from '../src/native.ts'

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], selectedPreset = false) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-continuation-host-'))
  const scope = new NativeScope()
  const model = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let execution: NativeSessionExecutionOperations | undefined
  let tools: NativeToolRegistry | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let presets: NativeAgentPresetOperations | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'continuation-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'sessionExecution', 'tools', 'activeSessions'],
    optional: ['agentPresets'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      execution = context.require('sessionExecution')
      tools = context.require('tools')
      activeSessions = context.require('activeSessions')
      presets = context.optional('agentPresets')
    } }
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'continuation-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => { context.provide('model', model) } }
  const standing: NativePlugin = { apiVersion: 1, name: 'test-standing', targets: ['host'], requires: ['agentPresets'],
    provides: [], resolve: () => (context) => {
      context.effect(context.require('agentPresets').register({ id: 'test', name: 'Test', scope }))
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4 } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
    ...selectedPreset ? [{ plugin: presetsPlugin, scope, config: { default: 'test' } },
      { plugin: standing, scope, config: undefined }] : [],
  ], 'host'))
  await host.start()
  if (app === undefined || storage === undefined || agents === undefined || execution === undefined || tools === undefined
    || activeSessions === undefined) {
    throw new Error('missing continuation fixture services')
  }
  return { root, host, scope, model, app, storage, agents, execution, tools, activeSessions, events: host.events, presets,
    async close() { await host.stop(); await rm(root, { recursive: true }) } }
}



it('routes root maintenance and execution through the original Agent without an extra model turn', async () => {
  const state = await fixture([textResponse('Scheduled root complete.')])
  const signal = new AbortController().signal
  const id = SessionId('scheduled-root')
  const routeId = brandString<NativeRootRouteId>('root')
  let original: NativeActiveSessionOwner | undefined
  try {
    const route = state.app.rootExecution.resolve(routeId)
    expect(Object.isFrozen(route)).toBe(true)
    expect(Object.isFrozen(route.configuration)).toBe(true)
    await state.app.rootExecution.maintenance({ route: routeId, id, resume: false }, async (owner) => {
      original = owner
      expect(state.app.rootExecution.capture(owner)).toBe(route)
      expect(state.model.requests).toHaveLength(0)
    }, signal)
    expect(await state.app.rootExecution.settle({ route: routeId, id }, signal)).toBeUndefined()
    expect(state.model.requests).toHaveLength(0)
    if (original === undefined) throw new Error('root maintenance did not attach its owner')
    const completedOwner = original
    expect(() => state.app.rootExecution.capture(completedOwner)).toThrow('exact attached root owner')
    const result = await state.app.rootExecution.execute({ route: routeId, id, resume: true,
      message: createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Run the scheduled root.' }] }) }, signal)
    expect(result.answer).toBe('Scheduled root complete.')
    expect(state.model.requests).toHaveLength(1)
    expect(JSON.stringify(state.model.requests[0]?.messages)).toContain('Run the scheduled root.')
    expect(state.agents.get(original.agent.id)).toBe(original.agent)
    await state.app.dispose()
    expect(() => state.app.rootExecution.settle({ route: routeId, id }, signal)).toThrow('application is disposed')
  } finally { await state.close() }
})


it('retains one child writer across parent closure, processes another turn and cold-resumes the same child log', async () => {
  const state = await fixture([
    toolCallResponse('open', 'open_child', {}), textResponse('Child first.'), textResponse('Parent first.'),
    textResponse('Child second.'), textResponse('Parent saw notice.'),
    toolCallResponse('resume', 'resume_child', {}), textResponse('Child restored.'), textResponse('Parent resumed child.'),
  ], true)
  const parentId = SessionId('continuation-parent')
  const childId = SessionId('continuation-child')
  const signal = new AbortController().signal
  const firstTurn = Promise.withResolvers<undefined>()
  const secondTurn = Promise.withResolvers<undefined>()
  let child: NativeSessionContinuation | undefined
  let releaseDescendant: (() => void) | undefined
  const input = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const removeOpen = state.tools.register({ schema: { name: 'open_child', description: 'Open child.', parameters: {} },
    async execute(call) {
      const operations = state.execution.continuations!(call.agent, call.session)
      const failedId = SessionId('failed-preset-child')
      const failure = new Error('child announcement refused')
      const leases: Promise<void>[] = []
      if (state.presets === undefined) throw new Error('missing real preset Provider')
      const acquire = state.presets.acquire.bind(state.presets)
      const acquired = vi.spyOn(state.presets, 'acquire').mockImplementation((preset) => {
        const lease = acquire(preset)
        return { ...lease, release: (reason) => { const released = lease.release(reason); leases.push(released); return released } }
      })
      const stopAnnouncement = state.events.on(state.scope, 'agent/created', (agent) => {
        if (agent.id === NativeAgentId(failedId)) throw failure
      })
      try {
        await expect(operations.open({ id: failedId, resume: false, maxDepth: 1,
          config: state.execution.configuration(call.agent, call.session) }, call.signal)).rejects.toBe(failure)
        expect(leases).toHaveLength(1)
        await leases[0]
      } finally { acquired.mockRestore(); await stopAnnouncement() }
      child = await operations.open({ id: childId, resume: false, maxDepth: 1,
        config: { ...state.execution.configuration(call.agent, call.session), model: 'child', systemPrompt: 'Child.' },
        onEvent: (event) => {
          if (event.type === 'turn/end' && event.data.turn === 1) firstTurn.resolve(undefined)
          if (event.type === 'turn/end' && event.data.turn === 2) secondTurn.resolve(undefined)
        },
        onSettled: async () => {
          expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
          const writer = await state.storage.open(childId, 'write')
          await writer.close()
          await operations.deliver(parentId, input('Child settled durably.'), 'next-step', false, signal)
        },
      }, call.signal)
      releaseDescendant = child.retainChild()
      await child.enqueue(input('First child task.'), 'next-turn', call.signal)
      await child.ready
      await firstTurn.promise
      return { content: [], isError: false }
    } })
  const removeResume = state.tools.register({ schema: { name: 'resume_child', description: 'Resume child.', parameters: {} },
    async execute(call) {
      const operations = state.execution.continuations!(call.agent, call.session)
      const restored = await operations.open({ id: childId, resume: true, maxDepth: 1,
        config: { ...state.execution.configuration(call.agent, call.session), model: 'child', systemPrompt: 'Child.' } }, call.signal)
      await restored.enqueue(input('Continue the recorded child.'), 'next-turn', call.signal)
      await restored.ready
      await restored.done
      return { content: [], isError: false }
    } })
  try {
    await state.app.executeTurn({ id: parentId, resume: false, message: input('Start.') }, signal)
    if (child === undefined || releaseDescendant === undefined) throw new Error('missing resident child')
    expect(state.agents.get(NativeAgentId(childId))).toBe(child.agent)
    await expect(state.storage.open(childId, 'write')).rejects.toThrow()
    const parentWriter = await state.storage.open(parentId, 'write')
    await parentWriter.close()
    await child.enqueue(input('Second child task.'), 'next-turn', signal)
    await secondTurn.promise
    releaseDescendant()
    await child.done
    await state.app.executeTurn({ id: parentId, resume: true, message: input('Collect.') }, signal)
    expect(JSON.stringify(state.model.requests[4]?.messages)).toContain('Child settled durably.')
    await state.app.executeTurn({ id: parentId, resume: true, message: input('Restore child.') }, signal)
    const restoredRequest = state.model.requests.findLast(request => request.model === 'child')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Child first.')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Child second.')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Continue the recorded child.')
    const reader = await state.storage.open(childId, 'read')
    try {
      const log = await reader.read(0, Number.MAX_SAFE_INTEGER)
      expect(reader.header.agentPreset).toBe('test')
      expect(log.events.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2, 3])
      expect(log.events.map(event => event.seq)).toEqual(log.events.map((_event, index) => index))
    } finally { await reader.close() }
  } finally { releaseDescendant?.(); await child?.dispose(); await removeOpen(); await removeResume(); await state.close() }
})




it('drains every retained root and unregisters Agents after one writer close fails', async () => {
  const state = await fixture([textResponse('Child settled.')])
  const failedId = SessionId('failed-close-root')
  const heldId = SessionId('held-close-root')
  const failure = new Error('root writer close failed')
  const failedClose = Promise.withResolvers<undefined>()
  const heldClose = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const releases: (() => void)[] = []
  const create = state.storage.create.bind(state.storage)
  const intercept = vi.spyOn(state.storage, 'create').mockImplementation(async (...args) => {
    const writer = await create(...args)
    const close = writer.close.bind(writer)
    vi.spyOn(writer, 'close').mockImplementation(async () => {
      if (args[0].id === heldId) { heldClose.resolve(undefined); await finish.promise }
      await close()
      if (args[0].id === failedId) { failedClose.resolve(undefined); throw failure }
    })
    return writer
  })
  const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError
    ? [error, ...error.errors.flatMap(causes)] : [error]
  try {
    const childId = SessionId('detached-failure-child')
    const detachedFailure = new Error('detached observer failed')
    const removeObserver = state.activeSessions.onDetached(async (owner) => {
      if (owner.session.id === childId) throw detachedFailure
    })
    try {
      await state.app.executeSessionOperation({ id: SessionId('one-shot-parent'), resume: false }, async (owner) => {
        const result = state.execution.delegate(owner.agent, owner.session, { id: childId, maxDepth: 1,
          config: state.execution.configuration(owner.agent, owner.session),
          message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Child task.' }] }),
        }, new AbortController().signal)
        expect(causes(await result.catch((error: unknown) => error))).toContain(detachedFailure)
        const writer = await state.storage.open(childId, 'write')
        await writer.close()
      }, new AbortController().signal)
    } finally { await removeObserver() }
    for (const id of [failedId, heldId]) {
      await state.app.executeSessionOperation({ id, resume: false }, async (owner) => {
        releases.push(owner.retain())
      }, new AbortController().signal)
    }
    let settled = false
    const disposal = state.app.dispose().then(() => { settled = true; return undefined }, (error: unknown) => {
      settled = true
      return error
    })
    await Promise.all([failedClose.promise, heldClose.promise])
    await Promise.resolve()
    expect(settled).toBe(false)
    finish.resolve(undefined)
    expect(causes(await disposal)).toContain(failure)
    expect(state.agents.get(NativeAgentId(failedId))).toBeUndefined()
    expect(state.agents.get(NativeAgentId(heldId))).toBeUndefined()
    expect(state.model.requests).toHaveLength(1)
  } finally {
    finish.resolve(undefined)
    for (const release of releases) release()
    intercept.mockRestore()
    await state.host.stop().catch((error: unknown) => { expect(causes(error)).toContain(failure) })
    await rm(state.root, { recursive: true, force: true })
  }
})
