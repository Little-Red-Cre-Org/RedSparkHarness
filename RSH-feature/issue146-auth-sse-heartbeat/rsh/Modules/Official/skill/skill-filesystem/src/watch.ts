import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { lstat, stat } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep, win32 } from 'node:path'
import chokidar from 'chokidar'
import { canonicalizeWatchPath } from '@deepseek-ai/dsh-home-paths'

/** One root in the path space used for watcher and mutation observation. */
export interface SkillWatchRoot {
  /** Host path when watching; selected-filesystem path when watching is disabled. */
  readonly path: string
  /** Whether the root's `.system` child is excluded from invalidation. */
  readonly skipSystem?: boolean
  /** Project grouping key used to bound retained watchers. */
  readonly projectRoot?: string
}

/** Watch controls read from the provider configuration. */
export interface SkillWatchConfigInput {
  /** Whether filesystem watches are enabled. */
  readonly watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  readonly watchUsePolling?: boolean
  /** Stability interval before changed skill entries are published. */
  readonly watchStabilityThresholdMs?: number
  /** Interval between stability and polling probes. */
  readonly watchPollIntervalMs?: number
  /** Maximum number of project roots retained by the manager. */
  readonly watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  readonly watchFollowSymlinks?: boolean
}

/** Default quiet period before publishing a filesystem change. */
export const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
/** Default interval used by stability probes and polling watchers. */
export const DEFAULT_WATCH_POLL_INTERVAL_MS = 100
/** Default cap on project roots retained by the watcher. */
export const DEFAULT_WATCH_MAX_PROJECTS = 128

interface ResolvedWatchConfig {
  enabled: boolean
  usePolling: boolean
  stabilityThresholdMs: number
  pollIntervalMs: number
  maxProjects: number
  followSymlinks: boolean
}
type SkillWatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

type RootWatchMode =
  | { kind: 'root'; anchor: string }
  | { kind: 'ancestor'; anchor: string; nextPath: string }

interface RootWatchState {
  root: SkillWatchRoot
  owners: Set<string>
  watcher: WatchHandle | undefined
  opening: Promise<void> | undefined
  unhealthy: boolean
}

interface WatchHandle {
  mode: RootWatchMode
  close(): Promise<void> | void
}

/** Owns bounded host watchers, catalog invalidation, and teardown draining. */
export class SkillWatchManager {
  private readonly roots = new Map<string, RootWatchState>()
  private readonly projects = new Map<string, Set<string>>()
  private readonly lifecycle = new AbortController()
  private closing = false
  private invalidationQueued = false

  /**
   * @param warn - diagnostic sink for watcher failures.
   * @param invalidate - invalidates the exact provider registration.
   * @param config - validated watcher behavior and resource limits.
   */
  constructor(
    private readonly warn: (message: string) => void,
    private readonly invalidate: () => void,
    private readonly config: ResolvedWatchConfig,
  ) {}

  /** Retain roots for the current observation and release evicted project roots.
   * @param roots - host paths when watching, or selected-filesystem paths when watching is disabled.
   * @returns completion after required watchers are ready or released.
   */
  async observeRoots(roots: readonly SkillWatchRoot[]): Promise<void> {
    if (this.closing) return
    const projectRoots = new Map<string, SkillWatchRoot[]>()
    const pending: Promise<void>[] = []
    for (const root of roots) {
      if (root.projectRoot === undefined) {
        pending.push(this.retainRoot(root, `shared:${root.path}`))
        continue
      }
      const grouped = projectRoots.get(root.projectRoot) ?? []
      grouped.push(root)
      projectRoots.set(root.projectRoot, grouped)
    }
    for (const [projectRoot, grouped] of projectRoots) {
      const owner = `project:${projectRoot}`
      this.projects.delete(projectRoot)
      const paths = new Set(grouped.map(root => root.path))
      this.projects.set(projectRoot, paths)
      for (const root of grouped) pending.push(this.retainRoot(root, owner))
    }
    let evictedProject = false
    while (this.projects.size > this.config.maxProjects) {
      const oldest = this.projects.entries().next()
      /* v8 ignore next -- the loop condition proves one project exists. */
      if (oldest.done) break
      const [projectRoot, paths] = oldest.value
      this.projects.delete(projectRoot)
      const owner = `project:${projectRoot}`
      for (const path of paths) pending.push(this.releaseRoot(path, owner))
      evictedProject = true
    }
    await Promise.all(pending)
    if (evictedProject) this.invalidate()
  }

  /** Invalidate a catalog after a host-backed filesystem mutation.
   * @param path - absolute host path reported by the mutation observer.
   */
  observeHostMutation(path: string): void {
    this.observeMutation(path)
  }

  /** Invalidate after an observed mutation in the selected filesystem world.
   * @param path - absolute path in the same execution world as the retained roots.
   */
  observeFilesystemMutation(path: string): void {
    this.observeMutation(path)
  }

  private observeMutation(path: string): void {
    if (this.closing) return
    if (![...this.roots.values()].some(state => isPotentialSkillPath(state.root, path))) return
    this.invalidate()
  }

  /** Close all watchers and wait for watcher startup and close operations to settle.
   * @returns completion after every owned watcher has closed.
   */
  async dispose(): Promise<void> {
    this.closing = true
    this.lifecycle.abort(new Error('skill-filesystem watcher disposed'))
    const states = [...this.roots.values()]
    this.roots.clear()
    this.projects.clear()
    await Promise.all(states.map(async (state) => {
      await settleWatcherOpening(state.opening)
      const watcher = state.watcher
      state.watcher = undefined
      if (watcher !== undefined) await this.closeWatcher(watcher)
    }))
  }

  private async retainRoot(root: SkillWatchRoot, owner: string): Promise<void> {
    let state = this.roots.get(root.path)
    if (state === undefined) {
      state = { root, owners: new Set(), watcher: undefined, opening: undefined, unhealthy: true }
      this.roots.set(root.path, state)
    }
    state.owners.add(owner)
    if (this.config.enabled) await this.ensureWatcher(state)
  }

  private async releaseRoot(path: string, owner: string): Promise<void> {
    const state = this.roots.get(path)
    /* v8 ignore next -- Concurrent cwd observations can evict the same shared root before this release settles. */
    if (state === undefined) return
    state.owners.delete(owner)
    if (state.owners.size > 0) return
    this.roots.delete(path)
    await settleWatcherOpening(state.opening)
    const watcher = state.watcher
    state.watcher = undefined
    if (watcher !== undefined) await this.closeWatcher(watcher)
  }

  private ensureWatcher(state: RootWatchState): Promise<void> {
    /* v8 ignore next -- A scheduled rewatch can reach this guard only when teardown wins its await. */
    if (this.closing || !this.config.enabled) return Promise.resolve()
    if (state.opening !== undefined) return state.opening
    const opening = this.ensureCurrentWatcher(state)
    state.opening = opening
    void opening.then(
      () => {
        state.opening = undefined
      },
      () => {
        state.opening = undefined
      },
    )
    return opening
  }

  private async ensureCurrentWatcher(state: RootWatchState): Promise<void> {
    const watcher = state.watcher
    if (watcher !== undefined && !state.unhealthy) {
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      // A child unlink can publish an empty catalog before root unlinkDir arrives.
      // Discovery therefore revalidates the retained handle independently.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- watcher callbacks can mark unhealthy while the probe awaits
      if (!state.unhealthy && sameWatchMode(watcher.mode, current)) return
    }
    await this.replaceWatcher(state)
  }

  private async replaceWatcher(state: RootWatchState): Promise<void> {
    const previous = state.watcher
    state.watcher = undefined
    if (previous !== undefined) await this.closeWatcher(previous)
    /* v8 ignore next -- Teardown can win while an unhealthy watcher is still closing. */
    if (this.closing || state.owners.size === 0) return
    try {
      const watcher = await this.openStableWatcher(state)
      /* v8 ignore next -- The loop returns no handle only when teardown wins between awaited probes. */
      if (watcher === undefined) return
      /* v8 ignore start -- Post-open teardown is timing-dependent; the disposal race has an explicit integration test. */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (this.closing || state.owners.size === 0) {
        await this.closeWatcher(watcher)
        return
      }
      /* v8 ignore stop */
      state.watcher = watcher
      state.unhealthy = false
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (!this.closing) {
        state.unhealthy = true
        this.warn(`skill-filesystem: failed to watch ${state.root.path}: ${errorMessage(error)}`)
      }
      throw error
    }
  }

  // TODO(file-watch-service): Extract Chokidar and missing-root observation below into a Cordis
  // service; keep skill filtering and invalidation here.
  private async openStableWatcher(state: RootWatchState): Promise<WatchHandle | undefined> {
    while (!this.closing && state.owners.size > 0) {
      const mode = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      const watcher = mode.kind === 'ancestor'
        ? this.openAncestorWatcher(state, mode)
        : await this.openRootWatcher(state, mode)
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      /* v8 ignore else -- A host path transition between the two probes is timing-dependent. */
      if (sameWatchMode(mode, current)) return watcher
      /* v8 ignore next -- Covered by the same host path transition guard. */
      await this.closeWatcher(watcher)
    }
    /* v8 ignore next -- The loop exits only when teardown wins between awaited probes. */
    return undefined
  }

  private openAncestorWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'ancestor' }>): WatchHandle {
    const listener = (_current: Stats, _previous: Stats): void => {
      void this.handleAncestorWatchEvent(state, mode)
    }
    watchFile(mode.nextPath, {
      persistent: false,
      interval: this.config.pollIntervalMs,
    }, listener)
    return {
      mode,
      close() {
        unwatchFile(mode.nextPath, listener)
      },
    }
  }

  private async handleAncestorWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'ancestor' }>,
  ): Promise<void> {
    let current: RootWatchMode
    try {
      current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
    } catch (error) {
      /* v8 ignore start -- Non-absence stat failures need a platform permission or I/O fault. */
      if (!this.closing && state.owners.size > 0) this.handleWatcherError(state, error)
      return
      /* v8 ignore stop */
    }
    if (this.closing || state.owners.size === 0 || sameWatchMode(mode, current)) return
    this.queueInvalidation()
    state.unhealthy = true
    this.scheduleRewatch(state)
  }

  private async openRootWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'root' }>): Promise<WatchHandle> {
    const watcher = chokidar.watch(mode.anchor, {
      // Chokidar owns late native fs.watch errors only for persistent watchers;
      // this provider's effect explicitly closes every handle at teardown.
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      followSymlinks: this.config.followSymlinks,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityThresholdMs,
        pollInterval: this.config.pollIntervalMs,
      },
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
    })
    const handle: WatchHandle = {
      mode,
      close: () => watcher.close(),
    }
    let ready = false
    const readiness = Promise.withResolvers<undefined>()
    const signal = this.lifecycle.signal
    if (signal.aborted) {
      await this.closeWatcher(handle)
      signal.throwIfAborted()
    }
    const onAbort = (): void => { readiness.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    const onError = (error: unknown): void => {
      if (!ready) {
        readiness.reject(error)
        return
      }
      this.handleWatcherError(state, error)
    }
    watcher.on('error', onError)
    watcher.once('ready', () => {
      ready = true
      readiness.resolve(undefined)
    })
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(event, (path) => { this.handleWatchEvent(state, mode, event, path) })
    }
    try {
      await readiness.promise
    } catch (error) {
      await this.closeWatcher(handle)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    return handle
  }

  private handleWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'root' }>,
    event: SkillWatchEvent,
    path: string,
  ): void {
    const target = resolve(path)
    if (this.closing || !isRelevantWatchEvent({ ...state.root, path: mode.anchor }, event, target)) return
    this.queueInvalidation()
    if (target === mode.anchor && event === 'unlinkDir') {
      state.unhealthy = true
      this.scheduleRewatch(state)
    }
  }

  private handleWatcherError(state: RootWatchState, error: unknown): void {
    if (this.closing) return
    this.warn(`skill-filesystem: watcher for ${state.root.path} failed: ${errorMessage(error)}`)
    state.unhealthy = true
    this.queueInvalidation()
    this.scheduleRewatch(state)
  }

  private scheduleRewatch(state: RootWatchState): void {
    const currentOpening = state.opening ?? Promise.resolve()
    void (async () => {
      await settleWatcherOpening(currentOpening)
      try {
        await this.ensureWatcher(state)
      } catch {
        // Watch startup logged the retry failure; the next incomplete discovery retries it again.
        return
      }
      this.queueInvalidation()
    })()
  }

  private queueInvalidation(): void {
    if (this.closing || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      /* v8 ignore next -- Effect teardown can win this queued microtask before provider disposal emits. */
      if (this.closing) return
      this.invalidate()
    })
  }

  private async closeWatcher(watcher: WatchHandle): Promise<void> {
    try {
      await watcher.close()
    } catch (error) {
      this.warn(`skill-filesystem: failed to close watcher: ${errorMessage(error)}`)
    }
  }
}

async function settleWatcherOpening(opening: Promise<void> | undefined): Promise<void> {
  if (opening === undefined) return
  try {
    await opening
  } catch {
    // Watch startup already logged the underlying failure; teardown only contains it.
  }
}

/** Validate and resolve watcher defaults for a provider configuration.
 * @param config - configured watcher controls.
 * @returns explicit watcher lifecycle and timing values.
 */
export function resolveSkillWatchConfig(config: SkillWatchConfigInput): ResolvedWatchConfig {
  const stabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS
  const pollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS
  const maxProjects = config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS
  assertPositiveInteger('watchStabilityThresholdMs', stabilityThresholdMs)
  assertPositiveInteger('watchPollIntervalMs', pollIntervalMs)
  assertPositiveInteger('watchMaxProjects', maxProjects)
  return {
    enabled: config.watch ?? true,
    usePolling: config.watchUsePolling ?? false,
    stabilityThresholdMs,
    pollIntervalMs,
    maxProjects,
    followSymlinks: config.watchFollowSymlinks ?? true,
  }
}

async function resolveRootWatchMode(root: string, followSymlinks: boolean): Promise<RootWatchMode> {
  let candidate = root
  while (true) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) {
        const preserveRootLink = candidate === root
          && !followSymlinks
          && (await lstat(candidate)).isSymbolicLink()
        const anchor = preserveRootLink ? resolve(candidate) : await canonicalizeWatchPath(candidate)
        if (candidate === root) return { kind: 'root', anchor }
        const firstSegment = relative(candidate, root).split(sep)[0]
        /* v8 ignore next -- candidate is a strict ancestor of root. */
        if (firstSegment === undefined || firstSegment.length === 0) return { kind: 'root', anchor }
        return { kind: 'ancestor', anchor, nextPath: join(anchor, firstSegment) }
      }
    } catch (error) {
      /* v8 ignore next -- Non-absence stat failures are platform/permission-specific and propagate as incomplete discovery. */
      if (!isAbsentPathError(error)) throw error
    }
    const parent = dirname(candidate)
    /* v8 ignore next -- Traversal reaches the existing filesystem root before this fallback. */
    if (parent === candidate) return { kind: 'ancestor', anchor: candidate, nextPath: root }
    candidate = parent
  }
}

function sameWatchMode(left: RootWatchMode, right: RootWatchMode): boolean {
  return left.kind === right.kind
    && left.anchor === right.anchor
    && (left.kind === 'root' || (right.kind === 'ancestor' && left.nextPath === right.nextPath))
}

function isRelevantWatchEvent(
  root: SkillWatchRoot,
  event: SkillWatchEvent,
  path: string,
): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined) return false
  if (segments.length === 0) return event === 'addDir' || event === 'unlinkDir'
  if (root.skipSystem === true && segments[0] === '.system') return false
  if (segments.length === 1) {
    if (event === 'addDir' || event === 'unlinkDir') return true
    return segments[0]?.endsWith('.md') === true
  }
  return segments.length === 2
    && segments[1] === 'SKILL.md'
    && event !== 'addDir'
    && event !== 'unlinkDir'
}

function isPotentialSkillPath(root: SkillWatchRoot, path: string): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined || segments.length === 0 || segments.length > 2) return false
  if (root.skipSystem === true && segments[0] === '.system') return false
  return segments.length === 1
    ? segments[0]?.endsWith('.md') === true
    : segments[1] === 'SKILL.md'
}

function containedSegments(root: string, path: string): string[] | undefined {
  const paths = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\') ? win32 : posix
  const child = paths.relative(paths.resolve(root), paths.resolve(path))
  if (child.length === 0) return []
  if (child === '..' || child.startsWith(`..${paths.sep}`) || paths.isAbsolute(child)) return undefined
  return child.split(paths.sep)
}


function errorMessage(error: unknown): string {
  return String(error)
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`skill-filesystem: ${field} must be a positive integer`)
  }
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
