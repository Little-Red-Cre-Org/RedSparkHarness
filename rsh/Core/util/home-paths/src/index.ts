/**
 * Shared filesystem path helpers for RedSpark Harness user data.
 *
 * @module @deepseek-ai/dsh-home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Directory name for the default RedSpark Harness home under the OS home.
 *
 * Deliberately not `.dsh`: a RedSpark install keeps its sessions, settings,
 * caches and profiles entirely apart from a RedSpark Harness install on the
 * same machine, so the two can be run side by side without either reading
 * the other's state. Upstream identifiers inside the code (`DSH_HOME`,
 * `@deepseek-ai/*`, the `dsh` CLI) stay as they are so this fork can keep
 * tracking upstream; only the on-disk root moves.
 */
export const DSH_HOME_DIR_NAME = '.redspark'

/** Stable user-facing display form for the default RedSpark Harness home. */
export const DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`

/**
 * On-disk directory name of the upstream DeepSeek Harness home this fork must
 * never treat as its own. Kept as a literal because it names another product's
 * root, not a constant this package owns.
 */
const UPSTREAM_DSH_HOME_DIR_NAME = '.dsh'

/** Environment variable that overrides the default RedSpark Harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default RedSpark Harness home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultDshHome(): string {
  return join(homedir(), DSH_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root RedSpark Harness home.
 *
 * Precedence, highest first: an explicit configured path, `$DSH_HOME`, then
 * `~/.dsh`. The harness keeps all user data under one root. An empty or
 * whitespace-only `$DSH_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read `DSH_HOME`.
 * @returns the normalized absolute harness home path.
 */
export function resolveDshHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = inheritableDshHome(env[DSH_HOME_ENV])
  const selected = configured ?? fromEnv ?? defaultDshHome()
  return resolve(expandHomePath(selected))
}

/**
 * Reject an inherited `$DSH_HOME` that names an upstream DSH home.
 *
 * A process started from a shell inside upstream DeepSeek Harness inherits
 * `DSH_HOME=~/.dsh`, and a developer may have exported it once for the `dsh`
 * CLI. Honouring it here would point RedSpark Harness at another product's
 * sessions, credentials and settings, which is the one thing the renamed
 * default root exists to prevent. The upstream home is recognisable by its
 * final path segment, so a value naming `.dsh` is dropped and the RedSpark
 * default is used instead; an explicit configured path still wins, so a
 * deliberate migration target stays expressible.
 *
 * The inherited home is the one beside the user's own directory, so the
 * segment alone is not enough: a test isolates itself by pointing `DSH_HOME`
 * at `<tempdir>/.dsh`, and dropping that would make every test share the real
 * home — which is how the CI runner accumulated profiles it never asked for.
 * Drop the value only when its parent is the user's home directory.
 * @param value - ambient `$DSH_HOME`, possibly absent or blank.
 * @returns the accepted value, or undefined when the ambient value is absent,
 * blank, or points at an upstream DSH home.
 */
function inheritableDshHome(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const normalized = value.trim().replace(/[\\/]+$/u, '')
  if (basename(normalized) !== UPSTREAM_DSH_HOME_DIR_NAME) return value
  return resolve(normalized) === resolve(homedir(), UPSTREAM_DSH_HOME_DIR_NAME) ? undefined : value
}

export {
  resolveDshProfileDirectoryExecution, resolveDshProfileExecution, validateDshProfileName,
} from './profile-runtime.ts'
export type { DshProfileExecution } from './profile-runtime.ts'

/**
 * Join path segments onto the resolved RedSpark Harness home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function dshHomePath(...segments: string[]): string {
  return join(resolveDshHome(), ...segments)
}

/**
 * Join path segments onto the resolved Harness home's `cache` directory without creating it; no arguments returns the directory itself.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function dshCachePath(optionsOrSegment: { dshHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return dshHomePath('cache', optionsOrSegment, ...segments)
  return join(resolveDshHome(optionsOrSegment.dshHome), 'cache', ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.dsh`, and any configured home is labelled `$DSH_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveDshHome}.
 * @returns `~/.dsh` for the default home, otherwise `$DSH_HOME`.
 */
export function dshHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultDshHome()) ? DEFAULT_DSH_HOME_DISPLAY : `$${DSH_HOME_ENV}`
}
