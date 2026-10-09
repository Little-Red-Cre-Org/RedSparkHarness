import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import SessionStore, { SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { NativeSessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection/native'
import type { NativeSessionProjectionCacheOperations } from '@deepseek-ai/dsh-session-projection-cache/native'
import type { SessionEvent, SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { Session as NativeSession } from '@deepseek-ai/dsh-session/native'
import type { SessionAppendInput } from '@deepseek-ai/dsh-session/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/native'
import type { NativeContext, NativeServices } from '@deepseek-ai/dsh-native-runtime'
import SessionPersistence, {
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import SessionQueryEngine, {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  type SessionEventSurface,
  type SessionQueryErrorCode,
} from '@deepseek-ai/dsh-session-query'
import { SessionTitleProviderId, SessionTitleService } from '@deepseek-ai/dsh-session-title'
import { TestSessionQueryEngine } from './test-service.ts'
import {
  createNativeSessionQueryRuntime,
  createNativeSessionQuerySource,
  plugin as nativeSessionQueryPlugin,
  SessionQueryError,
  SESSION_QUERY_READ_WINDOW_MAX,
} from '../src/native.ts'
import type { NativeSessionQueryOperations, NativeSessionQuerySource } from '../src/native.ts'

const TITLE_SERVICE_CONFIG = { fallbackMaxWords: 8, fallbackMaxBytes: 64, maxTitleBytes: 256 }

function header(id: string, createdAt = 1, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, isSeeded: false, ...extra }
}

function eventLog(text = 'hello'): SessionEvent[] {
  return [{
    type: 'user/message',
    seq: SessionSeq(0),
    time: 10,
    data: createUserMessage({
      content: [{ type: 'text', text }], source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  }]
}

class TestHandle implements SessionHandle {
  constructor(
    readonly id: SessionIdType,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: ReturnType<typeof SessionLogOffset> = SessionLogOffset(0),
  ) {}

  read(offset = 0, length?: number, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    TestPersistence.readCalls.push(this.id)
    TestPersistence.readSignals.push(options?.signal)
    const slice = (events: SessionEvent[]): SessionEvent[] => {
      const from = events.filter(event => event.seq >= offset)
      return length === undefined ? from : from.slice(0, length)
    }
    if (TestPersistence.readOverride !== undefined) {
      return TestPersistence.readOverride(this.id, options?.signal).then(loaded => ({
        eventState: 'detached', events: structuredClone(slice(loaded.events)),
      } as const))
    }
    if (TestPersistence.readFailure !== undefined) return rejectUnknown(TestPersistence.readFailure)
    const entry = TestPersistence.entries.get(this.id)
    if (entry === undefined) return Promise.reject(new SessionPersistenceNotFoundError(this.id))
    const result = structuredClone(entry.events)
    TestPersistence.readEffect?.()
    TestPersistence.readEffect = undefined
    return Promise.resolve({ eventState: 'detached', events: slice(result) })
  }

  append(events: readonly SessionEvent[]): Promise<void> {
    if (this.access === 'read') return Promise.reject(new SessionReadOnlyError(this.id, 'append'))
    const entry = TestPersistence.entries.get(this.id)
    if (entry === undefined) return Promise.reject(new SessionPersistenceNotFoundError(this.id))
    entry.events.push(...structuredClone(events))
    return Promise.resolve()
  }

  flush(): Promise<void> {
    if (this.access === 'read') return Promise.reject(new SessionReadOnlyError(this.id, 'flush'))
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

function entryRevision(entry: { events: SessionEvent[] }): SessionPersistenceRevision {
  return SessionPersistenceRevision(`events:${entry.events.length}`)
}

class TestPersistence extends SessionPersistence {
  static entries = new Map<SessionIdType, {
    meta: SessionHeader
    events: SessionEvent[]
    inheritedEventCount?: ReturnType<typeof SessionLogOffset>
  }>()
  static listFailure: unknown
  static listOverride: ((signal?: AbortSignal) => Promise<SessionPersistenceSnapshot[]>) | undefined
  static readFailure: unknown
  static readEffect: (() => void) | undefined
  static readOverride: ((
    id: SessionIdType,
    signal?: AbortSignal,
  ) => Promise<{ meta: SessionHeader; events: SessionEvent[] }>) | undefined
  static afterList: (() => void) | undefined
  static afterStat: (() => void) | undefined
  static listCalls = 0
  static readCalls: SessionIdType[] = []
  static listSignals: Array<AbortSignal | undefined> = []
  static readSignals: Array<AbortSignal | undefined> = []

  static reset(entries: readonly {
    meta: SessionHeader
    events: SessionEvent[]
    inheritedEventCount?: ReturnType<typeof SessionLogOffset>
  }[] = []): void {
    this.entries = new Map(entries.map(entry => [entry.meta.id, structuredClone(entry)]))
    this.listFailure = undefined
    this.listOverride = undefined
    this.readFailure = undefined
    this.readEffect = undefined
    this.readOverride = undefined
    this.afterList = undefined
    this.afterStat = undefined
    this.listCalls = 0
    this.readCalls = []
    this.listSignals = []
    this.readSignals = []
  }

  create(header: SessionHeader): Promise<SessionHandle> {
    const entry = { meta: structuredClone(header), events: [], inheritedEventCount: SessionLogOffset(0) }
    TestPersistence.entries.set(header.id, entry)
    return Promise.resolve(new TestHandle(header.id, entry.meta, 'write', entry.inheritedEventCount))
  }

  // Appends are durable on resolution here; nothing buffers, so the service-wide flush is a no-op.
  async flush(): Promise<void> {}

  open(id: SessionIdType, access: SessionAccess): Promise<SessionHandle> {
    const entry = TestPersistence.entries.get(id)
    if (entry === undefined) return Promise.reject(new SessionPersistenceNotFoundError(id))
    return Promise.resolve(new TestHandle(id, structuredClone(entry.meta), access,
      entry.inheritedEventCount ?? SessionLogOffset(0)))
  }

  stat(id: SessionIdType): Promise<SessionPersistenceSnapshot | undefined> {
    const entry = TestPersistence.entries.get(id)
    const record = entry === undefined ? undefined : { header: structuredClone(entry.meta), revision: entryRevision(entry) }
    TestPersistence.afterStat?.()
    return Promise.resolve(record)
  }

  list(options?: { signal?: AbortSignal }): Promise<readonly SessionPersistenceSnapshot[]> {
    TestPersistence.listCalls += 1
    TestPersistence.listSignals.push(options?.signal)
    if (TestPersistence.listOverride !== undefined) return TestPersistence.listOverride(options?.signal)
    if (TestPersistence.listFailure !== undefined) return rejectUnknown(TestPersistence.listFailure)
    const snapshots = [...TestPersistence.entries.values()].map(entry => ({
      header: structuredClone(entry.meta),
      revision: entryRevision(entry),
    }))
    TestPersistence.afterList?.()
    return Promise.resolve(snapshots)
  }
}

async function liveContext(config: ConstructorParameters<typeof TestSessionQueryEngine>[1] = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TestSessionQueryEngine, config)
  return ctx
}

function expectCode(code: SessionQueryErrorCode): Error {
  return expect.objectContaining({ code }) as Error
}

async function rejectUnknown<T>(reason: unknown): Promise<T> {
  // Persistence and active-owner reads may reject with unknown provider or file errors.
  throw reason
}

async function installNativeSessionQuery(
  active: NativeActiveSessionOperations,
  persistence: unknown,
): Promise<NativeSessionQueryOperations> {
  const services = new Map<string, unknown>()
  const activate = nativeSessionQueryPlugin.resolve(undefined)
  await activate({
    require: () => active,
    optional: (key: keyof NativeServices) => key === 'sessionPersistence'
      ? persistence as NativeServices['sessionPersistence'] | undefined
      : undefined,
    own: () => {},
    provide: (key: string, service: unknown) => { services.set(key, service) },
  } as unknown as NativeContext)
  const service = services.get('sessionQuery')
  if (service === undefined) throw new Error('Native session-query provider did not provide sessionQuery')
  return service as NativeSessionQueryOperations
}

function nativeOwner(
  meta: SessionHeader,
  events: SessionEvent[],
  readEvents = (options?: { maxEvents?: number }) => Promise.resolve(events.slice(0, options?.maxEvents ?? events.length)),
): NativeActiveSessionOwner {
  return {
    agent: {},
    session: activeSession(meta, events),
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    readEvents,
  } as unknown as NativeActiveSessionOwner
}

function activeSession(meta: SessionHeader, events: readonly SessionEvent[]): NativeSession {
  const session = NativeSession.create(meta.id, undefined, meta)
  if (events.length > 0) session.appendBatch(events.map(sessionAppendInput))
  return session
}

function sessionAppendInput(event: SessionEvent): SessionAppendInput {
  const options = 'surfaceOp' in event && event.surfaceOp !== undefined
    ? {
      surfaceOp: event.surfaceOp,
      ...'sourceEventSeqs' in event && event.sourceEventSeqs !== undefined
        ? { sourceEventSeqs: [...event.sourceEventSeqs] }
        : {},
    }
    : 'ignorable' in event && event.ignorable ? { ignorable: true as const } : undefined
  return {
    type: event.type,
    data: event.data,
    ...options === undefined ? {} : { opts: options },
  } as SessionAppendInput
}

function nativeOwners(...owners: NativeActiveSessionOwner[]): NativeActiveSessionOperations {
  return { owners: () => owners } as unknown as NativeActiveSessionOperations
}

const cancellableSessionListings = [
  {
    name: 'listSessions',
    run: (ctx: Context, signal: AbortSignal) => ctx.sessionQuery.listSessions(signal),
  },
  {
    name: 'filterSessions',
    run: (ctx: Context, signal: AbortSignal) => ctx.sessionQuery.filterSessions([], signal),
  },
] as const

interface CancellableExactRead {
  readonly name: 'traceSession' | 'traceEvent' | 'readEvent'
  readonly inspects: boolean
  readonly run: (
    ctx: Context,
    sessionId: SessionIdType,
    signal: AbortSignal,
  ) => Promise<unknown>
}

const cancellableExactReads: readonly CancellableExactRead[] = [
  {
    name: 'traceSession',
    inspects: false,
    run: (ctx, sessionId, signal) => ctx.sessionQuery.traceSession(sessionId, signal),
  },
  {
    name: 'traceEvent',
    inspects: true,
    run: (ctx, sessionId, signal) => ctx.sessionQuery.traceEvent({ sessionId, seq: SessionSeq(0) }, signal),
  },
  {
    name: 'readEvent',
    inspects: true,
    run: (ctx, sessionId, signal) => ctx.sessionQuery.readEvent({ sessionId, seq: SessionSeq(0) }, signal),
  },
] as const

describe.each(cancellableSessionListings)('$name cancellation', ({ run }) => {
  it('preserves an exact pre-abort reason without entering persistence', async () => {
    TestPersistence.reset()
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('session listing cancelled before start')
    controller.abort(reason)

    await expect(run(ctx, controller.signal)).rejects.toBe(reason)
    expect(TestPersistence.listCalls).toBe(0)
    expect(TestPersistence.listSignals).toEqual([])
  })

  it('forwards in-flight cancellation and waits for persistence cleanup before rejecting', async () => {
    TestPersistence.reset()
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('session listing cancelled in flight')
    const started = Promise.withResolvers<undefined>()
    const abortObserved = Promise.withResolvers<undefined>()
    const cleanup = Promise.withResolvers<undefined>()
    let active = false
    TestPersistence.listOverride = async (signal) => {
      if (signal === undefined) throw new Error('expected persistence listing signal')
      active = true
      const aborted = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      started.resolve(undefined)
      await aborted
      abortObserved.resolve(undefined)
      await cleanup.promise
      active = false
      signal.throwIfAborted()
      return []
    }

    const pending = run(ctx, controller.signal)
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(reason)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(TestPersistence.listSignals).toEqual([controller.signal])

    cleanup.resolve(undefined)
    await expect(pending).rejects.toBe(reason)
    expect(active).toBe(false)
  })

  it('preserves cancellation after a persistence implementation ignores the signal', async () => {
    TestPersistence.reset()
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('session listing cancelled before persistence returned')
    const started = Promise.withResolvers<undefined>()
    const listing = Promise.withResolvers<SessionPersistenceSnapshot[]>()
    TestPersistence.listOverride = (_signal) => {
      started.resolve(undefined)
      return listing.promise
    }

    const pending = run(ctx, controller.signal)
    await started.promise
    controller.abort(reason)
    listing.resolve([])

    await expect(pending).rejects.toBe(reason)
    expect(TestPersistence.listSignals).toEqual([controller.signal])
  })
})

describe.each(cancellableExactReads)('$name cancellation', ({ inspects, run }) => {
  it('preserves an exact pre-abort reason without entering persistence', async () => {
    const persisted = header('pre-aborted-exact-read')
    TestPersistence.reset([{ meta: persisted, events: eventLog() }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('exact read cancelled before start')
    controller.abort(reason)

    await expect(run(ctx, persisted.id, controller.signal)).rejects.toBe(reason)
    expect(TestPersistence.listCalls).toBe(0)
    expect(TestPersistence.readCalls).toEqual([])
  })

  it('forwards in-flight list cancellation and waits for cleanup before rejecting', async () => {
    const persisted = header('cancelled-exact-list')
    TestPersistence.reset([{ meta: persisted, events: eventLog() }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('exact read list cancelled in flight')
    const started = Promise.withResolvers<undefined>()
    const abortObserved = Promise.withResolvers<undefined>()
    const cleanup = Promise.withResolvers<undefined>()
    let active = false
    TestPersistence.listOverride = async (signal) => {
      if (signal === undefined) throw new Error('expected exact-read listing signal')
      active = true
      const aborted = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      started.resolve(undefined)
      await aborted
      abortObserved.resolve(undefined)
      await cleanup.promise
      active = false
      signal.throwIfAborted()
      return []
    }

    const pending = run(ctx, persisted.id, controller.signal)
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(reason)
    await abortObserved.promise

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(TestPersistence.listSignals).toEqual([controller.signal])
    expect(TestPersistence.readCalls).toEqual([])

    cleanup.resolve(undefined)
    await expect(pending).rejects.toBe(reason)
    expect(active).toBe(false)
  })

  it('waits for an ignoring backend to return before preserving the abort reason', async () => {
    const persisted = header('ignored-exact-signal')
    const entry = { meta: persisted, events: eventLog() }
    TestPersistence.reset([entry])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('exact read cancelled while backend ignored signal')
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let active = false
    if (inspects) {
      TestPersistence.readOverride = async () => {
        active = true
        started.resolve(undefined)
        await release.promise
        active = false
        return structuredClone(entry)
      }
    } else {
      TestPersistence.listOverride = async () => {
        active = true
        started.resolve(undefined)
        await release.promise
        active = false
        return [{ header: structuredClone(persisted), revision: SessionPersistenceRevision('override:0') }]
      }
    }

    const pending = run(ctx, persisted.id, controller.signal)
    let settled = false
    void pending.then(
      () => { settled = true },
      () => { settled = true },
    )
    await started.promise
    controller.abort(reason)

    expect(settled).toBe(false)
    expect(active).toBe(true)
    expect(TestPersistence.listSignals).toEqual([controller.signal])
    expect(TestPersistence.readSignals).toEqual(inspects ? [controller.signal] : [])

    release.resolve(undefined)
    await expect(pending).rejects.toBe(reason)
    expect(active).toBe(false)
  })
})

describe.each(cancellableExactReads.filter(read => read.inspects))(
  '$name persisted inspection cancellation',
  ({ run }) => {
    it('forwards cancellation and waits for inspection cleanup before rejecting', async () => {
      const persisted = header('cancelled-exact-inspect')
      TestPersistence.reset([{ meta: persisted, events: eventLog() }])
      const ctx = await liveContext()
      await ctx.plugin(TestPersistence)
      const controller = new AbortController()
      const reason = new Error('exact read inspection cancelled in flight')
      const started = Promise.withResolvers<undefined>()
      const abortObserved = Promise.withResolvers<undefined>()
      const cleanup = Promise.withResolvers<undefined>()
      let active = false
      TestPersistence.readOverride = async (_sessionId, signal) => {
        if (signal === undefined) throw new Error('expected exact-read inspection signal')
        active = true
        const aborted = new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        started.resolve(undefined)
        await aborted
        abortObserved.resolve(undefined)
        await cleanup.promise
        active = false
        signal.throwIfAborted()
        throw new Error('unreachable after exact-read cancellation')
      }

      const pending = run(ctx, persisted.id, controller.signal)
      let settled = false
      void pending.then(
        () => { settled = true },
        () => { settled = true },
      )
      await started.promise
      controller.abort(reason)
      await abortObserved.promise

      expect(settled).toBe(false)
      expect(active).toBe(true)
      expect(TestPersistence.listSignals).toEqual([controller.signal])
      expect(TestPersistence.readSignals).toEqual([controller.signal])

      cleanup.resolve(undefined)
      await expect(pending).rejects.toBe(reason)
      expect(active).toBe(false)
    })
  },
)

describe('session-query exact reads', () => {
  it('returns a detached replay-valid fork log and rejects a corrupt persisted seed', async () => {
    const valid = header('valid-log', 2, { parentSession: SessionId('valid-parent'), isSeeded: true })
    const corrupt = header('corrupt-log', 1)
    const validEvents: SessionEvent[] = [
      ...eventLog('valid'),
      { type: 'session/end-seed', seq: SessionSeq(1), time: 11, data: { inherited: true } },
      {
        type: 'session/title', seq: SessionSeq(2), time: 20,
        data: { title: 'Fork title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' } },
      },
    ]
    const corruptEvents = [{ ...eventLog('bad')[0]!, seq: SessionSeq(1) }]
    TestPersistence.reset([
      { meta: valid, events: validEvents, inheritedEventCount: SessionLogOffset(1) },
      { meta: corrupt, events: corruptEvents },
    ])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)

    const snapshot = await ctx.sessionQuery.readSession(valid.id)
    expect(snapshot).toEqual({
      session: valid,
      inheritedEventCount: SessionLogOffset(1),
      events: validEvents,
    })
    Object.assign(snapshot.events[0]!, { time: 999 })
    expect(TestPersistence.entries.get(valid.id)?.events[0]?.time).toBe(10)
    await expect(ctx.sessionQuery.readSession(corrupt.id)).rejects.toThrow('seed event at index 0 has seq 1')
  })

  it('prefers a live owner that attaches while its persisted prefix is inspected', async () => {
    const shared = header('attach-during-inspect', 2)
    TestPersistence.reset([{ meta: shared, events: eventLog('persisted') }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    TestPersistence.readEffect = () => {
      ctx.sessions.create(shared.id, {
        seed: eventLog('live'),
        meta: { createdAt: shared.createdAt },
      })
    }

    await expect(ctx.sessionQuery.filterEvents(shared.id, []))
      .resolves.toMatchObject([{ sessionId: shared.id, text: 'live' }])
  })

  it('reads the latest title from one live-preferred or persisted log without widening listSessions', async () => {
    const persistedHeader = header('persisted-title', 2)
    const sharedHeader = header('shared-title', 3)
    TestPersistence.reset([
      {
        meta: persistedHeader,
        events: [{
          type: 'session/title',
          seq: SessionSeq(0),
          time: 20,
          data: {
            title: 'Persisted title',
            messageSeqs: [SessionSeq(4)],
            source: { kind: 'fallback' },
          },
        }],
      },
      {
        meta: sharedHeader,
        events: [{
          type: 'session/title',
          seq: SessionSeq(0),
          time: 30,
          data: {
            title: 'Stale durable title',
            messageSeqs: [SessionSeq(1)],
            source: { kind: 'fallback' },
          },
        }],
      },
    ])
    const ctx = await liveContext()
    await ctx.plugin(SessionTitleService, TITLE_SERVICE_CONFIG)
    const shared = ctx.sessions.create(sharedHeader.id, { meta: { createdAt: 3 } })
    shared.append('session/title', {
      title: 'Live title',
      messageSeqs: [SessionSeq(7)],
      source: {
        kind: 'provider',
        provider: SessionTitleProviderId('query-test'),
      },
    })
    await ctx.plugin(TestPersistence)

    await expect(ctx.sessionQuery.readTitle(persistedHeader.id)).resolves.toMatchObject({
      title: 'Persisted title', eventSeq: 0, updatedAt: 20,
    })
    await expect(ctx.sessionQuery.readTitle(shared.id)).resolves.toMatchObject({
      title: 'Live title', eventSeq: 0,
    })
    expect(Object.keys((await ctx.sessionQuery.listSessions())[0]!)).toEqual(['header', 'live', 'persisted'])
  })

  it('batches unique persisted title observations through one cancellable corpus scan', async () => {
    const first = header('batch-title-first', 1)
    const second = header('batch-title-second', 2)
    const titleEvent = (title: string, time: number): SessionEvent => ({
      type: 'session/title',
      seq: SessionSeq(0),
      time,
      data: {
        title,
        messageSeqs: [],
        source: { kind: 'fallback' },
      },
    })
    TestPersistence.reset([
      { meta: first, events: [titleEvent('First title', 10)] },
      { meta: second, events: [titleEvent('Second title', 20)] },
    ])
    const ctx = await liveContext()
    await ctx.plugin(SessionTitleService, TITLE_SERVICE_CONFIG)
    await ctx.plugin(TestPersistence)
    const signal = new AbortController().signal
    const missing = SessionId('batch-title-missing')

    const results = await ctx.sessionQuery.readTitleSnapshots(
      [second.id, first.id, second.id, missing],
      signal,
    )

    expect(results.map(result => [result.sessionId, result.status])).toEqual([
      [second.id, 'fulfilled'],
      [first.id, 'fulfilled'],
      [missing, 'rejected'],
    ])
    expect(results[0]).toMatchObject({ value: { session: second, title: { title: 'Second title' } } })
    expect(results[1]).toMatchObject({ value: { session: first, title: { title: 'First title' } } })
    expect(TestPersistence.listCalls).toBe(1)
    expect(TestPersistence.readCalls).toEqual([second.id, first.id])
    expect(TestPersistence.listSignals).toEqual([signal])
    expect(TestPersistence.readSignals).toEqual([signal, signal])
  })

  it('bounds persisted title inspection concurrency while preserving ordered results', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => {
      const meta = header(`bounded-title-${index}`, index)
      return { meta, events: eventLog(`title-${index}`) }
    })
    TestPersistence.reset(entries)
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    let active = 0
    let maximum = 0
    TestPersistence.readOverride = async (id) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>(resolve => setImmediate(resolve))
      active -= 1
      const entry = TestPersistence.entries.get(id)
      if (entry === undefined) throw new Error('missing bounded test session')
      return structuredClone(entry)
    }

    const results = await ctx.sessionQuery.readTitleSnapshots(entries.map(entry => entry.meta.id))

    expect(maximum).toBe(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY)
    expect(TestPersistence.listCalls).toBe(1)
    expect(TestPersistence.readCalls).toEqual(entries.map(entry => entry.meta.id))
    expect(results.map(result => result.sessionId)).toEqual(entries.map(entry => entry.meta.id))
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
  })

  it('folds and discards each completed log before its worker dequeues another inspection', async () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      meta: header(`project-title-${index}`, index),
      events: [],
    }))
    TestPersistence.reset(entries)
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const timeline: string[] = []
    const releases = new Map<SessionIdType, () => void>()
    TestPersistence.readOverride = id => new Promise((resolve) => {
      timeline.push(`inspect:${id}`)
      releases.set(id, () => {
        const marker = `full-log-marker:${id}`
        const titleEvent = {
          type: 'session/title',
          seq: SessionSeq(1),
          time: 20,
          data: {
            title: `Projected ${id}`,
            get messageSeqs() {
              timeline.push(`project:${id}`)
              return []
            },
            source: { kind: 'fallback' },
          },
        } as unknown as SessionEvent
        resolve({
          meta: entries.find(entry => entry.meta.id === id)!.meta,
          events: [...eventLog(marker), titleEvent],
        })
      })
    })
    const release = (id: SessionIdType): void => {
      const settle = releases.get(id)
      if (settle === undefined) throw new Error(`inspection ${id} has not started`)
      settle()
    }
    const ids = entries.map(entry => entry.meta.id)

    const pending = ctx.sessionQuery.readTitleSnapshots(ids)
    await vi.waitFor(() => { expect(TestPersistence.readCalls).toHaveLength(4) })
    release(ids[0]!)
    await vi.waitFor(() => { expect(TestPersistence.readCalls).toHaveLength(5) })

    // Heap-retention assertions would depend on nondeterministic GC. This ordering
    // is the deterministic guard: a retain-all implementation cannot touch the
    // observable title getter until every inspection has completed.
    expect(timeline.indexOf(`project:${ids[0]}`))
      .toBeLessThan(timeline.indexOf(`inspect:${ids[4]}`))
    for (const id of ids.slice(1)) release(id)
    const results = await pending

    expect(results.map(result => result.sessionId)).toEqual(ids)
    expect(JSON.stringify(results)).not.toContain('full-log-marker:')
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
  })

  it('passes cancellation into a stalled persisted title batch and rejects with its reason', async () => {
    const persisted = header('stalled-title', 1)
    TestPersistence.reset([{ meta: persisted, events: [] }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('title deadline')
    let started!: () => void
    const inspectStarted = new Promise<void>((resolve) => { started = resolve })
    TestPersistence.readOverride = (_id, signal) => new Promise((_resolve, reject) => {
      started()
      signal?.addEventListener('abort', () => { reject(reason) }, { once: true })
    })

    const pending = ctx.sessionQuery.readTitleSnapshots([persisted.id], controller.signal)
    await inspectStarted
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(TestPersistence.listSignals).toEqual([controller.signal])
    expect(TestPersistence.readSignals).toEqual([controller.signal])
  })

  it('drains started title inspections after cancellation without starting queued ids', async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      meta: header(`cancel-queued-title-${index}`, index),
      events: eventLog(`queued-${index}`),
    }))
    TestPersistence.reset(entries)
    const persistedReadConcurrency = 2
    const ctx = await liveContext({ persistedReadConcurrency })
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('cancel queued title batch')
    const releases: Array<() => void> = []
    let abortsObserved = 0
    let inspectionsSettled = 0
    TestPersistence.readOverride = (_id, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { abortsObserved += 1 }, { once: true })
      releases.push(() => {
        inspectionsSettled += 1
        reject(reason)
      })
    })

    const pending = ctx.sessionQuery.readTitleSnapshots(
      entries.map(entry => entry.meta.id),
      controller.signal,
    )
    let batchSettled = false
    void pending.then(
      () => { batchSettled = true },
      () => { batchSettled = true },
    )
    await vi.waitFor(() => {
      expect(TestPersistence.readCalls).toHaveLength(persistedReadConcurrency)
    })
    controller.abort(reason)
    await vi.waitFor(() => { expect(abortsObserved).toBe(persistedReadConcurrency) })

    expect(batchSettled).toBe(false)
    expect(TestPersistence.readCalls)
      .toEqual(entries.slice(0, persistedReadConcurrency).map(entry => entry.meta.id))
    for (const release of releases) release()

    await expect(pending).rejects.toBe(reason)
    expect(inspectionsSettled).toBe(persistedReadConcurrency)
    expect(TestPersistence.readCalls)
      .toEqual(entries.slice(0, persistedReadConcurrency).map(entry => entry.meta.id))
  })

  it('passes cancellation into a stalled persisted title listing and rejects with its reason', async () => {
    const persisted = header('stalled-title-list', 1)
    TestPersistence.reset([{ meta: persisted, events: [] }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const controller = new AbortController()
    const reason = new Error('title listing deadline')
    let started!: () => void
    const listStarted = new Promise<void>((resolve) => { started = resolve })
    TestPersistence.listOverride = signal => new Promise((_resolve, reject) => {
      started()
      signal?.addEventListener('abort', () => { reject(reason) }, { once: true })
    })

    const pending = ctx.sessionQuery.readTitleSnapshots([persisted.id], controller.signal)
    await listStarted
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(TestPersistence.listSignals).toEqual([controller.signal])
    expect(TestPersistence.readCalls).toEqual([])
  })

  it('isolates title read and fold failures while preferring a live owner attached during inspection', async () => {
    const attached = header('batch-title-attached', 1)
    const failed = header('batch-title-failed', 2)
    const malformed = header('batch-title-malformed', 3)
    const inspectFailure = new Error('one title inspect failed')
    const malformedTitle = {
      type: 'session/title',
      seq: SessionSeq(0),
      time: 30,
      data: {
        title: 'malformed',
        source: { kind: 'fallback' },
      },
    } as unknown as SessionEvent
    TestPersistence.reset([
      { meta: attached, events: eventLog('stale persisted') },
      { meta: failed, events: [] },
      { meta: malformed, events: [malformedTitle] },
    ])
    const ctx = await liveContext()
    await ctx.plugin(SessionTitleService, TITLE_SERVICE_CONFIG)
    await ctx.plugin(TestPersistence)
    TestPersistence.readOverride = (id) => {
      if (id === failed.id) return Promise.reject(inspectFailure)
      const entry = TestPersistence.entries.get(id)
      if (entry === undefined) return Promise.reject(new Error('missing test session'))
      if (id === attached.id) {
        const session = ctx.sessions.create(attached.id, { meta: { createdAt: attached.createdAt } })
        session.append('session/title', {
          title: 'Attached live title',
          messageSeqs: [],
          source: { kind: 'fallback' },
        })
      }
      return Promise.resolve(structuredClone(entry))
    }

    const results = await ctx.sessionQuery.readTitleSnapshots([
      attached.id,
      failed.id,
      malformed.id,
    ])

    expect(results[0]).toMatchObject({
      status: 'fulfilled',
      value: { session: attached, title: { title: 'Attached live title' } },
    })
    expect(results[1]).toMatchObject({
      sessionId: failed.id,
      status: 'rejected',
      reason: {
        code: 'SESSION_QUERY_PERSISTENCE_FAILED',
        cause: inspectFailure,
      },
    })
    expect(results[2]).toMatchObject({ sessionId: malformed.id, status: 'rejected' })
    if (results[2]?.status !== 'rejected') throw new Error('expected malformed title rejection')
    expect(results[2].reason).toBeInstanceOf(Error)
  })

  it('preserves live batch results across missing persistence, listing failure, and late attachment', async () => {
    const liveOnly = await liveContext()
    const live = liveOnly.sessions.create(SessionId('batch-title-live'))
    const missing = SessionId('batch-title-no-persistence')

    await expect(liveOnly.sessionQuery.readTitleSnapshots([live.id, live.id])).resolves.toEqual([{
      sessionId: live.id,
      status: 'fulfilled',
      value: { session: live.header },
    }])
    await expect(liveOnly.sessionQuery.readTitleSnapshots([live.id, missing])).resolves.toMatchObject([
      { sessionId: live.id, status: 'fulfilled' },
      { sessionId: missing, status: 'rejected' },
    ])
    await expect(liveOnly.sessionQuery.readTitleSnapshot(missing))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))

    const persisted = header('batch-title-persisted', 1)
    const late = header('batch-title-late', 2)
    TestPersistence.reset([{ meta: persisted, events: [] }])
    const mixed = await liveContext()
    const mixedLive = mixed.sessions.create(SessionId('batch-title-mixed-live'))
    await mixed.plugin(TestPersistence)
    TestPersistence.afterList = () => {
      mixed.sessions.create(late.id, { meta: { createdAt: late.createdAt } })
      TestPersistence.afterList = undefined
    }

    await expect(mixed.sessionQuery.readTitleSnapshots([
      mixedLive.id,
      persisted.id,
      late.id,
    ])).resolves.toMatchObject([
      { sessionId: mixedLive.id, status: 'fulfilled' },
      { sessionId: persisted.id, status: 'fulfilled' },
      { sessionId: late.id, status: 'fulfilled' },
    ])

    TestPersistence.reset()
    TestPersistence.listFailure = new Error('title listing failed')
    const failedList = await liveContext()
    const survivingLive = failedList.sessions.create(SessionId('batch-title-list-live'))
    await failedList.plugin(TestPersistence)

    await expect(failedList.sessionQuery.readTitleSnapshots([survivingLive.id, missing]))
      .resolves.toMatchObject([
        { sessionId: survivingLive.id, status: 'fulfilled' },
        {
          sessionId: missing,
          status: 'rejected',
          reason: expectCode('SESSION_QUERY_PERSISTENCE_FAILED'),
        },
      ])
  })

  it('lists live sessions deterministically and returns detached headers', async () => {
    const ctx = await liveContext()
    const older = ctx.sessions.create(SessionId('older'), { meta: { createdAt: 1 } })
    ctx.sessions.create(SessionId('z'), { meta: { createdAt: 2 } })
    ctx.sessions.create(SessionId('a'), { meta: { createdAt: 2 } })

    const records = await ctx.sessionQuery.listSessions()
    expect(records.map(record => record.header.id)).toEqual([SessionId('a'), SessionId('z'), older.id])
    expect(records.every(record => record.live && !record.persisted)).toBe(true)
    Object.assign(records[2]!.header, { createdAt: 99 })
    expect(older.header.createdAt).toBe(1)
  })

  it('filters sessions symmetrically and owns mutable filter values immediately', async () => {
    const durable = header('durable-filter', 1)
    TestPersistence.reset([{ meta: durable, events: eventLog('durable') }])
    const ctx = await liveContext()
    const live = ctx.sessions.create(SessionId('live-filter'), { meta: { createdAt: 2 } })
    live.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'live' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    const persistence = await ctx.plugin(TestPersistence)

    const ids = [durable.id]
    const filtered = ctx.sessionQuery.filterSessions([{ kind: 'id', values: ids }])
    ids[0] = live.id
    await expect(filtered).resolves.toEqual([{
      header: durable,
      live: false,
      persisted: true,
    }])

    const surfaces: SessionEventSurface[] = ['current']
    const events = ctx.sessionQuery.filterEvents(live.id, [{ kind: 'surface', values: surfaces }])
    surfaces[0] = 'shadowed'
    await expect(events).resolves.toMatchObject([{ sessionId: live.id, surface: 'current', text: 'live' }])
    await expect(ctx.sessionQuery.filterSessions([{ kind: 'future' } as never]))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await expect(ctx.sessionQuery.filterEvents(live.id, [{ kind: 'future' } as never]))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_FILTER'))
    await persistence.dispose()
  })

  it('classifies current, shadowed, and raw-log-only events through foldSurface', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('surface'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const first = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'first' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('assistant/attempt', {
      turn: 1,
      step: 1,
      stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [], texts: ['draft'] }],
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'replacement' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] },
    )

    expect((await ctx.sessionQuery.listEvents(session.id)).slice(2).map(record => record.surface))
      .toEqual(['shadowed', 'log-only', 'current'])
  })

  it('reads a detached current surface with its raw-log capture boundary', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('surface-snapshot'), { meta: { cwd: '/work' } })
    const first = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'old' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('assistant/attempt', {
      turn: 1,
      step: 1,
      stream: [{ type: 'text-chunks', time0: 0, index: 0, dt: [], texts: ['draft'] }],
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'plugin', plugin: 'compact' },
      }),
      { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [first.seq] },
    )
    const retained = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'retained tail' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'latest checkpoint' }], source: { kind: 'plugin', plugin: 'compact' },
      }),
      { surfaceOp: { op: 'replace', startSeq: SessionSeq(2), endSeq: retained.seq }, sourceEventSeqs: [SessionSeq(2), retained.seq] },
    )
    session.append(
      'assistant/message',
      {
        stream: [],
        turn: 2, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'latest answer' }],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      },
      { surfaceOp: 'append' },
    )

    const snapshot = await ctx.sessionQuery.readSurface(session.id)
    expect(snapshot.session).toEqual(session.header)
    expect(snapshot.capturedThroughSeq).toBe(5)
    expect(snapshot.events.map(event => [event.seq, event.type])).toEqual([
      [4, 'user/message'],
      [5, 'assistant/message'],
    ])
    if (snapshot.events[0]?.type !== 'user/message') throw new Error('expected current user message')
    expect(() => {
      (snapshot.events[0]!.data as { content: unknown[] }).content = []
    }).toThrow()
    Object.assign(snapshot.session, { cwd: '/mutated' })

    const logged = session.eventAt(SessionSeq(4))
    expect(logged?.type === 'user/message' && logged.data.content).toHaveLength(1)
    expect(session.header.cwd).toBe('/work')
  })

  it('returns an empty current surface with a null capture boundary', async () => {
    const ctx = await liveContext()
    const session = ctx.sessions.create(SessionId('empty-surface'))
    await expect(ctx.sessionQuery.readSurface(session.id)).resolves.toMatchObject({
      capturedThroughSeq: null,
      events: [],
    })
  })

  it('returns a bounded detached raw-event window and validates the request', async () => {
    const ctx = await liveContext({ readWindowMax: 1 })
    const session = ctx.sessions.create(SessionId('window'), { meta: { cwd: '/work' } })
    session.append('turn/start', { turn: 1 })
    for (const text of ['one', 'two', 'three']) {
      session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text }], source: { kind: 'user' },
        }),
        { surfaceOp: 'append' },
      )
    }

    const result = await ctx.sessionQuery.readEvent({ sessionId: session.id, seq: SessionSeq(2), before: 1, after: 1 })
    expect([result.startSeq, result.endSeq, result.target.seq]).toEqual([1, 3, 2])
    expect(result.session).toEqual(session.header)
    Object.assign(result.session, { createdAt: -1 })
    if (result.events[0]?.type !== 'user/message') throw new Error('expected user message')
    expect(() => {
      (result.events[0]!.data as { content: unknown[] }).content = []
    }).toThrow()
    expect(session.header.createdAt).not.toBe(-1)
    const logged = session.eventAt(SessionSeq(1))
    expect(logged?.type === 'user/message' && logged.data.content).toHaveLength(1)

    await expect(ctx.sessionQuery.readEvent({ sessionId: session.id, seq: SessionSeq(9) }))
      .rejects.toThrow(expectCode('SESSION_QUERY_EVENT_NOT_FOUND'))
    for (const request of [
      { sessionId: session.id, seq: SessionSeq(0), before: -1 },
      { sessionId: session.id, seq: SessionSeq(0), before: 2 },
      { sessionId: session.id, seq: SessionSeq(0), after: 0.5 },
    ]) {
      await expect(ctx.sessionQuery.readEvent(request)).rejects.toThrow(expectCode('SESSION_QUERY_INVALID_WINDOW'))
    }
  })

  it('merges authoritative persistence with live precedence and detects conflicts', async () => {
    const shared = header('shared', 3, { cwd: '/same' })
    const durable = header('durable', 2)
    TestPersistence.reset([
      { meta: shared, events: eventLog('persisted') },
      { meta: durable, events: eventLog('durable') },
    ])
    const ctx = await liveContext()
    const live = ctx.sessions.create(shared.id, { meta: { createdAt: 3, cwd: '/same' } })
    live.append('turn/start', { turn: 1 })
    live.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'live' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    const persistence = await ctx.plugin(TestPersistence)

    expect((await ctx.sessionQuery.listSessions()).map(record => [record.header.id, record.live, record.persisted]))
      .toEqual([[shared.id, true, true], [durable.id, false, true]])
    const liveRead = await ctx.sessionQuery.readEvent({ sessionId: shared.id, seq: SessionSeq(1) })
    expect(liveRead.target.type === 'user/message' && liveRead.target.data.content[0])
      .toMatchObject({ text: 'live' })
    await expect(ctx.sessionQuery.readSurface(shared.id)).resolves.toMatchObject({
      events: [{ data: { content: [{ text: 'live' }] } }],
    })
    await expect(ctx.sessionQuery.readEvent({ sessionId: durable.id, seq: SessionSeq(0) }))
      .resolves.toMatchObject({ session: durable })
    await expect(ctx.sessionQuery.readSurface(durable.id)).resolves.toMatchObject({
      session: durable,
      events: [{ data: { content: [{ text: 'durable' }] } }],
    })

    const sharedEntry = TestPersistence.entries.get(shared.id)!
    sharedEntry.meta = { ...sharedEntry.meta, cwd: '/conflict' }
    await expect(ctx.sessionQuery.listSessions()).rejects.toThrow(expectCode('SESSION_QUERY_SOURCE_CONFLICT'))
    sharedEntry.meta = { ...sharedEntry.meta, cwd: '/same', delegationDepth: 1 }
    await expect(ctx.sessionQuery.listSessions()).rejects.toThrow(expectCode('SESSION_QUERY_SOURCE_CONFLICT'))
    await persistence.dispose()
    await expect(ctx.sessionQuery.listSessions()).resolves.toEqual([
      { header: shared, live: true, persisted: false },
    ])
  })

  it('keeps known live reads independent from persistence health', async () => {
    TestPersistence.reset()
    const ctx = await liveContext()
    const live = ctx.sessions.create(SessionId('live'))
    live.append('turn/start', { turn: 1 })
    live.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'available' }], source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    await ctx.plugin(TestPersistence)
    TestPersistence.listFailure = new Error('list unavailable')
    TestPersistence.readFailure = new Error('inspect unavailable')
    const signal = new AbortController().signal

    await expect(ctx.sessionQuery.listEvents(live.id)).resolves.toHaveLength(2)
    await expect(ctx.sessionQuery.traceEvent({ sessionId: live.id, seq: SessionSeq(1) }, signal))
      .resolves.toMatchObject({ session: { id: live.id }, target: { seq: SessionSeq(1) } })
    await expect(ctx.sessionQuery.readEvent({ sessionId: live.id, seq: SessionSeq(1) }, signal))
      .resolves.toMatchObject({ target: { seq: SessionSeq(1) } })
    expect(TestPersistence.listSignals).toEqual([])
    expect(TestPersistence.readSignals).toEqual([])
    await expect(ctx.sessionQuery.listSessions()).rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    await expect(ctx.sessionQuery.listEvents(SessionId('durable'))).rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
  })

  it('wraps persisted corruption as SESSION_QUERY_CORRUPT_SESSION with its cause preserved', async () => {
    const durable = header('durable-corrupt')
    TestPersistence.reset([{ meta: durable, events: eventLog() }])
    const ctx = await liveContext()
    await ctx.plugin(TestPersistence)
    const corruption = new SessionPersistenceCorruptionError(
      'stored prefix failed validation',
      { cause: new Error('torn final record') },
    )
    TestPersistence.readFailure = corruption

    await expect(ctx.sessionQuery.readSession(durable.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_CORRUPT_SESSION',
      message: `stored session "${durable.id}" is corrupt: stored prefix failed validation`,
      cause: corruption,
    })
  })

  it('reports absent sessions, persisted load failures, and persisted header conflicts', async () => {
    const durable = header('durable')
    TestPersistence.reset([{ meta: durable, events: eventLog() }])
    const ctx = await liveContext()
    await expect(ctx.sessionQuery.listEvents(SessionId('absent')))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))
    await ctx.plugin(TestPersistence)
    await expect(ctx.sessionQuery.listEvents(SessionId('absent')))
      .rejects.toThrow(expectCode('SESSION_QUERY_SESSION_NOT_FOUND'))

    TestPersistence.readFailure = 'raw failure'
    await expect(ctx.sessionQuery.listEvents(durable.id))
      .rejects.toThrow(expectCode('SESSION_QUERY_PERSISTENCE_FAILED'))
    TestPersistence.readFailure = undefined
    const durableEntry = TestPersistence.entries.get(durable.id)!
    durableEntry.meta = { ...durableEntry.meta, cwd: '/changed-after-list' }
    TestPersistence.afterList = () => {
      const listedEntry = TestPersistence.entries.get(durable.id)!
      listedEntry.meta = { ...listedEntry.meta, cwd: '/changed-during-read' }
    }
    await expect(ctx.sessionQuery.listEvents(durable.id))
      .rejects.toThrow(expectCode('SESSION_QUERY_SOURCE_CONFLICT'))
  })

  it('turns persisted malformed surfaces and direct invalid config into typed errors', async () => {
    const ctx = await liveContext()
    const persisted = header('bad-persisted-surface')
    TestPersistence.reset([{
      meta: persisted,
      events: [{
        type: 'user/message',
        seq: SessionSeq(0),
        time: 1,
        data: createUserMessage({
          content: [{ type: 'text', text: 'hidden' }], source: { kind: 'user' },
        }),
      }] as unknown as SessionEvent[],
    }])
    const persistence = await ctx.plugin(TestPersistence)
    await expect(ctx.sessionQuery.listEvents(persisted.id))
      .rejects.toThrow(expectCode('SESSION_QUERY_INVALID_SURFACE'))
    await persistence.dispose()

    const direct = new Context()
    await direct.plugin(SessionStore)
    expect(new TestSessionQueryEngine(direct)).toBeInstanceOf(SessionQueryEngine)
    for (const config of [
      { readWindowMax: -1 },
      { persistedReadConcurrency: 0 },
      { persistedReadConcurrency: Number.MAX_SAFE_INTEGER + 1 },
      { preparedSessionCacheSize: 0 },
      { preparedSessionCacheSize: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const invalid = new Context()
      await invalid.plugin(SessionStore)
      expect(() => new TestSessionQueryEngine(invalid, config))
        .toThrow(expectCode('SESSION_QUERY_INVALID_CONFIG'))
    }
  })

  it('exposes caller-owned observation leases through observeSession', async () => {
    const ctx = await liveContext()
    const live = ctx.sessions.create(SessionId('observe-live'))

    using observed = await ctx.sessionQuery.observeSession(live.id)

    expect(observed.source).toBe('live')
    expect(observed.header.id).toBe(live.id)
  })

  it('leaves the optional persistence dependency optional', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(TestSessionQueryEngine)
    expect(ctx.sessionQuery).toBeInstanceOf(TestSessionQueryEngine)
    await fiber.dispose()
    expect(ctx.sessionQuery).toBeUndefined()
  })

  it('awaits optional-persistence child-fiber quiescence on disposal', async () => {
    TestPersistence.reset()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const query = await ctx.plugin(TestSessionQueryEngine)
    const persistence = await ctx.plugin(TestPersistence)
    const optional = (ctx.sessionQuery as unknown as {
      _corpus: { _optionalPersistenceFiber: Fiber }
    })._corpus._optionalPersistenceFiber
    let release!: () => void
    const cleanup = new Promise<void>((resolve) => { release = resolve })
    optional.ctx.effect(() => () => cleanup)

    let settled = false
    const disposing = query.dispose().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await disposing
    await persistence.dispose()
  })
})

describe('native session-query exact reads', () => {
  it.each([
    { reason: 'returns no checkpoint', failure: undefined },
    { reason: 'throws while reading', failure: new Error('checkpoint storage unavailable') },
  ])('folds a cold projection when the checkpoint cache $reason', async ({ failure }) => {
    const stored = header('native-observation-checkpoint-fallback', 4)
    TestPersistence.reset([{ meta: stored, events: eventLog('checkpoint fallback') }])
    const cachedCheckpoint = vi.fn(() => {
      if (failure !== undefined) throw failure
      return undefined
    })
    const cache = { cachedCheckpoint } as unknown as NativeSessionProjectionCacheOperations
    const runtime = createNativeSessionQueryRuntime(
      createNativeSessionQuerySource(nativeOwners(), new TestPersistence(new Context())),
      { projections: new NativeSessionProjectionRegistry(), checkpointCache: cache },
    )

    try {
      const observation = await runtime.operations.observeSession(stored.id)
      try {
        expect(observation.source).toBe('prepared')
        expect(observation.projections?.asOfSeq).toBe(SessionSeq(0))
        expect(cachedCheckpoint).toHaveBeenCalledOnce()
      } finally {
        observation[Symbol.dispose]()
      }
    } finally {
      await runtime.close()
    }
  })

  it('keeps pinned cold observations immutable across revisions and LRU eviction', async () => {
    const stored = header('native-observation-lease', 4)
    const other = header('native-observation-lease-other', 5)
    const extra = header('native-observation-lease-extra', 6)
    TestPersistence.reset([
      { meta: stored, events: eventLog('revision one') },
      { meta: other, events: eventLog('other session') },
      { meta: extra, events: eventLog('extra session') },
    ])
    const persistence = new TestPersistence(new Context())
    const source = createNativeSessionQuerySource(nativeOwners(), persistence)
    const runtime = createNativeSessionQueryRuntime(source, { preparedSessionCacheSize: 1 })
    const leases: Array<Awaited<ReturnType<NativeSessionQueryOperations['observeSession']>>> = []

    try {
      const first = await runtime.operations.observeSession(stored.id)
      leases.push(first)
      const entry = TestPersistence.entries.get(stored.id)
      if (entry === undefined) throw new Error('persisted observation fixture disappeared')
      entry.events.push({ ...eventLog('revision two')[0]!, seq: SessionSeq(1), time: 11 })

      const revised = await runtime.operations.observeSession(stored.id)
      leases.push(revised)
      expect(first.source).toBe('prepared')
      expect(first.revision).not.toBe(revised.revision)
      expect(first.events.map(event => event.seq)).toEqual([SessionSeq(0)])
      expect(revised.events.map(event => event.seq)).toEqual([SessionSeq(0), SessionSeq(1)])
      expect(revised.events[1]).toMatchObject({
        type: 'user/message', seq: SessionSeq(1), data: { content: [{ type: 'text', text: 'revision two' }] },
      })
      const retained = revised.retain()
      leases.push(retained)
      expect(retained).not.toBe(revised)
      expect(retained.events).toBe(revised.events)

      const otherLease = await runtime.operations.observeSession(other.id)
      leases.push(otherLease)
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id])
      const pinnedHit = await runtime.operations.observeSession(stored.id)
      leases.push(pinnedHit)
      expect(pinnedHit.events).toBe(revised.events)
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id])

      const extraLease = await runtime.operations.observeSession(extra.id)
      leases.push(extraLease)
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id, extra.id])
      otherLease[Symbol.dispose]()
      const pinnedOverCapacityHit = await runtime.operations.observeSession(stored.id)
      leases.push(pinnedOverCapacityHit)
      expect(pinnedOverCapacityHit.events).toBe(revised.events)
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id, extra.id])
      pinnedOverCapacityHit[Symbol.dispose]()

      first[Symbol.dispose]()
      revised[Symbol.dispose]()
      expect(() => revised.retain()).toThrow('is disposed')
      expect(retained.events[1]).toMatchObject({ data: { content: [{ text: 'revision two' }] } })
      pinnedHit[Symbol.dispose]()
      const retainedHit = await runtime.operations.observeSession(stored.id)
      leases.push(retainedHit)
      expect(retainedHit.events).toBe(retained.events)
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id, extra.id])
      retainedHit[Symbol.dispose]()
      retained[Symbol.dispose]()
      const afterEviction = await runtime.operations.observeSession(stored.id)
      leases.push(afterEviction)
      expect(afterEviction.events.map(event => event.seq)).toEqual([SessionSeq(0), SessionSeq(1)])
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id, other.id, extra.id, stored.id])
    } finally {
      for (const lease of leases) lease[Symbol.dispose]()
      await runtime.close()
    }
  })

  it('retries a cold observation when its revision changes during the read', async () => {
    const stored = header('native-observation-revision-churn', 6)
    TestPersistence.reset([{ meta: stored, events: eventLog('revision one') }])
    let statCalls = 0
    TestPersistence.afterStat = () => { statCalls += 1 }
    TestPersistence.readEffect = () => {
      const entry = TestPersistence.entries.get(stored.id)
      if (entry === undefined) throw new Error('persisted revision fixture disappeared')
      entry.events.push({ ...eventLog('revision two')[0]!, seq: SessionSeq(1), time: 11 })
    }
    const persistence = new TestPersistence(new Context())
    const runtime = createNativeSessionQueryRuntime(createNativeSessionQuerySource(nativeOwners(), persistence))

    try {
      const observation = await runtime.operations.observeSession(stored.id)
      try {
        expect(observation.revision).toBe(SessionPersistenceRevision('events:2'))
        expect(observation.events.map(event => event.seq)).toEqual([SessionSeq(0), SessionSeq(1)])
        expect(observation.events[1]).toMatchObject({ data: { content: [{ text: 'revision two' }] } })
      } finally {
        observation[Symbol.dispose]()
      }
      expect(TestPersistence.readCalls).toEqual([stored.id, stored.id])
      expect(statCalls).toBe(4)
    } finally {
      await runtime.close()
    }
  })

  const initialBinding = {}
  const replacementBinding = {}
  const finalBinding = {}
  it.each([
    {
      operation: 'observe',
      phase: 'after each initial stat',
      identities: [{}, {}, {}, {}],
      expectedStats: 2,
      expectedReads: 0,
      expectedLists: 0,
    },
    {
      operation: 'observe',
      phase: 'after each cold read',
      identities: [initialBinding, initialBinding, replacementBinding, replacementBinding, replacementBinding, finalBinding],
      expectedStats: 2,
      expectedReads: 2,
      expectedLists: 0,
    },
    {
      operation: 'observe',
      phase: 'after the post-read stat',
      identities: [initialBinding, initialBinding, initialBinding, replacementBinding, {}, finalBinding],
      expectedStats: 3,
      expectedReads: 1,
      expectedLists: 0,
    },
    {
      operation: 'list',
      phase: 'during both list attempts',
      identities: [{}, {}, {}, {}],
      expectedStats: 0,
      expectedReads: 0,
      expectedLists: 2,
    },
  ] as const)('rejects repeated persistence binding changes $phase', async ({ operation, identities, expectedStats, expectedReads, expectedLists }) => {
    const stored = header('native-observation-binding-churn', 7)
    TestPersistence.reset([{ meta: stored, events: eventLog('binding churn') }])
    let statCalls = 0
    let bindingCalls = 0
    TestPersistence.afterStat = () => { statCalls += 1 }
    const persistence = new TestPersistence(new Context())
    const base = createNativeSessionQuerySource(nativeOwners(), persistence)
    const store = base.persistenceBinding().store
    if (store === undefined) throw new Error('persistent binding fixture has no store')
    const source: NativeSessionQuerySource = {
      liveOwners: () => [],
      persistenceBinding: () => {
        const identity = identities[bindingCalls]
        if (identity === undefined) throw new Error('binding identity fixture was exhausted')
        bindingCalls += 1
        return { identity, store }
      },
    }
    const runtime = createNativeSessionQueryRuntime(source)

    try {
      const result = operation === 'list'
        ? runtime.operations.listSessions()
        : runtime.operations.observeSession(stored.id)
      await expect(result).rejects.toMatchObject({
        code: 'SESSION_QUERY_SOURCE_CONFLICT',
        message: 'session source changed repeatedly during observation',
      })
      expect(bindingCalls).toBe(identities.length)
      expect(statCalls).toBe(expectedStats)
      expect(TestPersistence.readCalls).toHaveLength(expectedReads)
      expect(TestPersistence.listCalls).toBe(expectedLists)
    } finally {
      await runtime.close()
    }
  })

  it('merges persisted and live records and returns unique isolated title observations', async () => {
    const durable = header('native-list-a', 20)
    const active = header('native-list-b', 20)
    const shared = header('native-list-c', 20)
    const sharedEvents: SessionEvent[] = [
      ...eventLog('shared live title'),
      {
        type: 'session/title', seq: SessionSeq(1), time: 20,
        data: { title: 'Shared live title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' } },
      },
    ]
    TestPersistence.reset([
      { meta: durable, events: eventLog('durable') },
      { meta: shared, events: eventLog('shared stale copy') },
    ])
    const query = await installNativeSessionQuery(
      nativeOwners(nativeOwner(active, eventLog('active')), nativeOwner(shared, sharedEvents)),
      new TestPersistence(new Context()),
    )
    await expect(query.listSessions()).resolves.toEqual([
      { header: durable, live: false, persisted: true },
      { header: active, live: true, persisted: false },
      { header: shared, live: true, persisted: true },
    ])
    const missing = SessionId('native-list-missing')
    const observations = await query.readTitleSnapshots([active.id, missing, shared.id, active.id])
    expect(observations).toHaveLength(3)
    expect(observations[0]).toMatchObject({ sessionId: active.id, status: 'fulfilled', value: { session: active } })
    expect(observations[1]).toMatchObject({ sessionId: missing, status: 'rejected', reason: { code: 'SESSION_QUERY_SESSION_NOT_FOUND' } })
    expect(observations[2]).toMatchObject({
      sessionId: shared.id, status: 'fulfilled', value: { title: { title: 'Shared live title' } },
    })

    const conflict = header(shared.id, shared.createdAt + 1)
    TestPersistence.reset([{ meta: shared, events: eventLog() }])
    const conflicting = await installNativeSessionQuery(nativeOwners(nativeOwner(conflict, eventLog())), new TestPersistence(new Context()))
    await expect(conflicting.listSessions()).rejects.toMatchObject({ code: 'SESSION_QUERY_SOURCE_CONFLICT' })
  })

  it('lists and reads detached persisted titles and current surface without attaching or mutating the log', async () => {
    const stored = header('native-cold-query', 4)
    const events = [
      { type: 'turn/start' as const, seq: SessionSeq(0), time: 9, data: { turn: 1 } },
      { ...eventLog('cold history')[0]!, seq: SessionSeq(1) },
      {
        type: 'session/title' as const,
        seq: SessionSeq(2),
        time: 20,
        data: {
          title: 'Cold title',
          messageSeqs: [SessionSeq(1)],
          source: { kind: 'fallback' as const },
        },
      },
    ]
    TestPersistence.reset([{ meta: stored, events }])
    const ctx = new Context()
    await ctx.plugin(TestPersistence)
    const active = { owners: () => [], owner: () => undefined } as unknown as NativeActiveSessionOperations
    const query = await installNativeSessionQuery(active, ctx.sessionPersistence)

    await expect(query.listSessions()).resolves.toEqual([{
      header: stored, live: false, persisted: true,
    }])
    await expect(query.readTitleSnapshot(stored.id)).resolves.toMatchObject({
      session: stored,
      title: { title: 'Cold title', eventSeq: SessionSeq(2) },
    })
    await expect(query.readSurface(stored.id)).resolves.toMatchObject({
      session: stored,
      capturedThroughSeq: SessionSeq(3),
      events: [{ seq: SessionSeq(1), data: { content: [{ text: 'cold history' }] } }],
    })
    const snapshot = await query.readSession(stored.id)
    expect(snapshot).toMatchObject({
      session: stored,
      events: [...events, { type: 'turn/end', seq: SessionSeq(3), data: { reason: { kind: 'interrupted' } } }],
    })
    expect(TestPersistence.entries.get(stored.id)?.events).toEqual(events)
    expect(ctx.get('sessions')).toBeUndefined()
  })

  it('validates cold fork history with the inherited prefix and leaves restore markers out of the read result', async () => {
    const stored = header('native-fork-query', 4, { parentSession: SessionId('native-query-parent'), isSeeded: true })
    const events: SessionEvent[] = [
      ...eventLog('inherited question'),
      { type: 'session/end-seed', seq: SessionSeq(1), time: 11, data: { inherited: true } },
      {
        type: 'session/title', seq: SessionSeq(2), time: 20,
        data: { title: 'Fork title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' } },
      },
    ]
    TestPersistence.reset([{ meta: stored, events, inheritedEventCount: SessionLogOffset(1) }])
    const ctx = new Context()
    await ctx.plugin(TestPersistence)
    const active = { owners: () => [], owner: () => undefined } as unknown as NativeActiveSessionOperations
    const query = await installNativeSessionQuery(active, ctx.sessionPersistence)

    await expect(query.readTitleSnapshot(stored.id)).resolves.toMatchObject({
      session: stored,
      title: { title: 'Fork title', eventSeq: SessionSeq(2) },
    })
    await expect(query.readSession(stored.id)).resolves.toEqual({
      session: stored, inheritedEventCount: SessionLogOffset(1), events,
    })
    expect(TestPersistence.entries.get(stored.id)?.events).toEqual(events)
  })

  it('prefers the exact active owner over a stale persisted copy for title and surface reads', async () => {
    const stored = header('native-live-query', 5)
    const staleEvents = [
      ...eventLog('stale durable copy'),
      {
        type: 'session/title' as const,
        seq: SessionSeq(1),
        time: 20,
        data: { title: 'Stale title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' as const } },
      },
    ]
    TestPersistence.reset([{ meta: stored, events: staleEvents }])
    const ctx = new Context()
    await ctx.plugin(TestPersistence)
    const activeEvents = [
      ...eventLog('live owner'),
      {
        type: 'session/title' as const,
        seq: SessionSeq(1),
        time: 30,
        data: { title: 'Live title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' as const } },
      },
    ]
    const session = activeSession(stored, activeEvents)
    let ownerIsCurrent = true
    let replaceDuringRead = false
    const readEvents = vi.fn(() => {
      if (replaceDuringRead) ownerIsCurrent = false
      return Promise.resolve(activeEvents)
    })
    const owner = {
      agent: {},
      session,
      inheritedEventCount: SessionLogOffset(0),
      writerAvailable: true,
      readEvents,
    } as unknown as NativeActiveSessionOwner
    const active = {
      owners: () => ownerIsCurrent ? [owner] : [],
      owner: () => {
        if (!ownerIsCurrent) throw new Error('native-active-session: Session is not the exact active instance')
        return owner
      },
    } as unknown as NativeActiveSessionOperations
    const query = await installNativeSessionQuery(active, ctx.sessionPersistence)

    await expect(query.listSessions()).resolves.toEqual([{
      header: stored, live: true, persisted: true,
    }])
    await expect(query.readTitleSnapshot(stored.id)).resolves.toMatchObject({
      session: stored,
      title: { title: 'Live title', eventSeq: SessionSeq(1) },
    })
    await expect(query.readSurface(stored.id)).resolves.toMatchObject({
      session: stored,
      events: [{ seq: SessionSeq(0), data: { content: [{ text: 'live owner' }] } }],
    })
    await expect(query.readSurface(stored.id)).resolves.toMatchObject({ session: stored })
    expect(readEvents).toHaveBeenLastCalledWith(expect.objectContaining({ maxEvents: SessionLogOffset(2) }))
    expect(readEvents).toHaveBeenCalledTimes(3)
    expect(TestPersistence.readCalls).toEqual([])

    replaceDuringRead = true
    await expect(query.readTitleSnapshot(stored.id)).resolves.toMatchObject({
      session: stored,
      title: { title: 'Stale title', eventSeq: SessionSeq(1) },
    })
    expect(readEvents).toHaveBeenCalledTimes(4)
    expect(TestPersistence.readCalls).toEqual([stored.id])

    const empty = header('native-empty-live-query', 6)
    const emptyQuery = await installNativeSessionQuery(nativeOwners(nativeOwner(empty, [])), undefined)
    await expect(emptyQuery.readSurface(empty.id)).resolves.toMatchObject({
      session: empty, capturedThroughSeq: null, events: [],
    })
  })

  it('maps durable read failures, missing sessions, cancellation, and corrupt raw histories', async () => {
    const stored = header('native-failure-query', 4)
    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    const persistence = new TestPersistence(new Context())
    const query = await installNativeSessionQuery(nativeOwners(), persistence)

    TestPersistence.listFailure = new Error('index unavailable')
    await expect(query.listSessions()).rejects.toMatchObject({ code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
    TestPersistence.listFailure = undefined
    TestPersistence.readFailure = new Error('reader unavailable')
    await expect(query.readSession(stored.id)).rejects.toMatchObject({ code: 'SESSION_QUERY_PERSISTENCE_FAILED' })

    const typedSourceFailure = new SessionQueryError('source changed', 'SESSION_QUERY_SOURCE_CONFLICT')
    TestPersistence.readFailure = typedSourceFailure
    await expect(query.readSession(stored.id)).rejects.toBe(typedSourceFailure)

    TestPersistence.readFailure = undefined
    const statFailure = new Error('stat unavailable')
    TestPersistence.afterStat = () => {
      TestPersistence.afterStat = undefined
      throw statFailure
    }
    await expect(query.readSession(stored.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_PERSISTENCE_FAILED', cause: statFailure,
    })

    TestPersistence.readFailure = undefined
    const reason = new Error('listing cancelled')
    const loadController = new AbortController()
    TestPersistence.readOverride = () => {
      loadController.abort(reason)
      return Promise.reject(new Error('aborted query read'))
    }
    await expect(query.readSession(stored.id, loadController.signal)).rejects.toBe(reason)

    const controller = new AbortController()
    TestPersistence.listOverride = () => {
      controller.abort(reason)
      return Promise.reject(new Error('aborted storage read'))
    }
    await expect(query.listSessions(controller.signal)).rejects.toBe(reason)

    const titleController = new AbortController()
    TestPersistence.readOverride = () => {
      titleController.abort(reason)
      return Promise.reject(new Error('aborted title read'))
    }
    await expect(query.readTitleSnapshots([stored.id], titleController.signal)).rejects.toBe(reason)

    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    const readController = new AbortController()
    TestPersistence.readOverride = () => {
      readController.abort(reason)
      return Promise.reject(new Error('aborted query read'))
    }
    await expect(query.readSession(stored.id, readController.signal)).rejects.toBe(reason)

    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    TestPersistence.readFailure = new SessionPersistenceCorruptionError('corrupt raw log', { cause: new Error('invalid record') })
    await expect(query.readSession(stored.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_CORRUPT_SESSION', message: `stored session "${stored.id}" is corrupt: corrupt raw log`,
    })

    TestPersistence.reset([{ meta: stored, events: [{ ...eventLog()[0]!, seq: SessionSeq(4) }] }])
    await expect(query.readSession(stored.id)).rejects.toMatchObject({ code: 'SESSION_QUERY_CORRUPT_SESSION' })

    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    TestPersistence.readEffect = () => {
      const entry = TestPersistence.entries.get(stored.id)
      if (entry === undefined) throw new Error('persisted header fixture disappeared')
      entry.meta = { ...entry.meta, cwd: '/changed-during-read' }
    }
    await expect(query.readSession(stored.id)).rejects.toMatchObject({ code: 'SESSION_QUERY_SOURCE_CONFLICT' })

    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    const defaultWindow = await query.readEvent({ sessionId: stored.id, seq: SessionSeq(0) })
    expect(defaultWindow).toMatchObject({ startSeq: SessionSeq(0), endSeq: SessionSeq(0), target: { seq: SessionSeq(0) } })
    await expect(query.readEvent({ sessionId: stored.id, seq: SessionSeq(1) })).rejects.toMatchObject({
      code: 'SESSION_QUERY_EVENT_NOT_FOUND',
    })
    for (const request of [
      { sessionId: stored.id, seq: SessionSeq(0), before: -1 },
      { sessionId: stored.id, seq: SessionSeq(0), after: SESSION_QUERY_READ_WINDOW_MAX + 1 },
    ]) {
      await expect(query.readEvent(request)).rejects.toMatchObject({ code: 'SESSION_QUERY_INVALID_WINDOW' })
    }

    const missingAfterStat = header('native-missing-after-stat', 4)
    TestPersistence.reset([{ meta: missingAfterStat, events: eventLog() }])
    TestPersistence.afterStat = () => {
      TestPersistence.afterStat = undefined
      TestPersistence.entries.delete(missingAfterStat.id)
    }
    const missingReadFailure = await query.readSession(missingAfterStat.id).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(missingReadFailure).toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    if (!(missingReadFailure instanceof Error)) throw new Error('Expected a query error')
    expect(missingReadFailure.cause).toBeInstanceOf(SessionPersistenceNotFoundError)

    TestPersistence.reset()
    const noPersistence = await installNativeSessionQuery(nativeOwners(), undefined)
    await expect(noPersistence.listSessions()).resolves.toEqual([])
    await expect(noPersistence.readSurface(SessionId('native-no-persistence'))).rejects.toMatchObject({
      code: 'SESSION_QUERY_SESSION_NOT_FOUND',
    })

    const activeReadFailure = new Error('active owner read failed')
    const failingOwner = nativeOwner(stored, eventLog(), () => rejectUnknown(activeReadFailure))
    const failingQuery = await installNativeSessionQuery(nativeOwners(failingOwner), undefined)
    await expect(failingQuery.readSurface(stored.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_PERSISTENCE_FAILED', cause: activeReadFailure,
    })

    const activeCancelController = new AbortController()
    const activeCancelReason = new Error('active owner read cancelled')
    const cancellingOwner = nativeOwner(stored, eventLog(), () => {
      activeCancelController.abort(activeCancelReason)
      return rejectUnknown(new Error('active owner storage read stopped'))
    })
    const cancellingQuery = await installNativeSessionQuery(nativeOwners(cancellingOwner), undefined)
    await expect(cancellingQuery.readTitleSnapshot(stored.id, activeCancelController.signal)).rejects.toBe(activeCancelReason)
  })

  it('keeps a captured live cut fixed and joins an admitted read on close', async () => {
    const meta = header('native-captured-cut', 7)
    const session = NativeSession.create(meta.id, undefined, meta)
    const durableEvents = [session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })]
    let readGate = Promise.withResolvers<undefined>()
    let started = Promise.withResolvers<number>()
    const owner = {
      agent: {},
      session,
      inheritedEventCount: SessionLogOffset(0),
      writerAvailable: true,
      async readEvents(options?: { maxEvents?: number }) {
        const maxEvents = options?.maxEvents ?? SessionLogOffset(0)
        started.resolve(maxEvents)
        await readGate.promise
        return structuredClone(durableEvents.slice(0, maxEvents))
      },
    } as unknown as NativeActiveSessionOwner
    const stat = vi.fn(async (_id: SessionIdType, _options?: { signal?: AbortSignal }) => undefined)
    const list = vi.fn(async (_options?: { signal?: AbortSignal }) => [])
    const nativePersistence = { stat, list } as unknown as NativeSessionPersistenceOperations
    const persistenceStore = createNativeSessionQuerySource(
      { owners: () => [] } as unknown as NativeActiveSessionOperations,
      nativePersistence,
    ).persistenceBinding().store
    if (persistenceStore === undefined) throw new Error('Native persistence adapter omitted its store')
    await persistenceStore.stat(meta.id)
    await persistenceStore.list()
    const sourceSignal = new AbortController().signal
    await persistenceStore.stat(meta.id, sourceSignal)
    await persistenceStore.list(sourceSignal)
    expect(stat).toHaveBeenNthCalledWith(1, meta.id, undefined)
    expect(stat).toHaveBeenNthCalledWith(2, meta.id, { signal: sourceSignal })
    expect(list).toHaveBeenNthCalledWith(1, undefined)
    expect(list).toHaveBeenNthCalledWith(2, { signal: sourceSignal })

    const source = createNativeSessionQuerySource({ owners: () => [owner] } as unknown as NativeActiveSessionOperations)
    const capturedOwner = source.liveOwners()[0]
    if (capturedOwner === undefined) throw new Error('captured Native owner is missing')
    expect(() => capturedOwner.readEvents(SessionLogOffset(2))).toThrow(RangeError)
    const runtime = createNativeSessionQueryRuntime(source)

    const firstRead = runtime.operations.readSurface(meta.id)
    await expect(started.promise).resolves.toBe(SessionLogOffset(1))
    durableEvents.push(session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'later' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }))
    readGate.resolve(undefined)
    await expect(firstRead).resolves.toMatchObject({
      capturedThroughSeq: SessionSeq(0),
      events: [{ seq: SessionSeq(0), data: { content: [{ text: 'first' }] } }],
    })
    const liveLease = await runtime.operations.observeSession(meta.id)
    const retainedLive = liveLease.retain()
    liveLease[Symbol.dispose]()
    expect(retainedLive.events).toBe(liveLease.events)
    expect(retainedLive.events).toHaveLength(2)
    retainedLive[Symbol.dispose]()

    readGate = Promise.withResolvers<undefined>()
    started = Promise.withResolvers<number>()
    const pendingRead = runtime.operations.readSurface(meta.id).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    await started.promise
    let closed = false
    const closing = runtime.close().then(() => { closed = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    readGate.resolve(undefined)
    await expect(pendingRead).resolves.toMatchObject({ code: 'SESSION_QUERY_PROVIDER_CLOSED' })
    await closing
    expect(closed).toBe(true)
    await expect(runtime.operations.observeSession(meta.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_PROVIDER_CLOSED',
    })
    await runtime.close()
  })

  it('prefers an owner attached during point metadata reads and a replacement after live reads settle', async () => {
    const stored = header('native-owner-race', 4)
    const events = eventLog('durable owner race')
    TestPersistence.reset()
    let current: NativeActiveSessionOwner[] = []
    const persistence = new TestPersistence(new Context())
    TestPersistence.afterStat = () => { current = [nativeOwner(stored, events)] }
    const query = await installNativeSessionQuery({ owners: () => current } as unknown as NativeActiveSessionOperations, persistence)
    await expect(query.readSurface(stored.id)).resolves.toMatchObject({
      session: stored, capturedThroughSeq: SessionSeq(0), events: [{ seq: SessionSeq(0) }],
    })
    expect(TestPersistence.readCalls).toEqual([])

    TestPersistence.reset()
    current = []
    const detachDuringListingRead = vi.fn(() => {
      current = []
      return rejectUnknown<SessionEvent[]>(new Error('new owner detached during listing'))
    })
    const detachedDuringListing = nativeOwner(stored, events, detachDuringListingRead)
    TestPersistence.afterStat = () => {
      TestPersistence.afterStat = undefined
      current = [detachedDuringListing]
    }
    const detachedQuery = await installNativeSessionQuery(
      { owners: () => current } as unknown as NativeActiveSessionOperations,
      persistence,
    )
    await expect(detachedQuery.readSurface(stored.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_SESSION_NOT_FOUND',
    })
    expect(detachDuringListingRead).toHaveBeenCalledOnce()

    TestPersistence.reset()
    const original = nativeOwner(stored, events, () => {
      current = [nativeOwner(stored, [
        ...eventLog('replacement owner'),
        {
          type: 'session/title', seq: SessionSeq(1), time: 20,
          data: { title: 'Replacement title', messageSeqs: [SessionSeq(0)], source: { kind: 'fallback' } },
        },
      ])]
      return Promise.reject(new Error('original owner was replaced'))
    })
    current = [original]
    const replacementQuery = await installNativeSessionQuery(
      { owners: () => current } as unknown as NativeActiveSessionOperations,
      undefined,
    )
    await expect(replacementQuery.readTitleSnapshot(stored.id)).resolves.toMatchObject({
      session: stored, title: { title: 'Replacement title' },
    })

    const disappearing = nativeOwner(stored, events, () => {
      current = []
      return rejectUnknown(new Error('replacement owner disappeared'))
    })
    current = [disappearing]
    const missingQuery = await installNativeSessionQuery({ owners: () => current } as unknown as NativeActiveSessionOperations, undefined)
    await expect(missingQuery.readSurface(stored.id)).rejects.toMatchObject({
      code: 'SESSION_QUERY_SESSION_NOT_FOUND',
    })

    TestPersistence.reset([{ meta: stored, events }])
    current = []
    const detachAfterColdRead = vi.fn(() => {
      current = []
      return rejectUnknown<SessionEvent[]>(new Error('owner detached before its read'))
    })
    const afterColdRead = nativeOwner(stored, events, detachAfterColdRead)
    TestPersistence.readEffect = () => { current = [afterColdRead] }
    const coldFallback = await installNativeSessionQuery({ owners: () => current } as unknown as NativeActiveSessionOperations, persistence)
    await expect(coldFallback.readSurface(stored.id)).resolves.toMatchObject({
      session: stored, capturedThroughSeq: SessionSeq(0), events: [{ seq: SessionSeq(0) }],
    })
    expect(detachAfterColdRead).toHaveBeenCalledOnce()
    expect(TestPersistence.readCalls).toEqual([stored.id, stored.id])

    TestPersistence.reset([{ meta: stored, events }])
    current = []
    const attachedEvents = eventLog('owner attached after cold read')
    const attachedAfterColdRead = nativeOwner(stored, attachedEvents)
    TestPersistence.readEffect = () => { current = [attachedAfterColdRead] }
    const preferredAfterColdRead = await installNativeSessionQuery(
      { owners: () => current } as unknown as NativeActiveSessionOperations,
      persistence,
    )
    await expect(preferredAfterColdRead.readSurface(stored.id)).resolves.toMatchObject({
      session: stored, capturedThroughSeq: SessionSeq(0), events: [{ seq: SessionSeq(0), data: { content: [{ text: 'owner attached after cold read' }] } }],
    })
    expect(TestPersistence.readCalls).toEqual([stored.id])
  })

  it('validates Native provider configuration and isolates persistent open/read failures', async () => {
    for (const input of [null, [], 'bad', { unknown: true }]) {
      expect(() => nativeSessionQueryPlugin.resolve(input)).toThrow(expectCode('SESSION_QUERY_INVALID_CONFIG'))
    }
    expect(() => nativeSessionQueryPlugin.resolve({})).not.toThrow()

    const stored = header('native-open-failure', 4)
    TestPersistence.reset([{ meta: stored, events: eventLog() }])
    const query = await installNativeSessionQuery(nativeOwners(), new TestPersistence(new Context()))
    TestPersistence.readFailure = new Error('reader unavailable')
    await expect(query.readSession(stored.id)).rejects.toMatchObject({ code: 'SESSION_QUERY_PERSISTENCE_FAILED' })

    TestPersistence.readFailure = new SessionPersistenceNotFoundError(stored.id)
    await expect(query.readTitleSnapshot(stored.id)).rejects.toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })

    for (const reason of ['raw reader failure', null]) {
      TestPersistence.readFailure = reason
      await expect(query.readSession(stored.id)).rejects.toMatchObject({
        code: 'SESSION_QUERY_PERSISTENCE_FAILED',
        message: `session persistence failed while reading session "${stored.id}": ${String(reason)}`,
        cause: reason,
      })
    }
  })
})
