/** Private snapshot owner for asynchronous GUI operations. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CreateTaskRequest, SchedulerOwner, SchedulerSnapshot } from '../gui-types.ts'

/** Domain operations consumed by the panel; transport errors reject. */
export interface SchedulerApi {
  deleteRun: (id: string) => Promise<SchedulerSnapshot>
  owners: () => Promise<SchedulerOwner[]>
  list: () => Promise<SchedulerSnapshot>
  create: (owner: SessionId, input: CreateTaskRequest) => Promise<SchedulerSnapshot>
  change: (id: string, action: 'pause' | 'resume' | 'delete') => Promise<SchedulerSnapshot>
}
/** Private observable GUI state; form drafts remain local to the component. */
export interface SchedulerView {
  owners: SchedulerOwner[]
  owner: SessionId | null
  data: SchedulerSnapshot | null
  busy: boolean
  error: string | null
  notice: 'created' | 'changed' | null
}
/**
 * Create one panel controller with serialized actions and unload-safe publication.
 * @param api - The mounted authenticated Remote adapter.
 * @returns Snapshot source, action callbacks and cleanup.
 */
export function createSchedulerController(api: SchedulerApi): {
  store: SnapshotStore<SchedulerView>
  refresh: () => Promise<boolean>
  select: (owner: SessionId) => Promise<boolean>
  create: (input: CreateTaskRequest) => Promise<boolean>
  change: (id: string, action: 'pause' | 'resume' | 'delete') => Promise<boolean>
  dispose: () => void
  deleteRun: (id: string) => Promise<boolean>
} {
  const store = createSnapshotStore<SchedulerView>({ owners: [], owner: null, data: null, busy: false, error: null, notice: null })
  let disposed = false
  let revision = 0
  let refreshing: Promise<boolean> | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const isDisposed = () => disposed
  async function run(work: () => Promise<void>): Promise<boolean> {
    if (disposed || store.getSnapshot().busy) return false
    revision++
    clearTimeout(noticeTimer)
    store.update((state) => { state.busy = true; state.error = null; state.notice = null })
    try { await work(); return !disposed }
    catch (error) {
      if (!isDisposed()) store.update((state) => { state.error = error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      if (!isDisposed()) {
        store.update((state) => { state.busy = false })
        if (store.getSnapshot().notice !== null) noticeTimer = setTimeout(() => {
          if (!disposed) store.update((state) => { state.notice = null })
        }, 3000)
      }
    }
  }
  const refresh = (): Promise<boolean> => {
    if (disposed || store.getSnapshot().busy) return Promise.resolve(false)
    if (refreshing) return refreshing
    const started = revision
    refreshing = (async () => {
      try {
        const [owners, data] = await Promise.all([api.owners(), api.list()])
        if (isDisposed() || started !== revision) return false
        const previous = store.getSnapshot().owner
        const owner = owners.find(item => item.id === previous)?.id ?? owners[0]?.id ?? null
        store.update((state) => {
          state.owners = owners; state.owner = owner; state.data = data
          if (owner !== null && state.error === 'Select an open session first') state.error = null
        })
        return true
      } catch (error) {
        if (!isDisposed() && started === revision) store.update((state) => {
          state.error = error instanceof Error ? error.message : String(error)
        })
        return false
      } finally { refreshing = undefined }
    })()
    return refreshing
  }
  const select = (owner: SessionId) => run(async () => {
    const data = await api.list()
    if (!disposed) store.update((state) => { state.owner = owner; state.data = data })
  })
  const create = (input: CreateTaskRequest) => run(async () => {
    const previous = store.getSnapshot().owner
    const owners = await api.owners()
    const owner = owners.find(item => item.id === previous)?.id ?? owners[0]?.id ?? null
    if (disposed) return
    store.update((state) => { state.owners = owners; state.owner = owner })
    if (owner === null) throw new Error('Select an open session first')
    await api.create(owner, input)
    const data = await api.list()
    if (!isDisposed()) store.update((state) => { state.data = data; state.notice = 'created' })
  })
  const change = (id: string, action: 'pause' | 'resume' | 'delete') => run(async () => {
    const data = await api.change(id, action)
    if (!disposed) store.update((state) => { state.data = data; state.notice = 'changed' })
  })
  const deleteRun = (id: string) => run(async () => {
    const data = await api.deleteRun(id)
    if (!disposed) store.update((state) => { state.data = data })
  })
  return { store, refresh, select, create, change, deleteRun, dispose: () => { disposed = true; clearTimeout(noticeTimer) } }
}
