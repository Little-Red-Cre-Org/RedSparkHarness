/** Cordis-free native Client profile validation and browser bundling. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parseNativeEntryManifest } from '@deepseek-ai/dsh-native-runtime'
import type { NativeClientBootWire } from '@deepseek-ai/dsh-client-web/native'
import { NativeClientBuildError } from './client-build-error.ts'

const PROFILE_FILENAME = 'rsh.client.json'
const ROUTE_PREFIX = '/.dsh/native-client/'
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/** One Host-owned response path and body in the compiled browser graph. */
export interface NativeClientAsset {
  readonly contentType: string
  readonly body: Uint8Array
}

/** Compiled Client modules and the exact boot data rendered into native.html. */
export interface NativeClientBundle {
  readonly wire: NativeClientBootWire
  readonly assets: ReadonlyMap<string, NativeClientAsset>
  /** Absolute profile, manifest and transitive source files used to produce this bundle; never sent to Clients. */
  readonly watchFiles: readonly string[]
  /** Existing input and relative-import directories, observed without recursive traversal. */
  readonly watchDirectories: readonly string[]
}

interface NativeClientInstallation {
  readonly id: string
  readonly plugin: string
  readonly config?: unknown
}

interface NativeClientProfile {
  readonly formatVersion: 1
  readonly installations: readonly NativeClientInstallation[]
}

interface PackageManifest {
  readonly name?: string
  readonly exports: Record<string, unknown>
  readonly dsh?: { readonly native?: unknown }
}

interface SelectedEntry {
  readonly id: string
  readonly entryPath: string
  readonly manifestPath: string
  readonly config: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function object(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`dsh native web: ${label} must be an object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`dsh native web: ${label} has unknown field ${key}`)
  }
  return value
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dsh native web: ${label} must be a nonempty string`)
  }
  return value
}

function parseProfile(value: unknown): NativeClientProfile {
  const profile = object(value, 'native Client profile', ['formatVersion', 'installations'])
  if (profile.formatVersion !== 1) throw new Error('dsh native web: native Client profile has unsupported formatVersion')
  if (!Array.isArray(profile.installations) || profile.installations.length === 0) {
    throw new Error('dsh native web: native Client profile must select at least one installation')
  }
  const installations = profile.installations.map((value): NativeClientInstallation => {
    const row = object(value, 'native Client installation', ['id', 'plugin', 'config'])
    const id = nonempty(row.id, 'native Client installation id')
    const plugin = nonempty(row.plugin, `native Client installation ${id} plugin`)
    if (!PACKAGE_NAME.test(plugin)) throw new Error(`dsh native web: native Client installation ${id} has invalid package name`)
    return { id, plugin, ...Object.hasOwn(row, 'config') ? { config: row.config } : {} }
  })
  if (new Set(installations.map(row => row.id)).size !== installations.length) {
    throw new Error('dsh native web: native Client profile repeats an installation id')
  }
  return { formatVersion: 1, installations }
}

function packageDirectory(anchor: string, name: string): string | undefined {
  const paths = createRequire(join(anchor, 'package.json')).resolve.paths(name) ?? []
  for (const modules of paths) {
    const path = join(modules, ...name.split('/'))
    if (existsSync(join(path, 'package.json'))) return realpathSync(path)
  }
  return undefined
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
}

function workspaceRoot(start: string): string | undefined {
  let current = start
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function readPackageManifest(path: string): PackageManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value)) throw new Error(`dsh native web: invalid package manifest ${path}`)
  const exports = isRecord(value.exports) ? value.exports : {}
  const dsh = isRecord(value.dsh) ? value.dsh : undefined
  return { ...(typeof value.name === 'string' ? { name: value.name } : {}), exports, ...(dsh === undefined ? {} : { dsh }) }
}

function selectedEntries(profile: NativeClientProfile, projectDir: string, runtimeDir: string, installedOnly: boolean): SelectedEntry[] {
  const roots = [realpathSync(projectDir), realpathSync(runtimeDir)]
  const sourceWorkspace = installedOnly ? undefined : workspaceRoot(roots[1] ?? runtimeDir)
  return profile.installations.map((row) => {
    let packageRoot: string | undefined
    for (const root of roots) {
      const candidate = packageDirectory(root, row.plugin)
      if (candidate !== undefined && (roots.some(allowed => inside(allowed, candidate))
        || (sourceWorkspace !== undefined && inside(sourceWorkspace, candidate)))) {
        packageRoot = candidate
        break
      }
    }
    if (packageRoot === undefined) {
      throw new Error(`dsh native web: native Client installation ${row.id} package ${row.plugin} is not installed in the profile or runtime`)
    }
    const manifestPath = join(packageRoot, 'package.json')
    const manifest = readPackageManifest(manifestPath)
    if (manifest.name !== row.plugin) throw new Error(`dsh native web: native Client installation ${row.id} package identity differs`)
    const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports)))
    if (!entry.targets.includes('client')) throw new Error(`dsh native web: ${row.plugin} does not support client`)
    const entryPath = createRequire(manifestPath).resolve(`${row.plugin}${entry.entry.slice(1)}`)
    const realEntryPath = realpathSync(entryPath)
    if (!inside(packageRoot, realEntryPath)) throw new Error(`dsh native web: native Client installation ${row.id} entry escapes its package`)
    return { id: row.id, entryPath: realEntryPath, manifestPath, config: row.config }
  })
}

/**
 * Read, validate, and bundle a selected native Client profile.
 * @param projectDir - profile-owned package root containing `rsh.client.json`.
 * @param runtimeDir - installed runtime root containing shared frontend packages.
 * @param installedOnly - private Desktop carriers reject packages outside their installed roots.
 * @returns one native browser graph, or undefined when no profile file exists.
 */
export async function prepareNativeClientBundle(
  projectDir: string,
  runtimeDir: string,
  installedOnly = false,
): Promise<NativeClientBundle | undefined> {
  const profilePath = join(projectDir, PROFILE_FILENAME)
  if (!existsSync(profilePath)) return undefined
  let profile: NativeClientProfile
  try {
    profile = parseProfile(JSON.parse(readFileSync(profilePath, 'utf8')) as unknown)
  } catch (error) {
    throw new Error(`dsh native web: cannot load ${PROFILE_FILENAME}: ${String(error)}`, { cause: error })
  }

  const entries = selectedEntries(profile, projectDir, runtimeDir, installedOnly)
  const importRows = entries.map((entry, index) => `import * as plugin${index} from ${JSON.stringify(entry.entryPath)}`)
  const pluginRows = entries.map((entry, index) => `${JSON.stringify(entry.id)}: plugin${index}`).join(',')
  const watchDirectories = new Set([resolve(projectDir), ...entries.map(entry => dirname(entry.manifestPath))])
  const bareImports = new Map<string, Set<string>>()
  const observeDirectory = (filename: string): void => {
    let directory = dirname(filename)
    while (!existsSync(directory)) {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    watchDirectories.add(directory)
  }
  const result = await build({
    absWorkingDir: projectDir,
    stdin: {
      contents: `${importRows.join('\n')}\nexport const plugins = {${pluginRows}}\n`,
      loader: 'ts',
      resolveDir: dirname(fileURLToPath(import.meta.url)),
      sourcefile: 'native-client-profile.ts',
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outdir: join(projectDir, '.dsh-native-client-build'),
    entryNames: 'profile-[hash]',
    assetNames: 'assets/[name]-[hash]',
    publicPath: ROUTE_PREFIX.slice(0, -1),
    mainFields: ['browser', 'module', 'main'],
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.png': 'file', '.jpg': 'file' },
    plugins: [{ name: 'native-client-input-observation', setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer.length > 0 && existsSync(args.importer)) observeDirectory(args.importer)
        if (args.path.startsWith('.') || isAbsolute(args.path) || args.kind === 'import-rule' || args.kind === 'url-token') {
          observeDirectory(resolve(args.resolveDir, args.path))
        } else if (args.resolveDir.length > 0) {
          const importers = bareImports.get(args.path) ?? new Set<string>()
          importers.add(args.resolveDir)
          bareImports.set(args.path, importers)
        }
        return undefined
      })
    } }],
  }).catch((error: unknown) => {
    if (error instanceof Error && 'errors' in error && Array.isArray(error.errors)) {
      const messages: readonly unknown[] = error.errors
      for (const message of messages) {
        if (typeof message !== 'object' || message === null || !('text' in message) || typeof message.text !== 'string') continue
        const name = /^Could not resolve "([^"]+)"$/u.exec(message.text)?.[1]
        if (name === undefined) continue
        const segments = name.split('/')
        const packageName = name.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? name)
        for (const importerDir of bareImports.get(name) ?? []) {
          for (let directory = importerDir; ; directory = dirname(directory)) {
            const modulesDir = resolve(directory, 'node_modules')
            if (existsSync(modulesDir)) observeDirectory(resolve(modulesDir, packageName))
            if (dirname(directory) === directory) break
          }
        }
      }
    }
    throw new NativeClientBuildError(error, [...watchDirectories].sort())
  })

  const cordisInput = Object.keys(result.metafile.inputs).find(path => /cordis/iu.test(path))
  if (cordisInput !== undefined) throw new Error(`dsh native web: native Client bundle imports Cordis through ${cordisInput}`)

  const assets = new Map<string, NativeClientAsset>()
  let bundleUrl: string | undefined
  const styleUrls: string[] = []
  for (const output of result.outputFiles) {
    const outputPath = relative(join(projectDir, '.dsh-native-client-build'), output.path).split(sep).join('/')
    const url = `${ROUTE_PREFIX}${outputPath}`
    const extension = outputPath.slice(outputPath.lastIndexOf('.'))
    const contentType = extension === '.js'
      ? 'text/javascript; charset=utf-8'
      : extension === '.css'
        ? 'text/css; charset=utf-8'
        : 'application/octet-stream'
    assets.set(url, { contentType, body: output.contents })
    if (extension === '.js') bundleUrl = url
    else if (extension === '.css') styleUrls.push(`${url}?v=${createHash('sha256').update(output.contents).digest('hex').slice(0, 16)}`)
  }
  if (bundleUrl === undefined) throw new Error('dsh native web: native Client bundle has no JavaScript output')
  const watchFiles = new Set([resolve(profilePath), ...entries.map(entry => entry.manifestPath)])
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input === 'native-client-profile.ts') continue
    const path = resolve(projectDir, input)
    watchFiles.add(path)
    watchDirectories.add(dirname(path))
    let directory = dirname(path)
    while (true) {
      const manifest = join(directory, 'package.json')
      if (existsSync(manifest)) { watchFiles.add(manifest); break }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return {
    watchFiles: [...watchFiles].sort(),
    watchDirectories: [...watchDirectories].sort(),
    wire: {
      formatVersion: 1,
      bundle: bundleUrl,
      styles: styleUrls,
      modules: entries.map(entry => ({ id: entry.id })),
      selections: profile.installations.map(row => ({ id: row.id, config: row.config })),
    },
    assets,
  }
}
