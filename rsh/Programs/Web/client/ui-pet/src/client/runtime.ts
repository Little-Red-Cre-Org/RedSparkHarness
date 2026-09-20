/** Extensible pet registry, durable preference owner, and activity override source. */
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  DEFAULT_PET_ID, DEFAULT_PET_VARIANT, MAX_CUSTOM_PETS, type PetSettings,
} from '../pet-settings.ts'

/** Semantic states a pet presentation may visualize. */
export type PetActivity = 'idle' | 'thinking' | 'waiting' | 'error' | 'complete' | 'coding' | 'working' | 'sleeping' | 'planning' | 'compacting' | 'focused'

/** One visual variant supplied by a pet definition. */
export interface PetVariantDefinition {
  /** Stable variant id persisted in user settings. */
  id: string
  /** Four-frame horizontal atlas: idle, blink, wave, happy wave. */
  atlasUrl: string
}

/** A character registered by the built-in or a third-party plugin. */
export interface PetDefinition {
  /** Stable pet id persisted in user settings. */
  id: string
  /** User-facing character name. User-authored names are data, not product copy. */
  name: string
  /** Non-empty visual variants in display order. */
  variants: readonly PetVariantDefinition[]
}

/** Immutable runtime snapshot consumed by settings and presentation slots. */
export interface PetSnapshot {
  enabled: boolean
  desktopEnabled: boolean
  petId: string
  variant: string
  pets: readonly PetDefinition[]
  customPetIds: readonly string[]
  activities: ReadonlyMap<SessionId, PetActivity>
  revision: number
}

const DEFAULT_SETTINGS: PetSettings = {
  enabled: true,
  desktopEnabled: false,
  petId: DEFAULT_PET_ID,
  variant: DEFAULT_PET_VARIANT,
  customPets: [],
}

function copySettings(settings: PetSettings): PetSettings {
  return { ...settings, customPets: settings.customPets.map(pet => ({ ...pet })) }
}

/** Registry and preference service used by independently loaded pet providers. */
export class PetRuntime {
  private readonly ctx: Context
  private readonly host: SettingsScope<PetSettings>
  private readonly definitions = new Map<string, PetDefinition>()
  private readonly activities = new Map<SessionId, Map<string, { activity: PetActivity }>>()
  private listeners = new Set<() => void>()
  private snapshot: PetSnapshot
  private preferences = copySettings(DEFAULT_SETTINGS)

  /** Observable used by injected Slot hooks. */
  readonly state: ObservableSnapshot<PetSnapshot> = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  /** Create the runtime and continuously adopt durable settings. */
  constructor(ctx: Context, host: SettingsScope<PetSettings>) {
    this.ctx = ctx
    this.host = host
    this.snapshot = Object.freeze({
      ...this.preferences,
      pets: Object.freeze([]),
      customPetIds: Object.freeze([]),
      activities: new Map(),
      revision: 0,
    })
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-pet: settings scope adoption')
    this.adopt()
  }

  /**
   * Register one character; duplicate ids fail at plugin load.
   * @param definition - Stable character id, name, and non-empty variant roster.
   * @returns an idempotent disposer removing only this registration.
   */
  register(definition: PetDefinition): () => void {
    if (definition.variants.length === 0) throw new Error(`pet "${definition.id}" has no variants`)
    if (this.definitions.has(definition.id)) throw new Error(`pet "${definition.id}" is already registered`)
    const stored = Object.freeze({
      ...definition,
      variants: Object.freeze(definition.variants.map(variant => Object.freeze({ ...variant }))),
    })
    this.definitions.set(definition.id, stored)
    this.publish()
    return () => {
      if (this.definitions.get(definition.id) !== stored) return
      this.definitions.delete(definition.id)
      this.publish()
    }
  }

  /**
   * Select visibility, character, or variant through the durable settings scope.
   * Remote browser scopes retain the selection in this browser process because
   * they intentionally cannot write Host preferences.
   * @param field - Preference field to write.
   * @param value - Value selected for that field.
   */
  setPreference<K extends keyof PetSettings>(field: K, value: PetSettings[K]): void {
    this.replacePreferences({ ...this.preferences, [field]: value })
    if (this.host.getSnapshot().mode === 'memory') {
      return
    }
    void this.host.set(field, value)
  }

  /**
   * Select a registered character and a variant it actually provides.
   * @param id - Registered character selected by the user.
   */
  selectPet(id: string): void {
    const pet = this.snapshot.pets.find(candidate => candidate.id === id)
    if (pet === undefined) throw new Error(`pet "${id}" is not registered`)
    const variant = pet.variants.some(candidate => candidate.id === this.preferences.variant)
      ? this.preferences.variant : (pet.variants[0] as PetVariantDefinition).id
    this.replacePreferences({ ...this.preferences, petId: id, variant })
    if (this.host.getSnapshot().mode === 'memory') {
      return
    }
    void this.host.mutate([
      { op: 'set', path: ['petId'], value: id },
      { op: 'set', path: ['variant'], value: variant },
    ])
  }

  /**
   * Persist and select a user-imported character in one revision-checked write.
   * @param name - User-provided character name.
   * @param atlasUrl - PNG data produced by the importer.
   * @returns completion of the settings write.
   */
  async importPet(name: string, atlasUrl: string): Promise<void> {
    if (this.preferences.customPets.length >= MAX_CUSTOM_PETS) throw new Error(`A maximum of ${MAX_CUSTOM_PETS} custom pets can be imported`)
    const id = `imported-${randomUUID()}`
    const customPets = [...this.preferences.customPets, { id, name, atlasUrl }]
    if (this.host.getSnapshot().mode === 'memory') {
      this.replacePreferences({ ...this.preferences, customPets, petId: id, variant: 'normal' })
      return
    }
    await this.host.mutate([
      { op: 'set', path: ['customPets'], value: customPets as unknown as JsonValue },
      { op: 'set', path: ['petId'], value: id },
      { op: 'set', path: ['variant'], value: 'normal' },
    ], this.host.getSnapshot().revision)
    if (!this.host.getSnapshot().value?.customPets.some(pet => pet.id === id)) throw new Error('Pet import was not saved')
  }

  /**
   * Remove an imported character and return to the built-in character when selected.
   * @param id - Imported character chosen by the user.
   * @returns completion of the atomic settings write.
   */
  async removePet(id: string): Promise<void> {
    const customPets = this.preferences.customPets.filter(pet => pet.id !== id)
    const selected = this.preferences.petId === id
    if (this.host.getSnapshot().mode === 'memory') {
      this.replacePreferences({
        ...this.preferences,
        customPets,
        ...(selected ? { petId: DEFAULT_PET_ID, variant: DEFAULT_PET_VARIANT } : {}),
      })
      return
    }
    await this.host.mutate([
      { op: 'set', path: ['customPets'], value: customPets as unknown as JsonValue },
      ...(selected ? [
        { op: 'set' as const, path: ['petId'], value: DEFAULT_PET_ID },
        { op: 'set' as const, path: ['variant'], value: DEFAULT_PET_VARIANT },
      ] : []),
    ], this.host.getSnapshot().revision)
    if (this.host.getSnapshot().value?.customPets.some(pet => pet.id === id)) throw new Error('Pet removal was not saved')
  }

  /**
   * Publish a semantic activity from another plugin until its disposer runs.
   * @param sessionId - Session whose pet receives the report.
   * @param source - Stable identity of the reporting plugin or operation.
   * @param activity - Semantic state to present while this report is active.
   * @returns an idempotent disposer removing only this source's report.
   */
  setActivity(sessionId: SessionId, source: string, activity: PetActivity): () => void {
    const report = { activity }
    const reports = this.activities.get(sessionId) ?? new Map<string, { activity: PetActivity }>()
    reports.delete(source)
    reports.set(source, report)
    this.activities.set(sessionId, reports)
    this.publish()
    return () => {
      if (reports.get(source) !== report) return
      reports.delete(source)
      if (reports.size === 0) this.activities.delete(sessionId)
      this.publish()
    }
  }

  private adopt(): void {
    const settings = this.host.getSnapshot().value
    if (settings === undefined) return
    this.replacePreferences(settings)
  }

  private replacePreferences(settings: PetSettings): void {
    this.preferences = copySettings(settings)
    this.publish()
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      ...this.preferences,
      pets: Object.freeze([...this.definitions.values(), ...this.preferences.customPets.map(pet => ({
        id: pet.id, name: pet.name, variants: [{ id: 'normal', atlasUrl: pet.atlasUrl }],
      }))]),
      customPetIds: Object.freeze(this.preferences.customPets.map(pet => pet.id)),
      activities: new Map([...this.activities].flatMap(([sessionId, reports]) => {
        const report = [...reports.values()].at(-1)
        return report === undefined ? [] : [[sessionId, report.activity] as const]
      })),
      revision: this.snapshot.revision + 1,
    })
    this.emit()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
    this.ctx.emit('pet/change', this.snapshot)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { pet: PetRuntime }
  interface Events {
    /**
     * Announces a changed desktop-pet registry, preference, or active presentation.
     * @param snapshot - Current pet registry and preferences.
     * @mode emit
     */
    'pet/change'(snapshot: PetSnapshot): void
  }
}
