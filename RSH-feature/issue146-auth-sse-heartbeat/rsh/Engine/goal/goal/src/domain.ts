/** Cordis compatibility events over shared durable Goal facts. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalChanged } from './facts.ts'
export type * from './facts.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Goal mutation accepted by one live agent. The matching `goal/change`
     * session event has already committed. Listener failures are contained.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param payload.agent - agent whose session owns the goal.
     * @param payload.change - fresh current projection or clear tombstone.
     * @mode emit
     */
    'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
  }
}

export type * from './compatibility-events.ts'
