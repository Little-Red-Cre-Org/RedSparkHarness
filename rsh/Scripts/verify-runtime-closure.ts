/**
 * Verify that the Python runtime or native CLI manifest supplies its shipped
 * compositions and every required workspace peer in its dependency graph.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'
import { PACKAGE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'
import {
  SHIPPED_NATIVE_PROFILES,
  shippedNativeProfileClientComposition,
  shippedNativeProfileComposition,
} from '../Programs/CLI/src/native-profile-template.ts'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

interface RuntimePlatform {
  tag: string
  executable: string
}

type RuntimePlatformManifest = Record<string, RuntimePlatform>

const AGENT_PRESET_GLOB = 'rsh/Engine/preset/agent-presets/presets/*/agent.cordis.yml'
const PYTHON_RUNTIME_MANIFEST = 'rsh/Programs/SDK/python/sdk-runtime/package.json'
const CLI_MANIFEST = 'rsh/Programs/CLI/package.json'
const NATIVE_CLI_ROOT_IMPORTS = [
  ['rsh/Programs/CLI/src/bin.ts', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-launch-environment/layers'],
  ['rsh/Compatibility/DSH/bundle/web-app/src/index.ts', '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-subprocess/native'],
] as const
type RuntimeClosureTarget = 'python-runtime' | 'native-cli'

export interface RuntimeClosureResult {
  failures: string[]
  presetCount: number
  workspacePackageCount: number
}

/**
 * Check a runtime manifest against its shipped profile compositions and required workspace peers.
 * @param root repository root containing the runtime manifest and shipped presets.
 * @param manifestPath runtime manifest path relative to {@link root}.
 * @param target selects the Python compatibility runtime or the native CLI dependency closure.
 * @returns the discovered preset count, reachable workspace package count, and violations.
 */
export async function verifyRuntimeClosure(
  root: string,
  manifestPath = PYTHON_RUNTIME_MANIFEST,
  target: RuntimeClosureTarget = 'python-runtime',
): Promise<RuntimeClosureResult> {
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  const runtimeName = runtimeManifest.name ?? manifestPath
  const workspace = await loadWorkspacePackages(root)
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  const platforms = await loadJson<RuntimePlatformManifest>(resolve(root, 'rsh/Programs/SDK/python/sdk-runtime/platforms.json'))
  const presetPaths = target === 'python-runtime' ? globSync(AGENT_PRESET_GLOB, { cwd: root }).sort() : []
  const targets = Object.keys(platforms).sort()
  const parents = new Map<string, string | undefined>()
  const queue: string[] = []
  const failures: string[] = []

  if (target === 'native-cli') {
    for (const dependency of Object.keys(runtimeDependencies).sort()) {
      if (runtimeManifest.optionalDependencies?.[dependency] !== undefined) {
        failures.push(`${runtimeName} -> ${dependency} is declared in both dependencies and optionalDependencies`)
      }
    }
  }

  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (target === 'native-cli' && isCordisPackage(dependency)) {
      failures.push(`${runtimeName} -> required Cordis dependency ${dependency}`)
      continue
    }
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  if (targets.length === 0) failures.push('rsh/Programs/SDK/python/sdk-runtime/platforms.json defines no runtime targets')
  if (target === 'python-runtime') {
    if (presetPaths.length === 0) failures.push(`no agent presets matched ${AGENT_PRESET_GLOB}`)
    failures.push(...await missingPresetPlugins(root, runtimeDependencies, presetPaths, targets))
    failures.push(...missingNativeSdkPlugins(root, runtimeDependencies, targets))
  } else {
    failures.push(...missingNativeCliPlugins(root, runtimeDependencies, targets, workspace))
    failures.push(...await nativeCliRootImportViolations(root))
  }
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    if (packageName === undefined) continue
    const current = workspace.get(packageName)
    if (current === undefined) continue
    const peers = current.manifest.peerDependencies ?? {}
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    const dependencies = current.manifest.dependencies ?? {}
    if (target === 'native-cli') {
      for (const dependency of Object.keys(dependencies).sort()) {
        if (current.manifest.optionalDependencies?.[dependency] !== undefined) {
          failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${dependency} is declared in both dependencies and optionalDependencies`)
        }
      }
    }
    for (const peer of Object.keys(peers).sort()) {
      if (peerMeta[peer]?.optional === true) continue
      if (target === 'native-cli') {
        if (isCordisPackage(peer)) {
          failures.push(`${formatChain(runtimeName, packageName, parents)} -> required Cordis peer ${peer}`)
          continue
        }
      }
      if (!workspace.has(peer)) continue
      if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    const packageDependencies = target === 'native-cli'
      ? dependencies
      : { ...dependencies, ...current.manifest.optionalDependencies }
    for (const dependency of Object.keys(packageDependencies).sort()) {
      if (target === 'native-cli' && isCordisPackage(dependency)) {
        failures.push(`${formatChain(runtimeName, packageName, parents)} -> required Cordis dependency ${dependency}`)
        continue
      }
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }

  return {
    failures,
    presetCount: presetPaths.length,
    workspacePackageCount: queue.length,
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..', '..')
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string' },
      target: { type: 'string' },
    },
  })
  const target = values.target ?? 'python-runtime'
  if (target !== 'python-runtime' && target !== 'native-cli') {
    throw new Error(`verify-runtime-closure: unknown target ${JSON.stringify(target)}`)
  }
  const manifestPath = values.manifest ?? (target === 'native-cli' ? CLI_MANIFEST : PYTHON_RUNTIME_MANIFEST)
  const result = await verifyRuntimeClosure(root, manifestPath, target)
  if (result.failures.length > 0) {
    const description = target === 'native-cli'
      ? 'native CLI profile packages, Cordis-free required edges, or required workspace peers are invalid'
      : 'shipped profile plugins or required workspace peers are missing from rsh/Programs/SDK/python/sdk-runtime dependencies'
    console.error(`verify-runtime-closure: ${description}:`)
    for (const failure of result.failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    const description = target === 'native-cli'
      ? `${SHIPPED_NATIVE_PROFILES.length} native CLI profile templates and ${result.workspacePackageCount} workspace packages form a closed runtime dependency graph.`
      : `${result.presetCount} agent presets and ${result.workspacePackageCount} workspace packages form a closed runtime dependency graph.`
    console.log(`verify-runtime-closure: ${description}`)
  }
}

function missingNativeCliPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
  targets: readonly string[],
  workspace: ReadonlyMap<string, WorkspacePackage>,
): string[] {
  const missing = new Map<string, Set<string>>()
  for (const target of targets) {
    const platform = processPlatformForTarget(target)
    for (const profile of SHIPPED_NATIVE_PROFILES) {
      const composition = shippedNativeProfileComposition(root, profile, platform)
      const rows = [
        ...composition.installations,
        ...shippedNativeProfileClientComposition(profile),
      ]
      for (const row of rows) {
        const plugin = barePackageName(row.plugin)
        if (plugin === undefined) continue
        const isWorkspacePackage = workspace.has(plugin)
        const version = runtimeDependencies[plugin]
        if (isWorkspacePackage && version?.startsWith('workspace:') === true) continue
        let declaration = ''
        if (!isWorkspacePackage) declaration = ' [workspace package not found]'
        else if (version !== undefined) declaration = ` [CLI dependency is ${JSON.stringify(version)}; expected workspace:]`
        const key = `${plugin}${declaration}`
        const profiles = missing.get(key) ?? new Set<string>()
        profiles.add(`${profile} (${target})`)
        missing.set(key, profiles)
      }
    }
  }
  return [...missing.entries()].map(([plugin, profiles]) =>
    `${[...profiles].sort().join(', ')} -> ${plugin}`)
}

async function nativeCliRootImportViolations(root: string): Promise<string[]> {
  const failures: string[] = []
  for (const [sourcePath, specifier, replacement] of NATIVE_CLI_ROOT_IMPORTS) {
    const source = await readFile(resolve(root, sourcePath), 'utf8')
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*)(['"])${escaped}\\1`).test(source)) {
      failures.push(`${sourcePath}: import ${specifier} pulls its Cordis root entry; use ${replacement}`)
    }
  }
  return failures
}

function isCordisPackage(packageName: string): boolean {
  return packageName.startsWith('@deepseek-ai/cordis')
}

async function missingPresetPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
  presetPaths: readonly string[],
  targets: readonly string[],
): Promise<string[]> {
  const missing = new Map<string, Set<string>>()
  const failures: string[] = []
  for (const presetPath of presetPaths) {
    const document = loadCordisYaml(await readFile(resolve(root, presetPath), 'utf8'))
    if (!Array.isArray(document)) {
      failures.push(`${presetPath}: preset root must be a Loader entry array`)
      continue
    }
    for (const target of targets) {
      const processPlatform = processPlatformForTarget(target)
      for (const plugin of activeBarePluginPackages(document, processPlatform)) {
        const version = runtimeDependencies[plugin]
        if (version?.startsWith('workspace:') === true) continue
        const preset = basename(dirname(presetPath))
        const declaration = version === undefined
          ? ''
          : ` [runtime dependency is ${JSON.stringify(version)}; expected workspace:]`
        const key = `${preset} preset -> ${plugin}${declaration}`
        const targets = missing.get(key) ?? new Set<string>()
        targets.add(target)
        missing.set(key, targets)
      }
    }
  }
  failures.push(...[...missing.entries()].map(([chain, targets]) =>
    `${chain} (${[...targets].sort().join(', ')})`))
  return failures
}

function missingNativeSdkPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
  targets: readonly string[],
): string[] {
  const missing = new Map<string, Set<string>>()
  for (const target of targets) {
    const profile = shippedNativeProfileComposition(root, 'native-sdk', processPlatformForTarget(target))
    for (const row of profile.installations) {
      const plugin = barePackageName(row.plugin)
      if (plugin === undefined || runtimeDependencies[plugin]?.startsWith('workspace:') === true) continue
      const version = runtimeDependencies[plugin]
      const declaration = version === undefined
        ? ''
        : ` [runtime dependency is ${JSON.stringify(version)}; expected workspace:]`
      const key = `native-sdk profile -> ${plugin}${declaration}`
      const affectedTargets = missing.get(key) ?? new Set<string>()
      affectedTargets.add(target)
      missing.set(key, affectedTargets)
    }
  }
  return [...missing.entries()].map(([plugin, affectedTargets]) =>
    `${plugin} (${[...affectedTargets].sort().join(', ')})`)
}

function activeBarePluginPackages(entries: unknown[], processPlatform: string): Set<string> {
  const packages = new Set<string>()
  const visit = (value: unknown, parentDisabled: boolean): void => {
    if (!isRecord(value)) return
    const disabled = parentDisabled || disabledOnPlatform(value.disabled, processPlatform)
    if (disabled) return
    if (typeof value.name === 'string') {
      const packageName = barePackageName(value.name)
      if (packageName !== undefined) packages.add(packageName)
    }
    if (isCordisGroupEntry(value)) {
      for (const child of value.config) visit(child, disabled)
    }
  }
  for (const entry of entries) visit(entry, false)
  return packages
}

function disabledOnPlatform(value: unknown, processPlatform: string): boolean {
  if (typeof value === 'boolean') return value
  if (!isRecord(value) || typeof value.__jsExpr !== 'string') return false
  const match = /^process\.platform\s*(===|!==)\s*(['"])(win32|linux|darwin)\2$/.exec(value.__jsExpr.trim())
  if (match === null) return false
  const [, operator, , expected] = match
  return operator === '===' ? processPlatform === expected : processPlatform !== expected
}

function processPlatformForTarget(target: string): NodeJS.Platform {
  if (target.startsWith('linux-')) return 'linux'
  if (target.startsWith('macos-')) return 'darwin'
  if (target.startsWith('win-')) return 'win32'
  throw new Error(`verify-runtime-closure: unsupported runtime target ${JSON.stringify(target)}`)
}

function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return undefined
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }
  return parts[0] || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadWorkspacePackages(root: string): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync([...PACKAGE_MANIFEST_GLOBS, 'rsh/Core/vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return loadJson<PackageManifest>(path)
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
