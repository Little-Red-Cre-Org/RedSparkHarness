import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  createUserMessage,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as Archify from '@deepseek-ai/dsh-archify'
import { ARCHIFY_SKILL_DIRECTORY_ENV } from '../src/shared.ts'
import { NativeHost, NativeScope, resolveInstallation } from '@deepseek-ai/dsh-native-runtime'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as nativeAgentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as nativeToolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as nativeArchifyPlugin } from '@deepseek-ai/dsh-archify/native'
import { plugin as nativeSkillRegistryPlugin } from '@deepseek-ai/dsh-skill/native'
import type { NativeSkillInvocations, NativeSkills } from '@deepseek-ai/dsh-skill/native'
import { plugin as nativeToolSkillPlugin } from '@deepseek-ai/dsh-tool-skill/native'
import { plugin as nativeShellEnvPlugin } from '@deepseek-ai/dsh-shell-env/native'
import type { ShellEnvironment } from '@deepseek-ai/dsh-shell-env/definition'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import { plugin as nativeRequestContextPlugin } from '@deepseek-ai/dsh-request-context/native'
import { NativeRequestContextRegistry } from '@deepseek-ai/dsh-request-context'
import { NativeRequestContextProviderId, type NativeRequestContextProvider, type NativeRequestContexts } from '@deepseek-ai/dsh-request-context-definition'

const OFF = ReasoningEffortId('off')
const HIGH = ReasoningEffortId('high')
let agentNumber = 0

function testAgent(cwd = '/workspace'): Agent {
  const id = SessionId(`archify-routing-${++agentNumber}`)
  return {
    id,
    options: {},
    session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false }),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function user(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function propose(ctx: Context, agent: Agent, messages: UserMessage[]): Promise<PreStepDecision> {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

async function routingContext(config: Archify.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(ShellEnv)
  await ctx.plugin(Archify, config)
  return ctx
}

class CapturingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [{ id: OFF, name: 'Off' }, { id: HIGH, name: 'High' }],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe('dsh-archify', () => {
  it('withdraws its Native Skill, shell environment, and request context with the installation', async () => {
    const scope = new NativeScope()
    const requests = {
      skills: { plugin: nativeSkillRegistryPlugin, scope, config: undefined },
      shellEnv: { plugin: nativeShellEnvPlugin, scope, config: undefined },
      requestContexts: { plugin: nativeRequestContextPlugin, scope, config: undefined },
      archify: { plugin: nativeArchifyPlugin, scope, config: undefined },
    }
    let skills: NativeSkills | undefined
    let shellEnv: ShellEnvironment<NativeToolExecution> | undefined
    let requestContexts: NativeRequestContexts | undefined
    const observer: NativePlugin = {
      apiVersion: 1, name: 'archify-disposal-observer', targets: ['host'],
      requires: ['skills', 'shellEnv', 'requestContexts'], provides: [],
      resolve: () => (context) => {
        skills = context.require('skills')
        shellEnv = context.require('shellEnv')
        requestContexts = context.require('requestContexts')
      },
    }
    const host = new NativeHost(resolveInstallation([
      ...Object.values(requests), { plugin: observer, scope, config: undefined },
    ], 'host'))
    try {
      await host.start()
      if (skills === undefined || shellEnv === undefined || requestContexts === undefined) {
        throw new Error('Native Archify disposal observer was not activated')
      }
      expect(await skills.list({ scope, cwd: '/workspace' })).toEqual([expect.objectContaining({
        name: 'archify', provider: 'archify', invocation: { modelInvocable: false, userInvocable: true },
      })])
      expect(shellEnv.list()).toContainEqual(expect.objectContaining({
        key: ARCHIFY_SKILL_DIRECTORY_ENV, contributor: 'archify',
      }))
      expect(requestContexts.hasProviders(scope)).toBe(true)

      await host.remove(requests.archify)

      expect(host.signal.aborted).toBe(false)
      expect(host.diagnostics().find(item => item.name === nativeArchifyPlugin.name)?.state).toBe('disposed')
      expect(host.diagnostics().filter(item => item.name !== nativeArchifyPlugin.name).every(item => item.state === 'ready')).toBe(true)
      expect(await skills.list({ scope, cwd: '/workspace' })).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'archify', provider: 'archify' }),
      ]))
      expect(shellEnv.list()).not.toContainEqual(expect.objectContaining({
        key: ARCHIFY_SKILL_DIRECTORY_ENV, contributor: 'archify',
      }))
      expect(requestContexts.hasProviders(scope)).toBe(false)
    } finally { await host.stop() }

    const consumerScope = new NativeScope()
    const consumerRequests = {
      skills: { plugin: nativeSkillRegistryPlugin, scope: consumerScope, config: undefined },
      agents: { plugin: nativeAgentPlugin, scope: consumerScope, config: undefined },
      tools: { plugin: nativeToolsPlugin, scope: consumerScope, config: undefined },
      shellEnv: { plugin: nativeShellEnvPlugin, scope: consumerScope, config: undefined },
      requestContexts: { plugin: nativeRequestContextPlugin, scope: consumerScope, config: undefined },
      toolSkill: { plugin: nativeToolSkillPlugin, scope: consumerScope, config: undefined },
      archify: { plugin: nativeArchifyPlugin, scope: consumerScope, config: undefined },
    }
    let skillInvocations: NativeSkillInvocations | undefined
    let consumerContexts: NativeRequestContexts | undefined
    const consumerObserver: NativePlugin = {
      apiVersion: 1, name: 'skill-invocation-disposal-observer', targets: ['host'],
      requires: ['requestContexts'], optional: ['skillInvocations'], provides: [],
      resolve: () => (context) => {
        consumerContexts = context.require('requestContexts')
        skillInvocations = context.optional('skillInvocations')
      },
    }
    const consumerHost = new NativeHost(resolveInstallation([
      ...Object.values(consumerRequests), { plugin: consumerObserver, scope: consumerScope, config: undefined },
    ], 'host'))
    try {
      await consumerHost.start()
      if (skillInvocations === undefined || consumerContexts === undefined) {
        throw new Error('Native ToolSkill disposal observer was not activated')
      }
      await expect(skillInvocations.canInvoke('archify', {
        scope: consumerScope, cwd: '/workspace', signal: new AbortController().signal, requestContexts: consumerContexts,
      })).resolves.toBe(true)
      const foreignContexts = new NativeRequestContextRegistry(consumerScope)
      try {
        await expect(skillInvocations.canInvoke('archify', {
          scope: consumerScope, cwd: '/workspace', signal: new AbortController().signal, requestContexts: foreignContexts,
        })).resolves.toBe(false)
      } finally { await foreignContexts.dispose() }
      const child = new NativeScope(consumerScope)
      const shadowProvider: NativeRequestContextProvider = {
        id: NativeRequestContextProviderId('dsh-tool-skill'), order: 100,
        prepare: async () => ({ messages: [], commit() {} }),
      }
      const removeShadow = consumerContexts.register(child, shadowProvider)
      try {
        await expect(skillInvocations.canInvoke('archify', {
          scope: child, cwd: '/workspace', signal: new AbortController().signal, requestContexts: consumerContexts,
        })).resolves.toBe(false)
      } finally { await removeShadow() }
      expect(consumerContexts.hasProviders(consumerScope)).toBe(true)
      await consumerHost.remove(consumerRequests.toolSkill)
      expect(consumerHost.diagnostics().find(item => item.name === nativeToolSkillPlugin.name)?.state).toBe('disposed')
      await expect(skillInvocations.canInvoke('archify', {
        scope: consumerScope, cwd: '/workspace', signal: new AbortController().signal, requestContexts: consumerContexts,
      })).rejects.toThrow()
      expect(consumerContexts.hasProviders(consumerScope)).toBe(true)
    } finally { await consumerHost.stop() }
  })

  it('provides one hidden, user-invocable upstream Skill body on demand', async () => {
    const ctx = await routingContext()
    try {
      const skills = await ctx.skills.list({ cwd: '/workspace' })
      expect(skills).toEqual([expect.objectContaining({
        name: 'archify',
        provider: 'archify',
        invocation: { modelInvocable: false, userInvocable: true },
      })])
      const definition = await ctx.skills.get('archify', { cwd: '/workspace' })
      expect(definition?.content).toContain('node bin/archify.mjs deliver')
      expect(definition?.content).toContain('DSH_ARCHIFY_SKILL_DIR')
      expect(ctx.shellEnv.collect({} as never)).toEqual(expect.objectContaining({
        DSH_ARCHIFY_SKILL_DIR: expect.any(String) as unknown,
      }))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves ordinary explanation requests untouched and only scans direct user text', async () => {
    const ctx = await routingContext()
    try {
      const agent = testAgent()
      await expect(propose(ctx, agent, [user('请解释 Godot 引擎架构，不需要图。')])).resolves.toMatchObject({
        kind: 'enter',
        messages: [expect.objectContaining({ source: { kind: 'user' } })],
      })
      const pluginText = createUserMessage({
        content: [{ type: 'text', text: '请输出 Godot 架构图。' }],
        source: { kind: 'plugin', plugin: 'untrusted-text' },
      })
      const decision = await propose(ctx, agent, [pluginText])
      expect(decision).toMatchObject({ kind: 'enter', messages: [pluginText] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('loads Archify once when a direct request combines delivery and diagram intent', async () => {
    const ctx = await routingContext()
    try {
      const decision = await propose(ctx, testAgent(), [user('请输出 Godot 的架构图和引擎运行链路。')])
      expect(decision).toMatchObject({
        kind: 'enter',
        messages: [
          expect.objectContaining({ source: { kind: 'user' } }),
          expect.objectContaining({
            source: { kind: 'archify-auto-invocation', form: 'instructions', reason: 'diagram-delivery-request' },
            content: [expect.objectContaining({ type: 'text', text: expect.stringContaining('<skill_content name="archify">') as unknown })],
          }),
        ],
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps direct /archify invocation separate from automatic routing', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(ShellEnv)
      await ctx.plugin(Archify, { maxUserTextChars: 32 })
      await ctx.plugin(ToolSkill)
      const decision = await propose(ctx, testAgent(), [
        user(`Generate a Godot architecture diagram ${'x'.repeat(40)}`),
        user('/archify 请输出 Godot 架构图。'),
      ])
      expect(decision).toMatchObject({
        kind: 'enter',
        messages: [
          expect.objectContaining({ source: { kind: 'user' } }),
          expect.objectContaining({ source: { kind: 'user' } }),
          expect.objectContaining({ source: { kind: 'skill-invocation', name: 'archify', form: 'instructions' } }),
        ],
      })
      expect(decision.kind === 'enter' && decision.messages.some(message => message.source.kind === 'archify-auto-invocation')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('records the automatic instructions in a production agent-loop request', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(ShellEnv)
      await ctx.plugin(Archify)
      const adapter = new CapturingAdapter()
      ctx.llm.registerAdapter(['mock'], adapter)
      const loop = await mountAgentLoopTestHarness(ctx)
      const agent = await loop.create(SessionId('archify-product-route'), { provider: 'mock', model: 'mock' }, { cwd: '/workspace' })
      const idle = waitForIdle(ctx, agent)
      agent.followup(user('Generate a Godot architecture diagram and runtime flow.'))
      await idle

      const requestText = adapter.requests.flatMap(request => request.messages)
        .flatMap(message => message.content)
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      expect(requestText).toContain('<skill_content name="archify">')
      const injection = agent.session.snapshotEvents().find(event => event.type === 'user/message'
        && event.data.source.kind === 'archify-auto-invocation')
      expect(injection?.type === 'user/message' && injection.data.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('node bin/archify.mjs deliver') as unknown }),
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('honors the deployment switch and bounded scan limit', async () => {
    const disabled = await routingContext({ autoInvoke: false })
    const limited = await routingContext({ maxUserTextChars: 4 })
    try {
      await expect(propose(disabled, testAgent(), [user('请输出 Godot 架构图。')])).resolves.toMatchObject({
        kind: 'enter', messages: [expect.objectContaining({ source: { kind: 'user' } })],
      })
      await expect(propose(limited, testAgent(), [user('xxxx请输出 Godot 架构图。')])).resolves.toMatchObject({
        kind: 'enter', messages: [expect.objectContaining({ source: { kind: 'user' } })],
      })
    } finally {
      await Promise.all([disabled.fiber.dispose(), limited.fiber.dispose()])
    }
  })
})
