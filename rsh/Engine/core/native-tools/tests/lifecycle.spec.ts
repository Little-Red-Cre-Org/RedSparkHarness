/** Canonical value processing and quiescent contribution replacement. */
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { NativeToolRegistry, type NativeToolExecution, type NativeToolContribution, type NativeValueToolContribution } from '../src/index.ts'
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
