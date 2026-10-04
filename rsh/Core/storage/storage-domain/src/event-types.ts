/**
 * Change-event vocabulary of the domain data form. Every durable write emits
 * one event after the backend resolves durability, carrying the new snapshot
 * and an operation discriminant — never the old value (a diffing consumer
 * keeps its own previous snapshot). This is the event source for cross-process
 * change push (RPC frames) in a later phase.
 * @module @deepseek-ai/dsh-storage-domain/src/events
 */

/** Shared location fields of one durable domain change. */
export interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}

/** A record (or the global singleton) was inserted or overwritten. */
export interface DomainChangedPut extends DomainChangedBase {
  readonly operation: 'put'
  /** The new snapshot. */
  readonly value: unknown
}

/** A record was deleted; tombstones carry no value. */
export interface DomainChangedDeleted extends DomainChangedBase {
  readonly operation: 'deleted'
  readonly value?: never
}

/** One durable domain change; a closed union — switch on `operation`. */
export type DomainChanged = DomainChangedPut | DomainChangedDeleted
