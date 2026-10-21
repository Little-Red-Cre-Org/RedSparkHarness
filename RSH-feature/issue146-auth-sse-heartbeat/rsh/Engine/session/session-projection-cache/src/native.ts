/** Cordis-free projection checkpoint Provider over the Native storage domain. */

import { z } from 'zod'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {
  NativeActiveSessionOperations,
  NativeActiveSessionOwner,
} from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { Session, SessionEvent, SessionHeader, SessionLogOffset as SessionLogOffsetValue } from '@deepseek-ai/dsh-session/native'
import type { ProjectionCheckpoint, NativeSessionProjectionOperations } from '@deepseek-ai/dsh-session-projection/native'
import type { Domain } from '@deepseek-ai/dsh-storage-domain/native'
import { identityMatches, identityOf } from './identity.ts'
import { projectionCacheDomainSpec } from './spec.ts'
import type { CheckpointRecord } from './spec.ts'

/** Explicit write-behind thresholds used by the Native cache Provider. */
export interface NativeSessionProjectionCacheConfig {
  /** Committed events per session that force a checkpoint between mandatory points. */
  readonly writeEveryEvents: number
  /** Longest time in milliseconds that dirty state may remain unwritten. */
  readonly writeIntervalMs: number
}

/** Synchronous matching checkpoint reads shared by exact query observations. */
export interface NativeSessionProjectionCacheOperations {
  /**
   * Return detached rows only for the exact Session lifecycle.
   * @param header - immutable active or stored Session identity.
   * @param inheritedEventCount - exact fork prefix used to initialize the folds.
   * @returns detached rows, or undefined when no current lifecycle row exists.
   */
  cachedCheckpoint(header: SessionHeader, inheritedEventCount: SessionLogOffsetValue): ProjectionCheckpoint | undefined
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionProjectionCache: NativeSessionProjectionCacheOperations }
}

/**
 * Resolve required Native write-behind thresholds before opening storage.
 * @param input - Native profile configuration.
 * @returns validated checkpoint thresholds.
 */
export function resolveNativeSessionProjectionCacheConfig(input: unknown): NativeSessionProjectionCacheConfig {
  return Object.freeze(z.object({
    writeEveryEvents: z.number().int().positive(),
    writeIntervalMs: z.number().int().positive(),
  }).strict().parse(input))
}

interface OwnerState {
  readonly owner: NativeActiveSessionOwner
  removeEvents: () => void
  tail: Promise<void>
  pendingEvents: number
  timer: ReturnType<typeof setTimeout> | undefined
  softQueued: boolean
  detached: boolean
}

/** Native cache owns accepted event listeners, timers, writes, and its domain handle. */
class NativeSessionProjectionCache implements NativeSessionProjectionCacheOperations {
  private readonly owners = new Map<NativeActiveSessionOwner, OwnerState>()
  private closing = false
  private removeAttached: (() => Promise<void>) | undefined
  private removeDetached: (() => Promise<void>) | undefined

  constructor(
    private readonly domain: Domain<typeof projectionCacheDomainSpec>,
    private readonly active: NativeActiveSessionOperations,
    private readonly projections: NativeSessionProjectionOperations,
    private readonly config: NativeSessionProjectionCacheConfig,
  ) {}

  /** Admit future owners before attaching the current exact-owner snapshot. */
  async start(): Promise<void> {
    this.removeAttached = this.active.onAttached(owner => this.attach(owner))
    this.removeDetached = this.active.onDetached(owner => this.detach(owner))
    for (const owner of this.active.owners()) await this.attach(owner)
  }

  /** @inheritdoc */
  cachedCheckpoint(header: SessionHeader, inheritedEventCount: SessionLogOffsetValue): ProjectionCheckpoint | undefined {
    if (this.closing) return undefined
    const record = this.domain.table('sessions').get(header.id)
    if (record === undefined || !identityMatches(record.identity, identityOf(header, inheritedEventCount))) return undefined
    return structuredClone(record.rows)
  }

  /** Close admissions, remove listeners, write final exact-owner cuts, and close the domain. */
  close(): Promise<void> {
    this.closing = true
    return this.closeOwned()
  }

  private async attach(owner: NativeActiveSessionOwner): Promise<void> {
    if (this.closing || this.owners.has(owner) || !this.active.owners().includes(owner)) return
    const state: OwnerState = {
      owner,
      removeEvents: () => {},
      tail: Promise.resolve(),
      pendingEvents: 0,
      timer: undefined,
      softQueued: false,
      detached: false,
    }
    this.owners.set(owner, state)
    state.removeEvents = owner.onEvent((event) => { this.onEvent(state, event) })
    await this.enqueue(state, 'create')
  }

  private async detach(owner: NativeActiveSessionOwner): Promise<void> {
    const state = this.owners.get(owner)
    if (state === undefined) return
    state.detached = true
    this.clearTimer(state)
    let removeFailure: unknown
    let removeFailed = false
    try {
      state.removeEvents()
    } catch (failure: unknown) {
      removeFailure = failure
      removeFailed = true
    }
    try {
      await this.enqueue(state, 'detach')
    } finally {
      this.owners.delete(owner)
    }
    if (removeFailed) throw removeFailure
  }

  private onEvent(state: OwnerState, event: SessionEvent): void {
    if (state.detached) return
    state.pendingEvents += 1
    if (event.type === 'turn/end') {
      this.clearTimer(state)
      this.enqueueMandatory(state, 'turn/end')
      return
    }
    if (this.closing) return
    if (state.pendingEvents >= this.config.writeEveryEvents) {
      this.enqueueSoft(state, 'count threshold')
    } else {
      this.armTimer(state)
    }
  }

  private enqueueSoft(state: OwnerState, trigger: string): void {
    if (state.softQueued || state.detached || this.closing) return
    state.softQueued = true
    this.clearTimer(state)
    void this.enqueue(state, trigger).then((written) => {
      state.softQueued = false
      if (state.detached || this.closing) return
      if (written && state.pendingEvents >= this.config.writeEveryEvents) {
        this.enqueueSoft(state, 'count threshold')
      } else if (state.pendingEvents > 0) {
        this.armTimer(state)
      }
    })
  }

  private enqueueMandatory(state: OwnerState, trigger: string): void {
    void this.enqueue(state, trigger).then(() => {
      if (state.detached || this.closing || state.pendingEvents === 0) return
      if (state.pendingEvents >= this.config.writeEveryEvents) {
        this.enqueueSoft(state, 'count threshold')
      } else {
        this.armTimer(state)
      }
    })
  }

  private armTimer(state: OwnerState): void {
    if (state.timer !== undefined || state.pendingEvents === 0 || state.detached || this.closing) return
    state.timer = setTimeout(() => {
      state.timer = undefined
      this.enqueueSoft(state, 'interval')
    }, this.config.writeIntervalMs)
  }

  private clearTimer(state: OwnerState): void {
    if (state.timer === undefined) return
    clearTimeout(state.timer)
    state.timer = undefined
  }

  private enqueue(state: OwnerState, trigger: string): Promise<boolean> {
    const task = state.tail.then(async () => {
      const capturedEvents = state.pendingEvents
      try {
        const rows = this.projections.checkpoint(state.owner.session)
        await state.owner.flush()
        await this.put(state.owner.session, rows)
        state.pendingEvents = Math.max(0, state.pendingEvents - capturedEvents)
        return true
      } catch (error: unknown) {
        console.warn(`session projection cache: Native ${trigger} write for "${state.owner.session.id}" failed (cache stays stale): ${String(error)}`)
        return false
      }
    })
    state.tail = task.then(() => {})
    return task
  }

  private async put(session: Session, rows: ProjectionCheckpoint): Promise<void> {
    const detached = snapshotJsonValue(rows)
    if (detached === undefined) {
      throw new TypeError('projection checkpoint is not losslessly JSON-serializable (a unit state violates the plain-JSON contract)')
    }
    const identity = identityOf(session.header, SessionLogOffset(session.inheritedEventCount))
    await this.domain.table('sessions').put(session.id, { identity, rows: detached as CheckpointRecord['rows'] })
  }

  private async closeOwned(): Promise<void> {
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => this.removeAttached?.()),
      Promise.resolve().then(() => this.removeDetached?.()),
    ])
    this.removeAttached = undefined
    this.removeDetached = undefined
    const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    for (const state of this.owners.values()) {
      state.detached = true
      this.clearTimer(state)
      try {
        state.removeEvents()
      } catch (failure: unknown) {
        failures.push(failure)
      }
    }
    await Promise.all([...this.owners.values()].map(state => this.enqueue(state, 'close')))
    const closeOutcomes = await Promise.allSettled([Promise.resolve().then(() => this.domain.close())])
    this.owners.clear()
    failures.push(...closeOutcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
    if (failures.length > 0) throw new AggregateError(failures, 'session projection cache: Native teardown failed')
  }
}

/** Native projection-cache Provider uses the existing validated `session_projcache` domain. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-projection-cache',
  targets: ['host'],
  requires: ['activeSessions', 'sessionProjections', 'storageDomain'],
  provides: ['sessionProjectionCache'],
  resolve(input) {
    const config = resolveNativeSessionProjectionCacheConfig(input)
    return async (context) => {
      const active = context.require('activeSessions')
      const projections = context.require('sessionProjections')
      const domain = await context.require('storageDomain').open(projectionCacheDomainSpec)
      const cache = new NativeSessionProjectionCache(domain, active, projections, config)
      context.own(() => cache.close())
      context.provide('sessionProjectionCache', cache)
      await cache.start()
    }
  },
}
