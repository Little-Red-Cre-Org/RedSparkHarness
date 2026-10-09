import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-agent/turn-boundary'
import type { TurnBoundaryProjection } from '@deepseek-ai/dsh-native-agent/turn-boundary'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { Session, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionLogOffset as SessionLogOffsetValue } from '@deepseek-ai/dsh-session/native'
import { plugin as projectionPlugin } from '@deepseek-ai/dsh-session-projection/native'
import { plugin as cachePlugin } from '@deepseek-ai/dsh-session-projection-cache/native'
import type { SessionQueryOperations } from '@deepseek-ai/dsh-session-query/native'
import { plugin as exactPlugin } from '@deepseek-ai/dsh-session-query/native'
import { describe, expect, it, vi } from 'vitest'
import { plugin as sqlitePlugin, resolveNativeSessionQuerySqliteConfig } from '../src/native.ts'

function service<K extends keyof NativeServices>(key: K, value: NativeServices[K]): NativePlugin {
  return {
    apiVersion: 1,
    name: `native-sqlite-test-${key}`,
    targets: ['host'],
    requires: [],
    provides: [key],
    resolve: () => (context) => { context.provide(key, value) },
  }
}

describe('Native session-query Providers', () => {
  it.each([
    { backend: 'exact', plugin: exactPlugin, config: {}, searchEnabled: false },
    { backend: 'SQLite', plugin: sqlitePlugin, config: { path: ':memory:', openAt: 'startup' }, searchEnabled: true },
  ])('serve all query operations over the shared Native owners with $backend', async ({ backend, plugin, config, searchEnabled }) => {
    if (backend === 'SQLite') {
      for (const input of [null, [], 'invalid', { path: ':memory:', unknown: true }, { path: ':memory:', openAt: null }]) {
        expect(() => resolveNativeSessionQuerySqliteConfig(input)).toThrow(expect.objectContaining({
          code: 'SESSION_QUERY_INVALID_CONFIG',
        }))
      }
    }
    const session = Session.create(SessionId('native-sqlite-query'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'native sqlite needle' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const eventListeners = new Set<(event: SessionEvent) => void>()
    const owner = {
      agent: {},
      session,
      invocation: 'root' as const,
      inheritedEventCount: SessionLogOffset(0),
      writerAvailable: true,
      append: session.append.bind(session),
      appendBatch: session.appendBatch.bind(session),
      flush: vi.fn(async () => {}),
      async readEvents(options?: { maxEvents?: SessionLogOffsetValue; signal?: AbortSignal }) {
        return session.snapshotEvents(SessionLogOffset(0), options?.maxEvents)
      },
      messages: () => [],
      retain: () => () => {},
      retainBackground: () => () => {},
      onEvent(listener: (event: SessionEvent) => void) {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      },
      async onIdle() { return async () => {} },
      async beforeStep() { return async () => {} },
    } as unknown as NativeActiveSessionOwner
    const attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    const detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    let announcedDuringSnapshot = false
    const active = {
      owners() {
        if (!announcedDuringSnapshot) {
          announcedDuringSnapshot = true
          void Promise.all([...attached].map(observer => observer(owner)))
        }
        return [owner]
      },
      async register() { throw new Error('not used by this query fixture') },
      owner: () => owner,
      onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
        attached.add(observer)
        return async () => { attached.delete(observer) }
      },
      onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
        detached.add(observer)
        return async () => { detached.delete(observer) }
      },
    } as unknown as NativeServices['activeSessions']

    const rows = new Map<string, unknown>()
    const domain = {
      table: () => ({
        get: (id: string) => rows.get(id),
        async put(id: string, record: unknown) { rows.set(id, structuredClone(record)) },
      }),
      close: vi.fn(async () => {}),
    }
    const storage = { open: async () => domain } as unknown as NativeServices['storageDomain']
    const scope = new NativeScope()
    let query: SessionQueryOperations | undefined
    let projections: NativeServices['sessionProjections'] | undefined
    const captureQuery: NativePlugin = {
      apiVersion: 1,
      name: 'native-sqlite-query-capture',
      targets: ['host'],
      requires: ['sessionQuery', 'sessionProjections'],
      provides: [],
      resolve: () => (context) => {
        query = context.require('sessionQuery')
        projections = context.require('sessionProjections')
      },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: service('activeSessions', active), scope, config: undefined },
      { plugin: service('storageDomain', storage), scope, config: undefined },
      { plugin: projectionPlugin, scope, config: undefined },
      { plugin: cachePlugin, scope, config: { writeEveryEvents: 1, writeIntervalMs: 60_000 } },
      { plugin, scope, config },
      { plugin: captureQuery, scope, config: undefined },
    ], 'host'))

    try {
      await host.start()
      expect(eventListeners.size).toBe(2)
      if (query === undefined) throw new Error('Native SQLite Provider did not provide sessionQuery')
      if (projections === undefined) throw new Error('Native projection Provider did not provide sessionProjections')
      const observation = await query.observeSession(session.id)
      expect(observation.source).toBe('live')
      expect(observation.header.id).toBe(session.id)
      expect(observation.inheritedEventCount).toBe(SessionLogOffset(0))
      expect(observation.cursor).toBe(4)
      expect(observation.events).toHaveLength(5)
      const boundary: TurnBoundaryProjection | undefined = projections.stateOf(session, 'turnBoundary')
      expect(boundary).toMatchObject({ lastTurn: 1, openTurnStartSeq: null })
      observation[Symbol.dispose]()

      const sessions = await query.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ header: { id: session.id }, live: true })
      const filteredSessions = await query.filterSessions([])
      expect(filteredSessions).toHaveLength(1)
      expect(filteredSessions[0]?.header.id).toBe(session.id)
      const read = await query.readSession(session.id)
      expect(read.session.id).toBe(session.id)
      expect(read.inheritedEventCount).toBe(SessionLogOffset(0))
      expect(read.events).toHaveLength(5)
      expect(read.events.map(event => event.type)).toEqual([
        'turn/start', 'step/start', 'user/message', 'step/end', 'turn/end',
      ])
      expect(read.events[2]).toMatchObject({
        type: 'user/message',
        seq: 2,
        data: { content: [{ type: 'text', text: 'native sqlite needle' }] },
      })
      await expect(query.readTitle(session.id)).resolves.toBeUndefined()
      const title = await query.readTitleSnapshot(session.id)
      expect(title.session.id).toBe(session.id)
      expect(title).not.toHaveProperty('title')
      const titles = await query.readTitleSnapshots([session.id, session.id])
      expect(titles).toHaveLength(1)
      expect(titles[0]).toMatchObject({
        sessionId: session.id,
        status: 'fulfilled',
        value: { session: { id: session.id } },
      })
      const events = await query.listEvents(session.id)
      expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4])
      expect(events[2]).toMatchObject({ sessionId: session.id, type: 'user/message' })
      const filteredEvents = await query.filterEvents(session.id, [])
      expect(filteredEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ seq: 2, text: 'native sqlite needle' }),
      ]))
      const surface = await query.readSurface(session.id)
      expect(surface.session.id).toBe(session.id)
      expect(surface.inheritedEventCount).toBe(SessionLogOffset(0))
      expect(surface.capturedThroughSeq).toBe(SessionSeq(4))
      expect(surface.events.map(event => event.seq)).toEqual([2])
      expect(surface.events[0]).toMatchObject({
        seq: 2,
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'native sqlite needle' }] },
      })
      const lineage = await query.traceSession(session.id)
      expect(lineage).toMatchObject({
        complete: true,
        target: { header: { id: session.id }, live: true },
        root: { header: { id: session.id } },
        ancestors: [],
        descendants: [],
      })
      const trace = await query.traceEvent({ sessionId: session.id, seq: SessionSeq(2) })
      expect(trace).toMatchObject({
        session: { id: session.id },
        target: { sessionId: session.id, seq: 2, type: 'user/message' },
        replacementChain: [],
        replacedEventSeqs: [],
        sourceEventSeqs: [],
        derivedEventSeqs: [],
      })
      const window = await query.readEvent({ sessionId: session.id, seq: SessionSeq(2), before: 1, after: 1 })
      expect(window).toMatchObject({
        session: { id: session.id },
        inheritedEventCount: SessionLogOffset(0),
        target: { seq: 2, type: 'user/message' },
        startSeq: 1,
        endSeq: 3,
      })
      expect(window.events.map(event => event.type)).toEqual(['step/start', 'user/message', 'step/end'])
      if (searchEnabled) {
        const sessionPage = await query.searchSessions({ query: 'needle' })
        expect(sessionPage.items).toHaveLength(1)
        expect(sessionPage.items[0]).toMatchObject({
          header: { id: session.id },
          bestMatch: { seq: 2, type: 'user/message', snippet: 'native sqlite needle' },
        })
        const eventPage = await query.searchEvents({ sessionId: session.id, query: 'needle' })
        expect(eventPage.session.id).toBe(session.id)
        expect(eventPage.items).toHaveLength(1)
        expect(eventPage.items[0]).toMatchObject({ seq: 2, type: 'user/message', snippet: 'native sqlite needle' })
      } else {
        await expect(query.searchSessions({ query: 'needle' })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
        await expect(query.searchEvents({ sessionId: session.id, query: 'needle' })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
      }
      expect(attached.size).toBe(2)
      expect(detached.size).toBe(2)
    } finally {
      await host.stop()
    }

    expect(attached.size).toBe(0)
    expect(detached.size).toBe(0)
    expect(eventListeners.size).toBe(0)
    expect(domain.close).toHaveBeenCalledOnce()
  })

  it('composes SQLite without optional projection or checkpoint providers', async () => {
    const active = { owners: () => [] } as unknown as NativeServices['activeSessions']
    const scope = new NativeScope()
    let query: SessionQueryOperations | undefined
    const captureQuery: NativePlugin = {
      apiVersion: 1,
      name: 'native-sqlite-query-without-projections-capture',
      targets: ['host'],
      requires: ['sessionQuery'],
      provides: [],
      resolve: () => (context) => { query = context.require('sessionQuery') },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: service('activeSessions', active), scope, config: undefined },
      { plugin: sqlitePlugin, scope, config: { path: ':memory:', openAt: 'startup' } },
      { plugin: captureQuery, scope, config: undefined },
    ], 'host'))

    try {
      await host.start()
      if (query === undefined) throw new Error('Native SQLite Provider did not provide sessionQuery')
      await expect(query.listSessions()).resolves.toEqual([])
      await expect(query.searchSessions({ query: 'absent' })).resolves.toMatchObject({ items: [] })
      await expect(query.readSurface(SessionId('without-optional-projections'))).rejects.toMatchObject({
        code: 'SESSION_QUERY_SESSION_NOT_FOUND',
      })
    } finally {
      await host.stop()
    }
  })

  it('closes accepted Native providers when SQLite startup cannot open its database path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'native-session-query-open-failure-'))
    const databasePath = temp
    const attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    const detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    const active = {
      owners: () => [],
      onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
        attached.add(observer)
        return async () => { attached.delete(observer) }
      },
      onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
        detached.add(observer)
        return async () => { detached.delete(observer) }
      },
    } as unknown as NativeServices['activeSessions']
    const domain = {
      table: () => ({ get: () => undefined, async put() {} }),
      close: vi.fn(async () => {}),
    }
    const storage = { open: async () => domain } as unknown as NativeServices['storageDomain']
    const scope = new NativeScope()
    let queryConsumerStarted = false
    const consumer: NativePlugin = {
      apiVersion: 1,
      name: 'native-sqlite-open-failure-consumer',
      targets: ['host'],
      requires: ['sessionQuery'],
      provides: [],
      resolve: () => () => { queryConsumerStarted = true },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: service('activeSessions', active), scope, config: undefined },
      { plugin: service('storageDomain', storage), scope, config: undefined },
      { plugin: projectionPlugin, scope, config: undefined },
      { plugin: cachePlugin, scope, config: { writeEveryEvents: 1, writeIntervalMs: 60_000 } },
      { plugin: sqlitePlugin, scope, config: { path: databasePath, openAt: 'startup' } },
      { plugin: consumer, scope, config: undefined },
    ], 'host'))

    let started = false
    try {
      let startupFailure: unknown
      try {
        await host.start()
        started = true
      } catch (reason: unknown) {
        startupFailure = reason
      }
      expect(startupFailure).toMatchObject({ code: 'SESSION_QUERY_INDEX_FAILED' })
      expect(queryConsumerStarted).toBe(false)
      expect(attached.size).toBe(0)
      expect(detached.size).toBe(0)
      expect(domain.close).toHaveBeenCalledOnce()

      const cleanupFailure = new Error('projection registration release failed')
      const unregisterProjection = vi.fn(() => { throw cleanupFailure })
      const projections = {
        register: vi.fn(() => unregisterProjection),
      } as unknown as NativeServices['sessionProjections']
      const cleanupScope = new NativeScope()
      const cleanupHost = new NativeHost(resolveInstallation([
        { plugin: service('activeSessions', active), scope: cleanupScope, config: undefined },
        { plugin: service('sessionProjections', projections), scope: cleanupScope, config: undefined },
        { plugin: sqlitePlugin, scope: cleanupScope, config: { path: databasePath, openAt: 'startup' } },
      ], 'host'))
      let activationAndCleanupFailure: unknown
      try {
        await cleanupHost.start()
      } catch (reason: unknown) {
        activationAndCleanupFailure = reason
      }
      const failures: unknown[] = []
      const pending: unknown[] = [activationAndCleanupFailure]
      while (pending.length > 0) {
        const failure = pending.pop()
        if (failure instanceof AggregateError) pending.push(...(failure.errors as unknown[]))
        else if (failure !== undefined) failures.push(failure)
      }
      expect(failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'SESSION_QUERY_INDEX_FAILED' }),
        cleanupFailure,
      ]))
      expect(unregisterProjection).toHaveBeenCalledOnce()
    } finally {
      if (started) await host.stop()
      await rm(temp, { recursive: true, force: true })
    }
  })
})
