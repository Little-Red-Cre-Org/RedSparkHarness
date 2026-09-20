/** Application-scoped inbox polling; it runs even while Settings is closed. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TaskNotice } from '../gui-types.ts'

/** Observable reminder state owned by this plugin mount. */
export interface NoticeView {
  items: TaskNotice[]
  open: boolean
  error: string | null
}
/** Injectable transport and presentation callbacks for reminder delivery. */
export interface NoticeApi {
  dismiss?: (id: string) => void
  list: () => Promise<TaskNotice[]>
  acknowledge: (id: string) => Promise<TaskNotice[]>
  remove: (id: string) => Promise<TaskNotice[]>
  notify: (item: TaskNotice, open: () => void) => void
}
/**
 * Poll committed notices with one in-flight operation and no repeated popups per mount.
 * @param api - Authenticated transport plus best-effort native notification callback.
 * @returns Observable inbox, acknowledgement actions and lifecycle controls.
 */
export function createNoticeController(api: NoticeApi): {
  store: SnapshotStore<NoticeView>
  start: () => void
  refresh: () => Promise<void>
  acknowledge: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  open: () => void
  close: () => void
  dispose: () => void
} {
  const store = createSnapshotStore<NoticeView>({ items: [], open: false, error: null })
  const seen = new Map<string, TaskNotice['phase']>()
  let disposed = false
  const isDisposed = (): boolean => disposed
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const open = (): void => { if (!disposed) store.update((s) => { s.open = true }) }
  const publish = (items: TaskNotice[]): void => {
    if (disposed) return
    // One inbox card per recurring plan; occurrence IDs still own acknowledgement
    // and delivery, so acknowledging one cycle never suppresses the next.
    const grouped = new Map<string, TaskNotice>()
    for (const item of items) {
      const key = item.recurring && item.taskId ? `task:${item.taskId}` : item.id
      const previous = grouped.get(key)
      const latest = !previous || item.time > previous.time ? item : previous
      grouped.set(key, { ...latest, occurrenceCount: (previous?.occurrenceCount ?? 0) + 1 })
    }
    items = [...grouped.values()]
    const fresh = items.filter(item => !item.read && !seen.has(item.id))
    const changed = items.filter(item => seen.has(item.id) && seen.get(item.id) !== item.phase)
    for (const item of items) seen.set(item.id, item.phase)
    // Retention owns the bound; retired receipt identities need not stay in memory.
    const retained = new Set(items.map(item => item.id))
    for (const id of seen.keys()) if (!retained.has(id)) { api.dismiss?.(id); seen.delete(id) }
    store.update((s) => {
      s.items = items.filter(item => !item.dismissed)
      s.error = null
      if (!s.items.length) s.open = false
      if (fresh.some(item => !item.dismissed)) s.open = true
    })
    for (const item of [...fresh, ...changed]) {
      if (item.dismissed && item.phase === 'due') continue
      try { api.notify(item, open) } catch { /* The durable in-app reminder remains visible. */ }
    }
  }
  const run = async (operation: () => Promise<TaskNotice[]>): Promise<void> => {
    if (disposed || busy) return
    busy = true
    try { publish(await operation()) }
    catch (error) { if (!isDisposed()) store.update((s) => { s.error = error instanceof Error ? error.message : String(error) }) }
    finally { busy = false }
  }
  const refresh = (): Promise<void> => run(api.list)
  const tick = async (): Promise<void> => {
    await refresh()
    if (!disposed) timer = setTimeout(() => { void tick() }, 500)
  }
  return { store, refresh, open, close: () => { store.update((s) => { s.open = false }) },
    acknowledge: id => run(() => api.acknowledge(id)),
    remove: id => run(() => api.remove(id)),
    start: () => { if (!timer && !disposed) { timer = setTimeout(() => { void tick() }, 0) } },
    dispose: () => { disposed = true; clearTimeout(timer) },
  }
}
