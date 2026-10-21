/**
 * Local filesystem skill provider.
 *
 * This package is one implementation of the `ctx.skills` provider registry. It
 * discovers directory-bundle and flat Markdown skills from project, custom, and
 * user roots, parses YAML frontmatter, and loads bodies through `ctx.fs` when a
 * filesystem service is present.
 *
 * @module @deepseek-ai/dsh-skill-filesystem
 */

import { access, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import {
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderControl,
  type SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { parseSkillContent } from './frontmatter.ts'
import type { ParsedSkillContent } from './frontmatter.ts'
import { buildSkillRoots, type SkillRoot } from './roots.ts'
import {
  SkillWatchManager,
  resolveSkillWatchConfig,
} from './watch.ts'
import { resolveSkillFilesystemConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
export { Config } from './config.ts'

export const name = 'skill-filesystem'
export const inject = ['skills']

interface SkillRootEntry {
  name: string
  type: 'directory' | 'file' | 'other'
  path: string
}

interface SkillText {
  path: string
  content: string
}

type ParsedSkill = ParsedSkillContent

interface LocalLocator {
  path: string
  directory: string
}

/** Register the local filesystem skill provider on `ctx.skills`. */
export function apply(ctx: Context, config: Config = {}): void {
  let provider!: FileSystemSkillProvider
  ctx.skills.registerProvider((control) => {
    provider = new FileSystemSkillProvider(ctx, control, config)
    return provider
  })
  ctx.effect(function* () {
    yield async () => { await provider.dispose() }
  }, 'skill-filesystem watcher')
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (mutationToolName(actor) === undefined) return
    provider.observeHostMutation(target.displayPath)
  })
}

/** Provider that maps local project/user skill roots into `ctx.skills`. */
export class FileSystemSkillProvider implements SkillProvider {
  readonly name: string
  private readonly resolvedConfig: ResolvedConfig
  private readonly watchManager: SkillWatchManager
  private disposal: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    control: SkillProviderControl,
    config: Config = {},
  ) {
    const resolved = resolveSkillFilesystemConfig(config)
    this.name = resolved.providerName
    this.resolvedConfig = resolved
    this.watchManager = new SkillWatchManager(
      (message) => { ctx.logger.warn(message) },
      control.invalidate,
      resolveSkillWatchConfig(resolved),
    )
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
    // The environment bundled root is a default root: an isolated provider
    // must see only its explicit roots, or every such provider would
    // re-discover the app's bundled skills under its own provider name.
  }

  /**
   * Discover local skill summaries for a cwd-sensitive workspace.
   * @param options - lookup options; `cwd` selects the project roots to scan.
   * @returns local provider candidates with stable root ranks; watcher startup
   *   failure returns readable candidates as an incomplete observation.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    const roots = await this.roots(options.cwd)
    let complete = true
    try {
      await this.watchManager.observeRoots(roots)
    } catch (error) {
      if (this.disposal !== undefined) throw error
      complete = false
    }
    const candidates: SkillCandidate[] = []
    for (const root of roots) {
      for (const skill of await discoverRoot(root, this.ctx, this.name)) {
        candidates.push(skill)
      }
    }
    return complete ? candidates : { candidates, complete }
  }

  /**
   * Load a complete local skill body from the candidate's file locator.
   * @param candidate - the winning candidate returned by this provider.
   * @param options - lookup options whose signal cancels filesystem reads.
   * @returns the full local skill, or `undefined` if the file disappeared.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as LocalLocator
    const parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === 'bundled')
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: parsed.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.content,
    }
  }

  /**
   * Invalidate this provider synchronously after a first-party filesystem mutation.
   * @param path - host display path observed after a model-facing write or edit.
   */
  observeHostMutation(path: string): void {
    this.watchManager.observeHostMutation(path)
  }

  /**
   * Close every host watcher and contain late filesystem callbacks.
   * @returns a shared promise that settles when every watcher reaches quiescence.
   */
  dispose(): Promise<void> {
    this.disposal ??= this.watchManager.dispose()
    return this.disposal
  }

  private async roots(cwd: string | undefined): Promise<SkillRoot[]> {
    const projectRoot = this.resolvedConfig.includeDefaultRoots && cwd !== undefined
      ? await findProjectRoot(resolve(cwd), optionalFileSystem(this.ctx))
      : undefined
    return buildSkillRoots(this.resolvedConfig, projectRoot)
  }
}

function mutationToolName(actor: object | undefined): 'edit' | 'write' | undefined {
  if (actor === undefined || !('name' in actor)) return undefined
  const value = actor.name
  return value === 'edit' || value === 'write' ? value : undefined
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function isAbsentSkillPathError(error: unknown): boolean {
  return isAbsentPathError(error)
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function discoverRoot(root: SkillRoot, ctx: Context, provider: string): Promise<SkillCandidate[]> {
  const skills: SkillCandidate[] = []
  const entries = await listSkillRootEntries(root, ctx)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (root.skipSystem && entry.name === '.system') continue
    const locator = entry.type === 'directory'
      ? { path: join(entry.path, 'SKILL.md'), directory: entry.path }
      : entry.type === 'file' && entry.name.endsWith('.md')
        ? { path: entry.path, directory: root.path }
        : undefined
    if (locator === undefined) continue
    const parsed = await parseSkillFile(locator.path, ctx, undefined, root.trustedHost === true)
    if (parsed === undefined) continue
    skills.push({
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      provider,
      source: root.source,
      rank: root.rank,
      locator,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: parsed.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
    })
  }
  return skills
}

async function listSkillRootEntries(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && root.trustedHost !== true) return await listSkillRootEntriesFromFileSystem(root, fs)
  return await listSkillRootEntriesFromNode(root, ctx)
}

async function listSkillRootEntriesFromFileSystem(root: SkillRoot, fs: FileSystem): Promise<SkillRootEntry[]> {
  try {
    return (await fsListDir(fs, root.path)).map(entryFromFs)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return []
    throw error
  }
}

async function fsListDir(fs: FileSystem, path: string): Promise<FsDirEntry[]> {
  const target = await fs.resolve(path)
  return await fs.listDir(target)
}

function entryFromFs(entry: FsDirEntry): SkillRootEntry {
  return { name: entry.name, type: entry.type, path: entry.target.displayPath }
}

async function listSkillRootEntriesFromNode(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    /* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */
    if (isAbsentSkillPathError(error)) return []
    /* v8 ignore next -- Same native error branch as above. */
    throw error
  }

  const result: SkillRootEntry[] = []
  for (const entry of entries) {
    const path = join(root.path, entry.name)
    const type = await nodeEntryKind(path, entry, ctx)
    result.push({ name: entry.name, type: type ?? 'other', path })
  }
  return result
}

async function parseSkillFile(path: string, ctx: Context, signal?: AbortSignal, trustedHost = false): Promise<ParsedSkill | undefined> {
  const raw = await readSkillText(ctx, path, signal, trustedHost)
  signal?.throwIfAborted()
  if (raw === undefined) return undefined
  return parseSkillContent(raw.path, raw.content, (message) => { ctx.logger.warn(message) })
}

function optionalFileSystem(ctx: Context): FileSystem | undefined {
  return ctx.get('fs')
}

async function readSkillText(ctx: Context, path: string, signal?: AbortSignal, trustedHost = false): Promise<SkillText | undefined> {
  signal?.throwIfAborted()
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && !trustedHost) {
    return await readSkillTextFromFileSystem(ctx, fs, path, signal)
  }
  try {
    const resolvedPath = await realpath(path)
    return { path: resolvedPath, content: await readFile(resolvedPath, { encoding: 'utf8', signal }) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
}

async function readSkillTextFromFileSystem(
  ctx: Context, fs: FileSystem, path: string, signal?: AbortSignal,
): Promise<SkillText | undefined> {
  // A missing or temporarily inaccessible skill file is not fatal to discovery.
  signal?.throwIfAborted()
  let target
  try {
    target = await fs.resolve(path)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  signal?.throwIfAborted()
  let info
  try {
    info = await fs.stat(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  if (info === undefined || info.type !== 'file') return undefined
  try {
    return { path: fs.processPath(target), content: await fs.readText(target, signal) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    if (!hasErrorCode(error, 'FS_NOT_TEXT')) throw error
    ctx.logger.warn(`skill file ${path} ignored: ${fsReadErrorMessage(target, error)}`)
    return undefined
  }
}

function fsReadErrorMessage(target: FsTarget, error: unknown): string {
  return `failed to read text file at ${target.displayPath}: ${errorMessage(error)}`
}

async function nodeEntryKind(fullPath: string, entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }, ctx: Context): Promise<'directory' | 'file' | undefined> {
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  /* v8 ignore next -- Non-file directory entries such as FIFOs are platform-specific and intentionally skipped. */
  if (!entry.isSymbolicLink()) return undefined
  try {
    const info = await stat(fullPath)
    if (info.isDirectory()) return 'directory'
    /* v8 ignore else -- the special-file symlink branch relies on POSIX /dev/null. */
    if (info.isFile()) return 'file'
    /* v8 ignore next -- The special-file symlink fixture relies on POSIX /dev/null. */
    return undefined
  } catch (error) {
    ctx.logger.warn(`skill entry ${fullPath} ignored: failed to follow symbolic link: ${errorMessage(error)}`)
    return undefined
  }
}

async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    return await pathExistsInFileSystem(path, fs)
  }
  return await pathExistsInNode(path)
}

async function pathExistsInFileSystem(path: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(path)
  } catch {
    // A backend may reject or hide this candidate; continue walking upward.
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch {
    // Transient stat failures make only this git-root candidate unusable.
    return false
  }
}

async function pathExistsInNode(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    return false
  }
}

function errorMessage(error: unknown): string {
  return String(error)
}
