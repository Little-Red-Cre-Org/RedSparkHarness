/** Native checkpoint writes use the same Session owner and drain before the domain closes. */

import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeSessionProjectionRegistry, plugin as projectionPlugin } from '@deepseek-ai/dsh-session-projection/native'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/native'
import { plugin as cachePlugin } from '../src/native.ts'
import type { CheckpointRecord } from '../src/spec.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'test/native-cache': number
    'test/native-cache-non-json': number
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'test/cache-event': { index: number } }
}

const projection: ProjectionDefinition<'test/native-cache', number> = {
  key: 'test/native-cache',
  stateSchema: z.number().int(),
  init: () => 0,
  apply: state => state + 1,
  stateVersion: 1,
}

const nonJsonProjection: ProjectionDefinition<'test/native-cache-non-json', number> = {
  key: 'test/native-cache-non-json',
  stateSchema: z.custom<number>(Number.isNaN),
  init: () => Number.NaN,
  apply: state => state,
  stateVersion: 1,
}

function service<K extends keyof NativeServices>(key: K, value: NativeServices[K]): NativePlugin {
  return {
    apiVersion: 1,
    name: `native-cache-test-${key}`,
    targets: ['host'],
    requires: [],
    provides: [key],
    resolve: () => (context) => { context.provide(key, value) },
  }
}

it('checkpoints committed live folds and joins the final writer flush before closing its domain', async () => {
  const session = Session.create(SessionId('native-cache-session'))
  const eventListeners = new Set<(event: SessionEvent) => void>()
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush: vi.fn(async () => {}),
    onEvent(listener: (event: SessionEvent) => void) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
  }
  const active = {
    owners: () => [owner],
    onAttached: () => async () => {},
    onDetached: () => async () => {},
  } as unknown as NativeServices['activeSessions']
  const rows = new Map<string, CheckpointRecord>()
  const events: string[] = []
  let domainClosed = false
  const domain = {
    table: () => ({
      get: (id: string) => rows.get(id),
      async put(id: string, record: CheckpointRecord) {
        events.push(`put:${owner.flush.mock.calls.length}`)
        rows.set(id, structuredClone(record))
      },
    }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  let cache: NativeServices['sessionProjectionCache'] | undefined
  const cacheConsumer: NativePlugin = {
    apiVersion: 1,
    name: 'native-cache-test-consumer',
    targets: ['host'],
    requires: ['sessionProjectionCache'],
    provides: [],
    resolve: () => (context) => { cache = context.require('sessionProjectionCache') },
  }
  const registerProjection: NativePlugin = {
    apiVersion: 1,
    name: 'native-cache-test-fold',
    targets: ['host'],
    requires: ['sessionProjections'],
    provides: [],
    resolve: () => (context) => { context.require('sessionProjections').register(projection) },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: projectionPlugin, scope, config: undefined },
    { plugin: registerProjection, scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 3, writeIntervalMs: 60_000 } },
    { plugin: cacheConsumer, scope, config: undefined },
  ], 'host'))
  const release: PromiseWithResolvers<void> = Promise.withResolvers()
  await host.start()
  try {
    if (cache === undefined) throw new Error('Native projection cache did not activate')
    const initial = cache.cachedCheckpoint(session.header, SessionLogOffset(0))
    expect(initial?.['test/native-cache']).toEqual({ ver: 1, seq: -1, val: 0 })
    expect(cache.cachedCheckpoint({ ...session.header, createdAt: session.header.createdAt + 1 }, SessionLogOffset(0))).toBeUndefined()

    const started = session.append('turn/start', { turn: 1 })
    for (const listener of eventListeners) listener(started)
    const ended = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    for (const listener of eventListeners) listener(ended)
    await vi.waitFor(() => { expect(cache?.cachedCheckpoint(session.header, SessionLogOffset(0))?.['test/native-cache'])
      .toEqual({ ver: 1, seq: 1, val: 2 }) })
    expect(events).toContain('put:2')

    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    owner.flush.mockImplementation(async () => { entered.resolve(); await release.promise })
    const stopping = host.stop()
    await entered.promise
    expect(domainClosed).toBe(false)
    release.resolve()
    await stopping
    expect(domainClosed).toBe(true)
    expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: 1, val: 2 })
  } finally {
    release.resolve()
    await host.stop()
  }
})

it('attaches late owners, keeps failed writes stale, persists detach, and closes the domain', async () => {
  const session = Session.create(SessionId('native-cache-late-owner'))
  const removeFailure = new Error('owner listener removal failed')
  let failRemoval = true
  const eventListeners = new Set<(event: SessionEvent) => void>()
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush: vi.fn(async () => {}),
    onEvent(listener: (event: SessionEvent) => void) {
      eventListeners.add(listener)
      return () => {
        if (failRemoval) {
          failRemoval = false
          throw removeFailure
        }
        eventListeners.delete(listener)
      }
    },
  } as unknown as NativeActiveSessionOwner
  const owners: NativeActiveSessionOwner[] = []
  const attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const active = {
    owners: () => owners,
    onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      attached.add(observer)
      return async () => { attached.delete(observer) }
    },
    onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      detached.add(observer)
      return async () => { detached.delete(observer) }
    },
  } as unknown as NativeServices['activeSessions']
  const rows = new Map<string, CheckpointRecord>()
  const put = vi.fn(async (id: string, record: CheckpointRecord) => {
    rows.set(id, structuredClone(record))
  })
  let domainClosed = false
  const domain = {
    table: () => ({ get: (id: string) => rows.get(id), put }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const projectionRegistry = new NativeSessionProjectionRegistry()
  projectionRegistry.register(projection)
  let cache: NativeServices['sessionProjectionCache'] | undefined
  const cacheConsumer: NativePlugin = {
    apiVersion: 1,
    name: 'native-cache-late-owner-consumer',
    targets: ['host'],
    requires: ['sessionProjectionCache'],
    provides: [],
    resolve: () => (context) => { cache = context.require('sessionProjectionCache') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('sessionProjections', projectionRegistry), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 1, writeIntervalMs: 60_000 } },
    { plugin: cacheConsumer, scope, config: undefined },
  ], 'host'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await host.start()
    owners.push(owner)
    await Promise.all([...attached].map(observer => observer(owner)))
    expect(cache?.cachedCheckpoint(session.header, SessionLogOffset(0))?.['test/native-cache'])
      .toEqual({ ver: 1, seq: -1, val: 0 })

    put.mockImplementationOnce(async () => { throw new Error('storage unavailable') })
    const started = session.append('turn/start', { turn: 1 })
    for (const listener of eventListeners) listener(started)
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledOnce() })
    expect(cache?.cachedCheckpoint(session.header, SessionLogOffset(0))?.['test/native-cache'])
      .toEqual({ ver: 1, seq: -1, val: 0 })

    const ended = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    for (const listener of eventListeners) listener(ended)
    await vi.waitFor(() => { expect(cache?.cachedCheckpoint(session.header, SessionLogOffset(0))?.['test/native-cache'])
      .toEqual({ ver: 1, seq: 1, val: 2 }) })

    owners.splice(0, 1)
    const writesBeforeDetach = put.mock.calls.length
    await expect(Promise.all([...detached].map(observer => observer(owner)))).rejects.toBe(removeFailure)
    expect(eventListeners.size).toBe(1)
    expect(put).toHaveBeenCalledTimes(writesBeforeDetach + 1)
    expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: 1, val: 2 })

    owners.push(owner)
    const writesBeforeReattach = put.mock.calls.length
    await Promise.all([...attached].map(observer => observer(owner)))
    expect(eventListeners.size).toBe(2)
    expect(put).toHaveBeenCalledTimes(writesBeforeReattach + 1)
  } finally {
    warning.mockRestore()
    await host.stop()
  }
  expect(domainClosed).toBe(true)
  expect(eventListeners.size).toBe(1)
})

it('requeues count writes, rearms after a mandatory checkpoint, and drains a pending interval on close', async () => {
  const intervalMs = 1_000
  const session = Session.create(SessionId('native-cache-interval'))
  const eventListeners = new Set<(event: SessionEvent) => void>()
  let cacheEventListener: ((event: SessionEvent) => void) | undefined
  const flush = vi.fn(async () => {})
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush,
    onEvent(listener: (event: SessionEvent) => void) {
      cacheEventListener = listener
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
  } as unknown as NativeActiveSessionOwner
  const attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const owners: NativeActiveSessionOwner[] = []
  let attachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
  let detachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
  const active = {
    owners: () => owners,
    onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      attachedObserver = observer
      attached.add(observer)
      return async () => { attached.delete(observer) }
    },
    onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      detachedObserver = observer
      detached.add(observer)
      return async () => { detached.delete(observer) }
    },
  } as unknown as NativeServices['activeSessions']
  const rows = new Map<string, CheckpointRecord>()
  const put = vi.fn(async (id: string, record: CheckpointRecord) => {
    rows.set(id, structuredClone(record))
  })
  let domainClosed = false
  const domain = {
    table: () => ({ get: (id: string) => rows.get(id), put }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const projectionRegistry = new NativeSessionProjectionRegistry()
  projectionRegistry.register(projection)
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('sessionProjections', projectionRegistry), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 3, writeIntervalMs: intervalMs } },
  ], 'host'))
  let stopped = false
  let releaseFirstWrite: (() => void) | undefined
  let releaseRequeue: (() => void) | undefined
  let releaseMandatory: (() => void) | undefined
  const warningSeen: PromiseWithResolvers<void> = Promise.withResolvers()
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => { warningSeen.resolve() })
  vi.useFakeTimers()
  try {
    await host.start()
    owners.push(owner)
    if (attachedObserver === undefined) throw new Error('Native projection cache did not register its attach observer')
    await attachedObserver(owner)
    await attachedObserver(owner)
    expect(eventListeners.size).toBe(1)
    const timersBeforeOwner = vi.getTimerCount()
    put.mockClear()
    flush.mockClear()
    const emit = (event: SessionEvent): void => {
      if (cacheEventListener === undefined) throw new Error('Native projection cache did not attach the owner')
      cacheEventListener(event)
    }
    const emitCacheEvent = (index: number): void => { emit(session.append('test/cache-event', { index })) }

    const firstWriteEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    const firstWriteGate: PromiseWithResolvers<void> = Promise.withResolvers()
    releaseFirstWrite = firstWriteGate.resolve
    const requeueEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    const requeueGate: PromiseWithResolvers<void> = Promise.withResolvers()
    releaseRequeue = requeueGate.resolve
    flush.mockImplementationOnce(async () => {
      firstWriteEntered.resolve()
      await firstWriteGate.promise
    })
    flush.mockImplementationOnce(async () => {
      requeueEntered.resolve()
      await requeueGate.promise
    })
    emitCacheEvent(0)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner + 1)
    await vi.advanceTimersByTimeAsync(intervalMs)
    await firstWriteEntered.promise
    emitCacheEvent(1)
    emitCacheEvent(2)
    emitCacheEvent(3)
    releaseFirstWrite()
    await requeueEntered.promise
    expect(flush).toHaveBeenCalledTimes(2)
    owners.splice(0, 1)
    if (detachedObserver === undefined) throw new Error('Native projection cache did not register its detach observer')
    const detaching = detachedObserver(owner)
    releaseRequeue()
    await detaching
    expect(flush).toHaveBeenCalledTimes(3)
    expect(put).toHaveBeenCalledTimes(3)
    expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: 3, val: 4 })
    expect(eventListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner)

    owners.push(owner)
    await attachedObserver(owner)
    expect(eventListeners.size).toBe(1)
    put.mockClear()
    flush.mockClear()

    const mandatoryFailure = new Error('mandatory checkpoint flush failed')
    const failedMandatoryEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    flush.mockImplementationOnce(async () => {
      failedMandatoryEntered.resolve()
      throw mandatoryFailure
    })
    emit(session.append('turn/start', { turn: 1 }))
    emit(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    await failedMandatoryEntered.promise
    await warningSeen.promise
    await vi.waitFor(() => { expect(vi.getTimerCount()).toBe(timersBeforeOwner + 1) })

    const recoveryEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    flush.mockImplementationOnce(async () => { recoveryEntered.resolve() })
    await vi.advanceTimersByTimeAsync(intervalMs)
    await recoveryEntered.promise
    owners.splice(0, 1)
    const recoveryDrain = detachedObserver(owner)
    await recoveryDrain
    expect(flush).toHaveBeenCalledTimes(3)
    expect(put).toHaveBeenCalledTimes(2)
    expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: 5, val: 6 })
    expect(vi.getTimerCount()).toBe(timersBeforeOwner)
    expect(eventListeners.size).toBe(0)

    owners.push(owner)
    await attachedObserver(owner)
    put.mockClear()
    flush.mockClear()

    const warningsBeforeMandatorySuccess = warning.mock.calls.length
    const mandatoryEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    const mandatoryGate: PromiseWithResolvers<void> = Promise.withResolvers()
    releaseMandatory = mandatoryGate.resolve
    const thresholdRequeueEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    const thresholdRequeueGate: PromiseWithResolvers<void> = Promise.withResolvers()
    releaseRequeue = thresholdRequeueGate.resolve
    flush.mockImplementationOnce(async () => {
      mandatoryEntered.resolve()
      await mandatoryGate.promise
    })
    flush.mockImplementationOnce(async () => {
      thresholdRequeueEntered.resolve()
      await thresholdRequeueGate.promise
    })
    emit(session.append('turn/start', { turn: 2 }))
    emit(session.append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
    await mandatoryEntered.promise
    emitCacheEvent(4)
    emitCacheEvent(5)
    emitCacheEvent(6)
    releaseMandatory()
    await thresholdRequeueEntered.promise
    expect(flush).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledTimes(1)
    releaseRequeue()
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(2) })
    expect(warning).toHaveBeenCalledTimes(warningsBeforeMandatorySuccess)

    emitCacheEvent(7)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner + 1)
    emitCacheEvent(8)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner + 1)
    const intervalWriteEntered: PromiseWithResolvers<void> = Promise.withResolvers()
    flush.mockImplementationOnce(async () => { intervalWriteEntered.resolve() })
    await vi.advanceTimersByTimeAsync(intervalMs)
    await intervalWriteEntered.promise
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(3) })
    expect(vi.getTimerCount()).toBe(timersBeforeOwner)

    emitCacheEvent(4)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner + 1)
    const writesBeforeClose = put.mock.calls.length
    await host.stop()
    stopped = true
    expect(domainClosed).toBe(true)
    expect(eventListeners.size).toBe(0)
    expect(attached.size).toBe(0)
    expect(detached.size).toBe(0)
    expect(vi.getTimerCount()).toBe(timersBeforeOwner)
    expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: 13, val: 14 })

    const writesAfterClose = put.mock.calls.length
    if (attachedObserver === undefined || cacheEventListener === undefined) {
      throw new Error('Native projection cache did not retain its accepted callbacks')
    }
    await attachedObserver(owner)
    cacheEventListener(session.append('test/cache-event', { index: 5 }))
    expect(eventListeners.size).toBe(0)
    expect(put).toHaveBeenCalledTimes(writesAfterClose)
    await vi.advanceTimersByTimeAsync(intervalMs)
    expect(put).toHaveBeenCalledTimes(writesBeforeClose + 1)
  } finally {
    releaseFirstWrite?.()
    releaseRequeue?.()
    releaseMandatory?.()
    try {
      if (!stopped) await host.stop()
    } finally {
      warning.mockRestore()
      vi.useRealTimers()
    }
  }
})

it('reports observer and owner cleanup failures after draining the final write and closing the domain', async () => {
  const attachedFailure = new Error('attached observer removal failed')
  const detachedFailure = new Error('detached observer removal failed')
  const ownerFailure = new Error('owner event listener removal failed')
  const domainFailure = new Error('projection cache domain close failed')
  const session = Session.create(SessionId('native-cache-cleanup-owner'))
  let eventListener: ((event: SessionEvent) => void) | undefined
  const flush = vi.fn(async () => {})
  const removeEvents = vi.fn(() => { throw ownerFailure })
  const onEvent = vi.fn((listener: (event: SessionEvent) => void) => {
    eventListener = listener
    return removeEvents
  })
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush,
    onEvent,
  } as unknown as NativeActiveSessionOwner
  const attachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const detachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  let attachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
  let detachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
  const attachedRemovalEntered: PromiseWithResolvers<void> = Promise.withResolvers()
  const attachedRemovalGate: PromiseWithResolvers<void> = Promise.withResolvers()
  const removeAttached = vi.fn(async (): Promise<void> => {
    attachedRemovalEntered.resolve()
    await attachedRemovalGate.promise
    if (attachedObserver !== undefined) attachedObservers.delete(attachedObserver)
    throw attachedFailure
  })
  const removeDetached = vi.fn(async () => {
    if (detachedObserver !== undefined) detachedObservers.delete(detachedObserver)
    throw detachedFailure
  })
  const closeDomain = vi.fn((): Promise<void> => { throw domainFailure })
  const active = {
    owners: () => [owner],
    onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      attachedObserver = observer
      attachedObservers.add(observer)
      return removeAttached
    },
    onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      detachedObserver = observer
      detachedObservers.add(observer)
      return removeDetached
    },
  } as unknown as NativeServices['activeSessions']
  const domain = {
    table: () => ({ get: () => undefined, put }),
    close: closeDomain,
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const scope = new NativeScope()
  const put = vi.fn(async () => {})
  let cache: NativeServices['sessionProjectionCache'] | undefined
  const cacheConsumer: NativePlugin = {
    apiVersion: 1,
    name: 'native-cache-cleanup-consumer',
    targets: ['host'],
    requires: ['sessionProjectionCache'],
    provides: [],
    resolve: () => (context) => { cache = context.require('sessionProjectionCache') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: service('sessionProjections', new NativeSessionProjectionRegistry()), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 2, writeIntervalMs: 1_000 } },
    { plugin: cacheConsumer, scope, config: undefined },
  ], 'host'))
  let hostStopFailure: unknown
  let stopping: Promise<void> | undefined
  vi.useFakeTimers()
  try {
    await host.start()
    stopping = host.stop()
    expect(host.stop()).toBe(stopping)
    await attachedRemovalEntered.promise
    if (eventListener === undefined) throw new Error('Native projection cache did not retain its owner callback')
    const timersBeforeClosingEvent = vi.getTimerCount()
    eventListener(session.append('test/cache-event', { index: 0 }))
    expect(vi.getTimerCount()).toBe(timersBeforeClosingEvent)
    expect(flush).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
    attachedRemovalGate.resolve()
    hostStopFailure = await stopping.then(() => undefined, (failure: unknown) => failure)
  } finally {
    attachedRemovalGate.resolve()
    if (stopping === undefined) await host.stop().catch(() => {})
    else await stopping.catch(() => {})
    vi.useRealTimers()
  }
  expect(hostStopFailure).toBeInstanceOf(AggregateError)
  if (!(hostStopFailure instanceof AggregateError)) throw new Error('missing Native Host cleanup aggregate')
  expect(hostStopFailure.errors).toHaveLength(1)
  const resourceFailure: unknown = hostStopFailure.errors[0]
  expect(resourceFailure).toBeInstanceOf(AggregateError)
  if (!(resourceFailure instanceof AggregateError)) throw new Error('missing Native resource-owner aggregate')
  expect(resourceFailure.errors).toHaveLength(1)
  const cacheFailure: unknown = resourceFailure.errors[0]
  expect.soft(cacheFailure).toBeInstanceOf(AggregateError)
  expect.soft(removeAttached).toHaveBeenCalledOnce()
  expect.soft(removeDetached).toHaveBeenCalledOnce()
  expect.soft(onEvent).toHaveBeenCalledOnce()
  expect.soft(removeEvents).toHaveBeenCalledOnce()
  expect.soft(flush).toHaveBeenCalledTimes(2)
  expect.soft(put).toHaveBeenCalledTimes(2)
  expect.soft(closeDomain).toHaveBeenCalledOnce()
  expect.soft(attachedObservers.size).toBe(0)
  expect.soft(detachedObservers.size).toBe(0)
  expect.soft(cache?.cachedCheckpoint(session.header, SessionLogOffset(0))).toBeUndefined()
  if (cacheFailure instanceof AggregateError) {
    expect.soft(cacheFailure.errors).toEqual([attachedFailure, detachedFailure, ownerFailure, domainFailure])
  }
  if (attachedObserver === undefined || eventListener === undefined) {
    throw new Error('Native projection cache did not retain its accepted owner callbacks')
  }
  await attachedObserver(owner)
  eventListener(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(onEvent).toHaveBeenCalledOnce()
  expect(put).toHaveBeenCalledTimes(2)
})

it('rolls back a partially acquired owner when public event registration throws', async () => {
  const registrationFailure = new Error('owner event registration failed')
  const session = Session.create(SessionId('native-cache-registration-failure'))
  const flush = vi.fn(async () => {})
  const onEvent = vi.fn((_listener: (event: SessionEvent) => void) => { throw registrationFailure })
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush,
    onEvent,
  } as unknown as NativeActiveSessionOwner
  const attachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const detachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const active = {
    owners: () => [owner],
    onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      attachedObservers.add(observer)
      return async () => { attachedObservers.delete(observer) }
    },
    onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      detachedObservers.add(observer)
      return async () => { detachedObservers.delete(observer) }
    },
  } as unknown as NativeServices['activeSessions']
  const projectionRegistry = new NativeSessionProjectionRegistry()
  projectionRegistry.register(projection)
  const rows = new Map<string, CheckpointRecord>()
  const put = vi.fn(async (id: string, record: CheckpointRecord) => { rows.set(id, structuredClone(record)) })
  let domainClosed = false
  const domain = {
    table: () => ({ get: (id: string) => rows.get(id), put }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('sessionProjections', projectionRegistry), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 3, writeIntervalMs: 60_000 } },
  ], 'host'))

  try {
    await expect(host.start()).rejects.toBe(registrationFailure)
    expect(onEvent).toHaveBeenCalledOnce()
  } finally {
    await host.stop().catch((failure: unknown) => {
      if (failure !== registrationFailure) throw failure
    })
  }
  expect(flush).toHaveBeenCalledOnce()
  expect(put).toHaveBeenCalledOnce()
  expect(rows.get(session.id)?.rows['test/native-cache']).toEqual({ ver: 1, seq: -1, val: 0 })
  expect(domainClosed).toBe(true)
  expect(attachedObservers.size).toBe(0)
  expect(detachedObservers.size).toBe(0)
})

it('skips an owner released while the initial active-owner snapshot is draining', async () => {
  const firstSession = Session.create(SessionId('native-cache-snapshot-first'))
  const releasedSession = Session.create(SessionId('native-cache-snapshot-released'))
  const firstFlushEntered: PromiseWithResolvers<void> = Promise.withResolvers()
  const firstFlushGate: PromiseWithResolvers<void> = Promise.withResolvers()
  const firstListeners = new Set<(event: SessionEvent) => void>()
  const releasedListeners = new Set<(event: SessionEvent) => void>()
  const firstFlush = vi.fn(async () => {
    if (firstFlush.mock.calls.length === 1) {
      firstFlushEntered.resolve()
      await firstFlushGate.promise
    }
  })
  const firstOwner = {
    agent: {} as NativeActiveSessionOwner['agent'],
    session: firstSession,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush: firstFlush,
    onEvent(listener: (event: SessionEvent) => void) {
      firstListeners.add(listener)
      return () => firstListeners.delete(listener)
    },
  } as unknown as NativeActiveSessionOwner
  let releasedOwnerAdmitting = true
  const releasedOwnerFlush = vi.fn(async () => {})
  const releasedOwnerOnEvent = vi.fn((listener: (event: SessionEvent) => void) => {
    if (!releasedOwnerAdmitting) throw new Error('released owner no longer admits observers')
    releasedListeners.add(listener)
    return () => releasedListeners.delete(listener)
  })
  const releasedOwner = {
    agent: {} as NativeActiveSessionOwner['agent'],
    session: releasedSession,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    beginDetach() { releasedOwnerAdmitting = false },
    flush: releasedOwnerFlush,
    onEvent: releasedOwnerOnEvent,
  } as unknown as NativeActiveSessionOwner
  let currentOwners: NativeActiveSessionOwner[] = [firstOwner, releasedOwner]
  const ownerSnapshots: NativeActiveSessionOwner[][] = []
  const attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  const active = {
    owners() {
      const snapshot = [...currentOwners]
      ownerSnapshots.push(snapshot)
      return snapshot
    },
    onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      attached.add(observer)
      return async () => { attached.delete(observer) }
    },
    onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>) {
      detached.add(observer)
      return async () => { detached.delete(observer) }
    },
  } as unknown as NativeServices['activeSessions']
  const rows = new Map<string, CheckpointRecord>()
  const put = vi.fn(async (id: string, record: CheckpointRecord) => { rows.set(id, structuredClone(record)) })
  let domainClosed = false
  const domain = {
    table: () => ({ get: (id: string) => rows.get(id), put }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const projectionRegistry = new NativeSessionProjectionRegistry()
  projectionRegistry.register(projection)
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('sessionProjections', projectionRegistry), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 3, writeIntervalMs: 60_000 } },
  ], 'host'))
  let stopped = false
  const releaseOwner = async (owner: NativeActiveSessionOwner): Promise<void> => {
    currentOwners = currentOwners.filter(candidate => candidate !== owner)
    owner.beginDetach?.()
    await Promise.all([...detached].map(observer => observer(owner)))
  }
  try {
    const starting = host.start()
    await firstFlushEntered.promise
    expect(ownerSnapshots[0]).toEqual([firstOwner, releasedOwner])

    await releaseOwner(releasedOwner)
    firstFlushGate.resolve()
    await expect(starting).resolves.toBeUndefined()

    expect(releasedOwnerOnEvent).not.toHaveBeenCalled()
    expect(releasedOwnerFlush).not.toHaveBeenCalled()
    expect(releasedListeners.size).toBe(0)
    expect(rows.has(releasedSession.id)).toBe(false)
    expect(put).toHaveBeenCalledTimes(1)
    await host.stop()
    stopped = true
    expect(domainClosed).toBe(true)
    expect(firstListeners.size).toBe(0)
  } finally {
    firstFlushGate.resolve()
    if (!stopped) await host.stop()
  }
})

it('keeps a schema-accepted non-JSON checkpoint out of Native durable storage', async () => {
  const session = Session.create(SessionId('native-cache-non-json'))
  const eventListeners = new Set<(event: SessionEvent) => void>()
  const flush = vi.fn(async () => {})
  const owner = {
    session,
    inheritedEventCount: SessionLogOffset(0),
    writerAvailable: true,
    flush,
    onEvent(listener: (event: SessionEvent) => void) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
  } as unknown as NativeActiveSessionOwner
  const active = {
    owners: () => [owner],
    onAttached: () => async () => {},
    onDetached: () => async () => {},
  } as unknown as NativeServices['activeSessions']
  const rows = new Map<string, CheckpointRecord>()
  const put = vi.fn(async (id: string, record: CheckpointRecord) => { rows.set(id, structuredClone(record)) })
  let domainClosed = false
  const domain = {
    table: () => ({ get: (id: string) => rows.get(id), put }),
    async close() { domainClosed = true },
  }
  const storageDomain = { open: async () => domain } as unknown as NativeServices['storageDomain']
  const projectionRegistry = new NativeSessionProjectionRegistry()
  projectionRegistry.register(projection)
  projectionRegistry.register(nonJsonProjection)
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: service('activeSessions', active), scope, config: undefined },
    { plugin: service('sessionProjections', projectionRegistry), scope, config: undefined },
    { plugin: service('storageDomain', storageDomain), scope, config: undefined },
    { plugin: cachePlugin, scope, config: { writeEveryEvents: 3, writeIntervalMs: 60_000 } },
  ], 'host'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await host.start()
    expect(flush).toHaveBeenCalledOnce()
    expect(put).not.toHaveBeenCalled()
    expect(rows.has(session.id)).toBe(false)
    expect(warning).toHaveBeenCalledOnce()
    expect(warning.mock.calls[0]?.[0]).toContain('not losslessly JSON-serializable')
  } finally {
    try {
      await host.stop()
    } finally {
      warning.mockRestore()
    }
  }
  expect(domainClosed).toBe(true)
  expect(eventListeners.size).toBe(0)
})
