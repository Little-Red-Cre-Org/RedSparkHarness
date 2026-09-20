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
      await ctx.plugin(Archify)
      await ctx.plugin(ToolSkill)
      const decision = await propose(ctx, testAgent(), [user('/archify 请输出 Godot 架构图。')])
      expect(decision).toMatchObject({
        kind: 'enter',
        messages: [
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
