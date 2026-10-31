/** Canonical value processing and quiescent contribution replacement. */
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { NativeToolRegistry, type NativeToolExecution, type NativeToolContribution, type NativeToolResult,
  type NativeValueToolContribution } from '../src/index.ts'
import { plugin as toolsPlugin } from '../src/native.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'


function execution(agents: NativeAgentRegistry, scope: NativeScope, name = 'held') {
  const agent = { id: NativeAgentId('tool-owner'), scope }
  const release = agents.register(agent)
  const id = SessionId('tool-lifecycle')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false })
  const call: NativeToolExecution = {
    agent, callId: ToolCallId('call'), name, arguments: {}, session, signal: new AbortController().signal,
    appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
  }
  return { call, release }
}

function contribution(execute: NativeToolContribution['execute'], name = 'held'): NativeToolContribution {
  return { schema: { name, description: 'Lifecycle fixture.', parameters: { type: 'object', properties: {} } }, execute }
}

it('reports only exact registrations captured by a model request', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const first = registry.register(contribution(async () => ({ content: [{ type: 'text', text: 'first' }], isError: false })))
  const second = registry.register(contribution(async () => ({ content: [{ type: 'text', text: 'second' }], isError: false }), 'other'))
  const snapshot = registry.captureModelSnapshot(['held'], scope)
  expect(snapshot.includesRegistration(first)).toBe(true)
  expect(snapshot.includesRegistration(second)).toBe(false)
  await snapshot.dispose()
  await first()
  await second()
})
it('captures the output schema and detaches canonical values before rendering', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const { call, release } = execution(agents, scope)
  const source = { labels: ['original'] }
  const order: string[] = []
  const post = registry.postResult(async (_call, _original, next) => {
    order.push('policy-enter')
    const selected = await next()
    order.push('policy-return')
    return selected
  })
  const render = vi.fn((_call: NativeToolExecution, value: JsonValue) => {
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen((value as { labels: JsonValue }).labels)).toBe(true)
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false }
  })
  const tool: NativeValueToolContribution = {
    schema: contribution(async () => ({ content: [], isError: false })).schema,
    output: { schema: { type: 'object', properties: { labels: { type: 'array', items: { type: 'string' } } },
      required: ['labels'], additionalProperties: false }, render }, execute: async () => source,
    async finalizeResult(_call, original, selected) {
      expect(selected.value).toBe(original.value)
      expect(selected.content).toBe(original.content)
      order.push('finalize')
      return { ...selected, content: [...selected.content, { type: 'text', text: 'after-policy' }] }
    },
  }
  const dispose = registry.registerValueTool(tool)
  tool.output.schema.required = []
  try {
    const result = await registry.execute(call)
    source.labels.push('later')
    expect(result.value).toEqual({ labels: ['original'] })
    expect(result.content).toEqual([{ type: 'text', text: '{"labels":["original"]}' }, { type: 'text', text: 'after-policy' }])
    expect(order).toEqual(['policy-enter', 'policy-return', 'finalize'])
    expect(Object.isFrozen(result)).toBe(true)
    tool.execute = async () => ({})
    await expect(registry.execute(call)).rejects.toMatchObject({ code: 'INVALID_TOOL_OUTPUT' })
    expect(render).toHaveBeenCalledOnce()
    await post()
    tool.execute = async () => ({ labels: ['replacement'] })
    const invalid = registry.postResult(async (_call, original) => original)
    await expect(registry.execute(call)).rejects.toThrow('result policy did not delegate')
    await invalid()
  } finally { await post(); await dispose(); await release() }
})

it('rejects a captured model schema after its exact registration is replaced', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const { call, release } = execution(agents, scope)
  const replacementExecute = vi.fn(async (): Promise<NativeToolResult> => ({ content: [], isError: false }))
  const removeOriginal = registry.register(contribution(async () => ({ content: [], isError: false })))
  const snapshot = registry.captureModelSnapshot(['held'], scope)
  expect(snapshot.schemas.map(schema => schema.name)).toEqual(['held'])
  await removeOriginal()
  const installReplacement = registry.register(contribution(replacementExecute))
  try {
    await expect(snapshot.execute(call)).rejects.toMatchObject({ code: 'TOOL_DENIED' })
    expect(replacementExecute).not.toHaveBeenCalled()
  } finally {
    await snapshot.dispose()
    await installReplacement()
    await release()
  }
})

it('keeps queued and delegated same-name calls with their scoped Agent and Session', async () => {
  const scope = new NativeScope()
  const firstScope = new NativeScope(scope)
  const secondScope = new NativeScope(scope)
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const firstAgent = { id: NativeAgentId('first-tool-agent'), scope: firstScope }
  const secondAgent = { id: NativeAgentId('second-tool-agent'), scope: secondScope }
  const firstSessionId = SessionId('first-tool-session')
  const secondSessionId = SessionId('second-tool-session')
  const firstSession = Session.create(firstSessionId, undefined, {
    version: SESSION_FORMAT_VERSION, id: firstSessionId, createdAt: 0, isSeeded: false,
  })
  const secondSession = Session.create(secondSessionId, undefined, {
    version: SESSION_FORMAT_VERSION, id: secondSessionId, createdAt: 0, isSeeded: false,
  })
  const firstParent: NativeToolExecution = {
    agent: firstAgent, callId: ToolCallId('first-parent'), name: 'same_name', arguments: {}, session: firstSession,
    signal: new AbortController().signal, appendEvent: async (type, data, ...opts) => firstSession.append(type, data, ...opts),
  }
  const secondParent: NativeToolExecution = {
    agent: secondAgent, callId: ToolCallId('second-parent'), name: 'same_name', arguments: {}, session: secondSession,
    signal: new AbortController().signal, appendEvent: async (type, data, ...opts) => secondSession.append(type, data, ...opts),
  }
  const delegationContext = Object.freeze({ depth: 1, maxDepth: 2, cwd: '/workspace', provider: 'fixture', model: 'fixture',
    maxSteps: 1, toolNames: Object.freeze(['same_name']), builtinToolNames: Object.freeze([]), programToolNames: Object.freeze([]) })
  const firstCall: NativeToolExecution = { ...firstParent, callId: ToolCallId('first-queued'), parent: firstParent, delegationContext }
  const secondCall: NativeToolExecution = { ...secondParent, callId: ToolCallId('second-delegated'), parent: secondParent, delegationContext }
  const firstRegistration = agents.register(firstAgent)
  const secondRegistration = agents.register(secondAgent)
  const firstTool = registry.registerValueTool({
    schema: { name: 'same_name', description: 'First scoped tool.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: (_call, value) => {
      if (typeof value !== 'string') throw new Error('first scoped output must be text')
      return { content: [{ type: 'text', text: value }], isError: false }
    } },
    async execute(call) {
      expect(agents.requireInitiator()).toBe(firstAgent)
      expect(call.agent).toBe(firstAgent)
      expect(call.session).toBe(firstSession)
      expect(call.parent).toBe(firstParent)
      expect(call.delegationContext).toBe(delegationContext)
      return 'first'
    },
  }, firstScope)
  const secondTool = registry.registerValueTool({
    schema: { name: 'same_name', description: 'Second scoped tool.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: (_call, value) => {
      if (typeof value !== 'string') throw new Error('second scoped output must be text')
      return { content: [{ type: 'text', text: value }], isError: false }
    } },
    async execute(call) {
      expect(agents.requireInitiator()).toBe(secondAgent)
      expect(call.agent).toBe(secondAgent)
      expect(call.session).toBe(secondSession)
      expect(call.parent).toBe(secondParent)
      expect(call.delegationContext).toBe(delegationContext)
      return 'second'
    },
  }, secondScope)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  try {
    const firstExecution = agents.execution(firstAgent)
    const occupying = firstExecution.run(async () => {
      entered.resolve(undefined)
      await release.promise
    })
    await entered.promise
    const queued = firstExecution.run(async () => registry.execute(firstCall))
    const delegated = agents.execution(secondAgent).run(async () => registry.execute(secondCall))
    await expect(delegated).resolves.toMatchObject({ value: 'second', content: [{ type: 'text', text: 'second' }] })
    release.resolve(undefined)
    await occupying
    await expect(queued).resolves.toMatchObject({ value: 'first', content: [{ type: 'text', text: 'first' }] })
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([registry.clear(), firstTool(), secondTool(), firstRegistration(), secondRegistration()])
  }
})

it('captures PTC business bindings without promoting them to direct model calls', async () => {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope, 'ptc')
  const { call, release } = execution(agents, scope, 'business')
  const removeRunCode = registry.registerValueTool({
    schema: { name: 'run_code', description: 'Run code.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    async execute() { return 'done' },
  })
  const executeBusiness = vi.fn(async () => 'business-result')
  const removeBusiness = registry.registerValueTool({
    schema: { name: 'business', description: 'Business tool.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    execute: executeBusiness,
  })
  const snapshot = registry.captureProgramSnapshot(['business'], scope)
  try {
    expect(registry.modelSchemas(scope).map(schema => schema.name)).toEqual(['run_code'])
    expect(snapshot.programSchemas?.map(schema => schema.name)).toEqual(['business'])
    const admitted = await snapshot.prepare(call)
    expect(await admitted.execute()).toEqual({ content: [], isError: false, value: 'business-result' })
    registry.acceptResult(admitted.call, { content: [], isError: false, value: 'business-result' })
    expect(executeBusiness).toHaveBeenCalledOnce()
  } finally {
    await snapshot.dispose()
    await removeBusiness()
    await removeRunCode()
    await release()
  }
})

it('lets a descendant scope select PTC without changing the Provider catalog', async () => {
  const scope = new NativeScope()
  const child = new NativeScope(scope)
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const removeRunCode = registry.registerValueTool({
    schema: { name: 'run_code', description: 'Run code.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    async execute() { return 'done' },
  })
  const removeBusiness = registry.registerValueTool({
    schema: { name: 'business', description: 'Business tool.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    async execute() { return 'business-result' },
  })
  const restore = registry.presentAs('ptc', child)
  const { call, release } = execution(agents, child, 'business')
  try {
    expect(registry.modelModeFor(scope)).toBe('both')
    expect(registry.modelModeFor(child)).toBe('ptc')
    expect(registry.modelSchemas(scope).map(schema => schema.name)).toEqual(['run_code', 'business'])
    expect(registry.modelSchemas(child).map(schema => schema.name)).toEqual(['run_code'])
    expect(registry.sdkSchemas(child).map(schema => schema.name)).toEqual(['run_code', 'business'])
    await expect(registry.executeModelCall(call)).rejects.toThrow(/unavailable in ptc mode/)
    expect(() => registry.presentAs('both', child)).toThrow(/duplicate contribution/)
    expect(() => registry.presentAs('ptc', scope)).toThrow(/descendant scope/)
  } finally {
    restore()
    expect(registry.modelSchemas(child).map(schema => schema.name)).toEqual(['run_code', 'business'])
    await removeBusiness()
    await removeRunCode()
    await release()
  }
})

it('hides an inherited tool denied before the ancestor registers it', async () => {
  const scope = new NativeScope()
  const child = new NativeScope(scope)
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeToolRegistry(agents, scope)
  const restore = registry.restrict({ deny: ['workflow'] }, child)
  const remove = registry.registerValueTool({
    schema: { name: 'workflow', description: 'Workflow.', parameters: { type: 'object', properties: {} } },
    output: { schema: { type: 'string' }, render: () => ({ content: [], isError: false }) },
    async execute() { return 'ran' },
  })
  try {
    expect(registry.schemas(scope).map(schema => schema.name)).toEqual(['workflow'])
    expect(registry.schemas(child).map(schema => schema.name)).toEqual([])
  } finally {
    restore()
    await remove()
  }
})

it('drains a replaced contribution before resources acquired after registration are released', async () => {
  const scope = new NativeScope()
  const entered = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  let resourceReleased = false
  let successorActive = false
  const capture: NativePlugin = { apiVersion: 1, name: 'capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
    resolve: () => (ctx) => { tools = ctx.require('tools'); agents = ctx.require('agents') } }
  const old: NativePlugin = { apiVersion: 1, name: 'old', targets: ['host'], requires: ['tools'], provides: [],
    resolve: () => (ctx) => {
      ctx.effect(ctx.require('tools').register(contribution(async ({ signal }) => {
        signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
        entered.resolve(undefined)
        await finish.promise
        expect(resourceReleased).toBe(false)
        return { content: [], isError: false }
      }), ctx.scope))
      ctx.own(() => { resourceReleased = true })
    } }
  const next: NativePlugin = { apiVersion: 1, name: 'next', targets: ['host'], requires: ['tools'], provides: [],
    resolve: () => (ctx) => {
      expect(resourceReleased).toBe(true)
      successorActive = true
      ctx.effect(ctx.require('tools').register(contribution(async () => ({ content: [], isError: false })), ctx.scope))
    } }
  const shared = [agentPlugin, toolsPlugin, capture].map(plugin => ({ plugin, scope, config: undefined }))
  const host = new NativeHost(resolveInstallation([...shared, { plugin: old, scope, config: undefined }], 'host'))
  await host.start()
  const { call, release } = execution(agents!, scope)
  const running = tools!.execute(call)
  const rejected = expect(running).rejects.toThrow()
  await entered.promise
  const replacing = host.replace(resolveInstallation([...shared, { plugin: next, scope, config: undefined }], 'host'))
  try {
    await cancelled.promise
    expect(tools!.schemas()).toEqual([])
    expect(resourceReleased).toBe(false)
    expect(successorActive).toBe(false)
    finish.resolve(undefined)
    await Promise.all([rejected, replacing])
    expect(successorActive).toBe(true)
    await expect(tools!.execute(call)).resolves.toEqual({ content: [], isError: false })
  } finally {
    finish.resolve(undefined)
    await Promise.allSettled([running, replacing])
    await release()
    await host.stop()
  }
})
