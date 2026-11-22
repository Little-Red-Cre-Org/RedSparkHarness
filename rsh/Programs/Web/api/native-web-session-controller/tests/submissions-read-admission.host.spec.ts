/** Read-only session/submissions admission beside session/mode-controls. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { localFilesystemPlugin } from '@redspark/rsh-fs-local/native'
import { plugin as storagePlugin } from '@redspark/rsh-session-persistence-jsonl/native'
import type { NativeSessionPersistenceOperations, SessionAccess, SessionPersistenceOpenOptions } from '@redspark/rsh-session-persistence/native'
import type { SessionHandle } from '@redspark/rsh-session-persistence/native'
import { plugin as agentPlugin, NativeAgentId, type NativeAgentExecution, type NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { plugin as executionPlugin, type NativeActiveSessionOperations } from '@redspark/rsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@redspark/rsh-native-model-execution/native'
import { plugin as meterPlugin } from '@redspark/rsh-token-meter/native'
import { plugin as toolsPlugin } from '@redspark/rsh-native-tools/native'
import { SessionId } from '@redspark/rsh-session/native'
import { MockAdapter } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { NativeHeadlessApplication, plugin as appPlugin } from '@redspark/rsh-native-headless/native'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'

interface WriteGate {
  readonly entered: Promise<void>
  release(): void
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'rsh-submissions-read-'))
  const scope = new NativeScope()
  const lifetime = new AbortController()
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let active: NativeActiveSessionOperations | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'submissions-read-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'activeSessions'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      active = context.require('activeSessions')
    },
  }
  const modelProvider: NativePlugin = {
    apiVersion: 1, name: 'submissions-read-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => {
      context.provide('model', new MockAdapter([]))
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 2, builtinTools: false } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: meterPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || storage === undefined || agents === undefined || active === undefined) {
    throw new Error('missing submissions-read fixture services')
  }
  const persistence = storage
  const open = persistence.open.bind(persistence)
  let gate: { entered: PromiseWithResolvers<undefined>; release: PromiseWithResolvers<undefined> } | undefined
  persistence.open = (id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> => {
    const pending = access === 'write' ? gate : undefined
    if (pending === undefined) return open(id, access, options)
    gate = undefined
    pending.entered.resolve(undefined)
    return pending.release.promise.then(() => {
      options?.signal?.throwIfAborted()
      return open(id, access, options)
    })
  }
  const service = new NativeWebSessionService(app, persistence, active, resolveNativeWebSessionConfig({
    cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 2, builtinTools: false,
    maxPendingRequests: 4, maxHistoryEvents: 50, maxPromptChars: 1000, maxFollowBufferBytes: 100_000,
    maxFollowers: 2, maxPendingHumanRequests: 1,
  }), lifetime.signal)
  const signal = lifetime.signal
  return {
    service, agents, signal,
    armWriteGate(): WriteGate {
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      gate = { entered, release }
      return { entered: entered.promise, release: () => { release.resolve(undefined) } }
    },
    async createSession(): Promise<SessionId> {
      const created = await service.handle('session/create', {}, signal)
      if (!created.ok || created.value === null || typeof created.value !== 'object' || !('sessionId' in created.value)
        || typeof created.value.sessionId !== 'string') {
        throw new Error(created.ok ? 'session/create returned no session id' : created.error.message)
      }
      return SessionId(created.value.sessionId)
    },
    execution(sessionId: SessionId): NativeAgentExecution {
      const agent = agents!.get(NativeAgentId(sessionId))
      if (agent === undefined) throw new Error('missing session agent')
      return agents!.execution(agent)
    },
    async close(): Promise<void> {
      gate?.release.resolve(undefined)
      lifetime.abort()
      await service.close()
      await host.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

it('returns submissions while a read-only mode-controls read holds idle admission', async () => {
  const state = await harness()
  const held: WriteGate[] = []
  try {
    const sessionId = await state.createSession()
    const execution = state.execution(sessionId)
    const runMaintenance = execution.runMaintenance.bind(execution)
    let admissions = 0
    let overlapping: { readonly kind: 'queued' } | { readonly kind: 'rejected'; readonly error: unknown } | undefined
    execution.runMaintenance = (task, options) => {
      const index = ++admissions
      try {
        const pending = runMaintenance(task, options)
        if (index === 2) overlapping = { kind: 'queued' }
        return pending
      } catch (error: unknown) {
        if (index === 2) overlapping = { kind: 'rejected', error }
        throw error
      }
    }
    const gate = state.armWriteGate()
    held.push(gate)
    // The resume write open runs only after runMaintenance claims the Agent and before an owner is published.
    const modeControls = state.service.handle('session/mode-controls', { sessionId }, state.signal)
    await gate.entered
    const submissions = state.service.handle('session/submissions', { sessionId }, state.signal)
    await vi.waitFor(() => { expect(overlapping).toEqual({ kind: 'queued' }) })
    gate.release()
    await expect(modeControls).resolves.toMatchObject({ ok: true, value: { planMode: { available: false, active: false } } })
    await expect(submissions).resolves.toMatchObject({ ok: true, value: { submissions: [] } })
  } finally {
    for (const gate of held) gate.release()
    await state.close()
  }
})

it('refuses a submissions read and a submission edit while exclusive maintenance is admitted', async () => {
  const state = await harness()
  const held: WriteGate[] = []
  try {
    const sessionId = await state.createSession()
    const gate = state.armWriteGate()
    held.push(gate)
    const edit = state.service.handle('session/submission/edit', {
      sessionId, requestId: 'pending-edit', text: 'mutate the inbox',
    }, state.signal)
    await gate.entered
    await expect(state.service.handle('session/submissions', { sessionId }, state.signal)).resolves.toEqual({
      ok: false, error: { code: 'native/session', message: 'native-agent: Agent is busy', details: {} },
    })
    await expect(state.service.handle('session/submission/edit', {
      sessionId, requestId: 'second-edit', text: 'still exclusive',
    }, state.signal)).resolves.toMatchObject({
      ok: false, error: { code: 'native/session', message: 'native-agent: Agent is busy', details: { requestId: 'second-edit' } },
    })
    gate.release()
    await expect(edit).resolves.toEqual({
      ok: true, value: { requestId: 'pending-edit', outcome: 'stale' },
    })
  } finally {
    for (const gate of held) gate.release()
    await state.close()
  }
})

it('returns the submissions snapshot when mode-controls is idle', async () => {
  const state = await harness()
  try {
    const sessionId = await state.createSession()
    const snapshot = await state.service.handle('session/submissions', { sessionId }, state.signal)
    expect(snapshot).toMatchObject({ ok: true, value: { submissions: [] } })
    if (!snapshot.ok || snapshot.value === null || typeof snapshot.value !== 'object' || !('throughSeq' in snapshot.value)) {
      throw new Error('session/submissions returned no snapshot')
    }
    expect(typeof snapshot.value.throughSeq).toBe('number')
  } finally {
    await state.close()
  }
})
