/**
 * The Models page's settings-document read over the Native transport.
 *
 * The browser build reads the document through ui-settings' shared mirror,
 * which merges concurrent invalidations and folds write answers in without a
 * re-read. A Native page needs the same fold over `clientNativeSession`, and
 * nothing else: one `settingsDescribe` call answers the whole document.
 */

import { createSnapshotStore, type SnapshotStore } from '@redspark/rsh-client-store'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@redspark/rsh-client-native-session/native'
import type { ModelsDescribeFace, ModelsDescribeSnapshot, SettingsNamespaceView } from './client/ports.ts'
import { toNamespaceView } from './native-ports.ts'

/** Native Session methods the describe face drives. */
export type NativeDescribeClient = Pick<NativeSessionClient, 'settingsDescribe'>

/**
 * Project Host descriptors onto the wire-shaped document a Settings page reads.
 * @param descriptors - redacted descriptors returned by one `settingsDescribe`.
 * @param writable - whether the Host accepts writes for this document.
 * @returns the describe view, or undefined when the Host serves no namespace.
 */
export function toDescribeView(
  descriptors: readonly NativeSettingsDescriptor[],
  writable: boolean,
): { namespaces: readonly SettingsNamespaceView[]; writable: boolean; hasDocument: boolean } | undefined {
  return {
    namespaces: descriptors.map(toNamespaceView),
    writable,
    hasDocument: descriptors.length > 0,
  }
}

/**
 * Bind the Native settings document read as the page's describe face.
 *
 * Concurrent reads fold into the in-flight one plus a single rerun, so an
 * invalidation arriving mid-read is neither lost nor duplicated.
 * @param client - the Native Session client.
 * @param signal - the composition's lifetime.
 * @returns the describe face the page store reads.
 */
export function createNativeDescribeFace(
  client: NativeDescribeClient,
  signal: AbortSignal,
): ModelsDescribeFace {
  const store: SnapshotStore<ModelsDescribeSnapshot> = createSnapshotStore<ModelsDescribeSnapshot>({
    status: 'idle', view: undefined, error: null,
  })
  let inFlight: Promise<void> | undefined
  let rerun = false

  const run = async (): Promise<void> => {
    try {
      do {
        const before = store.getSnapshot()
        if (before.status === 'idle') store.set({ ...before, status: 'loading' })
        rerun = false
        try {
          const described = await client.settingsDescribe(signal)
          // A namespace is writable exactly when the Host exposed one: the
          // Native Host refuses a write to a namespace it does not serve.
          const view = toDescribeView(described.namespaces, described.namespaces.length > 0)
          if (view === undefined) {
            const held = store.getSnapshot()
            store.set({ status: held.view === undefined ? 'idle' : 'ready', view: held.view, error: null })
          } else {
            store.set({ status: 'ready', view, error: null })
          }
        } catch (error: unknown) {
          const held = store.getSnapshot()
          // No answer yet: fall back to idle so `ensure` retries; with one, the
          // held view keeps serving and only the error field reports the miss.
          store.set({
            status: held.view === undefined ? 'idle' : 'ready',
            view: held.view,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } while (shouldRerun())
    } finally {
      inFlight = undefined
    }
  }

  // Read through a call so the loop condition is not narrowed to the value the
  // assignment above just stored: a `load()` landing mid-read must still rerun.
  const shouldRerun = (): boolean => rerun

  const load = (): Promise<void> => {
    if (inFlight !== undefined) {
      rerun = true
      return inFlight
    }
    const started = Promise.resolve().then(run)
    inFlight = started
    return started
  }

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    ensure: () => {
      if (inFlight !== undefined) return inFlight
      if (store.getSnapshot().status === 'idle') return load()
      return Promise.resolve()
    },
    acceptView: (view) => {
      const before = store.getSnapshot()
      if (before.view === undefined) return
      const namespaces = before.view.namespaces.some(row => row.ns === view.ns)
        ? before.view.namespaces.map(row => row.ns === view.ns ? view : row)
        : [...before.view.namespaces, view]
      store.set({ ...before, view: { ...before.view, namespaces } })
    },
  }
}
