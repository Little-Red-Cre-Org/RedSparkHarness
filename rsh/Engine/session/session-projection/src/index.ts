/**
 * Service Definition and Cordis adapter for session projections. Projection
 * folds and checkpoints live in a Cordis-free core shared with Native hosts.
 * @module @deepseek-ai/dsh-session-projection
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session/native'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/definition'
import {
  ProjectionRegistryCore,
  type ProjectionChangeListener,
  type ProjectionCheckpoint,
  type ProjectionSnapshot,
} from './registry-core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionProjections: SessionProjectionRegistry
  }
}

export type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'
export type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection/definition'
export type {
  ProjectionChangeListener,
  ProjectionCheckpoint,
  ProjectionCheckpointRow,
  ProjectionSnapshot,
} from './registry-core.ts'

/** Cordis service that owns registrations and delegates projection state to the shared core. */
export class SessionProjectionRegistry extends Service {
  private readonly core = new ProjectionRegistryCore()

  /**
   * Install the registry and feed it newly created Sessions and committed events.
   * @param ctx - Cordis context that owns this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
    ctx.on('session/created', (session: Session) => {
      this.core.created(session)
    })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.core.driveEvent(session, event)
    })
  }

  /**
   * Register one domain unit as an effect on the calling Cordis fiber.
   * @param definition - key, state schema, pure unit functions, and state version.
   * @returns the disposer for this registration.
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
   * Register one host-only unit as an effect on the calling Cordis fiber.
   * @param definition - key, state schema, pure unit functions, and state version.
   * @returns the disposer for this registration.
   */
  register<
    K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>,
    S extends SessionProjectionStateMap[K],
  >(
    definition: Omit<ProjectionDefinition<K, S>, 'wire'>,
  ): () => void
  register<K extends keyof SessionProjectionStateMap, S extends SessionProjectionStateMap[K]>(
    definition: ProjectionDefinition<K, S>,
  ): () => void {
    const dispose = this.ctx.effect(() => this.core.register(definition), 'sessionProjections.register()')
    return () => void dispose()
  }

  /**
   * Subscribe to changes on the calling Cordis fiber.
   * @param listener - called when a client view changes for a committed event.
   * @returns the disposer for this subscription.
   */
  onChanged(listener: ProjectionChangeListener): () => void {
    const dispose = this.ctx.effect(() => this.core.onChanged(listener), 'sessionProjections.onChanged()')
    return () => void dispose()
  }

  /**
   * Read one unit's current host state after folding to the Session cursor.
   * @param session - Session whose state is read.
   * @param key - registered unit key.
   * @returns current state, or undefined when the key is absent.
   */
  stateOf<K extends keyof SessionProjectionStateMap>(
    session: Session,
    key: K,
  ): SessionProjectionStateMap[K] | undefined {
    // The merge-extensible state map can look like void without domain augmentations.
    // oxlint-disable-next-line typescript/no-confusing-void-expression -- this returns the registered state value.
    return this.core.stateOf(session, key)
  }

  /**
   * Read all selected client values at one synchronous Session cut.
   * @param session - Session whose client values are read.
   * @param keys - optional client-visible keys to include.
   * @returns values and their common event watermark.
   */
  snapshot(
    session: Session,
    keys?: readonly Extract<keyof SessionProjectionMap, string>[],
  ): ProjectionSnapshot {
    return this.core.snapshot(session, keys)
  }

  /**
   * Read only cells already materialized for a Session.
   * @param session - Session whose cached cells are read.
   * @param keys - optional client-visible keys to include.
   * @returns values at their lowest common cached cut, or undefined.
   */
  cachedSnapshot(
    session: Session,
    keys?: readonly Extract<keyof SessionProjectionMap, string>[],
  ): ProjectionSnapshot | undefined {
    return this.core.cachedSnapshot(session, keys)
  }

  /**
   * Create detached checkpoint rows for every registered unit.
   * @param session - Session whose fold state is checkpointed.
   * @returns detached state rows keyed by projection key.
   */
  checkpoint(session: Session): ProjectionCheckpoint {
    return this.core.checkpoint(session)
  }

  /**
   * Find the earliest stored-log offset needed to restore checkpoint rows.
   * @param checkpoint - persisted rows for one Session.
   * @returns suffix offset, or undefined when no unit is registered.
   */
  restoreFloor(checkpoint: ProjectionCheckpoint): SessionLogOffset | undefined {
    return this.core.restoreFloor(checkpoint)
  }

  /**
   * View usable checkpoint rows without reading a stored log.
   * @param checkpoint - persisted rows for one Session.
   * @param keys - optional client-visible keys to include.
   * @returns validated client values from usable rows.
   */
  viewCheckpoint(
    checkpoint: ProjectionCheckpoint,
    keys?: readonly Extract<keyof SessionProjectionMap, string>[],
  ): Partial<SessionProjectionMap> {
    return this.core.viewCheckpoint(checkpoint, keys)
  }

  /**
   * Restore a detached stored-log cut and return refreshed checkpoint rows.
   * @param checkpoint - persisted rows for one Session.
   * @param events - stored events beginning at baseSeq.
   * @param baseSeq - sequence of the first supplied event.
   * @param header - immutable metadata for the Session.
   * @param inheritedEventCount - exact inherited prefix length.
   * @returns snapshot and refreshed checkpoint at the supplied cut.
   */
  restore(
    checkpoint: ProjectionCheckpoint,
    events: readonly SessionEvent[],
    baseSeq: SessionLogOffset,
    header: SessionHeader,
    inheritedEventCount: SessionLogOffset,
  ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint } {
    return this.core.restore(checkpoint, events, baseSeq, header, inheritedEventCount)
  }

  /**
   * Install an exact prepared Session cut into the live projection cells.
   * @param session - prepared Session that owns the supplied event cut.
   * @param checkpoint - persisted rows for this Session lifecycle.
   * @param events - exact events at the observation cut.
   * @param baseSeq - sequence of the first supplied event.
   * @returns all client values at the supplied cut.
   */
  hydrate(
    session: Session,
    checkpoint: ProjectionCheckpoint,
    events: readonly SessionEvent[],
    baseSeq: SessionLogOffset,
  ): ProjectionSnapshot {
    return this.core.hydrate(session, checkpoint, events, baseSeq)
  }
}

export default SessionProjectionRegistry
