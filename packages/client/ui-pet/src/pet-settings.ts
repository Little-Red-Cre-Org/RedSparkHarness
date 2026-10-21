/** Durable desktop-pet preferences shared by the Host schema and browser runtime. */
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the desktop-pet plugin. */
export const PET_SETTINGS_NAMESPACE = 'ui-pet'
/** Built-in RedSpark mascot id. */
export const DEFAULT_PET_ID = 'redspark-kitsune'
/** Default RedSpark presentation. */
export const DEFAULT_PET_VARIANT = 'normal'
/** Maximum imported character records held by one user preference. */
export const MAX_CUSTOM_PETS = 20

/** A user-imported PNG character stored with the user's preferences. */
export interface ImportedPet {
  id: string
  name: string
  atlasUrl: string
}

/** Persisted desktop-pet preferences. */
export interface PetSettings {
  /** Whether the pet is visible. */
  enabled: boolean
  /** Whether the desktop carrier also shows its independent floating window. */
  desktopEnabled: boolean
  /** Selected registered pet id. */
  petId: string
  /** Selected variant id within that pet. */
  variant: string
  /** User-imported characters; PNG data stays local to the settings provider. */
  customPets: ImportedPet[]
}

/** Durable schema. Pet and variant ids remain strings for third-party registration. */
export const PetSettingsSchema: z<PetSettings> = z.object({
  enabled: z.boolean().default(true),
  desktopEnabled: z.boolean().default(false),
  petId: z.string().default(DEFAULT_PET_ID),
  variant: z.string().default(DEFAULT_PET_VARIANT),
  customPets: z.array(z.object({
    id: z.string().pattern(/^imported-[a-zA-Z0-9-]+$/).required(),
    name: z.string().min(1).max(64).required(),
    atlasUrl: z.string().max(8 * 1024 * 1024).pattern(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).required(),
  })).max(MAX_CUSTOM_PETS).default([]),
})
