/** Native Host fork, direct subagent catalog, prompt, interrupt, history, and follow. */
import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootForkRequest } from '@redspark/rsh-native-session-execution'
import type { NativeHeadlessApplication } from '@redspark/rsh-native-headless/native'
import type { NativeSubagentCatalogEntry, NativeSubagentOperations } from '@redspark/rsh-native-subagent'
import type { AttachmentOperations } from '@redspark/rsh-attachment/native'
import type { AdmittedPromptContentPart, PromptContentPart } from '@redspark/rsh-attachment/types'
import { MessageId } from '@redspark/rsh-llm/native'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@redspark/rsh-session/native'
import type { SessionEvent, SessionHeader } from '@redspark/rsh-session/types'
import { SessionPersistenceNotFoundError, type NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { snapshotSubagentDescriptor } from '@redspark/rsh-subagent-protocol/descriptor'
import { createNativeSessionClient, NativeSessionRpcError } from '@redspark/rsh-client-native-session/native'
import type { ClientConnectionRpc } from '@redspark/rsh-client-connection/native'
import { NativeHostControlError } from '../src/subagent-host.ts'
import { NativeWebSessionService, resolveNativeWebSessionConfig, type NativeWebSelectionProviders } from '../src/native.ts'

const cwd = '/work'
const signal = new AbortController().signal

function header(id: string, createdAt: number, fields: {
  readonly cwd?: string
  readonly origin?: 'subagent'
  readonly parentSession?: string
  readonly isSeeded?: boolean
} = {}): SessionHeader {
  return {
    id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt, isSeeded: fields.isSeeded ?? false,
    ...fields.cwd === undefined ? {} : { cwd: fields.cwd },
    ...fields.origin === undefined ? {} : { origin: fields.origin },
    ...fields.parentSession === undefined ? {} : { parentSession: SessionId(fields.parentSession) },
  }
}

function endSeed(seq: number): SessionEvent {
  return { type: 'session/end-seed', seq: SessionSeq(seq), time: seq + 1, data: {} }
}

function descriptorEvent(seq: number, data: object): SessionEvent {
  return { type: 'subagent/descriptor', seq: SessionSeq(seq), time: seq + 1, data } as SessionEvent
}

function continuableEvents(label: string): SessionEvent[] {
  return [descriptorEvent(0, snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label }))]
}

function oneShotEvents(label?: string): SessionEvent[] {
  return [descriptorEvent(0, snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn', ...label === undefined ? {} : { label } }))]
}

interface OwnerOptions {
  readonly events?: readonly SessionEvent[]
  readonly invocation?: 'root' | 'delegated'
  readonly inheritedEventCount?: number
  readonly agent?: NativeAgent
}

interface TestOwner extends NativeActiveSessionOwner {
  emit(event: SessionEvent): void
}

function makeOwner(sessionHeader: SessionHeader, options: OwnerOptions = {}): TestOwner {
  const listeners: ((event: SessionEvent) => void)[] = []
  const events = options.events ?? [endSeed(0)]
  return {
    agent: options.agent ?? ({ name: sessionHeader.id } as unknown as NativeAgent),
    session: { id: sessionHeader.id, header: sessionHeader },
    invocation: options.invocation ?? 'root',
    inheritedEventCount: options.inheritedEventCount ?? 0,
    writerAvailable: true,
    readEvents: async () => events,
    onEvent: (listener: (event: SessionEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    emit(event: SessionEvent) {
      for (const listener of [...listeners]) listener(event)
    },
  } as TestOwner
}

interface StoredSession {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount?: number
  readonly openError?: 'missing' | 'secret' | 'close'
}

interface HarnessOptions {
  readonly owners?: readonly TestOwner[]
  readonly stored?: readonly StoredSession[]
  readonly subagents?: NativeSubagentOperations
  readonly attachments?: AttachmentOperations
  readonly executionFor?: ((agent: NativeAgent) => { readonly status: string }) | undefined
  readonly maxFollowers?: number
  readonly maxFollowBufferBytes?: number
  readonly maxPromptChars?: number
  readonly forkImpl?: (request: NativeRootForkRequest) => Promise<SessionId>
  readonly executeRootTurn?: NativeHeadlessApplication['executeRootTurn']
  readonly executeSessionOperation?: NativeHeadlessApplication['executeSessionOperation']
  readonly onOpen?: (id: SessionId) => void
}

function createHarness(options: HarnessOptions = {}) {
  const owners = [...(options.owners ?? [])]
  const stored = new Map((options.stored ?? []).map(record => [record.header.id, record]))
  const detached: ((owner: NativeActiveSessionOwner) => Promise<void>)[] = []
  const stat = vi.fn(async (id: SessionId) => stored.get(id) === undefined ? undefined : { header: stored.get(id)!.header, revision: 'rev' })
  const opened: SessionId[] = []
  const forks: NativeRootForkRequest[] = []
  const resumed: { readonly id: SessionId; readonly resume: boolean; readonly route: string }[] = []
  let cancelled = false
  const active = {
    owners: () => owners,
    owner: (agent: NativeAgent, session: { readonly id: SessionId }) => owners.find(candidate =>
      candidate.agent === agent && candidate.session === session),
    onAttached: () => async () => {},
    onDetached: (listener: (owner: NativeActiveSessionOwner) => Promise<void>) => {
      detached.push(listener)
      return async () => {
        const index = detached.indexOf(listener)
        if (index >= 0) detached.splice(index, 1)
      }
    },
  } as unknown as NativeActiveSessionOperations
  const executor = {
    rootExecution: {
      capture: () => ({ id: 'captured-route' }),
      fork: async (request: NativeRootForkRequest) => {
        forks.push(request)
        return options.forkImpl === undefined ? request.id : options.forkImpl(request)
      },
      cancel: () => { cancelled = true },
    },
    executeRootTurn: options.executeRootTurn ?? (async () => ({ exitCode: 0, answer: '' })),
    executeSessionOperation: options.executeSessionOperation ?? (async (request, operation, operationSignal) => {
      resumed.push({ id: request.id, resume: request.resume, route: String(request.route) })
      const sessionHeader = stored.get(request.id)?.header ?? owners.find(candidate => candidate.session.id === request.id)?.session.header
      const owner = makeOwner(sessionHeader ?? header(String(request.id), 0), { invocation: 'root' })
      return operation(owner, operationSignal)
    }),
    dispose: async () => {},
  } as unknown as NativeHeadlessApplication
  const lifetime = new AbortController()
  const selections = {
    subagents: options.subagents, attachments: options.attachments, executionFor: options.executionFor,
  } as NativeWebSelectionProviders
  const service = new NativeWebSessionService(executor,
    {
      stat, list: async () => [...stored.values()].map(record => ({ header: record.header, revision: 'rev' })),
      open: async (id: SessionId) => {
        opened.push(id)
        options.onOpen?.(id)
        const record = stored.get(id)
        if (record === undefined || record.openError === 'missing') throw new SessionPersistenceNotFoundError(id)
        if (record.openError === 'secret') throw new Error('SECRET-OPEN')
        return {
          header: record.header, inheritedEventCount: record.inheritedEventCount ?? 0,
          read: async () => ({ events: record.events }),
          close: async () => { if (record.openError === 'close') throw new Error('SECRET-CLOSE') },
        }
      },
    } as unknown as NativeSessionPersistenceOperations, active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
      maxSteps: 1, builtinTools: false, maxPendingRequests: 4, maxHistoryEvents: 40,
      maxPromptChars: options.maxPromptChars ?? 100, maxFollowBufferBytes: options.maxFollowBufferBytes ?? 100_000,
      maxFollowers: options.maxFollowers ?? 4, maxPendingHumanRequests: 2 }), lifetime.signal, selections)
  const rpc: ClientConnectionRpc = {
    call: (_target, endpoint, payload, callSignal) => service.handle(endpoint, payload, callSignal ?? lifetime.signal),
    response: (_target, endpoint, payload, callSignal) => {
      if (endpoint !== 'native-session/subagent-follow') throw new Error(`unexpected response endpoint ${endpoint}`)
      return service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: callSignal,
      }))
    },
  }
  const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 100_000 })
  return {
    owners, stored, stat, opened, forks, resumed, detached, service, client, get cancelled() { return cancelled },
    async detach(owner: NativeActiveSessionOwner) { await Promise.all(detached.map(listener => listener(owner))) },
    async close() {
      await client.close()
      await service.close()
    },
  }
}


async function expectCancellation(promise: Promise<unknown>, secret: string): Promise<void> {
  try {
    await promise
  } catch (error: unknown) {
    expect(error).not.toBeInstanceOf(NativeSessionRpcError)
    expect(String(error)).not.toContain(secret)
    return
  }
  throw new Error('expected cancellation')
}

async function rpcFailure(promise: Promise<unknown>): Promise<NativeSessionRpcError> {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof NativeSessionRpcError) return error
    throw error
  }
  throw new Error('expected a native Session RPC failure')
}

function childRow(id: string, parent: string, status: 'running' | 'idle' | 'ready', label: string): NativeSubagentCatalogEntry {
  return { kind: 'child', id: SessionId(id), label, status, parent: SessionId(parent) }
}

function diagnosticRow(id: string, reason: 'corrupt' | 'unsupported' | 'unavailable'): NativeSubagentCatalogEntry {
  return { kind: 'diagnostic', id: SessionId(id), reason }
}

it('forks a minted destination and hides source, anchor, and secret failures', async () => {
  const liveEvents = [endSeed(0)]
  const liveHeader = header('live-source', 1, { cwd })
  const anchoredHeader = header('anchored-source', 2, { cwd })
  const missingAnchor = header('missing-anchor', 3, { cwd })
  const openTurn = header('open-turn', 4, { cwd })
  const secretError = header('secret-error', 5, { cwd })
  const secretRaw = header('secret-raw', 6, { cwd })
  const abortForkHeader = header('abort-fork', 8, { cwd })
  const storedHeader = header('stored-source', 7, { cwd })
  const abortFork = new AbortController()
  const owners = [liveHeader, anchoredHeader, missingAnchor, openTurn, secretError, secretRaw, abortForkHeader]
    .map(sessionHeader => makeOwner(sessionHeader, { events: liveEvents }))
  const fixture = createHarness({
    owners,
    stored: [{ header: storedHeader, events: [endSeed(0)] }],
    forkImpl: async (request) => {
      if (request.source === SessionId('missing-anchor')) throw new Error('fork source event does not exist: TOKEN-SECRET')
      if (request.source === SessionId('open-turn')) throw new Error('fork source turn has not closed TOKEN-SECRET')
      if (request.source === SessionId('secret-error')) throw new Error('TOKEN-SECRET path /tmp/source')
      if (request.source === SessionId('secret-raw')) throw 'TOKEN-SECRET'
      if (request.source === SessionId('abort-fork')) {
        abortFork.abort()
        throw new Error('TOKEN-SECRET-FORK')
      }
      return request.id
    },
  })
  try {
    const invalid = await fixture.service.handle('session/fork', {}, signal)
    expect(invalid).toMatchObject({ ok: false, error: { code: 'gateway/bad-request', message: 'Session request is invalid.', details: {} } })
    expect(fixture.stat).not.toHaveBeenCalled()
    const minted = await fixture.client.fork(SessionId('live-source'), undefined)
    const anchored = await fixture.client.fork(SessionId('anchored-source'), 0)
    expect(minted.sessionId).not.toBe(SessionId('live-source'))
    expect(anchored.sessionId).not.toBe(SessionId('anchored-source'))
    expect(fixture.forks.map(request => ({ source: request.source, atSeq: request.atSeq, route: request.route }))).toEqual([
      { source: SessionId('live-source'), atSeq: undefined, route: 'captured-route' },
      { source: SessionId('anchored-source'), atSeq: SessionSeq(0), route: 'captured-route' },
    ])
    expect(fixture.forks[0]).not.toHaveProperty('atSeq')
    expect(fixture.stat).not.toHaveBeenCalled()
    expect(liveEvents).toEqual([endSeed(0)])
    expect(owners[0]?.session.header).toBe(liveHeader)
    const storedFork = await fixture.client.fork(SessionId('stored-source'), undefined)
    expect(storedFork.sessionId).not.toBe(SessionId('stored-source'))
    expect(fixture.stat).toHaveBeenCalledTimes(1)
    expect(fixture.stat.mock.calls[0]?.[0]).toBe(SessionId('stored-source'))
    expect(fixture.forks[2]).toMatchObject({ source: SessionId('stored-source'), route: 'root' })
    expect(fixture.forks[2]).not.toHaveProperty('atSeq')
    const missing = await rpcFailure(fixture.client.fork(SessionId('absent-source'), undefined))
    expect(missing).toMatchObject({ code: 'session/not-found', message: 'Session was not found.', details: { sessionId: SessionId('absent-source') } })
    const anchor = await rpcFailure(fixture.client.fork(SessionId('missing-anchor'), 2))
    const closed = await rpcFailure(fixture.client.fork(SessionId('open-turn'), undefined))
    const leaked = await rpcFailure(fixture.client.fork(SessionId('secret-error'), undefined))
    const raw = await rpcFailure(fixture.client.fork(SessionId('secret-raw'), undefined))
    expect(anchor.code).toBe('session/fork-unavailable')
    expect(closed.code).toBe('session/fork-unavailable')
    expect(leaked).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    expect(raw).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    for (const error of [anchor, closed, leaked, raw, missing]) {
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain('TOKEN-SECRET')
      expect(error.message).not.toContain('/tmp')
    }
    expect(fixture.cancelled).toBe(false)
    await expectCancellation(fixture.client.fork(SessionId('abort-fork'), undefined, abortFork.signal), 'TOKEN-SECRET')
  } finally {
    await fixture.close()
  }
})

it('lists direct children and keeps diagnostics free of reader secrets', async () => {
  const runningAgent = { name: 'cold-running' } as unknown as NativeAgent
  const idleAgent = { name: 'cold-idle' } as unknown as NativeAgent
  const owners = [
    makeOwner(header('live-parent', 1, { cwd })),
    makeOwner(header('fork-root', 3, { cwd, isSeeded: true, parentSession: 'older-root' })),
    makeOwner(header('cold-running', 12, { cwd, origin: 'subagent', parentSession: 'live-parent' }), {
      invocation: 'delegated', events: continuableEvents('ColdRun'), agent: runningAgent,
    }),
    makeOwner(header('cold-idle', 13, { cwd, origin: 'subagent', parentSession: 'live-parent' }), {
      invocation: 'delegated', events: continuableEvents('ColdIdle'), agent: idleAgent,
    }),
  ]
  const stored: StoredSession[] = [
    { header: header('one-label', 15, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: oneShotEvents('One') },
    { header: header('one-plain', 15, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: oneShotEvents() },
    { header: header('bad-mode', 50, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [descriptorEvent(0, { version: 4, mode: 'bad' })] },
    { header: header('old-version', 51, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [descriptorEvent(0, { version: 1, mode: 'one-shot', provider: 'spawn' })] },
    { header: header('no-desc', 52, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [endSeed(0)] },
    { header: header('open-fail', 53, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [], openError: 'secret' },
    { header: header('not-found-child', 54, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [], openError: 'missing' },
    { header: header('close-fail', 55, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [endSeed(0)], openError: 'close' },
    { header: header('seed-only', 56, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [descriptorEvent(0, snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn', label: 'Seed' }))], inheritedEventCount: 1 },
    { header: header('wrong-cwd', 60, { cwd: '/other', origin: 'subagent', parentSession: 'live-parent' }), events: oneShotEvents('Wrong') },
    { header: header('fork-child', 61, { cwd, parentSession: 'live-parent' }), events: [endSeed(0)] },
    { header: header('other-child', 62, { cwd, origin: 'subagent', parentSession: 'someone' }), events: oneShotEvents('Other') },
    { header: header('child-run-foreign', 31, { cwd: '/other', origin: 'subagent', parentSession: 'child-run' }), events: [endSeed(0)] },
    { header: header('grand', 32, { cwd, origin: 'subagent', parentSession: 'child-run' }), events: [endSeed(0)] },
    { header: header('cold-parent', 2, { cwd }), events: [endSeed(0)] },
    { header: header('cold-kid', 9, { cwd, origin: 'subagent', parentSession: 'cold-parent' }), events: continuableEvents('Cold') },
    { header: header('sub-parent', 4, { cwd, origin: 'subagent', parentSession: 'fork-root' }), events: continuableEvents('SubParent') },
    { header: header('sub-child', 8, { cwd, origin: 'subagent', parentSession: 'sub-parent' }), events: continuableEvents('Sub') },
    { header: header('cycle-a', 5, { cwd, origin: 'subagent', parentSession: 'cycle-b' }), events: continuableEvents('CycleA') },
    { header: header('cycle-b', 6, { cwd, origin: 'subagent', parentSession: 'cycle-a' }), events: oneShotEvents('CycleB') },
    { header: header('dangling-parent', 7, { cwd, origin: 'subagent', parentSession: 'missing-parent' }), events: [endSeed(0)] },
    { header: header('noparent-parent', 8, { cwd, origin: 'subagent' }), events: [endSeed(0)] },
    { header: header('child-idle', 10, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: continuableEvents('Idle') },
    { header: header('child-ready', 20, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: continuableEvents('Ready') },
    { header: header('child-run', 30, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: continuableEvents('Run') },
    { header: header('diag-corrupt', 40, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [endSeed(0)] },
    { header: header('diag-unsup', 41, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [endSeed(0)] },
    { header: header('diag-unavail', 42, { cwd, origin: 'subagent', parentSession: 'live-parent' }), events: [endSeed(0)] },
  ]
  const listCalls: { readonly id: string; readonly scope: string }[] = []
  const subagents = {
    list: async (request: { readonly session: { readonly id: SessionId }; readonly scope: string }) => {
      listCalls.push({ id: String(request.session.id), scope: request.scope })
      if (request.session.id === SessionId('live-parent')) return [
        childRow('child-run', 'live-parent', 'running', 'Run'),
        childRow('child-idle', 'live-parent', 'idle', 'Idle'),
        childRow('child-ready', 'live-parent', 'ready', 'Ready'),
        diagnosticRow('diag-corrupt', 'corrupt'), diagnosticRow('diag-unsup', 'unsupported'), diagnosticRow('diag-unavail', 'unavailable'),
        childRow('ghost-row', 'live-parent', 'idle', 'Ghost'),
        childRow('wrong-cwd', 'live-parent', 'idle', 'Wrong'),
        childRow('fork-child', 'live-parent', 'idle', 'Fork'),
      ]
      if (request.session.id === SessionId('fork-root') && request.scope === 'descendants') {
        return [childRow('sub-child', 'sub-parent', 'idle', 'Sub'), childRow('other-child', 'someone', 'running', 'Other')]
      }
      if (request.session.id === SessionId('cold-parent')) return [childRow('cold-kid', 'cold-parent', 'ready', 'Cold')]
      return []
    },
  } as unknown as NativeSubagentOperations
  let executionFor: ((agent: NativeAgent) => { readonly status: string }) | undefined = agent => (
    agent === runningAgent ? { status: 'running' } : { status: 'idle' }
  )
  const fixture = createHarness({
    owners, stored, subagents,
    executionFor: (agent) => {
      if (executionFor === undefined) return undefined as unknown as { readonly status: string }
      return executionFor(agent)
    },
  })
  const bare = createHarness({
    owners: [makeOwner(header('bare-parent', 1, { cwd }))],
    stored: [{ header: header('bare-parent', 1, { cwd }), events: [endSeed(0)] }],
  })
  const throwing = createHarness({
    owners: [makeOwner(header('throw-parent', 1, { cwd }))], stored: [], subagents,
  })
  const scanned = createHarness({
    owners: [
      makeOwner(header('scan-parent', 1, { cwd })),
      makeOwner(header('scan-child', 2, { cwd, origin: 'subagent', parentSession: 'scan-parent' }), {
        invocation: 'delegated', events: continuableEvents('Scan'),
      }),
    ],
    subagents: { list: async () => [] } as unknown as NativeSubagentOperations,
  })
  try {
    const unknown = await fixture.client.subagentsList(SessionId('unknown-parent'))
    expect(unknown).toEqual({ entries: [], parentAvailable: false })
    expect(listCalls).toEqual([])
    const unavailable = await rpcFailure(bare.client.subagentsList(SessionId('bare-parent')))
    expect(unavailable).toMatchObject({ code: 'subagent/projections-unavailable', message: 'Subagent catalog is unavailable.', details: {} })
    const invalid = await fixture.service.handle('subagents/list', {}, signal)
    expect(invalid).toMatchObject({ ok: false, error: { code: 'gateway/bad-request', details: {} } })
    const persistence = throwing.service as unknown as { persistence: { list: () => Promise<unknown> } }
    persistence.persistence.list = async () => { throw new Error('SECRET-LIST') }
    const generic = await rpcFailure(throwing.client.subagentsList(SessionId('throw-parent')))
    expect(generic).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    expect(`${generic.message} ${JSON.stringify(generic.details)}`).not.toContain('SECRET-LIST')
    const catalog = await fixture.client.subagentsList(SessionId('live-parent'))
    expect(catalog.parentAvailable).toBe(true)
    expect(JSON.stringify(catalog)).not.toContain('SECRET')
    const byId = new Map(catalog.entries.map(entry => [String(entry.id), entry]))
    expect(byId.get('child-run')).toMatchObject({ kind: 'child', activity: 'running', mode: 'continuable', label: 'Run', hasChildren: true })
    expect(byId.get('child-idle')).toMatchObject({ kind: 'child', activity: 'inactive', mode: 'continuable', label: 'Idle', hasChildren: false })
    expect(byId.get('child-ready')).toMatchObject({ kind: 'child', activity: 'inactive', mode: 'continuable', label: 'Ready', hasChildren: false })
    expect(byId.get('diag-corrupt')).toEqual({ kind: 'diagnostic', id: SessionId('diag-corrupt'), reason: 'corrupt' })
    expect(byId.get('diag-unsup')).toEqual({ kind: 'diagnostic', id: SessionId('diag-unsup'), reason: 'unsupported' })
    expect(byId.get('diag-unavail')).toEqual({ kind: 'diagnostic', id: SessionId('diag-unavail'), reason: 'unavailable' })
    expect(byId.get('one-label')).toMatchObject({ kind: 'child', mode: 'one-shot', label: 'One', activity: 'inactive', hasChildren: false })
    expect(byId.get('one-plain')).toMatchObject({ kind: 'child', mode: 'one-shot', activity: 'inactive', hasChildren: false })
    expect(byId.get('one-plain')).not.toHaveProperty('label')
    expect(byId.get('cold-running')).toMatchObject({ kind: 'child', mode: 'continuable', label: 'ColdRun', activity: 'running' })
    expect(byId.get('cold-idle')).toMatchObject({ kind: 'child', mode: 'continuable', label: 'ColdIdle', activity: 'inactive' })
    expect(byId.get('bad-mode')).toMatchObject({ kind: 'diagnostic', reason: 'corrupt' })
    expect(byId.get('old-version')).toMatchObject({ kind: 'diagnostic', reason: 'unsupported' })
    expect(byId.get('no-desc')).toMatchObject({ kind: 'diagnostic', reason: 'unavailable' })
    expect(byId.get('open-fail')).toEqual({ kind: 'diagnostic', id: SessionId('open-fail'), reason: 'unavailable' })
    expect(byId.get('close-fail')).toEqual({ kind: 'diagnostic', id: SessionId('close-fail'), reason: 'unavailable' })
    expect(byId.get('seed-only')).toEqual({ kind: 'diagnostic', id: SessionId('seed-only'), reason: 'unavailable' })
    for (const absent of ['ghost-row', 'wrong-cwd', 'fork-child', 'not-found-child', 'other-child', 'child-run-foreign']) {
      expect(byId.has(absent)).toBe(false)
    }
    expect(catalog.entries.findIndex(entry => entry.id === SessionId('one-label')))
      .toBeLessThan(catalog.entries.findIndex(entry => entry.id === SessionId('one-plain')))
    const stamps = new Map(stored.map(record => [String(record.header.id), record.header.createdAt]))
    for (const owner of owners) stamps.set(String(owner.session.id), owner.session.header.createdAt)
    for (let index = 1; index < catalog.entries.length; index += 1) {
      const left = catalog.entries[index - 1]!
      const right = catalog.entries[index]!
      const leftAt = stamps.get(String(left.id)) ?? 0
      const rightAt = stamps.get(String(right.id)) ?? 0
      expect(leftAt < rightAt || (leftAt === rightAt && String(left.id) <= String(right.id))).toBe(true)
    }
    executionFor = undefined
    const rescanned = await fixture.client.subagentsList(SessionId('live-parent'))
    expect(rescanned.entries.find(entry => entry.id === SessionId('cold-running'))).toMatchObject({ activity: 'inactive' })
    const cold = await fixture.client.subagentsList(SessionId('cold-parent'))
    expect(cold.parentAvailable).toBe(false)
    expect(cold.entries).toEqual([expect.objectContaining({ id: SessionId('cold-kid'), mode: 'continuable', activity: 'inactive', label: 'Cold' })])
    const nested = await fixture.client.subagentsList(SessionId('sub-parent'))
    expect(nested.parentAvailable).toBe(false)
    expect(nested.entries.map(entry => entry.id)).toEqual([SessionId('sub-child')])
    expect(listCalls).toContainEqual({ id: 'fork-root', scope: 'descendants' })
    expect(listCalls).toContainEqual({ id: 'live-parent', scope: 'children' })
    const cycle = await fixture.client.subagentsList(SessionId('cycle-a'))
    expect(cycle.entries.map(entry => String(entry.id))).toEqual(['cycle-b'])
    expect(await fixture.client.subagentsList(SessionId('dangling-parent'))).toMatchObject({ entries: [], parentAvailable: false })
    expect(await fixture.client.subagentsList(SessionId('noparent-parent'))).toMatchObject({ entries: [], parentAvailable: false })
    expect(fixture.resumed.map(request => request.id)).toEqual([SessionId('cold-parent')])
    expect(fixture.resumed.every(request => request.resume && request.route === 'root')).toBe(true)
    const withoutExecution = await scanned.client.subagentsList(SessionId('scan-parent'))
    expect(withoutExecution.entries).toEqual([expect.objectContaining({ id: SessionId('scan-child'), activity: 'inactive', mode: 'continuable' })])
    expect(fixture.opened).toContain(SessionId('close-fail'))
    await fixture.client.close()
    await expect(fixture.service.close()).rejects.toBeInstanceOf(AggregateError)
  } finally {
    await bare.close()
    await throwing.close()
    await scanned.close()
    await fixture.client.close().catch(() => undefined)
    await fixture.service.close().catch(() => undefined)
  }
})

it('prompts a continuable child and interrupts it without cancelling the parent', async () => {
  const parentHeader = header('parent', 1, { cwd })
  const rootHeader = header('root-live', 2, { cwd })
  const parent = makeOwner(parentHeader, { events: [endSeed(0)] })
  const root = makeOwner(rootHeader, { events: [endSeed(0)] })
  const liveChild = (id: string, parentId: string, events: SessionEvent[]) => makeOwner(
    header(id, 3, { cwd, origin: 'subagent', parentSession: parentId }),
    { invocation: 'delegated', events },
  )
  const sends: { readonly target: string; readonly content: readonly { readonly type: string }[] }[] = []
  const interrupts: { readonly agent: NativeAgent; readonly target: string }[] = []
  const promptAbort = new AbortController()
  const interruptAbort = new AbortController()
  const imageAbort = new AbortController()
  let abortNextSend = false
  let abortNextInterrupt = false
  const admitted: PromptContentPart[][] = []
  const subagents = {
    sendMessage: async (request: { readonly target: SessionId; readonly content: readonly { readonly type: string }[] }) => {
      sends.push({ target: String(request.target), content: request.content })
      if (abortNextSend) {
        abortNextSend = false
        promptAbort.abort()
        throw new Error('TOKEN-SECRET-PROMPT')
      }
      if (request.target === SessionId('send-parent')) throw new Error('does not name this direct parent TOKEN-SECRET')
      if (request.target === SessionId('send-workspace')) throw new Error('workspace differs TOKEN-SECRET')
      if (request.target === SessionId('send-continuation')) throw new Error('no supported continuation TOKEN-SECRET')
      if (request.target === SessionId('send-other')) throw new Error('TOKEN-SECRET')
      if (request.target === SessionId('send-raw')) throw 'TOKEN-SECRET'
      return MessageId(`msg-${String(request.target)}`)
    },
    interrupt: (request: { readonly agent: NativeAgent; readonly target: SessionId }) => {
      interrupts.push({ agent: request.agent, target: String(request.target) })
      if (abortNextInterrupt) {
        abortNextInterrupt = false
        interruptAbort.abort()
        throw new Error('TOKEN-SECRET-INTERRUPT')
      }
      if (request.target === SessionId('interrupt-ancestor')) throw new Error('interrupt requires a live ancestor')
      if (request.target === SessionId('interrupt-secret')) throw new Error('TOKEN-SECRET')
      if (request.target === SessionId('interrupt-raw')) throw 'TOKEN-SECRET'
    },
    list: async () => [],
  } as unknown as NativeSubagentOperations
  const attachments = {
    admitPromptContent: async (parts: readonly PromptContentPart[]) => {
      admitted.push([...parts])
      const image = parts.find(part => part.type === 'image')
      if (image?.type === 'image' && image.data === 'file') {
        return [{ type: 'file', attachment: { attachmentId: 'file-1', name: 'note.txt', bytes: 1 } }] as AdmittedPromptContentPart[]
      }
      if (image?.type === 'image' && image.data === 'rethrow') {
        throw new NativeHostControlError('subagent/attachment-invalid', 'Subagent attachment was rejected.', { marker: 'kept' })
      }
      if (image?.type === 'image' && image.data === 'secret') throw new Error('TOKEN-SECRET')
      if (image?.type === 'image' && image.data === 'abort-secret') {
        imageAbort.abort()
        throw new Error('TOKEN-SECRET-IMAGE')
      }
      return parts.map(part => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, ...part.name === undefined ? {} : { name: part.name } } })
    },
  } as unknown as AttachmentOperations

  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let turnSignal: AbortSignal | undefined
  const storedChild = (id: string, parentId: string, events: SessionEvent[], workspace = cwd, openError?: StoredSession['openError']): StoredSession => ({
    header: header(id, 4, { cwd: workspace, origin: 'subagent', parentSession: parentId }), events, ...openError === undefined ? {} : { openError },
  })
  const fixture = createHarness({
    owners: [
      parent, root,
      liveChild('child', 'parent', continuableEvents('Child')),
      liveChild('interrupt-ancestor', 'parent', continuableEvents('Ancestor')),
      liveChild('interrupt-secret', 'parent', continuableEvents('Secret')),
      liveChild('interrupt-raw', 'parent', continuableEvents('Raw')),
      liveChild('nested', 'mid', continuableEvents('Nested')),
      liveChild('orphan-child', 'orphan-parent', continuableEvents('Orphan')),
    ],
    stored: [
      storedChild('mid', 'root-live', continuableEvents('Mid')),
      storedChild('orphan-parent', 'nobody', [endSeed(0)]),
      storedChild('foreign', 'other-parent', continuableEvents('Foreign')),
      storedChild('other-cwd', 'parent', continuableEvents('Elsewhere'), '/elsewhere'),
      storedChild('oneshot', 'parent', oneShotEvents('Once')),
      storedChild('corrupt-child', 'parent', [descriptorEvent(0, { version: 4, mode: 'bad' })]),
      storedChild('unavail-child', 'parent', [endSeed(0)], cwd, 'secret'),
      storedChild('send-parent', 'parent', continuableEvents('Parent')),
      storedChild('send-workspace', 'parent', continuableEvents('Workspace')),
      storedChild('send-continuation', 'parent', continuableEvents('Continuation')),
      storedChild('send-other', 'parent', continuableEvents('Other')),
      storedChild('send-raw', 'parent', continuableEvents('RawSend')),
    ],
    subagents, attachments, executionFor: () => ({ status: 'idle' }),
    executeRootTurn: async (_request, next) => {
      turnSignal = next
      entered.resolve(undefined)
      return new Promise((resolve) => {
        const finish = () => {
          resolve({ exitCode: 0, answer: '' })
        }
        next.addEventListener('abort', finish, { once: true })
        void release.promise.then(finish)
      })
    },
  })
  const bare = createHarness({
    owners: [makeOwner(header('bare-parent', 1, { cwd })), liveChild('bare-child', 'bare-parent', continuableEvents('Bare'))],
  })
  const selections = fixture.service as unknown as { selections: { attachments?: AttachmentOperations | undefined } }
  const originalAttachments = selections.selections.attachments
  try {
    const started = fixture.service.handle('session/start', { sessionId: 'parent', text: 'hang', resume: true, follow: false }, signal)
    await entered.promise
    await started
    expect(turnSignal?.aborted).toBe(false)
    const invalid = await fixture.service.handle('subagents/prompt', { parentSessionId: 'parent' }, signal)
    expect(invalid).toMatchObject({ ok: false, error: { code: 'gateway/bad-request', details: {} } })
    const empty = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'empty', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: '' }],
    }))
    expect(empty.code).toBe('gateway/bad-request')
    const long = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'long', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'steer',
      content: [{ type: 'text', text: 'x'.repeat(101) }],
    }))
    expect(long.code).toBe('gateway/bad-request')
    const zone = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'zone', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: 'hello' }], clientTimeZone: 'Not/AZone',
    }))
    expect(zone).toMatchObject({ code: 'subagent/invalid-time-zone', details: { value: 'Not/AZone' } })
    const offline = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'offline', parentSessionId: SessionId('offline-parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }))
    expect(offline.code).toBe('subagent/parent-unavailable')
    const queued = await fixture.client.subagentPrompt({
      requestId: 'queue', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: 'hello' }], clientTimeZone: 'UTC',
    })
    const steered = await fixture.client.subagentPrompt({
      requestId: 'steer', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'steer',
      content: [{ type: 'text', text: 'hello' }],
    })
    expect(queued.messageId).toBe(MessageId('msg-child'))
    expect(steered.messageId).toBe(MessageId('msg-child'))
    expect(sends.slice(0, 2).map(call => call.content)).toEqual([[{ type: 'text', text: 'hello' }], [{ type: 'text', text: 'hello' }]])
    expect(JSON.stringify(sends.slice(0, 2))).not.toContain('UTC')
    expect(JSON.stringify(sends.slice(0, 2))).not.toContain('queue')
    expect(admitted).toEqual([])
    const named = await fixture.client.subagentPrompt({
      requestId: 'named', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: 'cap' }, { type: 'image', mediaType: 'image/png', data: 'aaaa', name: 'pic.png' }],
    })
    expect(named.messageId).toBe(MessageId('msg-child'))
    expect(admitted[0]?.[1]).toMatchObject({ type: 'image', name: 'pic.png' })
    expect(sends.at(-1)?.content).toEqual([
      { type: 'text', text: 'cap' },
      { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'pic.png' } },
    ])
    await fixture.client.subagentPrompt({
      requestId: 'plain-image', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'steer',
      content: [{ type: 'image', mediaType: 'image/png', data: 'bbbb' }],
    })
    expect(admitted[1]?.[0]).toEqual({ type: 'image', mediaType: 'image/png', data: 'bbbb' })
    const file = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'file', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'image', mediaType: 'image/png', data: 'file' }],
    }))
    expect(file).toMatchObject({ code: 'subagent/attachment-invalid', details: {} })
    const kept = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'kept', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'image', mediaType: 'image/png', data: 'rethrow' }],
    }))
    expect(kept).toMatchObject({ code: 'subagent/attachment-invalid', details: { marker: 'kept' } })
    const admitSecret = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'admit-secret', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'image', mediaType: 'image/png', data: 'secret' }],
    }))
    expect(admitSecret).toMatchObject({ code: 'subagent/attachment-invalid', details: {} })
    expect(admitSecret.message).not.toContain('TOKEN-SECRET')
    selections.selections.attachments = undefined
    const noAttachments = await rpcFailure(fixture.client.subagentPrompt({
      requestId: 'no-attachments', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'image', mediaType: 'image/png', data: 'cccc' }],
    }))
    expect(noAttachments.code).toBe('subagent/attachment-invalid')
    selections.selections.attachments = originalAttachments
    const cases: [string, string][] = [
      ['foreign', 'subagent/unauthorized'], ['other-cwd', 'subagent/unauthorized'], ['missing-child', 'subagent/not-found'],
      ['unavail-child', 'native/session'], ['corrupt-child', 'subagent/catalog-diagnostic'], ['oneshot', 'subagent/not-resumable'],
      ['send-parent', 'subagent/unauthorized'], ['send-workspace', 'subagent/unauthorized'], ['send-continuation', 'subagent/not-resumable'],
      ['send-other', 'subagent/delivery-unavailable'], ['send-raw', 'subagent/delivery-unavailable'],
    ]
    for (const [child, code] of cases) {
      const error = await rpcFailure(fixture.client.subagentPrompt({
        requestId: `case-${child}`, parentSessionId: SessionId('parent'), childSessionId: SessionId(child), mode: 'continuable', delivery: 'queue',
        content: [{ type: 'text', text: 'hello' }],
      }))
      expect(error.code).toBe(code)
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain('TOKEN-SECRET')
    }
    expect((await rpcFailure(bare.client.subagentPrompt({
      requestId: 'bare', parentSessionId: SessionId('bare-parent'), childSessionId: SessionId('bare-child'), mode: 'continuable', delivery: 'steer',
      content: [{ type: 'text', text: 'hello' }],
    }))).code).toBe('subagent/projections-unavailable')
    const accepted = await fixture.client.subagentInterrupt(SessionId('parent'), SessionId('child'))
    expect(accepted).toEqual({ accepted: true })
    expect(interrupts.at(-1)).toMatchObject({ agent: parent.agent, target: 'child' })
    const beforeAncestor = interrupts.length
    expect(await fixture.client.subagentInterrupt(SessionId('mid'), SessionId('nested'))).toEqual({ accepted: true })
    expect(interrupts.at(-1)).toMatchObject({ agent: root.agent, target: 'nested' })
    expect(interrupts.length).toBe(beforeAncestor + 1)
    const beforeNoop = interrupts.length
    expect(await fixture.client.subagentInterrupt(SessionId('parent'), SessionId('missing-child'))).toEqual({ accepted: true })
    expect(await fixture.client.subagentInterrupt(SessionId('parent'), SessionId('send-other'))).toEqual({ accepted: true })
    expect((await rpcFailure(fixture.client.subagentInterrupt(SessionId('orphan-parent'), SessionId('orphan-child')))).code).toBe('subagent/parent-unavailable')
    expect(interrupts.length).toBe(beforeNoop)
    const beforeRefusal = interrupts.length
    expect((await rpcFailure(fixture.client.subagentInterrupt(SessionId('parent'), SessionId('interrupt-ancestor')))).code).toBe('subagent/unauthorized')
    expect(interrupts.length).toBe(beforeRefusal + 1)
    const secretInterrupt = await rpcFailure(fixture.client.subagentInterrupt(SessionId('parent'), SessionId('interrupt-secret')))
    const rawInterrupt = await rpcFailure(fixture.client.subagentInterrupt(SessionId('parent'), SessionId('interrupt-raw')))
    expect(secretInterrupt).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    expect(rawInterrupt).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    const interruptCases: [string, string][] = [
      ['foreign', 'subagent/unauthorized'], ['other-cwd', 'subagent/unauthorized'], ['unavail-child', 'native/session'],
      ['corrupt-child', 'subagent/unauthorized'], ['oneshot', 'subagent/unauthorized'],
    ]
    for (const [child, code] of interruptCases) {
      const error = await rpcFailure(fixture.client.subagentInterrupt(SessionId('parent'), SessionId(child)))
      expect(error.code).toBe(code)
      expect(error.message).not.toContain('TOKEN-SECRET')
    }
    expect((await rpcFailure(bare.client.subagentInterrupt(SessionId('bare-parent'), SessionId('bare-child')))).code).toBe('subagent/projections-unavailable')
    abortNextSend = true
    await expectCancellation(fixture.client.subagentPrompt({
      requestId: 'abort-send', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    }, promptAbort.signal), 'TOKEN-SECRET')
    abortNextInterrupt = true
    await expectCancellation(fixture.client.subagentInterrupt(SessionId('parent'), SessionId('child'), interruptAbort.signal), 'TOKEN-SECRET')
    await expectCancellation(fixture.client.subagentPrompt({
      requestId: 'abort-image', parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable', delivery: 'steer',
      content: [{ type: 'image', mediaType: 'image/png', data: 'abort-secret' }],
    }, imageAbort.signal), 'TOKEN-SECRET')
    expect(turnSignal?.aborted).toBe(false)
    expect(fixture.cancelled).toBe(false)
  } finally {
    release.resolve(undefined)
    await bare.close()
    await fixture.close()
  }
})

it('reads and follows an addressed subagent without changing ordinary history', async () => {
  const parent = makeOwner(header('parent', 1, { cwd }), { events: [endSeed(0)] })
  const child = makeOwner(header('child', 2, { cwd, origin: 'subagent', parentSession: 'parent' }), {
    invocation: 'delegated', events: continuableEvents('Child'),
  })
  const foreign = makeOwner(header('foreign', 3, { cwd, origin: 'subagent', parentSession: 'other' }), {
    invocation: 'delegated', events: continuableEvents('Foreign'),
  })
  const historyAbort = new AbortController()
  let abortHistory = false
  const fixture = createHarness({
    maxFollowers: 1,
    onOpen: (id) => {
      if (abortHistory && id === SessionId('unavail-child')) historyAbort.abort()
    },
    owners: [parent, child, foreign],
    stored: [
      { header: header('idle-child', 4, { cwd, origin: 'subagent', parentSession: 'parent' }), events: continuableEvents('Idle') },
      { header: header('gap-child', 5, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [descriptorEvent(0, snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'Gap' })), endSeed(2)] },
      { header: header('shifted-child', 6, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [descriptorEvent(5, snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'Shift' }))] },
      { header: header('short-child', 7, { cwd, origin: 'subagent', parentSession: 'parent' }), events: continuableEvents('Short') },
      { header: header('corrupt-child', 8, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [descriptorEvent(0, { version: 4, mode: 'bad' })] },
      { header: header('old-child', 9, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [descriptorEvent(0, { version: 1, mode: 'one-shot', provider: 'spawn' })] },
      { header: header('plain-child', 10, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [endSeed(0)] },
      { header: header('other-cwd', 11, { cwd: '/elsewhere', origin: 'subagent', parentSession: 'parent' }), events: continuableEvents('Elsewhere') },
      { header: header('unavail-child', 12, { cwd, origin: 'subagent', parentSession: 'parent' }), events: [], openError: 'secret' },
    ],
  })
  const overflow = createHarness({
    maxFollowBufferBytes: 1,
    stored: [{ header: header('wide-child', 1, { cwd, origin: 'subagent', parentSession: 'parent' }), events: continuableEvents('Wide') },
      { header: header('parent', 1, { cwd }), events: [endSeed(0)] }],
  })
  try {
    expect((await fixture.client.history(SessionId('parent'))).events.map(event => event.type)).toEqual(['session/end-seed'])
    expect((await fixture.client.history(SessionId('foreign'))).events.map(event => event.type)).toEqual(['subagent/descriptor'])
    expect(fixture.opened).not.toContain(SessionId('foreign'))
    const addressed = await fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable' })
    expect(addressed.header.id).toBe(SessionId('child'))
    expect(addressed.events.map(event => event.type)).toEqual(['subagent/descriptor'])
    const failures: [() => Promise<unknown>, string][] = [
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('missing-child'), mode: 'one-shot' }), 'subagent/not-found'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('foreign'), mode: 'continuable' }), 'subagent/unauthorized'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('other-cwd'), mode: 'continuable' }), 'subagent/unauthorized'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'one-shot' }), 'subagent/unauthorized'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('corrupt-child'), mode: 'continuable' }), 'subagent/catalog-diagnostic'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('old-child'), mode: 'one-shot' }), 'subagent/catalog-diagnostic'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('plain-child'), mode: 'one-shot' }), 'subagent/catalog-diagnostic'],
      [() => fixture.client.subagentHistory({ parentSessionId: SessionId('parent'), childSessionId: SessionId('unavail-child'), mode: 'continuable' }), 'native/session'],
    ]
    abortHistory = true
    await expectCancellation(fixture.client.subagentHistory({
      parentSessionId: SessionId('parent'), childSessionId: SessionId('unavail-child'), mode: 'continuable',
    }, historyAbort.signal), 'SECRET')
    for (const [request, code] of failures) {
      const error = await rpcFailure(request())
      expect(error.code).toBe(code)
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain('SECRET')
    }
    for (const payload of [null, [], 'x', { address: { kind: 'nope' } }]) {
      const result = await fixture.service.handle('session/history', payload, signal)
      expect(result.ok).toBe(false)
    }
    const address = { parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable' as const }
    const follow = fixture.client.subagentFollow(address, -1)[Symbol.asyncIterator]()
    expect(await follow.next()).toMatchObject({ value: { type: 'baseline', sessionId: SessionId('child'), fromSeq: -1, throughSeq: 0 } })
    const blocked = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentSessionId: 'parent', childSessionId: 'idle-child', mode: 'continuable', lastSeq: -1 }),
    }))
    expect(blocked.status).toBe(429)
    const invalidAtCapacity = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    expect(invalidAtCapacity.status).toBe(409)
    expect(await invalidAtCapacity.json()).toMatchObject({ code: 'gateway/bad-request', message: 'Session request is invalid.' })
    expect(await follow.next()).toMatchObject({ value: { type: 'event' } })
    child.emit(endSeed(1))
    expect(await follow.next()).toMatchObject({ value: { type: 'event', event: { seq: 1 } } })
    await fixture.detach(parent)
    await fixture.detach(child)
    expect(await follow.next()).toMatchObject({ value: { type: 'settled' } })
    expect(await follow.next()).toMatchObject({ done: true })
    const idle = []
    for await (const frame of fixture.client.subagentFollow({ parentSessionId: SessionId('parent'), childSessionId: SessionId('idle-child'), mode: 'continuable' }, 0)) idle.push(frame)
    expect(idle.map(frame => frame.type)).toEqual(['baseline', 'settled'])
    const gap = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentSessionId: 'parent', childSessionId: 'gap-child', mode: 'continuable', lastSeq: -1 }),
    }))
    const gapBody = await gap.text()
    expect(gap.status).toBe(409)
    expect(JSON.parse(gapBody)).toMatchObject({ code: 'native/session', message: 'Session request failed.', details: {} })
    expect(gapBody).not.toContain('baseline')
    expect(gapBody).not.toContain('contiguous')
    const shifted = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentSessionId: 'parent', childSessionId: 'shifted-child', mode: 'continuable', lastSeq: 0 }),
    }))
    expect(await shifted.json()).toMatchObject({ code: 'subagent/not-found', message: 'Subagent follow cursor is outside history.' })
    const outside = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentSessionId: 'parent', childSessionId: 'short-child', mode: 'continuable', lastSeq: 5 }),
    }))
    expect(await outside.json()).toMatchObject({ code: 'subagent/not-found' })
    const leaked = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', body: 'LEAKTOKEN',
    }))
    const leakedBody = await leaked.text()
    expect(leaked.status).toBe(409)
    expect(leakedBody).not.toContain('LEAKTOKEN')
    expect((JSON.parse(leakedBody) as { code: string }).code).toBe('native/session')
    const invalid = await fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    expect(await invalid.json()).toMatchObject({ code: 'gateway/bad-request', message: 'Session request is invalid.' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(fixture.service.followSubagent(new Request('http://localhost/api/native-session/subagent-follow', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: aborted.signal,
    }))).rejects.toThrow()
    await expect((async () => {
      for await (const _frame of overflow.client.subagentFollow({
        parentSessionId: SessionId('parent'), childSessionId: SessionId('wide-child'), mode: 'continuable',
      }, -1)) { /* drain until the bounded feed fails */ }
    })()).rejects.toThrow()
    const responses: Response[] = []
    const fake = createNativeSessionClient({
      call: async () => { throw new Error('unused') },
      response: async () => {
        const next = responses.shift()
        if (next === undefined) throw new Error('missing fake follow response')
        return next
      },
    }, { maxFollowBufferChars: 1000 })
    const bareClient = createNativeSessionClient({ call: async () => ({ ok: false, error: { code: 'x', message: 'y', details: {} } }) }, { maxFollowBufferChars: 1000 })
    const followed = { parentSessionId: SessionId('parent'), childSessionId: SessionId('child'), mode: 'continuable' as const }
    await expect((async () => {
      for await (const _frame of bareClient.subagentFollow(followed, -1)) { /* no carrier */ }
    })()).rejects.toThrow('no Fetch response')
    await expect((async () => {
      for await (const _frame of fixture.client.subagentFollow({
        parentSessionId: SessionId('parent'), childSessionId: SessionId('short-child'), mode: 'continuable',
      }, 5)) { /* cursor is outside history */ }
    })()).rejects.toMatchObject({ code: 'subagent/not-found', details: {} })
    const baseline = { type: 'baseline', sessionId: 'child', fromSeq: -1, throughSeq: -1 }
    const readFrames = async (response: Response, signal?: AbortSignal): Promise<string[]> => {
      responses.push(response)
      const seen: string[] = []
      for await (const frame of fake.subagentFollow(followed, -1, signal)) seen.push(frame.type)
      return seen
    }
    expect(await readFrames(new Response(`data: ${JSON.stringify(baseline)}\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    }))).toEqual(['baseline'])
    expect(await readFrames(new Response(`data: ${JSON.stringify(baseline)}\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    }), new AbortController().signal)).toEqual(['baseline'])
    const rejected = async (response: Response): Promise<unknown> => {
      responses.push(response)
      try {
        for await (const _frame of fake.subagentFollow(followed, -1)) { /* rejected follow */ }
      } catch (error: unknown) {
        return error
      }
      throw new Error('expected subagent follow to reject')
    }
    expect(await rejected(new Response(JSON.stringify({
      code: 'subagent/unauthorized', message: 'Subagent parent does not own this child.', details: { childSessionId: 'child' },
    }), { status: 409, headers: { 'content-type': 'application/json' } }))).toMatchObject({
      code: 'subagent/unauthorized', details: { childSessionId: 'child' },
    })
    expect(await rejected(new Response(JSON.stringify({ code: 'x', message: 'y', details: null }), { status: 409 }))).toMatchObject({
      code: 'x', details: {},
    })
    expect(await rejected(new Response(JSON.stringify({ code: 'x', message: 'y', details: ['secret'] }), { status: 409 }))).toMatchObject({
      code: 'x', details: {},
    })
    expect(await rejected(new Response(JSON.stringify({ code: 'x', message: 'y', details: 'TOKEN-SECRET' }), { status: 409 }))).toMatchObject({
      code: 'x', details: {},
    })
    await expect(rejected(new Response('not-json', { status: 409 }))).resolves.toEqual(expect.objectContaining({
      message: 'native subagent follow: invalid response HTTP 409',
    }))
    await expect(rejected(new Response(JSON.stringify({ nope: true }), { status: 409 }))).resolves.toEqual(expect.objectContaining({
      message: 'native subagent follow: invalid response HTTP 409',
    }))
    await expect(rejected({
      ok: true, status: 200, body: null, headers: new Headers({ 'content-type': 'text/event-stream' }), text: async () => '',
    } as unknown as Response)).resolves.toEqual(expect.objectContaining({
      message: 'native subagent follow: invalid response HTTP 200',
    }))
    await expect(rejected(new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } }))).resolves.toEqual(
      expect.objectContaining({ message: 'native subagent follow: invalid response HTTP 200' }),
    )
    const abortFollow = new AbortController()
    abortFollow.abort()
    responses.push(new Response('data: {not-json}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const swallowed: string[] = []
    for await (const frame of fake.subagentFollow(followed, -1, abortFollow.signal)) swallowed.push(frame.type)
    expect(swallowed).toEqual([])
  } finally {
    await overflow.close()
    await fixture.close()
  }
})
