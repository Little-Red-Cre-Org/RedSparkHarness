/** Cordis compatibility events over shared durable Goal facts. */
import type { Agent } from '@redspark/rsh-agent'
import type { GoalChanged } from './facts.ts'
export type * from './facts.ts'

declare module '@redspark/cordis' {
  interface Events {
    /**
     * Goal mutation accepted by one live agent. The matching `goal/change`
     * session event has already committed. Listener failures are contained.
     * Scope-filtered dispatch (`@redspark/rsh-scope`): agent-scoped listeners receive only that agent.
     * @param payload.agent - agent whose session owns the goal.
     * @param payload.change - fresh current projection or clear tombstone.
     * @mode emit
     */
    'goal/changed'(this: import('@redspark/rsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
  }
}

export type * from './compatibility-events.ts'
