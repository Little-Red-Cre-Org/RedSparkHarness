/** Native projection Provider backed by the shared state-fold and checkpoint core. */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { Session, SessionEvent, SessionHeader, SessionLogOffset, SessionSeqCursor } from '@deepseek-ai/dsh-session/native'
import { ProjectionRegistryCore } from './registry-core.ts'
import type { ProjectionCheckpoint, ProjectionChangeListener, ProjectionSnapshot } from './registry-core.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/definition'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

export type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/definition'
export type { ProjectionCheckpoint, ProjectionSnapshot } from './registry-core.ts'

function runOwnerObserver(operation: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    operation()
    resolve()
  })
}

/** Inputs for one exact live or detached projection observation. */
export interface NativeProjectionObservationInput {
  /** Exact resident Session to hydrate when this is a live observation. */
  readonly session?: Session
  /** Immutable Session metadata for detached observations. */
  readonly header: SessionHeader
  /** Exact fork-inherited prefix length paired with the header. */
  readonly inheritedEventCount: SessionLogOffset
  /** Persisted rows for this Session lifecycle, or an empty checkpoint. */
  readonly checkpoint: ProjectionCheckpoint
  /** Contiguous events at or after baseSeq through the captured cut. */
  readonly events: readonly SessionEvent[]
  /** Sequence of the first supplied event. */
  readonly baseSeq: SessionLogOffset
}

/** One detached projection result and refreshed rows from an exact event cut. */
export interface NativeProjectionObservation {
  /** Last event reflected by every returned value, or -1 for an empty log. */
  readonly asOfSeq: SessionSeqCursor
  /** Cloned client-visible projection values from the same event cut. */
  readonly values: Partial<SessionProjectionMap>
  /** Detached rows refreshed through this cut; cold readers must not persist synthetic closers. */
  readonly checkpoint: ProjectionCheckpoint
  /**
   * Read one registered host fold state from this same cut.
   * @param key - registered projection key.
   * @returns a detached state value, or undefined when the key is absent.
   */
  stateOf<K extends keyof SessionProjectionStateMap>(key: K): SessionProjectionStateMap[K] | undefined
}

/** Cordis-free projection Definition name used by Native installers. */
export type NativeProjectionDefinition<
  K extends keyof SessionProjectionStateMap = keyof SessionProjectionStateMap,
  S extends SessionProjectionStateMap[K] = SessionProjectionStateMap[K],
> = ProjectionDefinition<K, S>

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionProjections: NativeSessionProjectionOperations }
}

/** Shared Native and Cordis projection registration, observation, and cache reads. */
export interface NativeSessionProjectionOperations {
  /**
   * Register a client-visible fold until its returned disposer runs.
   * @param definition - pure state fold, schema, and whole-value client view.
   * @returns an idempotent disposer for this registration.
   */
  register<
    K extends keyof SessionProjectionMap,
    S extends SessionProjectionStateMap[K],
  >(
    definition: Omit<ProjectionDefinition<K, S>, 'wire'> & {
      wire: NonNullable<ProjectionDefinition<K, S>['wire']>
    },
  ): () => void
  /**
   * Register a host-only fold until its returned disposer runs.
   * @param definition - pure state fold and validation schema.
   * @returns an idempotent disposer for this registration.
   */
  register<
    K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>,
    S extends SessionProjectionStateMap[K],
  >(definition: Omit<ProjectionDefinition<K, S>, 'wire'>): () => void
  /**
   * Subscribe to raw client-view reference changes from committed events.
   * @param listener - receives the exact Session, key, validated value, and event seq.
   * @returns an idempotent listener disposer.
   */
  onChanged(listener: ProjectionChangeListener): () => void
  /**
   * Read one registered host state at the Session's current log cursor.
   * @param session - exact Session instance whose state is read.
   * @param key - registered projection key.
   * @returns live internal state, or undefined when the key is absent.
   */
  stateOf<K extends keyof SessionProjectionStateMap>(
    session: Session,
    key: K,
  ): SessionProjectionStateMap[K] | undefined
  /**
   * Read client values at one synchronous Session cut.
   * @param session - exact Session instance to project.
   * @param keys - optional client-visible keys to include.
   * @returns values and their common event watermark.
   */
  snapshot(
    session: Session,
    keys?: readonly Extract<keyof SessionProjectionMap, string>[],
  ): ProjectionSnapshot
  /**
   * Capture detached host-state rows at the Session cursor.
   * @param session - exact Session instance to checkpoint.
   * @returns detached state rows keyed by projection key.
   */
  checkpoint(session: Session): ProjectionCheckpoint
  /**
   * Restore the supplied cut and hydrate its exact resident Session when present.
   * @param input - header, checkpoint, and contiguous events at one captured cut.
   * @returns detached values and checkpoint rows at that cut.
   */
  observe(input: NativeProjectionObservationInput): NativeProjectionObservation
  /**
   * Read usable rows without opening or replaying a log.
   * @param checkpoint - persisted rows for one Session lifecycle.
   * @param keys - optional client-visible keys to include.
   * @returns validated values from usable rows.
   */
  viewCheckpoint(
    checkpoint: ProjectionCheckpoint,
    keys?: readonly Extract<keyof SessionProjectionMap, string>[],
  ): Partial<SessionProjectionMap>
}

/** Session-instance event cells remain attached only while their exact active owner is published. */
export class NativeSessionProjectionRegistry extends ProjectionRegistryCore implements NativeSessionProjectionOperations {
  private readonly ownerEvents = new Map<NativeActiveSessionOwner, () => void>()

  /** @inheritdoc */
  observe(input: NativeProjectionObservationInput): NativeProjectionObservation {
    const result = input.session === undefined
      ? this.restore(input.checkpoint, input.events, input.baseSeq, input.header, input.inheritedEventCount)
      : this.hydrateWithCheckpoint(input.session, input.checkpoint, input.events, input.baseSeq)
    const checkpoint = structuredClone(result.checkpoint)
    const states = new Map(Object.entries(checkpoint).map(([key, row]) => [key, row.val]))
    return {
      asOfSeq: result.snapshot.asOfSeq,
      values: structuredClone(result.snapshot.values),
      checkpoint,
      stateOf: <K extends keyof SessionProjectionStateMap>(key: K): SessionProjectionStateMap[K] | undefined => {
        const state = states.get(key)
        return state === undefined ? undefined : structuredClone(state) as SessionProjectionStateMap[K]
      },
    }
  }

  /**
   * Attach synchronous event drive to one exact active Session owner.
   * @param owner - the active owner whose Session supplies committed events.
   */
  attach(owner: NativeActiveSessionOwner): void {
    if (this.ownerEvents.has(owner)) return
    this.created(owner.session)
    let active = true
    const remove = owner.onEvent((event) => {
      if (active) this.driveEvent(owner.session, event)
    })
    this.ownerEvents.set(owner, () => {
      active = false
      remove()
    })
  }

  /**
   * Disable and remove the event listener after an owner's lookup admission closes.
   * @param owner - the exact owner previously attached.
   * @throws if listener removal fails after registry ownership has been cleared.
   */
  detach(owner: NativeActiveSessionOwner): void {
    const release = this.ownerEvents.get(owner)
    if (release === undefined) return
    try {
      release()
    } finally {
      this.ownerEvents.delete(owner)
    }
  }

  /**
   * Disable every owner callback, attempt each listener removal, and clear state before reporting failures.
   * @throws AggregateError when one or more removals fail after all attempts and state clearing.
   */
  dispose(): void {
    const failures: unknown[] = []
    for (const release of this.ownerEvents.values()) {
      try {
        release()
      } catch (failure: unknown) {
        failures.push(failure)
      }
    }
    this.ownerEvents.clear()
    this.clear()
    if (failures.length > 0) throw new AggregateError(failures, 'session-projection: owner event cleanup failed')
  }
}

/** Selected Native projection Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-projection',
  targets: ['host'],
  requires: ['activeSessions'],
  provides: ['sessionProjections'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('session-projection: configuration must be empty')
    }
    return async (context) => {
      const active = context.require('activeSessions')
      const registry = new NativeSessionProjectionRegistry()
      let closing = false
      let removeAttached: (() => Promise<void>) | undefined
      let removeDetached: (() => Promise<void>) | undefined
      let cleanup: Promise<unknown[]> | undefined
      const release = (): Promise<unknown[]> => cleanup ??= (async () => {
        closing = true
        const outcomes = await Promise.allSettled([
          Promise.resolve().then(() => removeAttached?.()),
          Promise.resolve().then(() => removeDetached?.()),
        ])
        const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
        try {
          registry.dispose()
        } catch (failure: unknown) {
          failures.push(failure)
        }
        return failures
      })()
      try {
        removeAttached = active.onAttached(owner => runOwnerObserver(() => {
          if (!closing) registry.attach(owner)
        }))
        removeDetached = active.onDetached(owner => runOwnerObserver(() => {
          registry.detach(owner)
        }))
        for (const owner of active.owners()) registry.attach(owner)
        context.provide('sessionProjections', registry)
        context.own(async () => {
          const failures = await release()
          if (failures.length > 0) throw new AggregateError(failures, 'session-projection: lifecycle observer drain failed')
        })
      } catch (failure: unknown) {
        const cleanupFailures = await release()
        if (cleanupFailures.length > 0) throw new AggregateError([failure, ...cleanupFailures], 'session-projection: activation and cleanup failed')
        throw failure
      }
    }
  },
}
