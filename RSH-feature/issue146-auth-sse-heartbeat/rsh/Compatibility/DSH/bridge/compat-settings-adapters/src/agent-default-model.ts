import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/**
 * Cordis adapter for the optional default-model Settings source and writer.
 * @param ctx - Cordis context that mounts this selected adapter.
 * @returns completion after its Engine peer loads and the service injection is declared.
 * @throws when the selected Engine package cannot be loaded.
 */
export async function apply(ctx: Context): Promise<void> {
  const [service, settings] = await Promise.all([
    import('@deepseek-ai/dsh-agent-default-model'),
    import('@deepseek-ai/dsh-agent-default-model/compat-settings'),
  ]).catch((cause: unknown) => {
    throw new Error('The selected default-model Settings adapter requires its Engine peer.', { cause })
  })
  ctx.inject(['agentDefaultModel'], (engineCtx) => {
    const retained = settings.agentDefaultModelSettingsOwner(engineCtx.agentDefaultModel)
    engineCtx.effect(() => {
      const fiber = retained.owner.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => () => { retained.binding.bindWriter() }, 'agentDefaultModel.settingsWriter()')
        settingsCtx.settings.installSection(
          retained.owner,
          service.AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
          service.AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA,
          retained.binding.entry,
          {
            setSource: (source) => { retained.binding.bindSource(source) },
            onChange: () => {},
          },
        )
        retained.binding.bindWriter(settingsCtx.settings)
      })
      return () => fiber.dispose()
    }, 'compatSettings.agentDefaultModel()')
  })
}

/** Cordis plugin name. */
export const name = 'agent-default-model-settings'
export default apply
