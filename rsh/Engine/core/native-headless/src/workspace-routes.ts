/** Program-owned immutable Workspace routes; directory choice never changes filesystem or policy Providers. */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, parse } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace/workspace-types'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import type { NativeRootRoute, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'

/** Explicit deployment admission for dynamic routes, separate from operation permission. */
export interface NativeWorkspaceRouteConfiguration {
  readonly maxRoutes: number
  readonly allowedRoots: readonly string[]
}

/** Validate deployment inputs without opening or advertising a dynamic route.
 * @param input - profile configuration value.
 * @returns immutable positive capacity and absolute directory admission roots.
 */
export function resolveWorkspaceRouteConfiguration(input: unknown): NativeWorkspaceRouteConfiguration {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('workspaceRoutes must be an object')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => key !== 'maxRoutes' && key !== 'allowedRoots')) throw new Error('workspaceRoutes contains an unknown field')
  if (typeof value.maxRoutes !== 'number' || !Number.isSafeInteger(value.maxRoutes) || value.maxRoutes <= 0) throw new Error('workspaceRoutes.maxRoutes must be a positive safe integer')
  const candidates: unknown = value.allowedRoots
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('workspaceRoutes.allowedRoots must contain absolute directories')
  const allowedRoots: string[] = []
  for (const candidate of candidates) {
    const path: unknown = candidate
    if (typeof path !== 'string' || !isAbsolute(path)
      || process.platform === 'win32' && ['/', '\\'].includes(parse(path).root)) throw new Error('workspaceRoutes.allowedRoots must contain absolute directories')
    allowedRoots.push(path)
  }
  return Object.freeze({ maxRoutes: value.maxRoutes, allowedRoots: Object.freeze(allowedRoots) })
}

const within = (root: string, path: string): boolean => {
  const difference = relative(root, path)
  return difference === '' || !isAbsolute(difference) && difference !== '..' && !difference.startsWith('../') && !difference.startsWith('..\\')
}

/** One Program route map with owned selection cancellation and bounded dynamic capacity. */
export class NativeWorkspaceRoutes {
  private readonly selected = new Map<NativeRootRouteId, Readonly<NativeRootRoute>>()
  private readonly pending = new Map<WorkspaceId, Set<Promise<Readonly<NativeRootRoute>>>>()
  private readonly controller = new AbortController()
  private closing: Promise<void> | undefined

  /**
   * @param base - Program configuration and policy scope already selected by assembly.
   * @param configuration - explicit capacity and directory admission roots; absent disables dynamic selection.
   * @param registry - the existing Workspace directory authority, never another Workspace store.
   * @param fs - selected filesystem used to verify that its execution path matches the registered directory.
   * @param policy - existing scoped confinement configuration; selection never changes it.
   * @param lifetime - Program shutdown cancellation.
   * @param busy - exact Program Agent, writer and admission ownership test before route release.
   */
  constructor(private readonly base: Readonly<NativeRootRoute>,
    private readonly configuration: NativeWorkspaceRouteConfiguration | undefined,
    private readonly registry: { get(id: WorkspaceId): Workspace | undefined } | undefined, private readonly fs: Pick<FileSystemOperations, 'resolve' | 'processPath' | 'sandboxMode'>,
    private readonly policy: NativeSandboxPolicy | undefined, private readonly lifetime: AbortSignal,
    private readonly busy: (route: NativeRootRouteId) => boolean) {
    if (configuration !== undefined && registry === undefined) throw new Error('workspaceRoutes requires the Workspace Registry')
  }

  /** Resolve one already advertised immutable route.
   * @param id - branded Program route identity.
   * @returns the base or selected route; unknown references throw.
   */
  resolve(id: NativeRootRouteId): Readonly<NativeRootRoute> {
    this.assertOpen()
    const route = id === this.base.id ? this.base : this.selected.get(id)
    if (route === undefined) throw new Error('native-headless: unknown root route')
    return route
  }

  /** Read currently advertised dynamic routes without opening or updating anything.
   * @returns immutable configurations in acceptance order; disabled selection advertises none.
   */
  list(): readonly Readonly<NativeRootRoute>[] { this.assertOpen(); return [...this.selected.values()] }

  /** Validate the registered directory and publish one immutable route through the same Program.
   * @param baseRoute - explicit configured route whose model and policy scope remain selected.
   * @param workspaceId - existing branded Workspace identity; no arbitrary cwd is accepted.
   * @param caller - authenticated caller cancellation composed with Program lifetime.
   * @returns accepted route after directory, policy, capacity and cancellation checks.
   */
  select(baseRoute: NativeRootRouteId, workspaceId: WorkspaceId, caller: AbortSignal): Promise<Readonly<NativeRootRoute>> {
    this.assertOpen()
    if (baseRoute !== this.base.id) throw new Error('workspace selection requires the configured base route')
    if (this.configuration === undefined || this.registry === undefined) throw new Error('Workspace route selection is disabled')
    const signal = AbortSignal.any([caller, this.lifetime, this.controller.signal])
    signal.throwIfAborted()
    const operation = this.admit(workspaceId, this.configuration, this.registry, signal)
    let owned = this.pending.get(workspaceId)
    if (owned === undefined) { owned = new Set(); this.pending.set(workspaceId, owned) }
    owned.add(operation)
    const settle = () => { owned.delete(operation); if (owned.size === 0) this.pending.delete(workspaceId) }
    void operation.then(settle, settle)
    return operation
  }

  private async admit(id: WorkspaceId, configuration: NativeWorkspaceRouteConfiguration,
    registry: { get(id: WorkspaceId): Workspace | undefined }, signal: AbortSignal): Promise<Readonly<NativeRootRoute>> {
    const workspace = registry.get(id)
    if (workspace === undefined) throw new Error('unknown Workspace identity')
    if (await workspace.status() !== 'ok') throw new Error('Workspace directory is unavailable')
    const path = await realpath(workspace.path)
    if (path !== workspace.path || !(await stat(path)).isDirectory()) throw new Error('Workspace directory identity changed')
    const roots = await Promise.all(configuration.allowedRoots.map(async (root) => {
      const canonical = await realpath(root)
      if (!(await stat(canonical)).isDirectory()) throw new Error('Workspace allowed root is not a directory')
      return canonical
    }))
    if (!roots.some(root => within(root, path))) throw new Error('Workspace is outside the configured allowed roots')
    if (this.fs.sandboxMode !== undefined && this.policy === undefined) throw new Error('confined Workspace routing requires its selected sandbox policy')
    if (this.policy !== undefined && this.policy.config.mode !== 'danger-full-access') {
      const policyRoot = await realpath(this.policy.config.workspaceRoot)
      if (!within(policyRoot, path)) throw new Error('Workspace is outside the selected sandbox policy root')
    }
    const target = await this.fs.resolve(path, { cwd: this.base.configuration.cwd, signal })
    if (resolve(this.fs.processPath(target)) !== resolve(path)) throw new Error('Workspace requires a matching filesystem execution directory')
    signal.throwIfAborted()
    this.assertOpen()
    if (registry.get(id) !== workspace) throw new Error('Workspace was removed during route selection')
    const routeId = brandString<NativeRootRouteId>(JSON.stringify([this.base.id, id]))
    const existing = this.selected.get(routeId)
    if (existing !== undefined) {
      if (existing.configuration.cwd !== path) throw new Error('Workspace route directory changed')
      return existing
    }
    if (this.selected.size >= configuration.maxRoutes) throw new Error('Workspace route capacity is exhausted')
    const route: Readonly<NativeRootRoute> = Object.freeze({ id: routeId, workspaceId: id,
      configuration: Object.freeze({ ...this.base.configuration, cwd: path }) })
    this.selected.set(routeId, route)
    return route
  }

  /** Withdraw an idle dynamic route; active or pending exact ownership is refused.
   * @param id - selected dynamic route identity; the base route cannot be released.
   */
  release(id: NativeRootRouteId): void {
    this.assertOpen()
    const route = this.selected.get(id)
    if (route === undefined || route.workspaceId === undefined) throw new Error('unknown dynamic Workspace route')
    if (this.busy(id) || this.pending.has(route.workspaceId)) throw new Error('Workspace route is busy')
    this.selected.delete(id)
  }

  /** Close admission, cancel and drain actual directory selections, then withdraw all advertisements.
   * @returns idempotent settlement after all owned selections finish.
   */
  close(): Promise<void> {
    this.controller.abort({ kind: 'disposed' })
    return this.closing ??= Promise.allSettled([...this.pending.values()].flatMap(tasks => [...tasks]))
      .then(() => { this.selected.clear() })
  }

  private assertOpen(): void {
    this.lifetime.throwIfAborted(); this.controller.signal.throwIfAborted()
  }
}
