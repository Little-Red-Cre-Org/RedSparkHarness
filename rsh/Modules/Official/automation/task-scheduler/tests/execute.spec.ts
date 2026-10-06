import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { agentExecutor } from '../src/execute.ts'
import type { ClaimedRun, RunId, Task, TaskId } from '../src/types.ts'

function compatibilityFixture(failFlush = false) {
  const sessionId = SessionId('scheduled-execution')
  const otherSession = { id: SessionId('unrelated-execution') } as Session
  let seq = 8
  const session = { id: sessionId, get seq() { return seq } } as Session
  const order: string[] = []
  const listeners = new Set<(observed: Session, event: SessionEvent) => void>()
  const blocked: SessionEvent<'turn/end'> = {
    type: 'turn/end', seq: SessionSeq(seq), time: Date.now(), data: { turn: 1, reason: { kind: 'blocked' } },
  }
  const unrelated: SessionEvent<'turn/end'> = {
    type: 'turn/end', seq: SessionSeq(100), time: Date.now(), data: { turn: 99, reason: { kind: 'error',
      error: { message: 'unrelated', code: 'UNKNOWN' } } },
  }
  const completed: SessionEvent<'turn/end'> = {
    type: 'turn/end', seq: SessionSeq(seq + 1), time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } },
  }
  const agent = {
    session,
    followup: vi.fn(() => {
      for (const listener of listeners) listener(session, blocked)
      for (const listener of listeners) listener(session, completed)
      for (const listener of listeners) listener(otherSession, unrelated)
      seq = 10
      order.push('followup')
    }),
    whenIdle: vi.fn(async () => { order.push('idle') }),
    cancel: vi.fn(),
  }
  const flush = vi.fn(async (observed: Session) => {
    expect(observed).toBe(session)
    order.push('flush')
    if (failFlush) throw new Error('durability barrier failed')
  })
  const context = {
    on: (_name: string, listener: (observed: Session, event: SessionEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener); order.push('unobserve') }
    },
    permissionPresets: { resolve: vi.fn(), set: vi.fn() },
    agentPresets: { resolve: vi.fn(async () => ({ id: 'standard' })), standingKeyFor: vi.fn(async () => 'standing') },
    workspaceRegistry: { create: vi.fn(async () => ({ path: 'C:/workspace', attachSession: vi.fn(async () => {}) })) },
    agents: { get: vi.fn(() => undefined), create: vi.fn(async () => ({ agent, dispose: async () => { order.push('dispose') } })) },
    sessionTitle: { rename: vi.fn() },
    sessions: { flush },
  }
  const task: Task = {
    id: brandString<TaskId>('task'), ownerSessionId: 'owner', title: 'Check', prompt: 'Check this task.',
    workspace: 'C:/workspace', agentPreset: 'standard', permissionPreset: 'read-only', provider: 'mock', model: 'mock',
    at: new Date().toISOString(), state: 'active', nextAt: null,
  }
  const run: ClaimedRun = {
    id: brandString<RunId>('run'), taskId: task.id, scheduledAt: Date.now(), startedAt: Date.now(),
    deadline: Date.now() + 1000, finishedAt: null, state: 'running', sessionId: String(sessionId), detail: '',
  }
  const execute = agentExecutor(context as unknown as Context)
  return { context, listeners, order, execute: () => execute(task, run, new AbortController().signal), sessionId }
}

it('settles compatibility execution from the latest current-session turn event after flush', async () => {
  const state = compatibilityFixture()

  const result = await state.execute()

  expect(result).toMatchObject({ state: 'completed', sessionId: String(state.sessionId) })
  expect(state.context.sessions.flush).toHaveBeenCalledTimes(1)
  expect([...state.listeners]).toHaveLength(0)
  expect(state.order).toEqual(['followup', 'idle', 'flush', 'unobserve', 'dispose'])
})

it('releases the event observer and does not report completion when flush fails', async () => {
  const state = compatibilityFixture(true)

  const result = await state.execute()

  expect(result.state).toBe('failed')
  expect(result.detail).toContain('durability barrier failed')
  expect([...state.listeners]).toHaveLength(0)
  expect(state.order).toEqual(['followup', 'idle', 'flush', 'unobserve', 'dispose'])
})
