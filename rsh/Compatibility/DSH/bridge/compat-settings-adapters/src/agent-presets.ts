import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import type {} from '@deepseek-ai/dsh-agent-presets'

/**
 * Cordis adapter for the optional preset-selection Settings scope.
 * @param ctx - Cordis context that mounts this selected adapter.
 * @returns completion after its Engine peer loads and the service injection is declared.
 * @throws when the selected Engine package cannot be loaded.
 */
export async function apply(ctx: Context): Promise<void> {
  const [service, settings] = await Promise.all([
    import('@deepseek-ai/dsh-agent-presets'),
    import('@deepseek-ai/dsh-agent-presets/compat-settings'),
  ]).catch((cause: unknown) => {
    throw new Error('The selected Agent Presets Settings adapter requires its Engine peer.', { cause })
  })
  ctx.inject(['agentPresets'], (engineCtx) => {
    const presets = engineCtx.agentPresets
    const retained = settings.agentPresetsSettingsOwner(presets)
    engineCtx.effect(() => {
      const fiber = retained.owner.inject(['settings'], (settingsCtx) => {
        const scope = settingsCtx.settings.register(service.SETTINGS_NAMESPACE, service.AgentPresetSettingsSchema, {
          base: { default: presets.config.default, modeSelectionEnabled: true },
        })
        retained.binding.bind(scope, settingsCtx.settings)
        settingsCtx.effect(() => () => { retained.binding.bind() }, 'agentPresets.settings()')
      })
      return () => fiber.dispose()
    }, 'compatSettings.agentPresets()')
  })
}

/** Cordis plugin name. */
export const name = 'agent-presets-settings'
export default apply
