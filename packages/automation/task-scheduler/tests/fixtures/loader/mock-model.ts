import type { Context } from '@deepseek-ai/cordis'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../core/agent-loop/tests/mock-adapter.ts'
import type {} from '@deepseek-ai/dsh-goal'
export const name = 'scheduler-test-model'
export const inject = ['llm', 'goals', 'agents']
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new MockAdapter([
    textResponse('Scheduled execution finished.'),
    textResponse('Work remains; checkpoint saved.'),
    () => {
      const agent = ctx.agents.roots().find(item => ctx.goals.get(item))!
      const goal = ctx.goals.get(agent)!
      return toolCallResponse('finish-goal', 'update_goal', { action: 'complete', goal_id: goal.id, revision: goal.revision })
    },
    textResponse('Verification complete.'),
  ]))
}
