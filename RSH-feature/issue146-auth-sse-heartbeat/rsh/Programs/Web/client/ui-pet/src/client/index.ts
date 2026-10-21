/** Desktop-pet Client plugin: registry, shared preferences, Conversation view, and settings. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_PET_ID, DEFAULT_PET_VARIANT, PET_SETTINGS_NAMESPACE, type PetSettings } from '../pet-settings.ts'
import { en, zh, type PetKey } from './locales.ts'
import { PetSettingsRow, type PetSettingsInjected } from './PetSettingsRow.tsx'
import { PetView, type PetViewInjected } from './PetView.tsx'
import { PetRuntime } from './runtime.ts'
import { registerPetProjection, type PetLifecycle, type PetToolPolicy } from './activity-projection.ts'

export type { PetKey } from './locales.ts'
export type { PetSettingsInjected, PetSettingsRowProps } from './PetSettingsRow.tsx'
export type { PetViewInjected, PetViewProps } from './PetView.tsx'
export type { PetRuntime } from './runtime.ts'
export type { PetActivity, PetDefinition, PetSnapshot, PetVariantDefinition } from './runtime.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { pet: PetKey }
}

/** Required Client services. */
export const inject = ['slots', 'locale', 'remote', 'settingsScope', 'sessions', 'uiConversation']

/** Configurable activity classification and sustained-work threshold. */
export interface Config extends PetToolPolicy {
  codingTools: string[]
  planningTools: string[]
  longRunningAfterMs: number
}
/** Client configuration for state presentation without model or theme coupling. */
export const Config: z<Config> = z.object({
  codingTools: z.array(z.string()).default(['write', 'edit', 'apply_patch']),
  planningTools: z.array(z.string()).default(['todo_write', 'update_plan']),
  longRunningAfterMs: z.number().min(1000).default(60_000),
})

const absentLifecycle = { getSnapshot: (): PetLifecycle | undefined => undefined, subscribe: () => () => {} }

/** Install the default character and its two synchronized presentation variants. */
export function apply(ctx: Context, config: Config): void {
  const settings = ctx.settingsScope.bind<PetSettings>({ namespace: PET_SETTINGS_NAMESPACE })
  const pet = new PetRuntime(ctx, settings)
  ctx.provide('pet', pet)
  registerPetProjection(ctx, config)
  ctx.effect(() => pet.register({
    id: DEFAULT_PET_ID,
    name: 'Kitsune',
    variants: [
      { id: DEFAULT_PET_VARIANT, atlasUrl: '/brand/kitsune-sprites.png' },
      { id: 'chibi', atlasUrl: '/brand/kitsune-chibi-sprites.png' },
    ],
  }), 'ui-pet: built-in RedSpark mascot')
  ctx.effect(() => ctx.locale.register('pet', { zh, en }), 'ui-pet: dictionaries')

  const viewFace = (sessionId: SessionId | undefined): PetViewInjected => {
    const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)
    return {
      hooks: { pet: pet.state, petLifecycle: binding === undefined ? absentLifecycle : ctx.uiConversation.binding(binding).target('pet-activity') },
      longRunningAfterMs: config.longRunningAfterMs,
    }
  }
  ctx.slots.inject('conversation.pet', () => ctx.slots.register({
    name: 'conversation.pet',
    locale: 'pet',
    inject: viewFace,
  }, PetView))

  const settingsFace = (): PetSettingsInjected => ({
    hooks: { pet: pet.state },
    setEnabled: (enabled) => { pet.setPreference('enabled', enabled) },
    setDesktopEnabled: (enabled) => { pet.setPreference('desktopEnabled', enabled) },
    setPet: (id) => { pet.selectPet(id) },
    setVariant: (id) => { pet.setPreference('variant', id) },
    importPet: (name, atlasUrl) => pet.importPet(name, atlasUrl),
    removePet: id => pet.removePet(id),
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'personalization-pet',
    order: 30,
    locale: 'pet',
    inject: settingsFace,
  }, PetSettingsRow))
}
