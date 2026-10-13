/** Native Host provider for skills stored in the selected filesystem world. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, win32, posix } from 'node:path'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/operations'
import type { FsTarget } from '@deepseek-ai/dsh-fs/types'
import type {} from '@deepseek-ai/dsh-skill/native'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
  SkillSource,
} from '@deepseek-ai/dsh-skill/types'
import { parseSkillContent } from './frontmatter.ts'
import type { ParsedSkillContent } from './frontmatter.ts'
import { buildSkillRoots, type SkillRoot } from './roots.ts'
import { resolveSkillFilesystemConfig, type ResolvedConfig } from './config.ts'
import { resolveSkillWatchConfig, SkillWatchManager, type SkillWatchRoot } from './watch.ts'

/** Named Native Host entry selected through the explicit package manifest. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-skill-filesystem',
  targets: ['host'],
  requires: ['fs', 'skills'],
  provides: [],
  resolve(input) {
    const config = resolveSkillFilesystemConfig(input)
    return (context) => { installNativeProvider(context, config) }
  },
}

type NativeSkillLocator =
  | {
    readonly kind: 'filesystem'
    readonly filePath: string
    readonly directory: string
    readonly target: FsTarget
  }
  | {
    readonly kind: 'bundle'
    readonly filePath: string
    readonly directory: string
    readonly bundleRoot: string
  }

interface RootEntry {
  readonly name: string
  readonly type: 'directory' | 'file' | 'other'
  readonly target?: FsTarget
  readonly bundleRoot?: string
}

function installNativeProvider(context: NativeContext, config: ResolvedConfig): void {
  const fs = context.require('fs')
  let provider: NativeFilesystemSkillProvider | undefined
  const unregister = context.require('skills').registerProvider(context.scope, (control) => {
    provider = new NativeFilesystemSkillProvider(fs, config, control)
    return provider
  })
  context.own(async () => {
    await unregister()
    await provider?.dispose()
  })
  context.own(context.on('fs/observed', (target, _observation, actor) => {
    if (mutationToolName(actor) === undefined) return
    const path = fs.processPath(target)
    if (config.watch) {
      const hostPath = fs.hostPathFor(path)
      if (hostPath !== undefined) provider?.observeHostMutation(hostPath)
      return
    }
    provider?.observeFilesystemMutation(path)
  }))
}

class NativeFilesystemSkillProvider implements SkillProvider {
  readonly name: string
  private readonly watchManager: SkillWatchManager
  private disposal: Promise<void> | undefined

  constructor(
    private readonly fs: FileSystemOperations,
    private readonly config: ResolvedConfig,
    control: SkillProviderControl,
  ) {
    this.name = config.providerName
    this.watchManager = new SkillWatchManager(
      (message) => { console.warn(message) },
      control.invalidate,
      resolveSkillWatchConfig(config),
    )
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
  }

  /** Discover summaries through the selected filesystem and report partial scans as incomplete.
   * @param options - scope lookup options; `cwd` selects the project roots and `signal` cancels I/O.
   * @returns provider candidates or an incomplete observation when any root or watch is unavailable.
   */
  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const signal = options.signal
    signal?.throwIfAborted()
    const projectRoot = this.config.includeDefaultRoots && options.cwd !== undefined
      ? await findProjectRoot(this.fs, this.fs.processPath(await resolveTarget(this.fs, options.cwd, signal)), signal)
      : undefined
    const roots = buildSkillRoots(this.config, projectRoot)
    let complete = true
    let observedRoots: SkillWatchRoot[]
    if (this.config.watch) {
      const mapped = await this.hostWatchRoots(roots, signal)
      if (!mapped.complete) complete = false
      observedRoots = mapped.roots
    } else {
      observedRoots = await this.executionWorldRoots(roots, signal)
    }
    try {
      await this.watchManager.observeRoots(observedRoots)
    } catch {
      signal?.throwIfAborted()
      complete = false
    }

    const candidates: SkillCandidate[] = []
    for (const root of roots) {
      signal?.throwIfAborted()
      try {
        candidates.push(...await this.discoverRoot(root, signal))
      } catch (error) {
        signal?.throwIfAborted()
        if (!isAbsentSkillPathError(error)) complete = false
      }
    }
    return complete ? candidates : { candidates, complete }
  }

  /** Reload a candidate body from its owning filesystem or trusted bundle.
   * @param candidate - candidate returned by this provider's discovery.
   * @param options - lookup options whose signal cancels the read.
   * @returns the current skill body, or undefined if its instruction file disappeared.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as NativeSkillLocator
    options.signal?.throwIfAborted()
    const parsed = locator.kind === 'bundle'
      ? await readBundleSkill(locator, options.signal)
      : await readFilesystemSkill(this.fs, locator.target, locator.filePath, options.signal)
    if (parsed === undefined) return undefined
    return toDefinition(parsed, candidate.source, this.name, locator.directory)
  }

  /** Invalidate after an observed write or edit that could affect a watched root.
   * @param path - absolute path in the harness host filesystem.
   */
  observeHostMutation(path: string): void {
    this.watchManager.observeHostMutation(path)
  }

  /** Invalidate after an observed mutation in the selected filesystem world.
   * @param path - absolute path in the same execution world as the retained roots.
   */
  observeFilesystemMutation(path: string): void {
    this.watchManager.observeFilesystemMutation(path)
  }

  /** Close host watchers and await their outstanding callbacks.
   * @returns completion after every watcher has closed.
   */
  dispose(): Promise<void> {
    this.disposal ??= this.watchManager.dispose()
    return this.disposal
  }

  private async hostWatchRoots(roots: readonly SkillRoot[], signal?: AbortSignal): Promise<{ roots: SkillWatchRoot[]; complete: boolean }> {
    const mapped: SkillWatchRoot[] = []
    let complete = true
    for (const root of roots) {
      signal?.throwIfAborted()
      try {
        if (root.trustedHost === true) {
          // This configured host root is the only Native discovery path that bypasses fs.
          mapped.push({ path: root.path })
          continue
        }
        const worldPath = this.fs.processPath(await resolveTarget(this.fs, root.path, signal))
        const hostPath = this.fs.hostPathFor(worldPath)
        if (hostPath === undefined) {
          complete = false
          continue
        }
        let projectRoot: string | undefined
        if (root.projectRoot !== undefined) {
          const worldProjectRoot = this.fs.processPath(await resolveTarget(this.fs, root.projectRoot, signal))
          projectRoot = this.fs.hostPathFor(worldProjectRoot)
          if (projectRoot === undefined) {
            complete = false
            continue
          }
        }
        mapped.push({
          path: hostPath,
          ...root.skipSystem ? { skipSystem: true } : {},
          ...(projectRoot === undefined ? {} : { projectRoot }),
        })
      } catch {
        signal?.throwIfAborted()
        complete = false
      }
    }
    return { roots: mapped, complete }
  }

  private async executionWorldRoots(roots: readonly SkillRoot[], signal?: AbortSignal): Promise<SkillWatchRoot[]> {
    const observed: SkillWatchRoot[] = []
    for (const root of roots) {
      signal?.throwIfAborted()
      if (root.trustedHost === true) continue
      const path = await this.executionWorldPath(root.path, signal)
      const projectRoot = root.projectRoot === undefined
        ? undefined
        : await this.executionWorldPath(root.projectRoot, signal)
      observed.push({
        path,
        ...root.skipSystem === true ? { skipSystem: true } : {},
        ...(projectRoot === undefined ? {} : { projectRoot }),
      })
    }
    return observed
  }

  private async executionWorldPath(path: string, signal?: AbortSignal): Promise<string> {
    try {
      return this.fs.processPath(await resolveTarget(this.fs, path, signal))
    } catch {
      signal?.throwIfAborted()
      return path
    }
  }

  private async discoverRoot(root: SkillRoot, signal?: AbortSignal): Promise<SkillCandidate[]> {
    const entries = root.trustedHost === true
      ? await listBundleEntries(root, (message) => { console.warn(message) })
      : await listFilesystemEntries(this.fs, root, signal)
    const candidates: SkillCandidate[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      signal?.throwIfAborted()
      if (root.skipSystem && entry.name === '.system') continue
      let locator: NativeSkillLocator | undefined
      let parsed: ParsedSkillContent | undefined
      try {
        locator = await this.locatorFor(root, entry, signal)
        if (locator === undefined) continue
        parsed = locator.kind === 'bundle'
          ? await readBundleSkill(locator, signal, (message) => { console.warn(message) })
          : await readFilesystemSkill(this.fs, locator.target, locator.filePath, signal, (message) => { console.warn(message) })
      } catch (error) {
        signal?.throwIfAborted()
        if (isAbsentSkillPathError(error)) continue
        throw error
      }
      if (parsed === undefined) continue
      candidates.push({
        name: parsed.name,
        description: parsed.description,
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        invocation: parsed.invocation,
        provider: this.name,
        source: root.source,
        rank: root.rank,
        locator,
        resourceBase: { kind: 'directory', path: locator.directory },
        path: parsed.path,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      })
    }
    return candidates
  }

  private async locatorFor(root: SkillRoot, entry: RootEntry, signal?: AbortSignal): Promise<NativeSkillLocator | undefined> {
    if (root.trustedHost === true) {
      const canonicalRoot = entry.bundleRoot
      if (canonicalRoot === undefined) return undefined
      const child = await canonicalBundlePath(canonicalRoot, join(canonicalRoot, entry.name))
      if (child === undefined) return undefined
      const filePath = entry.type === 'directory'
        ? await canonicalBundlePath(canonicalRoot, join(child, 'SKILL.md'))
        : entry.type === 'file' && entry.name.endsWith('.md') ? child : undefined
      if (filePath === undefined) return undefined
      return { kind: 'bundle', filePath, directory: entry.type === 'directory' ? child : canonicalRoot, bundleRoot: canonicalRoot }
    }
    if (entry.target === undefined) return undefined
    const directory = entry.type === 'directory' ? this.fs.processPath(entry.target) : this.fs.processPath(await resolveTarget(this.fs, root.path, signal))
    const target = entry.type === 'directory'
      ? await resolveTarget(this.fs, joinInWorld(directory, 'SKILL.md'), signal)
      : entry.type === 'file' && entry.name.endsWith('.md') ? entry.target : undefined
    if (target === undefined) return undefined
    return { kind: 'filesystem', filePath: this.fs.processPath(target), directory, target }
  }
}

async function listFilesystemEntries(fs: FileSystemOperations, root: SkillRoot, signal?: AbortSignal): Promise<RootEntry[]> {
  try {
    const target = await resolveTarget(fs, root.path, signal)
    const info = await fs.stat(target, signal)
    if (info === undefined || info.type !== 'directory') return []
    return (await fs.listDir(target, signal)).map(entry => ({
      name: entry.name,
      type: entry.type,
      target: entry.target,
    }))
  } catch (error) {
    if (isAbsentSkillPathError(error)) return []
    throw error
  }
}

async function readFilesystemSkill(
  fs: FileSystemOperations,
  target: FsTarget,
  path: string,
  signal?: AbortSignal,
  warn: (message: string) => void = (message) => { console.warn(message) },
): Promise<ParsedSkillContent | undefined> {
  signal?.throwIfAborted()
  try {
    const info = await fs.stat(target, signal)
    if (info === undefined || info.type !== 'file') return undefined
    return parseSkillContent(path, await fs.readText(target, signal), warn)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    if (hasErrorCode(error, 'FS_NOT_TEXT')) {
      warn(`skill file ${path} ignored: expected UTF-8 text`)
      return undefined
    }
    throw error
  }
}

async function listBundleEntries(root: SkillRoot, warn: (message: string) => void): Promise<RootEntry[]> {
  const canonicalRoot = await canonicalBundleRoot(root.path)
  if (canonicalRoot === undefined) return []
  const entries = await readdir(canonicalRoot, { withFileTypes: true })
  const result: RootEntry[] = []
  for (const entry of entries) {
    if (root.skipSystem && entry.name === '.system') continue
    const path = await canonicalBundlePath(canonicalRoot, join(canonicalRoot, entry.name))
    if (path === undefined) {
      warn(`skill entry ${join(canonicalRoot, entry.name)} ignored: path is outside the bundled root or unavailable`)
      continue
    }
    const info = await stat(path)
    result.push({ name: entry.name, type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', bundleRoot: canonicalRoot })
  }
  return result
}

async function canonicalBundleRoot(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path)
    return (await stat(canonical)).isDirectory() ? canonical : undefined
  } catch (error) {
    if (isAbsentPathError(error)) return undefined
    throw error
  }
}

async function canonicalBundlePath(root: string, path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path)
    return isWithin(root, canonical) ? canonical : undefined
  } catch (error) {
    if (isAbsentPathError(error)) return undefined
    throw error
  }
}

async function readBundleSkill(
  locator: Extract<NativeSkillLocator, { kind: 'bundle' }>,
  signal?: AbortSignal,
  warn: (message: string) => void = (message) => { console.warn(message) },
): Promise<ParsedSkillContent | undefined> {
  signal?.throwIfAborted()
  const path = await canonicalBundlePath(locator.bundleRoot, locator.filePath)
  if (path === undefined) return undefined
  try {
    return parseSkillContent(path, await readFile(path, { encoding: 'utf8', signal }), warn)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentPathError(error)) return undefined
    throw error
  }
}

function toDefinition(parsed: ParsedSkillContent, source: SkillSource, provider: string, directory: string): SkillDefinition {
  return {
    name: parsed.name,
    description: parsed.description,
    ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
    invocation: parsed.invocation,
    source,
    provider,
    resourceBase: { kind: 'directory', path: directory },
    path: parsed.path,
    ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
    content: parsed.content,
  }
}

async function findProjectRoot(fs: FileSystemOperations, cwd: string, signal?: AbortSignal): Promise<string> {
  let current = cwd
  while (true) {
    signal?.throwIfAborted()
    if (await pathExists(fs, joinInWorld(current, '.git'), signal)) return current
    const parent = dirnameInWorld(current)
    if (parent === current) return cwd
    current = parent
  }
}

async function pathExists(fs: FileSystemOperations, path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const target = await resolveTarget(fs, path, signal)
    return await fs.stat(target, signal) !== undefined
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

function resolveTarget(fs: FileSystemOperations, path: string, signal?: AbortSignal): Promise<FsTarget> {
  return fs.resolve(path, signal === undefined ? {} : { signal })
}

function mutationToolName(actor: object | undefined): 'edit' | 'write' | undefined {
  if (actor === undefined || !('name' in actor)) return undefined
  const value = actor.name
  return value === 'edit' || value === 'write' ? value : undefined
}

function joinInWorld(base: string, child: string): string {
  const paths = /^[A-Za-z]:[\\/]/.test(base) || base.includes('\\') ? win32 : posix
  return paths.join(base, child)
}

function dirnameInWorld(path: string): string {
  const paths = /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\') ? win32 : posix
  return paths.dirname(path)
}

function isAbsentSkillPathError(error: unknown): boolean {
  return isAbsentPathError(error) || hasErrorCode(error, 'FS_NOT_FOUND') || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function isWithin(root: string, path: string): boolean {
  const paths = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\') ? win32 : posix
  const relativePath = paths.relative(root, path)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relativePath))
}
