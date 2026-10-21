import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
import type {} from '@deepseek-ai/dsh-tool-subagent'
import { validatedSourceCallbacks } from './settings-entry.ts'

/**
 * Cordis adapter for the optional subagent model-selection Settings source.
 * @param ctx - Cordis context that mounts this selected adapter.
 * @returns completion after its Engine peer loads and the service injection is declared.
 * @throws when the selected Engine package cannot be loaded.
 */
export async function apply(ctx: Context): Promise<void> {
  const [service, settings] = await Promise.all([
    import('@deepseek-ai/dsh-tool-subagent/model-selection-settings'),
    import('@deepseek-ai/dsh-tool-subagent/compat-settings'),
  ]).catch((cause: unknown) => {
    throw new Error('The selected subagent Settings adapter requires its Engine peer.', { cause })
  })
  ctx.inject(['subagentModelSelection'], (engineCtx) => {
    const retained = settings.subagentModelSelectionSettingsOwner(engineCtx.subagentModelSelection)
    engineCtx.effect(() => {
      const fiber = retained.owner.inject(['settings'], (settingsCtx) => {
        settingsCtx.settings.installSection(
          retained.owner,
          service.SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE,
          service.SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA,
          retained.binding.entry,
          validatedSourceCallbacks(retained.binding),
        )
      })
      return () => fiber.dispose()
    }, 'compatSettings.subagentModelSelection()')
  })
}

/** Cordis plugin name. */
export const name = 'subagent-model-selection-settings'
export default apply
