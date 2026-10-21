/** Low-overhead automatic routing for the upstream Archify Skill. */
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { BashEnvContributor } from '@deepseek-ai/dsh-shell-env'
import {
  ARCHIFY_SKILL_DIRECTORY_ENV,
  archifyShellEnvValues,
  archifySkillProvider,
  matchesDiagramDelivery,
  resolveConfig,
} from './shared.ts'
import type { Config } from './shared.ts'

export { Config } from './shared.ts'
export type { ArchifyAutoInvocationSource } from './types.ts'

export const name = 'archify'
export const inject = ['agents', 'skills', 'shellEnv']

const shellEnv: BashEnvContributor = {
  name: 'archify',
  variables: {
    [ARCHIFY_SKILL_DIRECTORY_ENV]: { description: 'Absolute directory containing the pinned Archify Skill resources and CLI.' },
  },
  resolve: archifyShellEnvValues,
}

/** Register the hidden Archify Skill and deterministic automatic instruction route. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.skills.registerProvider(() => archifySkillProvider)
  ctx.shellEnv.register(shellEnv)
  if (!resolved.autoInvoke) return

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || !matchesDiagramDelivery(messages, resolved)) return decision
    signal.throwIfAborted()
    const skill = await ctx.skills.get('archify', { cwd: agent.session.header.cwd, signal, scope: agent })
    signal.throwIfAborted()
    if (skill === undefined || !skill.invocation.userInvocable) return decision
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(skill) }],
        source: { kind: 'archify-auto-invocation', form: 'instructions', reason: 'diagram-delivery-request' },
      })],
    }
  })
}
