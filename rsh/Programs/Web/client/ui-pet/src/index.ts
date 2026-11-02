/** Host registration for durable desktop-pet preferences. */
import type { Context } from '@redspark/cordis'
import type {} from '@redspark/rsh-compat-settings-definition'
import { PET_SETTINGS_NAMESPACE, PetSettingsSchema } from './pet-settings.ts'

export {
  DEFAULT_PET_ID, DEFAULT_PET_VARIANT, PET_SETTINGS_NAMESPACE,
  type PetSettings,
} from './pet-settings.ts'

/** Register the desktop-pet settings section when settings is present. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (scope) => {
    scope.settings.register(PET_SETTINGS_NAMESPACE, PetSettingsSchema)
  })
}
