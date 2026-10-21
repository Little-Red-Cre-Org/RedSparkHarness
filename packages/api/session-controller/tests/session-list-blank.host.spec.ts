/**
 * The summary blank bit excludes sessions with turns or scheduler reminder records,
 * not "log empty": standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it, so running /plan or /goal on a
 * fresh session keeps it list-hidden and reusable, while the first accepted
 * prompt's turn/start clears it. The host/session-added frame shares the
 * same predicate function (covered by the workspace spec's frame assertion).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = conversation not started', () => {
  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })
})


it('keeps a durable reminder journal visible without a model turn', async () => {
  const { ctx, remote, attach } = await harness()
  try {
    const session = ctx.sessions.create()
    attach(session)
    const updates: boolean[] = []
    ctx.on('api-session/added', (summary) => { if (summary.sessionId === session.id) updates.push(summary.blank) })
    session.append('user/message', createUserMessage({
      source: { kind: 'plugin', plugin: 'task-scheduler', form: 'notice', summary: '喝水提醒' },
      content: [{ type: 'text', text: '16:05:00 已提醒' }],
    }), { surfaceOp: 'append' })
    expect(await listBlank(remote, session.id)).toBe(false)
    expect(updates).toContain(false)
    expect(session.snapshotEvents().some(event => event.type === 'turn/start')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})


it('does not turn ordinary plugin context into a conversation', async () => {
  const { ctx, remote, attach } = await harness()
  try {
    const session = ctx.sessions.create(); attach(session)
    session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'context', form: 'notice', summary: 'Configuration' }, content: [{ type: 'text', text: 'Context only' }] }), { surfaceOp: 'append' })
    expect(await listBlank(remote, session.id)).toBe(true)
  } finally { await ctx.fiber.dispose() }
})
