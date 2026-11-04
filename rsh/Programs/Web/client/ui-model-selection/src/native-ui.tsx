/**
 * Native entrypoint for model selection.
 *
 * The Cordis half owns two entries over one per-Session directory: a `/model`
 * popup on `commandUi` and the composer's `conversation.input.model` seat.
 * Both read `ctx.remote.session.modelCatalog` and the Session's durable
 * selection projection, and both write through `session.selectModel`.
 *
 * A Native host answers those calls under different names — `modelControls`
 * returns the catalog, and the durable selection arrives through the Session
 * event log — so this entry rebuilds the same directory over the Native
 * Session client and publishes it as `clientNativeModelSelection`. The Native
 * application already renders the picker from `modelControls`, so this entry
 * adds no second picker; it owns the shared catalog and selection so an
 * independently installed module does not have to duplicate the fetch or the
 * compare-and-set.
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativeModelControls, NativeSessionClient } from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type {} from '@redspark/rsh-client-native-session/native'
import { notifySubscribers } from '@redspark/rsh-client-store'
import { en, zh, type ModelKey } from './client/locales.ts'

export { en, zh, type ModelKey } from './client/locales.ts'
/** Provider-owned catalog advertised by the selected Host. */
export type NativeModelCatalog = NonNullable<NativeModelControls['catalog']>

/** One Session-local model and effort choice, as the Host records it. */
export type NativeModelSelection = Parameters<NativeSessionClient['selectModel']>[1]

declare module '@redspark/rsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy. */
    model: ModelKey
  }
}

/** Dictionary namespace owned by this plugin, shared with the browser build. */
const NS = 'model'

/** One provider/model route a picker lists. */
export interface NativeModelRow {
  /** Opaque row id: `provider/model`, resolved by lookup and never parsed. */
  readonly id: string
  /** Provider id that serves the model. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Model display name. */
  readonly name: string
  /** Provider display name. */
  readonly providerName: string
  /** Optional model description, already localized by the adapter when it ships one. */
  readonly description?: string
  /** Adapter-owned reasoning efforts, when the model declares any. */
  readonly efforts?: readonly string[]
  /** Effort applied when the row is picked without an explicit one. */
  readonly defaultEffort?: string
}

/** Immutable model catalog read by a Native picker. */
export interface NativeModelCatalogState {
  /** Lifecycle of the last read. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Advertised groups, or null before the first successful read. */
  readonly catalog: NativeModelCatalog | null
  /** Diagnostic of the last failed read. */
  readonly error: string | null
  /** Whether the Host accepts a model switch for the selected Session. */
  readonly canSelect: boolean
}

/** The model catalog and selection face shared by Native Client modules. */
export interface NativeModelSelectionService {
  /** @returns the current catalog state. */
  getSnapshot(): NativeModelCatalogState
  /** @param listener - called after each published change. @returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Read the catalog once; a later call reuses the loaded value. */
  load(): Promise<NativeModelCatalogState>
  /** Drop the loaded value and read the Host again. */
  refresh(): Promise<void>
  /**
   * Persist one complete selection for a Session.
   * @param sessionId - Session whose next request uses the choice.
   * @param selection - provider, model, and optional adapter-owned effort.
   */
  select(sessionId: SessionId, selection: NativeModelSelection): Promise<void>
  /**
   * Flatten the loaded catalog into picker rows.
   * @param t - optional translator for the failure rows this plugin owns.
   * @returns one row per advertised model, then one row per failed provider.
   */
  rows(t?: (key: ModelKey, params?: Record<string, unknown>) => string): readonly NativeModelRow[]
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Model catalog and selection face for Native Client modules. */
    clientNativeModelSelection: NativeModelSelectionService
  }
}

type ModelClient = Pick<NativeSessionClient, 'modelControls' | 'selectModel'>

/**
 * Build the catalog and selection face over the Native Session client.
 *
 * The catalog is exactly what `modelControls` advertises; a failed read is
 * reported once and never silently replaced by an empty catalog, because an
 * empty list would look like a provider with no models.
 * @param client - the Native Session client.
 * @param signal - lifetime; aborting leaves the last published state.
 * @returns the service.
 */
export function createNativeModelSelection(client: ModelClient, signal: AbortSignal): NativeModelSelectionService {
  let state: NativeModelCatalogState = Object.freeze({
    status: 'idle', catalog: null, error: null, canSelect: false,
  })
  const listeners = new Set<() => void>()
  let inflight: Promise<NativeModelCatalogState> | undefined
  let disposed = false

  const publish = (next: NativeModelCatalogState): void => {
    state = Object.freeze(next)
    notifySubscribers(listeners, '[native-model-selection]')
  }

  const read = async (): Promise<NativeModelCatalogState> => {
    publish({ ...state, status: 'loading', error: null })
    try {
      const controls: NativeModelControls = await client.modelControls(signal)
      if (disposed) return state
      publish({
        status: 'ready', catalog: controls.catalog, error: null, canSelect: controls.canSelectModel,
      })
    } catch (error) {
      if (!disposed) {
        publish({
          status: 'error',
          catalog: state.catalog,
          error: error instanceof Error ? error.message : String(error),
          canSelect: false,
        })
      }
    }
    return state
  }

  const service: NativeModelSelectionService = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load() {
      if (state.status === 'ready' && state.catalog !== null) return Promise.resolve(state)
      inflight ??= read().finally(() => { inflight = undefined })
      return inflight
    },
    async refresh() {
      inflight = undefined
      await read()
    },
    async select(sessionId, selection) {
      await client.selectModel(sessionId, selection, signal)
    },
    rows(t) {
      const catalog = state.catalog
      if (catalog === null) return []
      const rows: NativeModelRow[] = []
      for (const group of catalog.groups) {
        for (const model of group.models) {
          rows.push({
            id: `${group.id}/${model.id}`,
            provider: group.id,
            model: model.id,
            name: model.name,
            providerName: group.name,
            ...model.description === undefined ? {} : { description: model.description },
            ...model.reasoning === undefined ? {} : {
              efforts: model.reasoning.efforts.map(effort => effort.id),
              ...model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort },
            },
          })
        }
      }
      for (const failure of catalog.failures) {
        rows.push({
          id: `failure/${failure.id}`,
          provider: failure.id,
          model: '',
          name: failure.name,
          providerName: failure.name,
          description: t === undefined ? failure.message : t('option.loadError', { message: failure.message }),
        })
      }
      return rows
    },
  }
  return service
}

/** Native model catalog: one Host-generation read shared by every selector. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-model-selection',
  targets: ['client'],
  requires: ['clientLocale', 'clientNativeSession'],
  provides: ['clientNativeModelSelection'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new TypeError('native model selection: this provider takes no configuration')
    return (context) => {
      const locale = context.require('clientLocale')
      const client = context.require('clientNativeSession')
      context.own(locale.register(NS, { en, zh }))
      context.provide('clientNativeModelSelection', createNativeModelSelection(client, context.signal))
    }
  },
}