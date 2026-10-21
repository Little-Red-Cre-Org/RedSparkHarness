import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import type {} from '@deepseek-ai/dsh-agent-loop'
import { validatedSourceCallbacks } from './settings-entry.ts'

/**
 * Cordis adapter for the optional AgentLoop Settings source.
 * @param ctx - Cordis context that mounts this selected adapter.
 * @returns completion after its Engine peer loads and the service injection is declared.
 * @throws when the selected Engine package cannot be loaded.
 */
export async function apply(ctx: Context): Promise<void> {
  const [service, settings] = await Promise.all([
    import('@deepseek-ai/dsh-agent-loop'),
    import('@deepseek-ai/dsh-agent-loop/compat-settings'),
  ]).catch((cause: unknown) => {
    throw new Error('The selected AgentLoop Settings adapter requires its Engine peer.', { cause })
  })
  ctx.inject(['agentLoop'], (engineCtx) => {
    const retained = settings.agentLoopSettingsOwner(engineCtx.agentLoop)
    engineCtx.effect(() => {
      const fiber = retained.owner.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.installSection(
          retained.owner,
          service.AGENT_LOOP_SETTINGS_NAMESPACE,
          service.AGENT_LOOP_SETTINGS_SCHEMA,
          retained.binding.entry,
          validatedSourceCallbacks(retained.binding),
        )
      })
      return () => fiber.dispose()
    }, 'compatSettings.agentLoop()')
  })
}

/** Cordis plugin name. */
export const name = 'agent-loop-settings'
export default apply
