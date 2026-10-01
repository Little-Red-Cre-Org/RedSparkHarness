/** Report the current Cordis/DSH usage and Loader/HMR compatibility baseline. */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectSourceImportGraphViolations, type CordisSourceUse } from './verify-source-import-graph.ts'
import { PACKAGE_MANIFEST_GLOBS, WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'
import { mixedNativeEntryDirectories, mixedNativeLibraryDirectories, nativePackageDirectories, nativeSafeSourceSubpaths } from './native-package-policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
const CORDIS_PACKAGES = /(?:^|\/)(?:@deepseek-ai\/)?(?:cordis|cordis-)|^@cordisjs\//u
const DSH_PACKAGES = /^@deepseek-ai\/dsh-/u

/** Migration disposition; a mixed package still owns a compatibility entry. */
export type InventoryClass = 'native-migrated' | 'native-mixed' | 'framework-free' | 'compatibility-retained' | 'test-tooling' | 'migration-required'

/** One package's direct imports, dependency sections, and policy-owned native exports. */
export interface CompatibilityPackageRow {
  readonly name: string
  readonly version: string | undefined
  readonly path: string
  readonly classification: InventoryClass
  readonly directCordisUses: number
  readonly productionCordisUses: number
  readonly testCordisUses: number
  readonly cordisDependencies: readonly string[]
  readonly cordisDevelopmentDependencies: readonly string[]
  readonly cordisRequirements: readonly { name: string; section: string; range: string; optional: boolean }[]
  readonly dshDependencies: readonly string[]
  readonly runtimeDeclaration: boolean
  readonly role: string | undefined
  readonly capability: string | undefined
  readonly nativeEntry: string | undefined
  readonly nativeTargets: readonly string[]
  readonly legacyMain: string | undefined
  readonly clientPlatform: string | undefined
  readonly nativeExports: readonly string[]
}

/** A compatibility behavior with source ownership, regression tests, and native limitations. */
export interface LoaderBaselineRow {
  readonly capability: string
  readonly owner: string
  readonly classification: InventoryClass
  readonly evidence: readonly string[]
  readonly tests: readonly string[]
  readonly gap: string
}

/** Compiler observations and compatibility lifecycle evidence from one checkout. */
export interface CompatibilityInventory {
  readonly packages: readonly CompatibilityPackageRow[]
  readonly sourceUses: readonly CordisSourceUse[]
  readonly loaderBaseline: readonly LoaderBaselineRow[]
}

interface Manifest {
  readonly name?: string
  readonly version?: string
  readonly main?: string
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>
  readonly dsh?: {
    readonly native?: { readonly entry: string; readonly targets: readonly string[] }
    readonly runtime?: { readonly role: string; readonly capability: string }
    readonly client?: { readonly platform: string }
  }
}

function rel(path: string, rootPath = root): string {
  return relative(rootPath, path).replaceAll('\\', '/')
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:tests?|fixtures?)(?:\/|$)|\.(?:spec|test|e2e|bench)\.[cm]?tsx?$/u.test(path)
}

function packageClass(
  sourcePath: string,
  productionUses: number,
  productionDependencies: readonly string[],
  manifest: Manifest,
): InventoryClass {
  if (sourcePath.startsWith('rsh/Compatibility/DSH/') || sourcePath.startsWith('rsh/Core/vendor/')) {
    return 'compatibility-retained'
  }
  if (sourcePath.startsWith('rsh/Tests/') || sourcePath.startsWith('rsh/Docs/')) return 'test-tooling'
  if (nativePackageDirectories.has(sourcePath) && productionUses === 0 && productionDependencies.length === 0) return 'native-migrated'
  if (mixedNativeEntryDirectories.has(sourcePath) || mixedNativeLibraryDirectories.has(sourcePath)
    || nativeSafeSourceSubpaths.has(sourcePath)) return 'native-mixed'
  if (productionUses === 0 && productionDependencies.length === 0) {
    return manifest.dsh?.native === undefined ? 'framework-free' : 'native-migrated'
  }
  return 'migration-required'
}

function packageManifests(rootPath: string): Array<{ path: string; manifest: Manifest }> {
  const paths = new Set<string>()
  for (const pattern of [...PACKAGE_MANIFEST_GLOBS, ...WORKSPACE_MANIFEST_GLOBS]) {
    for (const file of globSync(pattern, { cwd: rootPath, exclude: ['**/node_modules/**'] })) {
      paths.add(resolve(rootPath, file))
    }
  }
  return [...paths].sort().map(path => ({ path, manifest: JSON.parse(readFileSync(path, 'utf8')) as Manifest }))
}

function dependencyNames(manifest: Manifest): string[] {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
    ...manifest.devDependencies,
  }).sort()
}

/**
 * Resolve the compatibility lifecycle baseline and reject missing evidence files.
 * @param rootPath - checkout containing the source and regression tests.
 * @returns compatibility-owned behaviors and the corresponding native limitations.
 */
export function collectLoaderBaseline(rootPath: string): LoaderBaselineRow[] {
  const rows: Array<Omit<LoaderBaselineRow, 'evidence' | 'tests'> & { evidence: string[]; tests: string[] }> = [
    {
      capability: 'Cordis Loader entry activation and Fiber disposal',
      owner: 'rsh/Core/vendor/loader', classification: 'compatibility-retained',
      evidence: ['rsh/Core/vendor/loader/src/index.ts', 'rsh/Core/vendor/loader/src/config/entry.ts'],
      tests: ['rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts', 'rsh/Modules/Official/fs/tool-fs/tests/runtime-loader-composition.spec.ts'],
      gap: 'No native Loader equivalent; native composition owns installation plans and NativeContext disposal.',
    },
    {
      capability: 'Include YAML composition and patch layering',
      owner: 'rsh/Core/vendor/include', classification: 'compatibility-retained',
      evidence: ['rsh/Core/vendor/include/src/index.ts', 'rsh/Compatibility/DSH/boot/app-boot/src/profile.ts'],
      tests: ['rsh/Compatibility/DSH/boot/app-boot/tests/user-patches.spec.ts', 'rsh/Compatibility/DSH/boot/app-boot/tests/config-reload.spec.ts'],
      gap: 'Include remains a Cordis configuration dialect; native profiles do not parse cordis.yml.',
    },
    {
      capability: 'File and config HMR refresh',
      owner: 'rsh/Core/vendor/hmr', classification: 'compatibility-retained',
      evidence: ['rsh/Core/vendor/hmr/src/index.ts', 'rsh/Compatibility/DSH/boot/app-boot/src/index.ts'],
      tests: ['rsh/Compatibility/DSH/boot/app-boot/tests/hmr-config.spec.ts', 'rsh/Compatibility/DSH/boot/app-boot/tests/user-patches.spec.ts'],
      gap: 'Native replacement is owned separately from Cordis HMR; automatic delivery of changed module code and Client compositions must be verified through their application launchers.',
    },
    {
      capability: 'Compatibility plugin ownership and unload',
      owner: 'rsh/Compatibility/DSH/bridge/compat-plugin-host', classification: 'compatibility-retained',
      evidence: ['rsh/Compatibility/DSH/bridge/compat-plugin-host/src/index.ts'],
      tests: ['rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts'],
      gap: 'Adapter disposal is Cordis Fiber-scoped; it must not become a second Agent, Session, or Tools authority.',
    },
  ]
  const missing = rows.flatMap(row => [...row.evidence, ...row.tests].filter(file => !existsSync(resolve(rootPath, file))))
  if (missing.length > 0) throw new Error(`compatibility-inventory: missing evidence files: ${missing.join(', ')}`)
  return rows
}

/**
 * Join compiler observations to every workspace manifest without inferring product completion.
 * @param rootPath - repository whose workspace manifests are inventoried.
 * @param sourceUses - compiler-face observations from that same repository.
 * @returns package dispositions, dependencies, and independently classified native exports.
 */
export function collectCompatibilityPackageRows(rootPath: string, sourceUses: readonly CordisSourceUse[]): CompatibilityPackageRow[] {
  const packages: CompatibilityPackageRow[] = []
  for (const { path, manifest } of packageManifests(rootPath)) {
    const name = manifest.name
    if (name === undefined) throw new Error(`compatibility-inventory: missing package name in ${path}`)
    const sourcePath = rel(dirname(path), rootPath)
    const deps = dependencyNames(manifest)
    const cordisDependencies = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })
      .filter(dep => CORDIS_PACKAGES.test(dep)).sort()
    const cordisDevelopmentDependencies = Object.keys(manifest.devDependencies ?? {}).filter(dep => CORDIS_PACKAGES.test(dep)).sort()
    const cordisRequirements = (['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const)
      .flatMap(section => Object.entries(manifest[section] ?? {}).filter(([dep]) => CORDIS_PACKAGES.test(dep))
        .map(([name, range]) => ({
          name, section, range,
          optional: section === 'optionalDependencies' || (section === 'peerDependencies' && manifest.peerDependenciesMeta?.[name]?.optional === true),
        })))
    const dshDependencies = deps.filter(dep => DSH_PACKAGES.test(dep))
    const ownerUses = sourceUses.filter(use => use.owner === name)
    const testCordisUses = ownerUses.filter(use => isTestPath(rel(use.fileName, rootPath))).length
    const productionCordisUses = ownerUses.length - testCordisUses
    const policyNative = nativePackageDirectories.has(sourcePath)
      || mixedNativeEntryDirectories.has(sourcePath)
      || mixedNativeLibraryDirectories.has(sourcePath)
      || nativeSafeSourceSubpaths.has(sourcePath)
    if (cordisDependencies.length === 0 && cordisDevelopmentDependencies.length === 0
      && dshDependencies.length === 0 && ownerUses.length === 0
      && manifest.dsh?.native === undefined && !policyNative) continue
    const nativeExports = nativePackageDirectories.has(sourcePath) ? ['.'] : [
      ...(mixedNativeEntryDirectories.has(sourcePath) || mixedNativeLibraryDirectories.has(sourcePath) ? ['./native'] : []),
      ...(nativeSafeSourceSubpaths.get(sourcePath) ?? []),
    ]
    packages.push({
      name, version: manifest.version, path: sourcePath,
      classification: packageClass(sourcePath, productionCordisUses, cordisDependencies, manifest),
      directCordisUses: ownerUses.length, productionCordisUses, testCordisUses,
      cordisDependencies, cordisDevelopmentDependencies, cordisRequirements, dshDependencies,
      runtimeDeclaration: manifest.dsh?.native !== undefined, nativeExports: [...new Set(nativeExports)],
      role: manifest.dsh?.runtime?.role, capability: manifest.dsh?.runtime?.capability,
      nativeEntry: manifest.dsh?.native?.entry, nativeTargets: manifest.dsh?.native?.targets ?? [],
      legacyMain: manifest.main, clientPlatform: manifest.dsh?.client?.platform,
    })
  }
  return packages
}

/**
 * Read the compiler graph, workspace manifests, and evidence-backed Loader baseline.
 * @param rootPath - repository root.
 * @returns the current diagnostic inventory; counts are observations per compiler face.
 */
export function collectCompatibilityInventory(rootPath = root): CompatibilityInventory {
  const sourceUses = collectSourceImportGraphViolations(rootPath).cordisUses
  const packages = collectCompatibilityPackageRows(rootPath, sourceUses)
  return { packages, sourceUses, loaderBaseline: collectLoaderBaseline(rootPath) }
}

function render(inventory: CompatibilityInventory, includeUses: boolean): string {
  const counts = new Map<InventoryClass, number>()
  for (const row of inventory.packages) counts.set(row.classification, (counts.get(row.classification) ?? 0) + 1)
  const lines = [
    `compatibility-inventory: ${String(inventory.packages.length)} package rows, ${String(inventory.sourceUses.length)} direct Cordis source uses`,
    `classes: ${(['native-migrated', 'native-mixed', 'framework-free', 'compatibility-retained', 'test-tooling', 'migration-required'] as const)
      .map(kind => `${kind}=${String(counts.get(kind) ?? 0)}`).join(', ')}`,
    '',
    'Counts are compiler-face observations, including type imports; they are not unique statements or completed capabilities.',
    '',
    'Package / version / owner path | Class | Cordis uses production / test | Cordis requirements (section, range, optional) | DSH dependencies | Role / capability | Entries / targets / policy exports',
    '--- | --- | ---: | --- | --- | --- | ---',
    ...inventory.packages.map(row => `\`${row.name}\` ${row.version ?? '—'} \`${row.path}\` | ${row.classification} | ${String(row.productionCordisUses)} / ${String(row.testCordisUses)} | ${row.cordisRequirements.map(dep => `${dep.name}: ${dep.section} ${dep.range}${dep.optional ? ' (optional)' : ''}`).join('<br>') || '—'} | ${row.dshDependencies.join(', ') || '—'} | ${row.role ?? '—'} / ${row.capability ?? '—'} | native: ${row.nativeEntry ?? '—'} (${row.nativeTargets.join(', ') || '—'}); main: ${row.legacyMain ?? '—'}; client: ${row.clientPlatform ?? '—'}; policy: ${row.nativeExports.join(', ') || '—'}`),
    '',
    'Loader/HMR capability | Owner | Class | Evidence | Tests | Current gap',
    '--- | --- | --- | --- | --- | ---',
    ...inventory.loaderBaseline.map(row => `**${row.capability}** | \`${row.owner}\` | ${row.classification} | ${row.evidence.map(file => `\`${file}\``).join('<br>')} | ${row.tests.map(file => `\`${file}\``).join('<br>')} | ${row.gap}`),
  ]
  if (includeUses) {
    lines.push('', 'Direct Cordis source use | Face | Kind | Specifier | Symbols', '--- | --- | --- | --- | ---')
    lines.push(...inventory.sourceUses.map(use => `\`${use.owner}\` \`${rel(use.fileName)}:${String(use.line)}\` | ${use.face} | ${use.kind} | \`${use.specifier}\` | ${use.symbols.join(', ')}`))
  }
  return `${lines.join('\n')}\n`
}

function main(): void {
  const inventory = collectCompatibilityInventory(root)
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(inventory, null, 2)}\n` : render(inventory, process.argv.includes('--uses')))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
