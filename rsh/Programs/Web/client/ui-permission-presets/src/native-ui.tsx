/**
 * Native entrypoint for the permission surfaces.
 *
 * The Cordis half is two surfaces over services a Native Client does not have:
 * a General-settings row written through `settingsScope` and
 * `remote.settings`, and a `/permission` popup decoration registered on
 * `commandUi`. A Native host serves the same facts per Session —
 * `permissionControls` and `selectPermissionPreset` — and the Native
 * application already draws its own composer switcher and namespace editor, so
 * registering a second switcher would put two permission controls on one
 * screen.
 *
 * What this entry owns instead is the reusable face: one
 * `clientNativePermissionPresets` service over the Settings RPC, plus the two
 * Cordis-free components a Native settings seat can render. The Full access gate
 * is part of that face on both builds; it is the only path to that preset.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { SessionId } from '@redspark/rsh-session/types'
import type {
  NativePermissionControls, NativeSessionClient, NativeSettingsDescriptor,
} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type {} from '@redspark/rsh-client-native-session/native'
import { IconChevronDownOutline14, IconShieldOutline16, Menu, RiskConfirmation } from '@redspark/rsh-client-ui-primitives'
import { en, zh, type PermissionSettingsKey } from './client/locales.ts'
import { displayPermissionPreset, FULL_ACCESS_PRESET } from './client/presentation.ts'

export { en, zh, type PermissionSettingsKey } from './client/locales.ts'

declare module '@redspark/rsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
export { displayPermissionPreset, displayPresetName, FULL_ACCESS_PRESET } from './client/presentation.ts'

/** Dictionary namespace owned by the plugin, shared with the browser build. */
const NS = 'settings.permission'

/** Settings namespace holding the default preset for Sessions created later. */
export const PERMISSION_SETTINGS_NAMESPACE = 'permission'

/** One selectable default, resolved from the Host schema. */
export interface NativePermissionOption {
  /** Preset id written to Settings. */
  readonly id: string
  /** Display label; a built-in preset resolves to this plugin's copy. */
  readonly label: string
}

/** Immutable state of the default-preset row. */
export interface NativePermissionRowState {
  /** Lifecycle phase of the last read or write. */
  readonly status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  /** Diagnostic of the last failed read or write. */
  readonly error: string | null
  /** Whether the Host accepts writes for this namespace. */
  readonly writable: boolean
  /** Current default preset id. */
  readonly currentValue: string
  /** Advertised presets in schema order. */
  readonly options: readonly NativePermissionOption[]
  /** Descriptor revision expected by the next write. */
  readonly revision: number
}

/** Default-preset and per-Session switching over the Native Settings RPC. */
export interface NativePermissionPresetsService {
  /** @returns the current default-preset row state. */
  getSnapshot(): NativePermissionRowState
  /** @param listener - called after each published row change. @returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Read the descriptor once and start following Host Settings events. */
  load(): Promise<void>
  /** Persist one advertised preset as the default for Sessions created later. */
  selectDefault(preset: string): Promise<void>
  /**
   * Switch one Session's standing policy.
   * @param sessionId - Session whose Agent applies the policy now.
   * @param preset - advertised preset id, including `danger-full-access`.
   */
  selectForSession(sessionId: SessionId, preset: string): Promise<void>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Permission default and switching face for Native Client modules. */
    clientNativePermissionPresets: NativePermissionPresetsService
  }
}

/**
 * Read the preset ids the Host's `defaultPreset` schema advertises.
 *
 * The schema is the redacted JSON form of a Schemastery document, so the union
 * of `const` nodes is the only durable list of choices; a namespace without one
 * is reported as unavailable rather than guessed at.
 * @param row - the permission Settings descriptor.
 * @returns the current default and the advertised presets in schema order.
 * @throws {TypeError} when the schema does not advertise its current preset.
 */
export function permissionDefaults(
  row: NativeSettingsDescriptor,
): { currentValue: string; options: readonly NativePermissionOption[] } {
  const currentValue = row.value.defaultPreset
  if (typeof currentValue !== 'string') throw new TypeError('permission settings has no defaultPreset value')
  const schema = row.schema as {
    uid?: number
    refs?: Record<string, { type?: string; value?: unknown; list?: readonly number[]; dict?: Record<string, number> }>
  }
  const root = schema.uid === undefined ? undefined : schema.refs?.[String(schema.uid)]
  const field = root?.dict?.defaultPreset
  const node = field === undefined ? undefined : schema.refs?.[String(field)]
  const refs = node?.type === 'union' ? node.list ?? [] : field === undefined ? [] : [field]
  const options = refs.flatMap((ref): NativePermissionOption[] => {
    const option = schema.refs?.[String(ref)]
    return option?.type === 'const' && typeof option.value === 'string'
      ? [{ id: option.value, label: option.value }] : []
  })
  if (options.length === 0 || !options.some(option => option.id === currentValue)) {
    throw new TypeError('permission settings schema does not advertise its current preset')
  }
  return { currentValue, options }
}

type PermissionClient = Pick<NativeSessionClient,
  'settingsDescribe' | 'settingsMutate' | 'settingsEvents' | 'selectPermissionPreset'>

/**
 * Build the permission face over the Native Session client.
 *
 * The row follows the Host's Settings event stream rather than polling: a
 * `settings/document-updated` for this namespace is the only signal that the
 * descriptor revision moved, and a write carrying a stale revision is refused.
 * @param client - the Native Session client.
 * @param signal - lifetime; aborting stops the follow.
 * @returns the service.
 */
export function createNativePermissionPresets(
  client: PermissionClient,
  signal: AbortSignal,
): NativePermissionPresetsService {
  let state: NativePermissionRowState = Object.freeze({
    status: 'idle', error: null, writable: false, currentValue: '', options: [], revision: 0,
  })
  const listeners = new Set<() => void>()
  let following: Promise<void> | undefined
  let saving = false
  let disposed = false

  const publish = (next: Partial<NativePermissionRowState>): void => {
    state = Object.freeze({ ...state, ...next })
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-permission-presets] row listener failed:', error)
      }
    }
  }

  const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

  const read = async (): Promise<void> => {
    const description = await client.settingsDescribe(signal)
    if (disposed) return
    const row = description.namespaces.find(entry => entry.namespace === PERMISSION_SETTINGS_NAMESPACE)
    if (row === undefined) {
      publish({ status: 'unavailable', error: null, writable: false, currentValue: '', options: [] })
      return
    }
    try {
      const resolved = permissionDefaults(row)
      publish({
        status: 'ready',
        error: null,
        writable: true,
        currentValue: resolved.currentValue,
        options: resolved.options,
        revision: row.revision,
      })
    } catch (error) {
      publish({ status: 'error', error: message(error) })
    }
  }

  const follow = async (): Promise<void> => {
    try {
      for await (const event of client.settingsEvents(signal)) {
        if (event.type !== 'settings/document-updated' || event.namespace !== PERMISSION_SETTINGS_NAMESPACE) continue
        if (saving) continue
        await read()
      }
    } catch (error) {
      if (signal.aborted || disposed) return
      console.error('[ui-permission-presets] Settings follow failed:', error)
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async load() {
      if (disposed) return
      following ??= follow()
      if (state.status !== 'ready') publish({ status: 'loading', error: null })
      try {
        await read()
      } catch (error) {
        if (!disposed) publish({ status: 'error', error: message(error) })
      }
    },
    async selectDefault(preset) {
      if (disposed || saving || state.status === 'unavailable') return
      saving = true
      publish({ status: 'saving', error: null })
      try {
        await client.settingsMutate(
          PERMISSION_SETTINGS_NAMESPACE, [{ op: 'set', path: ['defaultPreset'], value: preset }], state.revision,
        )
        await read()
      } catch (error) {
        if (!disposed) publish({ status: 'error', error: message(error) })
      } finally {
        saving = false
      }
    },
    async selectForSession(sessionId, preset) {
      await client.selectPermissionPreset(sessionId, preset, signal)
    },
  }
}

/** Props of the default-preset row. */
export interface NativePermissionRowProps {
  /** Row state; a host rendering this row subscribes through `usePermission`. */
  readonly usePermission: SnapshotSelectorHook<NativePermissionRowState>
  /** Ensure the descriptor has been read at least once. */
  readonly load: () => Promise<void>
  /** Persist one advertised preset as the default for Sessions created later. */
  readonly select: (preset: string) => Promise<void>
  /** Namespace translator supplied by the caller. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Default permission preset for Sessions created later.
 * @param props - row state hook, the load and select verbs, and the translator.
 * @returns the row, or null when the Host serves no permission namespace.
 */
export function NativePermissionRow({ usePermission, load, select, t }: NativePermissionRowProps): ReactNode {
  const state = usePermission(value => value)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => { void load() }, [load])

  // A namespace that stops accepting writes must not leave the gate open.
  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
    setAcknowledged(false)
    setConfirming(false)
  }, [state.status, state.writable])

  if (state.status === 'unavailable') return null
  const selected = state.options.find(option => option.id === state.currentValue)
  const busy = state.status === 'loading' || state.status === 'saving' || confirming
  const optionLabel = (option: NativePermissionOption): string =>
    displayPermissionPreset(option.id, option.label, t)
  const label = selected === undefined ? (busy ? t('loading') : t('unavailable')) : optionLabel(selected)
  return (
    <>
      <div>
        <span>{t('title')}</span>
        <span role={state.error === null ? undefined : 'alert'}>{state.error ?? t('description')}</span>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={state.options.map(option => ({ id: option.id, label: optionLabel(option) }))}
          selectedId={state.currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === state.currentValue) return
            if (id === FULL_ACCESS_PRESET) {
              setAcknowledged(false)
              setConfirming(true)
              return
            }
            void select(id)
          }}
          align="end"
          portal
          anchor={(
            <button type="button" aria-haspopup="menu" aria-expanded={open}
              disabled={busy || !state.writable || state.options.length === 0}
              onClick={() => { setOpen(value => !value) }}>
              {label}
              <IconChevronDownOutline14 />
            </button>
          )}
        />
      </div>
      <RiskConfirmation
        open={confirming}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!state.writable || state.status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setAcknowledged(false); setConfirming(false) }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirming(false)
          void select(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

/** Props of the current-Session switcher. */
export interface NativePermissionActionProps {
  /** Selected Session's permission controls, or undefined when none is served. */
  readonly controls: NativePermissionControls | undefined
  /** Whether the selected Session accepts a switch right now. */
  readonly ready: boolean
  /** Switch the selected Session's standing policy. */
  readonly select: (preset: string) => Promise<void>
  /** Namespace translator supplied by the caller. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Current-Session permission switcher.
 * @param props - the Session's controls, readiness, the switch verb, and the translator.
 * @returns the switcher, or null when no permission provider is installed.
 */
export function NativePermissionAction({ controls, ready, select, t }: NativePermissionActionProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => { if (!ready) setOpen(false) }, [ready])

  if (controls === undefined || !controls.available) return null
  const current = controls.options.find(option => option.value === controls.currentValue)
  const currentLabel = controls.currentValue === null
    ? t('unavailable')
    : displayPermissionPreset(controls.currentValue, current?.name ?? controls.currentValue, t)
  const choose = (value: string): void => {
    setOpen(false)
    if (value === controls.currentValue) return
    if (value === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setConfirming(true)
      return
    }
    void select(value)
  }
  return (
    <>
      <Menu
        open={open && ready}
        autoFocus
        compact
        items={controls.options.map(option => ({
          id: option.value,
          label: displayPermissionPreset(option.value, option.name, t),
          icon: <IconShieldOutline16 size={14} />,
        }))}
        selectedId={controls.currentValue ?? undefined}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        anchor={(
          <button type="button" title={current?.description} disabled={!ready}
            aria-label={t('title')} aria-expanded={open && ready}
            onClick={() => { setOpen(value => !value) }}>
            <IconShieldOutline16 size={14} />
            {currentLabel}
            <IconChevronDownOutline14 />
          </button>
        )}
      />
      <RiskConfirmation
        open={confirming}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!ready}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setAcknowledged(false); setConfirming(false) }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirming(false)
          void select(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

/** Native permission face: the Settings-backed default and the per-Session switch. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-permission-presets',
  targets: ['client'],
  requires: ['clientLocale', 'clientNativeSession'],
  provides: ['clientNativePermissionPresets'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) {
      throw new TypeError('native permission presets: this provider takes no configuration')
    }
    return (context) => {
      const locale = context.require('clientLocale')
      const client = context.require('clientNativeSession')
      context.own(locale.register(NS, { en, zh }))
      context.provide('clientNativePermissionPresets', createNativePermissionPresets(client, context.signal))
    }
  },
}
