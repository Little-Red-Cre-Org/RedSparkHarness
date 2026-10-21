/** Compatibility declaration reuses the single pure durable-change payload. */
import type { DomainChanged } from './event-types.ts'
export type { DomainChanged, DomainChangedBase, DomainChangedPut, DomainChangedDeleted } from './event-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A domain record or the global singleton changed, emitted once per write
     * strictly after the backend acknowledged durability. Events of one
     * domain arrive in its write-chain order.
     * @param change - domain, table (`''` for global), key (`''` for global),
     * operation discriminant, and on `put` the new snapshot.
     * @mode emit
     */
    'domain/changed'(change: DomainChanged): void
  }
}
