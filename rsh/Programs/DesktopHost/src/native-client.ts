/** Build the explicitly selected native Client profile for the browser page. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parseNativeEntryManifest } from '@deepseek-ai/dsh-native-runtime'
import type { NativeClientBootWire } from '@deepseek-ai/dsh-client-web/native'

const PROFILE_FILENAME = 'rsh.client.json'
const ROUTE_PREFIX = '/.dsh/native-client/'
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

interface NativeClientInstallation {
  readonly id: string
  readonly plugin: string
  readonly config?: unknown
}

interface NativeClientProfile {
  readonly formatVersion: 1
  readonly installations: readonly NativeClientInstallation[]
}

/** One Host-owned response path and body in the compiled browser graph. */
export interface NativeClientAsset {
  readonly contentType: string
  readonly body: Uint8Array
}

/** Compiled Client modules and the exact boot data rendered into native.html. */
export interface NativeClientBundle {
  readonly wire: NativeClientBootWire
  readonly assets: ReadonlyMap<string, NativeClientAsset>
}

interface PackageManifest {
  readonly name?: string
  readonly exports: Record<string, unknown>
  readonly dsh?: { readonly native?: unknown }
}

interface SelectedEntry {
  readonly id: string
  readonly entryPath: string
  readonly config: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function object(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`dsh desktop: ${label} must be an object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`dsh desktop: ${label} has unknown field ${key}`)
  }
  return value
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`dsh desktop: ${label} must be a nonempty string`)
  return value
}

function parseProfile(value: unknown): NativeClientProfile {
  const profile = object(value, 'native Client profile', ['formatVersion', 'installations'])
  if (profile.formatVersion !== 1) throw new Error('dsh desktop: native Client profile has unsupported formatVersion')
  if (!Array.isArray(profile.installations) || profile.installations.length === 0) {
    throw new Error('dsh desktop: native Client profile must select at least one installation')
  }
  const installations = profile.installations.map((value): NativeClientInstallation => {
    const row = object(value, 'native Client installation', ['id', 'plugin', 'config'])
    const id = nonempty(row.id, 'native Client installation id')
    const plugin = nonempty(row.plugin, `native Client installation ${id} plugin`)
    if (!PACKAGE_NAME.test(plugin)) throw new Error(`dsh desktop: native Client installation ${id} has invalid package name`)
    return { id, plugin, ...Object.hasOwn(row, 'config') ? { config: row.config } : {} }
  })
  if (new Set(installations.map(row => row.id)).size !== installations.length) {
    throw new Error('dsh desktop: native Client profile repeats an installation id')
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

function readPackageManifest(path: string): PackageManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value)) throw new Error(`dsh desktop: invalid package manifest ${path}`)
  const exports = isRecord(value.exports) ? value.exports : {}
  const dsh = isRecord(value.dsh) ? value.dsh : undefined
  return { ...(typeof value.name === 'string' ? { name: value.name } : {}), exports, ...(dsh === undefined ? {} : { dsh }) }
}

function selectedEntries(profile: NativeClientProfile, projectDir: string, runtimeDir: string): SelectedEntry[] {
  const roots = [realpathSync(projectDir), realpathSync(runtimeDir)]
  const declarations = profile.installations.map((row) => {
    let packageRoot: string | undefined
    for (const root of roots) {
      const candidate = packageDirectory(root, row.plugin)
      if (candidate !== undefined) {
        packageRoot = candidate
        break
      }
    }
    if (packageRoot === undefined || !roots.some(root => inside(root, packageRoot))) {
      throw new Error(`dsh desktop: native Client installation ${row.id} package ${row.plugin} is not installed in the profile or runtime`)
    }
    const manifestPath = join(packageRoot, 'package.json')
    const manifest = readPackageManifest(manifestPath)
    if (manifest.name !== row.plugin) throw new Error(`dsh desktop: native Client installation ${row.id} package identity differs`)
    const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports)))
    if (!entry.targets.includes('client')) throw new Error(`dsh desktop: ${row.plugin} does not support client`)
    const entryPath = createRequire(manifestPath).resolve(`${row.plugin}${entry.entry.slice(1)}`)
    const realEntryPath = realpathSync(entryPath)
    if (!inside(packageRoot, realEntryPath)) throw new Error(`dsh desktop: native Client installation ${row.id} entry escapes its package`)
    return { id: row.id, plugin: row.plugin, entryPath: realEntryPath, config: row.config }
  })
  return declarations.map(({ id, entryPath, config }) => ({ id, entryPath, config }))
}

/**
 * Read, validate, and bundle the profile's native Client entries before Host activation.
 * @param projectDir - Electron-owned profile with installed plugin packages.
 * @param runtimeDir - immutable application runtime containing shared packages.
 * @returns one browser graph, or undefined when the profile has no native Client configuration.
 */
export async function prepareNativeClientBundle(
  projectDir: string,
  runtimeDir: string,
): Promise<NativeClientBundle | undefined> {
  const profilePath = join(projectDir, PROFILE_FILENAME)
  if (!existsSync(profilePath)) return undefined
  let profile: NativeClientProfile
  try {
    profile = parseProfile(JSON.parse(readFileSync(profilePath, 'utf8')) as unknown)
  } catch (error) {
    throw new Error(`dsh desktop: cannot load ${PROFILE_FILENAME}: ${String(error)}`, { cause: error })
  }

  const entries = selectedEntries(profile, projectDir, runtimeDir)
  const importRows = entries.map((entry, index) => `import * as plugin${index} from ${JSON.stringify(entry.entryPath)}`)
  const pluginRows = entries.map((entry, index) => `${JSON.stringify(entry.id)}: plugin${index}`).join(',')
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
  })

  const cordisInput = Object.keys(result.metafile.inputs).find(path => /cordis/iu.test(path))
  if (cordisInput !== undefined) throw new Error(`dsh desktop: native Client bundle imports Cordis through ${cordisInput}`)

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
  /* v8 ignore next -- esbuild emits the stdin JavaScript entry when a build succeeds. */
  if (bundleUrl === undefined) throw new Error('dsh desktop: native Client bundle has no JavaScript output')
  const selections = profile.installations.map(row => ({ id: row.id, config: row.config }))
  const wire: NativeClientBootWire = {
    formatVersion: 1,
    bundle: bundleUrl,
    styles: styleUrls,
    modules: entries.map(entry => ({ id: entry.id })),
    selections,
  }
  return { wire, assets }
}
