/** Native entrypoint for the floating companion overlay. */
export {
  plugin, NativePetOverlay, createNativePetService, derivePetActivity,
  DEFAULT_PET_ID, DEFAULT_PET_VARIANT, en, zh,
} from './native-ui.tsx'
export type { PetKey } from './native-ui.tsx'
export type {
  NativePetConversation, NativePetDefinition, NativePetOverlayProps, NativePetService,
  NativePetSnapshot, NativePetVariant,
} from './native-ui.tsx'
export type { PetActivity } from './client/runtime.ts'
