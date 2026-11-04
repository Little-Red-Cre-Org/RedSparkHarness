/**
 * Native entrypoint for the floating companion overlay.
 *
 * The Cordis half owns three things a Native Client does not have: a
 * `settingsScope` binding for durable preferences, a Conversation view
 * projection registered on `uiConversation`, and the `conversation.pet` seat.
 * The Native shell declares none of them. What survives the move is the
 * presentation itself, so this entry keeps the mascot, derives its state from
 * the one Native Conversation service, and contributes it to the shell's root
 * overlay instead of the conversation seat.
 *
 * Two facts the Cordis half presents cannot be recovered here, and this entry
 * does not pretend otherwise: tool-level states (coding, planning, sleeping)
 * come from a Conversation view projection the Native host does not publish,
 * and preferences come from a settings namespace it does not serve. The
 * registry therefore lives in this browser process, and the state set is the
 * one the controller's own lifecycle supports.
 */

import { useEffect, useRef, useState } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { HostObservable, SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import { notifySubscribers } from '@redspark/rsh-client-store'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-ui-layout/native'
import type {} from '@redspark/rsh-client-locale/native'
// Type-only: pulls the `clientNativeConversation` NativeServices merge.
import type {} from '@redspark/rsh-client-ui-session/native'
import { ChatMascotHero } from '@redspark/rsh-client-ui-primitives'
import type { SessionId } from '@redspark/rsh-session/types'
import { en, zh, type PetKey } from './client/locales.ts'
import type { PetActivity } from './client/runtime.ts'

export { en, zh, type PetKey } from './client/locales.ts'
export type { PetActivity } from './client/runtime.ts'

/** Dictionary namespace owned by this plugin, shared with the browser build. */
const NS = 'pet'

/**
 * The Conversation facts this overlay reads.
 *
 * The service exposes far more; naming only these keeps the dependency
 * visible and lets a spec supply a stand-in instead of a whole controller.
 */
export interface NativePetConversation {
  /** Selected durable Session, or undefined when none is open. */
  readonly selected?: SessionId | undefined
  /** Readiness of the sole Native Conversation controller. */
  readonly state: 'loading' | 'ready' | 'sending' | 'cancelling' | 'closed'
  /** Last rejected Native Session operation, when the shell exposes it. */
  readonly error?: string | undefined
}

/** Built-in character id; its artwork ships with the Web assets. */
export const DEFAULT_PET_ID = 'redspark-kitsune'
/** Built-in presentation selected until the user picks another. */
export const DEFAULT_PET_VARIANT = 'normal'

/** One visual variant a character supplies. */
export interface NativePetVariant {
  /** Stable variant id; the selection persists within this browser process. */
  readonly id: string
  /** Four-frame horizontal atlas served by the shell. */
  readonly atlasUrl: string
}

/** A character contributed by this plugin or a third-party module. */
export interface NativePetDefinition {
  /** Stable character id. */
  readonly id: string
  /** User-facing name; user-authored names are data, not product copy. */
  readonly name: string
  /** Non-empty variants in display order. */
  readonly variants: readonly NativePetVariant[]
}

/** Immutable companion state read by the overlay. */
export interface NativePetSnapshot {
  /** Whether the companion is shown. */
  readonly enabled: boolean
  /** Selected character id. */
  readonly petId: string
  /** Selected variant id within that character. */
  readonly variant: string
  /** Registered characters in registration order. */
  readonly pets: readonly NativePetDefinition[]
  /** Advances on every published change. */
  readonly revision: number
}

/** Companion registry and selection owner shared with independently installed modules. */
export interface NativePetService {
  /** @returns the current registry and selection. */
  getSnapshot(): NativePetSnapshot
  /** @param listener - called after each published change. @returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** @param enabled - whether the companion is shown. */
  setEnabled(enabled: boolean): void
  /** @param id - a registered character id; an unknown id is a programming error. */
  selectPet(id: string): void
  /** @param id - a variant id within the selected character. */
  selectVariant(id: string): void
  /**
   * Register one character.
   * @param definition - stable id, name, and a non-empty variant roster.
   * @returns an idempotent disposer removing only this registration.
   */
  register(definition: NativePetDefinition): () => void
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Companion registry and selection owner installed by a Native profile. */
    clientNativePet: NativePetService
  }
}

/**
 * Build the companion registry.
 *
 * Registration is the only source of characters; a duplicate id, an empty
 * variant roster, or selecting an unknown character throws rather than
 * silently leaving the overlay blank.
 * @returns the service; the plugin context owns its disposal.
 */
export function createNativePetService(): NativePetService {
  const definitions = new Map<string, NativePetDefinition>()
  const listeners = new Set<() => void>()
  let enabled = true
  let petId = DEFAULT_PET_ID
  let variant = DEFAULT_PET_VARIANT
  let revision = 0

  const build = (): NativePetSnapshot => Object.freeze({
    enabled,
    petId,
    variant,
    pets: Object.freeze([...definitions.values()].map(pet => Object.freeze({
      id: pet.id,
      name: pet.name,
      variants: Object.freeze(pet.variants.map(entry => Object.freeze({ id: entry.id, atlasUrl: entry.atlasUrl }))),
    }))),
    revision,
  })

  let snapshot = build()
  const publish = (): void => {
    revision += 1
    snapshot = build()
    notifySubscribers(listeners, '[native-pet]')
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setEnabled(value) {
      if (enabled === value) return
      enabled = value
      publish()
    },
    selectPet(id) {
      const pet = definitions.get(id)
      if (pet === undefined) throw new Error(`pet "${id}" is not registered`)
      const kept = pet.variants.some(entry => entry.id === variant) ? variant : (pet.variants[0] as NativePetVariant).id
      if (petId === id && variant === kept) return
      petId = id
      variant = kept
      publish()
    },
    selectVariant(id) {
      if (variant === id) return
      variant = id
      publish()
    },
    register(definition) {
      if (definition.variants.length === 0) throw new Error(`pet "${definition.id}" has no variants`)
      if (definitions.has(definition.id)) throw new Error(`pet "${definition.id}" is already registered`)
      definitions.set(definition.id, definition)
      publish()
      return () => {
        if (definitions.get(definition.id) !== definition) return
        definitions.delete(definition.id)
        publish()
      }
    },
  }
}

/**
 * Derive the state the mascot presents from the Native Conversation service.
 *
 * Only the controller's own lifecycle is visible here, so a finished turn
 * reads as `idle` and the detailed tool states stay with the Cordis build's
 * Session projection.
 * @param snapshot - current Native Conversation view.
 * @returns the state to present.
 */
export function derivePetActivity(snapshot: NativePetConversation): PetActivity {
  if (snapshot.error !== undefined) return 'error'
  if (snapshot.state === 'sending' || snapshot.state === 'cancelling' || snapshot.state === 'loading') return 'thinking'
  return 'idle'
}

/** Locale key of the speech line for each activity. */
const SPEECH: Readonly<Record<PetActivity, PetKey>> = {
  idle: 'speech.idle', thinking: 'speech.thinking', waiting: 'speech.waiting',
  error: 'speech.error', complete: 'speech.complete', coding: 'speech.coding',
  working: 'speech.working', sleeping: 'speech.sleeping',
  planning: 'speech.planning', compacting: 'speech.compacting', focused: 'speech.focused',
}

/** Props the overlay receives from its slot registration. */
export interface NativePetOverlayProps {
  /** Companion registry and selection. */
  readonly usePet: SnapshotSelectorHook<NativePetSnapshot>
  /** The one Native Conversation service. */
  readonly useConversation: SnapshotSelectorHook<NativePetConversation>
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Floating companion over the Native shell.
 * @param props - registry hook, conversation hook, and the namespace translator.
 * @returns the mascot, or null while hidden or with no Session open.
 */
export function NativePetOverlay({ usePet, useConversation, t }: NativePetOverlayProps) {
  const pet = usePet(value => value)
  const conversation = useConversation(value => value)
  const [happy, setHappy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const sending = conversation.state === 'sending' || conversation.state === 'cancelling'
  const previousSending = useRef(sending)

  // A settled turn earns a short cheer; the flag clears itself so a still
  // conversation does not keep celebrating.
  useEffect(() => {
    const finished = previousSending.current && !sending && conversation.error === undefined
    previousSending.current = sending
    setCompleted(finished)
    setHappy(false)
    if (!finished) return
    const timer = window.setTimeout(() => { setCompleted(false) }, 3_200)
    return () => { window.clearTimeout(timer) }
  }, [sending, conversation.error])

  const selected = pet.pets.find(candidate => candidate.id === pet.petId) ?? pet.pets[0]
  const variant = selected?.variants.find(candidate => candidate.id === pet.variant) ?? selected?.variants[0]
  // The empty conversation already presents the mascot as its own hero; this
  // overlay covers the whole frame, so it stays out of the way without a
  // selected Session.
  if (!pet.enabled || variant === undefined || conversation.selected === undefined) return null

  const base = derivePetActivity(conversation)
  const activity: PetActivity = base === 'idle' && completed ? 'complete' : base
  const name = selected?.id === DEFAULT_PET_ID ? t('character.redspark-kitsune') : selected?.name ?? ''
  return (
    <ChatMascotHero
      atlasUrl={variant.atlasUrl}
      state={activity}
      placement="floating"
      characterLabel={name}
      happy={happy}
      onInteract={() => { setHappy(value => !value) }}
      interactionLabel={t('interact', { name })}
      speech={t(SPEECH[activity], { name })}
      pauseLabel={t('motion.pause')}
      enableMotionLabel={t('motion.enable')}
      resumeLabel={t('motion.resume', { name })}
    />
  )
}

/** Native companion overlay: registry, built-in character, and the shell overlay contribution. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-pet',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeConversation'],
  provides: ['clientNativePet'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new TypeError('native pet: this provider takes no configuration')
    return (context) => {
      const slots = context.require('clientSlots')
      const locale = context.require('clientLocale')
      const conversation = context.require('clientNativeConversation')
      const pet = createNativePetService()
      context.own(locale.register(NS, { en, zh }))
      context.provide('clientNativePet', pet)
      context.own(pet.register({
        id: DEFAULT_PET_ID,
        name: 'Kitsune',
        variants: [
          { id: DEFAULT_PET_VARIANT, atlasUrl: '/brand/kitsune-sprites.png' },
          { id: 'chibi', atlasUrl: '/brand/kitsune-chibi-sprites.png' },
        ],
      }))
      const registry: HostObservable<NativePetSnapshot> = {
        getSnapshot: pet.getSnapshot,
        subscribe: pet.subscribe,
      }
      // The service is already an observable of its own snapshot; the hook
      // binding requires a bare source, so this narrows the published value to
      // the fields the overlay reads without adding a second subscription.
      const conversationSource: HostObservable<NativePetConversation> = {
        getSnapshot: () => conversation.getSnapshot(),
        subscribe: listener => conversation.subscribe(listener),
      }
      context.own(slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'pet',
        order: 30,
        locale: NS,
        inject: () => ({ hooks: { pet: registry, conversation: conversationSource } }),
      }, NativePetOverlay)))
    }
  },
}