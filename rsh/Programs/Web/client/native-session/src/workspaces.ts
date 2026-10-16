/** Browser Workspace and directory-picker Consumers over the native Connection. */
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'
import { NativeSessionRpcError } from './rpc-error.ts'

/** Workspace row projected by the Host registry. */
export interface NativeWorkspace {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly sessionIds: readonly SessionId[]
}

/** Complete reconnect state for the Host Workspace registry. */
export interface NativeWorkspaceBaseline {
  readonly workspaces: readonly NativeWorkspace[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One Workspace registry update after a baseline. */
export type NativeWorkspaceFrame =
  | { readonly type: 'baseline'; readonly value: NativeWorkspaceBaseline }
  | { readonly type: 'upsert'; readonly workspace: NativeWorkspace }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Directory row that the browser may enter or select. */
export interface NativeDirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/** One directory level and its filesystem ancestry. */
export interface NativeDirectoryListing {
  readonly path: string
  readonly entries: readonly NativeDirectoryEntry[]
  readonly crumbs: readonly { readonly name: string; readonly path: string }[]
}

/** Native Workspace commands and the authoritative registry change stream. */
export interface NativeWorkspaceClient {
  /** @param signal - caller cancellation.
   * @returns registry order and every archived Session id.
   */
  list(signal?: AbortSignal): Promise<NativeWorkspaceBaseline>
  /** @param signal - generation cancellation.
   * @returns a complete baseline followed by ordered Host changes.
   */
  follow(signal: AbortSignal): AsyncIterable<NativeWorkspaceFrame>
  /** @param input - existing directory to register.
   * @param signal - caller cancellation.
   * @returns the canonical Workspace row and whether this call created it.
   */
  create(
    input: { readonly path: string; readonly trust?: boolean }, signal?: AbortSignal,
  ): Promise<{ readonly workspace: NativeWorkspace; readonly created: boolean }>
  /** @param workspaceId - registered Workspace.
   * @param title - proposed display title.
   * @param signal - caller cancellation.
   * @returns the updated Workspace row.
   */
  rename(workspaceId: WorkspaceId, title: string, signal?: AbortSignal): Promise<NativeWorkspace>
  /** @param workspaceId - registration to remove.
   * @param signal - caller cancellation.
   * @returns resolution after the Workspace record is removed.
   */
  delete(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<void>
  /** @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - optional Workspace anchor; omission appends.
   * @param signal - caller cancellation.
   * @returns the complete Host Workspace order.
   */
  reorder(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId, signal?: AbortSignal): Promise<readonly WorkspaceId[]>
  /** @param workspaceId - owning Workspace.
   * @param sessionId - accounted Session to move.
   * @param beforeSessionId - optional Session anchor; omission appends.
   * @param signal - caller cancellation.
   * @returns the updated Workspace row.
   */
  reorderSession(
    workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId, signal?: AbortSignal,
  ): Promise<NativeWorkspace>
  /** @param sessionId - known Session to hide from grouping views.
   * @param signal - caller cancellation.
   * @returns the complete Host archive set.
   */
  archiveSession(sessionId: SessionId, signal?: AbortSignal): Promise<readonly SessionId[]>
  /** @param query - case-insensitive literal title or path search.
   * @param signal - caller cancellation.
   * @returns matching Workspace ids in registry order.
   */
  search(query: string, signal?: AbortSignal): Promise<readonly WorkspaceId[]>
  /** @param workspaceId - registered Workspace to open.
   * @param signal - caller cancellation.
   * @returns a reusable blank Session or a newly created blank Session id.
   */
  connectWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal, trust?: boolean): Promise<{ readonly sessionId: SessionId }>
  /** @returns completion after active follow requests have been cancelled. */
  close(): Promise<void>
}

/** Directory chooser and in-app directory browser operations. */
export interface NativeDirectoryPickerClient {
  /** @param signal - caller cancellation.
   * @returns the selected directory, or null when the operator cancels.
   */
  pick(signal?: AbortSignal): Promise<string | null>
  /** @param path - absolute directory; omission lists the host home directory.
   * @param signal - caller cancellation.
   * @returns direct children and filesystem breadcrumbs.
   */
  list(path?: string, signal?: AbortSignal): Promise<NativeDirectoryListing>
  /** @param path - absolute existing parent directory.
   * @param name - one child directory name.
   * @param signal - caller cancellation.
   * @returns the created absolute path.
   */
  createDirectory(path: string, name: string, signal?: AbortSignal): Promise<string>
}

const workspaceSchema = z.strictObject({
  workspaceId: z.string(), path: z.string(), title: z.string(), createdAt: z.string(), updatedAt: z.string(),
  sessionIds: z.array(z.string()),
})
const baselineSchema = z.strictObject({ workspaces: z.array(workspaceSchema), archivedSessionIds: z.array(z.string()) })
const frameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('baseline'), value: baselineSchema }),
  z.strictObject({ type: z.literal('upsert'), workspace: workspaceSchema }),
  z.strictObject({ type: z.literal('remove'), workspaceId: z.string() }),
  z.strictObject({ type: z.literal('order'), workspaceIds: z.array(z.string()) }),
  z.strictObject({ type: z.literal('archived'), archivedSessionIds: z.array(z.string()) }),
])
const directoryEntrySchema = z.strictObject({ name: z.string(), path: z.string(), kind: z.enum(['directory', 'file']) })
const directorySchema = z.strictObject({
  path: z.string(), entries: z.array(directoryEntrySchema), crumbs: z.array(z.strictObject({ name: z.string(), path: z.string() })),
})

function workspace(value: unknown): NativeWorkspace {
  const parsed = workspaceSchema.parse(value)
  return {
    ...parsed,
    workspaceId: brandString<WorkspaceId>(parsed.workspaceId),
    sessionIds: parsed.sessionIds.map(id => brandString<SessionId>(id)),
  }
}

function baseline(value: unknown): NativeWorkspaceBaseline {
  const parsed = baselineSchema.parse(value)
  return {
    workspaces: parsed.workspaces.map(workspace),
    archivedSessionIds: parsed.archivedSessionIds.map(id => brandString<SessionId>(id)),
  }
}

function frame(value: unknown): NativeWorkspaceFrame {
  const parsed = frameSchema.parse(value)
  switch (parsed.type) {
    case 'baseline': return { type: 'baseline', value: baseline(parsed.value) }
    case 'upsert': return { type: 'upsert', workspace: workspace(parsed.workspace) }
    case 'remove': return { type: 'remove', workspaceId: brandString<WorkspaceId>(parsed.workspaceId) }
    case 'order': return { type: 'order', workspaceIds: parsed.workspaceIds.map(id => brandString<WorkspaceId>(id)) }
    case 'archived': return { type: 'archived', archivedSessionIds: parsed.archivedSessionIds.map(id => brandString<SessionId>(id)) }
  }
}

/** Create the Workspace and directory clients over the selected Connection RPC.
 * @param rpc - authenticated client transport shared by the native Session Consumer.
 * @param maxFollowBufferChars - maximum SSE event size accepted from the Host.
 * @param installationSignal - optional Client installation lifetime.
 * @returns the Workspace and directory-picking Consumers.
 */
export function createNativeWorkspaceClients(
  rpc: ClientConnectionRpc, maxFollowBufferChars: number, installationSignal?: AbortSignal,
): { readonly workspace: NativeWorkspaceClient; readonly directoryPicker: NativeDirectoryPickerClient } {
  const shutdown = new AbortController()
  const lifetime = installationSignal === undefined ? shutdown.signal : AbortSignal.any([installationSignal, shutdown.signal])
  const pendingFollows = new Set<Promise<void>>()

  const accepted = (signal?: AbortSignal): AbortSignal => signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
  async function call<T>(endpoint: string, payload: object, signal?: AbortSignal): Promise<T> {
    const result = await rpc.call('/api', endpoint, payload, accepted(signal))
    if (!result.ok) throw new NativeSessionRpcError(result.error.code, result.error.message, result.error.details)
    return result.value as T
  }

  const workspaceClient: NativeWorkspaceClient = {
    list: async signal => baseline(await call('workspaces/list', {}, signal)),
    async *follow(signal) {
      const responseOperation = rpc.response
      if (responseOperation === undefined) throw new Error('native Workspace Client: selected carrier has no Fetch response operation')
      const following = accepted(signal)
      const completion = Promise.withResolvers<void>()
      pendingFollows.add(completion.promise)
      const finish = (): void => {
        completion.resolve()
        pendingFollows.delete(completion.promise)
      }
      following.addEventListener('abort', finish, { once: true })
      if (following.aborted) finish()
      try {
        const response = await responseOperation('/api', 'workspaces/follow', {}, following)
        if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
          throw new Error(`native Workspace follow: invalid response HTTP ${response.status}`)
        }
        let sawBaseline = false
        const events = response.body.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream({ maxBufferSize: maxFollowBufferChars, onError: 'terminate' }))
        for await (const { data } of events) {
          const next = frame(JSON.parse(data))
          if (!sawBaseline && next.type !== 'baseline') throw new Error('native Workspace follow: first frame is not a baseline')
          if (next.type === 'baseline') sawBaseline = true
          yield next
        }
        if (!following.aborted) throw new Error('native Workspace follow: response ended before cancellation')
      } catch (error: unknown) {
        if (!following.aborted) throw error
      } finally {
        following.removeEventListener('abort', finish)
        finish()
      }
    },
    async create(input, signal) {
      const result = await call<{ workspace: unknown; created: boolean }>('workspaces/create', input, signal)
      return { workspace: workspace(result.workspace), created: z.boolean().parse(result.created) }
    },
    async rename(workspaceId, title, signal) {
      return workspace(await call('workspaces/rename', { workspaceId, title }, signal))
    },
    async delete(workspaceId, signal) {
      await call('workspaces/delete', { workspaceId }, signal)
    },
    async reorder(workspaceId, beforeWorkspaceId, signal) {
      const result = await call<{ workspaceIds: string[] }>('workspaces/reorder', {
        workspaceId, ...beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId },
      }, signal)
      return z.array(z.string()).parse(result.workspaceIds).map(id => brandString<WorkspaceId>(id))
    },
    async reorderSession(workspaceId, sessionId, beforeSessionId, signal) {
      const result = await call<unknown>('workspaces/reorder-session', {
        workspaceId, sessionId, ...beforeSessionId === undefined ? {} : { beforeSessionId },
      }, signal)
      return workspace(result)
    },
    async archiveSession(sessionId, signal) {
      const result = await call<{ archivedSessionIds: string[] }>('workspaces/archive-session', { sessionId }, signal)
      return z.array(z.string()).parse(result.archivedSessionIds).map(id => brandString<SessionId>(id))
    },
    async search(query, signal) {
      const result = await call<{ workspaceIds: string[] }>('workspaces/search', { query }, signal)
      return z.array(z.string()).parse(result.workspaceIds).map(id => brandString<WorkspaceId>(id))
    },
    async connectWorkspace(workspaceId, signal, trust) {
      const result = await call<{ sessionId: string }>('workspaces/connect', {
        workspaceId, ...trust === undefined ? {} : { trust },
      }, signal)
      return { sessionId: brandString<SessionId>(z.string().min(1).parse(result.sessionId)) }
    },
    async close() {
      shutdown.abort(new Error('native Workspace Client: disposed'))
      while (pendingFollows.size > 0) await Promise.allSettled([...pendingFollows])
    },
  }

  const directoryPickerClient: NativeDirectoryPickerClient = {
    async pick(signal) {
      return z.string().nullable().parse(await call('directories/pick', {}, signal))
    },
    async list(path, signal) {
      return directorySchema.parse(await call('directories/list', path === undefined ? {} : { path }, signal))
    },
    async createDirectory(path, name, signal) {
      return z.string().parse(await call('directories/create-directory', { path, name }, signal))
    },
  }
  return { workspace: workspaceClient, directoryPicker: directoryPickerClient }
}
