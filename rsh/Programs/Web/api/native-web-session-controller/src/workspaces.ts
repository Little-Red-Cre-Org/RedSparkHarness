/** Authenticated native Workspace operations over the existing registry and Session executor. */
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeActiveSessionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import { SessionId as sessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'
import { WorkspaceId as workspaceId, workspaceDomainState, workspaceRecord } from '@deepseek-ai/dsh-workspace/native'
import type { Workspace, WorkspaceRegistryRuntime } from '@deepseek-ai/dsh-workspace/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import type { NativeWorkspace, NativeWorkspaceBaseline, NativeWorkspaceFrame } from '@deepseek-ai/dsh-client-native-session/workspaces'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain/native'
import type { NativeSettingsScope, NativeSettingsSection } from '@deepseek-ai/dsh-settings-definition/native'
import { z } from 'zod'

const empty = z.strictObject({})
const createRequest = z.strictObject({ path: z.string().min(1), trust: z.boolean().optional() })
const renameRequest = z.strictObject({ workspaceId: z.string().min(1), title: z.string().trim().min(1) })
const deleteRequest = z.strictObject({ workspaceId: z.string().min(1) })
const reorderRequest = z.strictObject({ workspaceId: z.string().min(1), beforeWorkspaceId: z.string().min(1).optional() })
const reorderSessionRequest = z.strictObject({
  workspaceId: z.string().min(1), sessionId: z.string().min(1), beforeSessionId: z.string().min(1).optional(),
})
const archiveRequest = z.strictObject({ sessionId: z.string().min(1) })
const searchRequest = z.strictObject({ query: z.string() })
const connectRequest = z.strictObject({ workspaceId: z.string().min(1), trust: z.boolean().optional() })
const userVisibleErrors = new Set([
  'Workspace path must be absolute',
  'Workspace path must be an existing absolute directory',
  'Workspace title is already in use',
  'Workspace was not found',
  'Workspace route capacity is exhausted',
  'Workspace directory is unavailable',
])

/** Persisted canonical paths approved for dynamic Workspace routes. */
export interface NativeWorkspaceTrustSettings {
  readonly paths: readonly string[]
}

/** Validate absolute Workspace paths stored in the native Settings namespace.
 * @param value - merged namespace values.
 * @returns resolved trust paths, empty when none are configured.
 */
export function resolveNativeWorkspaceTrustSettings(value: NativeSettingsSection): NativeWorkspaceTrustSettings {
  for (const key of Object.keys(value)) {
    if (key !== 'paths') throw new TypeError(`workspace-trust: unknown field "${key}"`)
  }
  const paths: unknown = value.paths ?? []
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !isAbsolute(path))) {
    throw new TypeError('workspace-trust: paths must contain absolute directories')
  }
  return { paths: paths as string[] }
}

const within = (root: string, path: string): boolean => {
  const difference = relative(root, path)
  return difference === '' || !isAbsolute(difference) && difference !== '..'
    && !difference.startsWith('../') && !difference.startsWith('..\\')
}

/** Mirror the legacy list rule for a reusable blank Session. */
function blank(events: readonly SessionEvent[]): boolean {
  return !events.some(event => event.type === 'turn/start'
    || event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'task-scheduler' && event.data.source.form === 'notice')
}

/** Owns the queue for one authenticated Workspace follow request. */
class WorkspaceEventQueue implements AsyncIterator<NativeWorkspaceFrame> {
  private readonly frames: NativeWorkspaceFrame[] = []
  private waiter: ((result: IteratorResult<NativeWorkspaceFrame>) => void) | undefined
  private closed = false

  next(): Promise<IteratorResult<NativeWorkspaceFrame>> {
    const frame = this.frames.shift()
    if (frame !== undefined) return Promise.resolve({ done: false, value: frame })
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => { this.waiter = resolve })
  }

  push(frame: NativeWorkspaceFrame): void {
    if (this.closed) return
    const waiter = this.waiter
    if (waiter === undefined) this.frames.push(frame)
    else {
      this.waiter = undefined
      waiter({ done: false, value: frame })
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.frames.length = 0
    this.waiter?.({ done: true, value: undefined })
    this.waiter = undefined
  }
}

/** Project one registry entity into the browser Workspace row. */
function workspaceView(value: Workspace): NativeWorkspace {
  return {
    workspaceId: value.id, path: value.path, title: value.title,
    createdAt: value.createdAt, updatedAt: value.updatedAt, sessionIds: [...value.sessionIds],
  }
}

function recordView(id: string, value: unknown): NativeWorkspace {
  const record = workspaceRecord.parse(value)
  return {
    workspaceId: workspaceId(id), path: record.path, title: record.title,
    createdAt: record.createdAt, updatedAt: record.updatedAt, sessionIds: [...record.sessionIds],
  }
}

/** Host RPC owner for Workspace list, mutations, blank Session connection and follow. */
export class NativeWebWorkspaceService {
  private readonly followers = new Map<WorkspaceEventQueue, () => void>()
  private readonly knownIds: Set<string>
  private order: readonly string[]
  private archived: readonly string[]
  private readonly unsubscribe: () => Promise<void>
  private operationTail: Promise<void> = Promise.resolve()

  /** @param context - Native event subscriptions and Host lifetime.
   * @param registry - selected durable Workspace registry.
   * @param executor - existing Program Session executor and route authority.
   * @param persistence - selected Session history authority.
   * @param active - exact live Session ownership authority.
   * @param trustSettings - persisted operator-approved Workspace paths.
   * @param maxHistoryEvents - limit for blank Session reuse checks.
   * @param maxFollowers - maximum concurrent Workspace follow requests.
   */
  constructor(
    private readonly context: Pick<NativeContext, 'on' | 'signal'>,
    private readonly registry: WorkspaceRegistryRuntime,
    private readonly executor: NativeHeadlessApplication,
    private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations,
    private readonly baseRouteId: NativeRootRouteId,
    private readonly trustSettings: NativeSettingsScope<NativeWorkspaceTrustSettings> | undefined,
    private readonly maxHistoryEvents: number,
    private readonly maxFollowers: number,
  ) {
    const initial = registry.list()
    this.knownIds = new Set(initial.map(value => String(value.id)))
    this.order = initial.map(value => String(value.id))
    this.archived = registry.archivedSessionIds.map(String)
    this.unsubscribe = context.on('domain/changed', (change) => { this.changed(change) })
  }

  /** @returns current Workspace rows in Host order and the complete archive set. */
  list(): NativeWorkspaceBaseline {
    return {
      workspaces: this.registry.list().map(workspaceView),
      archivedSessionIds: [...this.registry.archivedSessionIds],
    }
  }

  /** Handle one authenticated Workspace command.
   * @param endpoint - Workspace RPC endpoint.
   * @param payload - decoded but untrusted request fields.
   * @param signal - carrier cancellation.
   * @returns Host result with stable trust and system-directory codes, or the existing Workspace error code and allowlisted message.
   */
  async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    let requestPath: string | undefined
    try {
      signal.throwIfAborted()
      if (endpoint === 'workspaces/list') {
        empty.parse(payload)
        return { ok: true, value: this.list() }
      }
      if (endpoint === 'workspaces/create') {
        const request = createRequest.parse(payload)
        requestPath = request.path
        return { ok: true, value: await this.enqueue(signal, async () => {
          const path = await realpath(request.path)
          requestPath = path
          // Trust applies only to the exact canonical path the user confirmed; a changed target asks again.
          if (request.trust === true && path !== request.path) throw new Error('Workspace is outside the configured allowed roots')
          const existing = await this.registry.resolveByPath(path)
          const trusted = request.trust === true || this.trusted(path)
          const rootExecution = this.executor.rootExecution
          if (rootExecution.createWorkspaceRoute === undefined) throw new Error('Workspace route creation is unavailable')
          const route = await rootExecution.createWorkspaceRoute({ baseRoute: this.baseRouteId, path, trusted }, signal)
          if (route.workspaceId === undefined) throw new Error('Workspace was not found')
          const created = this.registry.get(route.workspaceId)
          if (created === undefined) throw new Error('Workspace was not found')
          if (request.trust === true) await this.rememberTrust(path)
          return { workspace: workspaceView(created), created: existing === undefined }
        }) }
      }
      if (endpoint === 'workspaces/rename') {
        const request = renameRequest.parse(payload)
        return { ok: true, value: await this.enqueue(signal, async () => {
          const id = workspaceId(request.workspaceId)
          const workspace = this.requireWorkspace(id)
          if (this.registry.list().some(candidate => candidate.id !== id && candidate.title === request.title)) {
            throw new Error('Workspace title is already in use')
          }
          if (workspace.title !== request.title) await workspace.setTitle(request.title)
          return workspaceView(workspace)
        }) }
      }
      if (endpoint === 'workspaces/delete') {
        const request = deleteRequest.parse(payload)
        return { ok: true, value: await this.enqueue(signal, async () => {
          const workspace = this.requireWorkspace(workspaceId(request.workspaceId))
          const route = this.executor.rootExecution.workspaceRoutes().find(candidate => candidate.workspaceId === workspace.id)
          if (route !== undefined) {
            for (const owner of this.active.owners()) {
              if (owner.invocation !== 'root' || this.executor.rootExecution.capture(owner).id !== route.id) continue
              await this.executor.rootExecution.releaseIdle({ route: route.id, id: owner.session.id, expectedOwner: owner }, signal)
            }
            await this.executor.rootExecution.releaseWorkspace(route.id, signal)
          }
          if (!await this.registry.delete(workspace.id)) throw new Error('Workspace was not found')
          return { deleted: true }
        }) }
      }
      if (endpoint === 'workspaces/reorder') {
        const request = reorderRequest.parse(payload)
        const workspaceIds = await this.registry.insertBefore(
          workspaceId(request.workspaceId), request.beforeWorkspaceId === undefined ? undefined : workspaceId(request.beforeWorkspaceId),
        )
        return { ok: true, value: { workspaceIds: [...workspaceIds] } }
      }
      if (endpoint === 'workspaces/reorder-session') {
        const request = reorderSessionRequest.parse(payload)
        const workspace = this.requireWorkspace(workspaceId(request.workspaceId))
        await workspace.insertSessionBefore(sessionId(request.sessionId),
          request.beforeSessionId === undefined ? undefined : sessionId(request.beforeSessionId))
        return { ok: true, value: workspaceView(workspace) }
      }
      if (endpoint === 'workspaces/archive-session') {
        const request = archiveRequest.parse(payload)
        await this.registry.archiveSession(sessionId(request.sessionId), signal)
        return { ok: true, value: { archivedSessionIds: [...this.registry.archivedSessionIds] } }
      }
      if (endpoint === 'workspaces/search') {
        const request = searchRequest.parse(payload)
        const query = request.query.toLowerCase()
        const workspaceIds = this.registry.list().filter(workspace =>
          workspace.title.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query),
        ).map(workspace => workspace.id)
        return { ok: true, value: { workspaceIds } }
      }
      if (endpoint === 'workspaces/connect') {
        const request = connectRequest.parse(payload)
        return { ok: true, value: await this.enqueue(signal, () => {
          const workspace = this.requireWorkspace(workspaceId(request.workspaceId))
          requestPath = workspace.path
          return this.connectWorkspace(workspace, request.trust === true, signal)
        }) }
      }
      throw new Error('Unsupported Workspace request')
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Workspace is outside the configured allowed roots') {
        return { ok: false, error: { code: 'native/workspace-untrusted', message: error.message, details: { path: requestPath } } }
      }
      if (error instanceof Error && error.message === 'Workspace is a protected system directory') {
        return { ok: false, error: { code: 'native/workspace-forbidden', message: error.message, details: {} } }
      }
      const message = error instanceof Error && userVisibleErrors.has(error.message)
        ? error.message : 'Workspace request failed.'
      return { ok: false, error: { code: 'native/workspaces', message, details: {} } }
    }
  }

  /** Stream a complete Workspace baseline followed by committed domain changes.
   * @param request - authenticated empty Fetch request.
   * @returns an SSE response that closes when the caller or Host disconnects.
   */
  async follow(request: Request): Promise<Response> {
    try { empty.parse(await request.json()) } catch {
      return Response.json({ ok: false, error: { code: 'native/workspaces', message: 'Workspace request failed.', details: {} } }, { status: 400 })
    }
    const signal = AbortSignal.any([request.signal, this.context.signal])
    signal.throwIfAborted()
    if (this.followers.size >= this.maxFollowers) return new Response('native Workspace follow: capacity reached', { status: 429 })
    const queue = new WorkspaceEventQueue()
    const stop = (): void => {
      queue.close()
      this.followers.delete(queue)
      signal.removeEventListener('abort', stop)
    }
    this.followers.set(queue, stop)
    queue.push({ type: 'baseline', value: this.list() })
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await queue.next()
        if (next.done) {
          stop()
          controller.close()
        } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      cancel() { stop() },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }

  /** Release the domain listener and every open follow request.
   * @returns completion after admitted listener callbacks drain.
   */
  async close(): Promise<void> {
    for (const stop of this.followers.values()) stop()
    await this.unsubscribe()
  }

  private async connectWorkspace(workspace: Workspace, trust: boolean, signal: AbortSignal): Promise<{ sessionId: SessionId }> {
    const routeId = await this.workspaceRouteId(workspace.id, trust || this.trusted(workspace.path), signal)
    if (trust) await this.rememberTrust(workspace.path)
    for (const candidate of workspace.sessionIds) {
      if (this.registry.archivedSessionIds.includes(candidate)) continue
      const history = await readNativeSessionHistory(candidate, {
        active: this.active, persistence: this.persistence, maxHistoryEvents: this.maxHistoryEvents,
        label: 'native Workspace connection',
        onCleanupFailure: () => {},
      }, signal)
      if (history.header.cwd !== workspace.path || !blank(history.events)) continue
      if (!this.active.owners().some(owner => owner.session.id === candidate)) {
        await this.executor.executeSessionOperation(
          { id: candidate, resume: true, route: routeId }, () => Promise.resolve(undefined), signal,
        )
      }
      return { sessionId: candidate }
    }
    const idForSession = sessionId(randomUUID())
    await this.executor.executeSessionOperation(
      { id: idForSession, resume: false, route: routeId }, () => Promise.resolve(undefined), signal,
    )
    await workspace.attachSession(idForSession)
    return { sessionId: idForSession }
  }

  private async workspaceRouteId(id: WorkspaceId, trusted: boolean, signal: AbortSignal) {
    const route = this.executor.rootExecution.workspaceRoutes().find(candidate => candidate.workspaceId === id)
    if (route !== undefined) return route.id
    return (await this.executor.rootExecution.selectWorkspace({ baseRoute: this.baseRouteId, workspaceId: id, trusted }, signal)).id
  }

  /** @param path - canonical Workspace path.
   * @returns whether a persisted trust path covers it.
   */
  trusted(path: string): boolean {
    return this.trustSettings?.get().paths.some(root => within(root, path)) ?? false
  }

  /** Persist a confirmed path only after route admission accepted it, so forbidden paths never become trusted. */
  private async rememberTrust(path: string): Promise<void> {
    const settings = this.trustSettings
    if (settings === undefined || settings.get().paths.includes(path)) return
    await settings.replace({ paths: [...settings.get().paths, path] }, settings.revision)
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      const state = workspaceDomainState.parse(change.value)
      const nextOrder = state.workspaceIds.map(String)
      for (const id of state.workspaceIds) {
        if (this.knownIds.has(id)) continue
        const workspace = this.registry.get(id)
        if (workspace === undefined) throw new Error(`Workspace order references missing id ${id}`)
        this.knownIds.add(id)
        this.publish({ type: 'upsert', workspace: workspaceView(workspace) })
      }
      if (this.order.some((id, index) => id !== nextOrder[index]) || this.order.length !== nextOrder.length) {
        this.order = nextOrder
        this.publish({ type: 'order', workspaceIds: [...state.workspaceIds] })
      }
      const nextArchived = state.archivedSessionIds.map(String)
      if (this.archived.some((id, index) => id !== nextArchived[index]) || this.archived.length !== nextArchived.length) {
        this.archived = nextArchived
        this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.delete(change.key)) return
      this.publish({ type: 'remove', workspaceId: workspaceId(change.key) })
    } else if (this.knownIds.has(change.key)) {
      this.publish({ type: 'upsert', workspace: recordView(change.key, change.value) })
    }
  }

  private publish(frame: Exclude<NativeWorkspaceFrame, { type: 'baseline' }>): void {
    for (const queue of this.followers.keys()) queue.push(frame)
  }

  private requireWorkspace(id: WorkspaceId): Workspace {
    const workspace = this.registry.get(id)
    if (workspace === undefined) throw new Error('Workspace was not found')
    return workspace
  }

  private enqueue<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const result = this.operationTail.then(() => {
      signal.throwIfAborted()
      return operation()
    })
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}
