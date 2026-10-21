/** Cordis adapter for the shared v2 Workspace registry implementation. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceRegistryRuntime } from './runtime.ts'
import type { Workspace, WorkspaceId } from './workspace-types.ts'
export { WorkspaceId } from './workspace-types.ts'
export type { Workspace } from './workspace-types.ts'
export { WorkspaceUnknownSessionError, WorkspaceOrderInvalidError } from './errors.ts'
export { WorkspaceMoveInvalidError } from './entity.ts'
export { workspaceDomainState, workspaceRecord, workspaceDomainSpec } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

declare module '@deepseek-ai/cordis' { interface Context { workspaceRegistry: WorkspaceRegistry } }

/** Compatibility Service delegates every record and write to the shared runtime. */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']
  private runtime?: WorkspaceRegistryRuntime
  constructor(ctx: Context) { super(ctx, 'workspaceRegistry') }
  protected async [Service.init](): Promise<void> {
    const runtime = new WorkspaceRegistryRuntime({
      domain: this.ctx.storageDomain,
      listStored: () => this.ctx.sessionPersistence.list(),
      liveHeader: id => this.ctx.get('sessions')?.get(id)?.header,
      liveHeaders: () => this.ctx.get('sessions')?.list().map(session => session.header) ?? [],
      archiveHeader: async (id, known) => known
        ?? (await this.ctx.sessionPersistence.list()).find(snapshot => snapshot.header.id === id)?.header,
      warning: (message) =>{  this.ctx.logger.warn(message) },
    })
    this.runtime = runtime
    this.ctx.effect(() => () => runtime.close(), 'workspace.domainClose')
    await runtime.initialize()
  }
  private requireRuntime(): WorkspaceRegistryRuntime {
    if (this.runtime === undefined) throw new Error('workspace registry is not started yet')
    return this.runtime
  }

  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  async create(path: string, title?: string): Promise<Workspace> {
    return this.requireRuntime().create(path, title)
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.requireRuntime().get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireRuntime().list()
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.requireRuntime().delete(id)
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.requireRuntime().insertBefore(id, beforeId)
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.requireRuntime().archiveSession(sessionId)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    return this.requireRuntime().resolveByPath(path)
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] { return this.requireRuntime().archivedSessionIds }
}
export default WorkspaceRegistry
