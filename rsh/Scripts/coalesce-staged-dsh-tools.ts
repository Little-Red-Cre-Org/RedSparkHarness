import { load as parseYaml } from 'js-yaml'
import { resolve as resolveEsm } from 'import-meta-resolve'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_NAME = '@deepseek-ai/dsh-tools'
const CLOSURE_IMPORTER = 'rsh/Programs/SDK/python/sdk-runtime'
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type PackageManifest = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

type LockDependency = { version?: string }
type LockImporter = {
  dependencies?: Record<string, LockDependency>
  optionalDependencies?: Record<string, LockDependency>
}
type LockFile = { importers?: Record<string, LockImporter> }

type WorkspacePackage = {
  directory: string
  importer: string
  importerLock: LockImporter
  manifest: PackageManifest
}

type StagedPackage = {
  name: string
  directory: string
  containingNodeModules: string
  manifest: PackageManifest
}

type DependencyResolution = { url: string } | { error: string }

/** Remove only nested copies whose workspace dependency and peer graph matches the runtime copy.
 * @param staging - staged runtime package directory.
 * @param repositoryRoot - workspace root containing the package importers and lockfile.
 * @returns the number of nested package copies removed.
 */
export async function coalesceStagedDshToolsPeer(
  staging: string,
  repositoryRoot = REPOSITORY_ROOT,
): Promise<number> {
  const stagedManifest = await readManifest(join(staging, 'package.json'))
  const directVersion = stagedManifest.dependencies?.[PACKAGE_NAME]
  if (typeof directVersion !== 'string' || !isWorkspaceVersion(directVersion)) {
    throw new Error(`build-exe-for-python-sdk: ${PACKAGE_NAME} must remain a direct workspace dependency of dsh-python-runtime-closure.`)
  }

  const workspace = await readWorkspacePackages(repositoryRoot)
  const closurePackage = workspace.packagesByPath.get(resolveDirectory(resolve(repositoryRoot, CLOSURE_IMPORTER)))
  if (closurePackage === undefined) {
    throw new Error(`build-exe-for-python-sdk: missing workspace importer ${CLOSURE_IMPORTER}.`)
  }

  const component = await collectWorkspaceComponent(PACKAGE_NAME, workspace, closurePackage)
  const nodeModules = join(staging, 'node_modules')
  const { packages, consumers } = await scanNodeModules(nodeModules)
  const canonicalDirectories = new Map<string, string>()

  for (const [name, source] of component) {
    const packageUrl = resolvePackage(name, join(staging, 'runtime-bootstrap.mjs'))
    const stagedDirectory = await packageDirectoryForUrl(packageUrl, name, staging)
    const expectedDirectory = resolve(nodeModules, name)
    if (resolveDirectory(stagedDirectory) !== resolveDirectory(expectedDirectory)) {
      throw new Error(
        `build-exe-for-python-sdk: ${name} resolves to ${stagedDirectory}, not the shared runtime dependency ${expectedDirectory}.`,
      )
    }
    await assertStagedPackageMatchesWorkspace(source, {
      name,
      directory: stagedDirectory,
      containingNodeModules: dirname(stagedDirectory),
      manifest: await readManifest(join(stagedDirectory, 'package.json')),
    })
    canonicalDirectories.set(name, stagedDirectory)
  }

  const componentNames = new Set(component.keys())
  const duplicates = packages.filter((candidate) => {
    const canonical = canonicalDirectories.get(candidate.name)
    return canonical !== undefined && resolveDirectory(candidate.directory) !== resolveDirectory(canonical)
  })
  const duplicateDirectories = new Set(duplicates.map(candidate => resolveDirectory(candidate.directory)))
  const plannedDirectories = new Map<string, StagedPackage>()

  for (const candidate of duplicates) {
    const canonicalDirectory = canonicalDirectories.get(candidate.name)
    if (canonicalDirectory === undefined) continue
    if (isWithin(candidate.directory, canonicalDirectory)) {
      throw new Error(`build-exe-for-python-sdk: refusing to remove ${candidate.directory}; it contains the shared ${candidate.name} runtime copy.`)
    }
    const canonicalManifest = await readManifest(join(canonicalDirectory, 'package.json'))
    await assertSamePackage(canonicalDirectory, canonicalManifest, candidate)
    await assertSameDependencyResolution(
      canonicalDirectory,
      candidate.directory,
      candidate.manifest,
      staging,
      componentNames,
      canonicalDirectories,
      duplicateDirectories,
    )

    let hasResolvingConsumer = false
    for (const consumerDirectory of consumers.get(candidate.name) ?? []) {
      const resolved = resolvePackage(candidate.name, join(consumerDirectory, 'package.json'))
      const resolvedDirectory = await packageDirectoryForUrl(resolved, candidate.name, staging)
      if (resolveDirectory(resolvedDirectory) === resolveDirectory(candidate.directory)) {
        hasResolvingConsumer = true
        break
      }
    }
    if (!hasResolvingConsumer) {
      throw new Error(
        `build-exe-for-python-sdk: nested ${candidate.name} at ${candidate.directory} has no declaring consumer that resolves to it.`,
      )
    }
    plannedDirectories.set(resolveDirectory(candidate.directory), candidate)
  }

  const expectedRuntimeUrls = new Map<string, string>()
  const plannedPaths = new Map<string, Set<string>>()
  for (const [name, canonical] of canonicalDirectories) {
    expectedRuntimeUrls.set(name, resolvePackage(name, join(staging, 'runtime-bootstrap.mjs')))
    const runtimeConsumers = consumers.get(name) ?? new Set<string>()
    runtimeConsumers.add(staging)
    consumers.set(name, runtimeConsumers)
    plannedPaths.set(name, new Set([
      resolveDirectory(canonical),
      ...duplicates.filter(candidate => candidate.name === name).map(candidate => resolveDirectory(candidate.directory)),
    ]))
  }
  for (const [name, entries] of consumers) {
    if (!componentNames.has(name)) continue
    const expectedUrl = expectedRuntimeUrls.get(name)
    const allowedPaths = plannedPaths.get(name)
    if (expectedUrl === undefined || allowedPaths === undefined) continue
    for (const consumer of entries) {
      if (isWithinAny(consumer, [...plannedDirectories.keys()])) continue
      const importer = consumer === staging ? join(staging, 'runtime-bootstrap.mjs') : join(consumer, 'package.json')
      const result = resolvePackage(name, importer)
      const actualDirectory = await packageDirectoryForUrl(result, name, staging)
      if (!allowedPaths.has(resolveDirectory(actualDirectory))) {
        throw new Error(
          `build-exe-for-python-sdk: ${consumer} resolves ${name} to ${actualDirectory}, outside its validated workspace copies.`,
        )
      }
    }
  }

  const removals = [...plannedDirectories.values()].filter(candidate => ![...plannedDirectories.values()].some(
    parent => parent !== candidate && isWithin(parent.directory, candidate.directory),
  ))
  for (const candidate of removals) await rm(candidate.directory, { recursive: true })

  for (const [name, entries] of consumers) {
    if (!componentNames.has(name)) continue
    const expectedUrl = expectedRuntimeUrls.get(name)
    if (expectedUrl === undefined) continue
    for (const consumer of entries) {
      if (isWithinAny(consumer, [...plannedDirectories.keys()])) continue
      const importer = consumer === staging ? join(staging, 'runtime-bootstrap.mjs') : join(consumer, 'package.json')
      const actual = resolvePackage(name, importer)
      if (resolveDirectory(fileURLToPath(actual)) !== resolveDirectory(fileURLToPath(expectedUrl))) {
        throw new Error(
          `build-exe-for-python-sdk: ${consumer} resolves ${name} to ${actual}, expected the runtime copy ${expectedUrl}.`,
        )
      }
    }
  }

  return plannedDirectories.size
}

async function readWorkspacePackages(repositoryRoot: string): Promise<{
  importers: Map<string, LockImporter>
  packagesByName: Map<string, WorkspacePackage[]>
  packagesByPath: Map<string, WorkspacePackage>
}> {
  const lock = parseYaml(await readFile(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')) as LockFile | undefined
  if (lock?.importers === undefined) throw new Error('build-exe-for-python-sdk: pnpm-lock.yaml has no importers map.')

  const packagesByName = new Map<string, WorkspacePackage[]>()
  const packagesByPath = new Map<string, WorkspacePackage>()
  const importers = new Map(Object.entries(lock.importers))
  for (const [importer, importerLock] of importers) {
    const directory = resolve(repositoryRoot, importer)
    const manifest = await readManifest(join(directory, 'package.json'))
    if (typeof manifest.name !== 'string') continue
    const workspacePackage = { directory, importer, importerLock, manifest }
    const entries = packagesByName.get(manifest.name) ?? []
    entries.push(workspacePackage)
    packagesByName.set(manifest.name, entries)
    packagesByPath.set(resolveDirectory(directory), workspacePackage)
  }
  return { importers, packagesByName, packagesByPath }
}

async function collectWorkspaceComponent(
  rootName: string,
  workspace: Awaited<ReturnType<typeof readWorkspacePackages>>,
  closurePackage: WorkspacePackage,
): Promise<Map<string, WorkspacePackage>> {
  const component = new Map<string, WorkspacePackage>()
  const visiting = new Set<string>()

  async function visit(source: WorkspacePackage): Promise<void> {
    const packageName = source.manifest.name
    if (typeof packageName !== 'string') {
      throw new Error(`build-exe-for-python-sdk: workspace package at ${source.directory} has no name.`)
    }
    if (component.has(packageName)) return
    if (visiting.has(packageName)) return
    visiting.add(packageName)
    component.set(packageName, source)

    const workspaceEdges = [
      ...Object.entries(source.manifest.dependencies ?? {}).map(([name, version]) => ({ name, version, kind: 'dependency' as const })),
      ...Object.entries(source.manifest.optionalDependencies ?? {}).map(([name, version]) => ({ name, version, kind: 'optionalDependency' as const })),
      ...Object.entries(source.manifest.peerDependencies ?? {}).map(([name, version]) => ({ name, version, kind: 'peerDependency' as const })),
    ]
    for (const edge of workspaceEdges) {
      if (!isWorkspaceVersion(edge.version)) continue
      const child = edge.kind === 'peerDependency'
        ? uniqueWorkspacePackage(edge.name, workspace)
        : linkedWorkspacePackage(source, edge.name, workspace)
      if (edge.kind === 'dependency' || edge.kind === 'optionalDependency') {
        assertWorkspaceLink(source.importerLock, edge.name, child, source.directory)
      }
      await visit(child)
    }
    visiting.delete(packageName)
  }

  const root = linkedWorkspacePackage(closurePackage, rootName, workspace)
  await visit(root)
  return component
}

function linkedWorkspacePackage(
  parent: WorkspacePackage,
  name: string,
  workspace: Awaited<ReturnType<typeof readWorkspacePackages>>,
): WorkspacePackage {
  const lockDependency = parent.importerLock.dependencies?.[name] ?? parent.importerLock.optionalDependencies?.[name]
  if (typeof lockDependency?.version !== 'string' || !lockDependency.version.startsWith('link:')) {
    throw new Error(`build-exe-for-python-sdk: ${parent.manifest.name} has no lockfile workspace link for ${name}.`)
  }
  const directory = resolve(parent.directory, lockDependency.version.slice('link:'.length))
  const source = workspace.packagesByPath.get(resolveDirectory(directory))
  if (source?.manifest.name !== name) {
    throw new Error(`build-exe-for-python-sdk: ${parent.manifest.name} links ${name} to an unindexed workspace package at ${directory}.`)
  }
  return source
}

function uniqueWorkspacePackage(name: string, workspace: Awaited<ReturnType<typeof readWorkspacePackages>>): WorkspacePackage {
  const matches = workspace.packagesByName.get(name) ?? []
  const match = matches[0]
  if (matches.length !== 1 || match === undefined) {
    throw new Error(`build-exe-for-python-sdk: expected one workspace package named ${name}, found ${matches.length}.`)
  }
  return match
}

function assertWorkspaceLink(importer: LockImporter, name: string, expected: WorkspacePackage, importerDirectory: string): void {
  const entry = importer.dependencies?.[name] ?? importer.optionalDependencies?.[name]
  if (typeof entry?.version !== 'string' || !entry.version.startsWith('link:')) {
    throw new Error(`build-exe-for-python-sdk: workspace importer at ${importerDirectory} does not lock ${name} as a local package.`)
  }
  const linkedDirectory = resolve(importerDirectory, entry.version.slice('link:'.length))
  if (resolveDirectory(linkedDirectory) !== resolveDirectory(expected.directory)) {
    throw new Error(`build-exe-for-python-sdk: lockfile link for ${name} at ${importerDirectory} points to ${linkedDirectory}, expected ${expected.directory}.`)
  }
}

function isWorkspaceVersion(version: string): boolean {
  return version.startsWith('workspace:') || version.startsWith('link:')
}

async function scanNodeModules(nodeModules: string): Promise<{
  packages: StagedPackage[]
  consumers: Map<string, Set<string>>
}> {
  const packages: StagedPackage[] = []
  const consumers = new Map<string, Set<string>>()

  async function visitPackage(directory: string, containingNodeModules: string): Promise<void> {
    const manifestPath = join(directory, 'package.json')
    let manifest: PackageManifest | undefined
    try {
      manifest = await readManifest(manifestPath)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }

    if (manifest !== undefined) {
      if (
        typeof manifest.name === 'string'
        && resolveDirectory(directory) === resolveDirectory(join(containingNodeModules, manifest.name))
      ) packages.push({ name: manifest.name, directory, containingNodeModules, manifest })
      for (const name of declaredPackages(manifest)) {
        const entries = consumers.get(name) ?? new Set<string>()
        entries.add(directory)
        consumers.set(name, entries)
      }
    }

    const nestedNodeModules = join(directory, 'node_modules')
    try {
      const metadata = await lstat(nestedNodeModules)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`build-exe-for-python-sdk: expected a real node_modules directory at ${nestedNodeModules}.`)
      }
      await scanDirectory(nestedNodeModules)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  async function scanDirectory(directory: string): Promise<void> {
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`build-exe-for-python-sdk: expected a real node_modules directory at ${directory}.`)
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.bin') continue
      if (entry.isSymbolicLink()) {
        throw new Error(`build-exe-for-python-sdk: staged dependency link remains at ${join(directory, entry.name)}.`)
      }
      if (!entry.isDirectory()) continue
      const entryPath = join(directory, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scopedPackage of await readdir(entryPath, { withFileTypes: true })) {
          if (scopedPackage.isSymbolicLink()) {
            throw new Error(`build-exe-for-python-sdk: staged dependency link remains at ${join(entryPath, scopedPackage.name)}.`)
          }
          if (scopedPackage.isDirectory()) await visitPackage(join(entryPath, scopedPackage.name), directory)
        }
      } else {
        await visitPackage(entryPath, directory)
      }
    }
  }

  await scanDirectory(nodeModules)
  consumers.set(PACKAGE_NAME, new Set([...(consumers.get(PACKAGE_NAME) ?? []), dirname(nodeModules)]))
  return { packages, consumers }
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function declaredPackages(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
}

function resolveDirectory(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function isWithinAny(candidate: string, parents: string[]): boolean {
  return parents.some(parent => isWithin(parent, candidate))
}

async function assertStagedPackageMatchesWorkspace(source: WorkspacePackage, candidate: StagedPackage): Promise<void> {
  if (source.manifest.name !== candidate.manifest.name || source.manifest.version !== candidate.manifest.version) {
    throw new Error(
      `build-exe-for-python-sdk: staged ${candidate.name}@${candidate.manifest.version} differs from workspace ${source.manifest.name}@${source.manifest.version}.`,
    )
  }
  const sourceFiles = await packageFiles(source.directory)
  const stagedFiles = await packageFiles(candidate.directory)
  for (const [path, digest] of stagedFiles) {
    if (sourceFiles.get(path) !== digest) {
      throw new Error(`build-exe-for-python-sdk: staged ${candidate.name} file ${path} differs from workspace source at ${source.directory}.`)
    }
  }
}

async function assertSamePackage(root: string, rootManifest: PackageManifest, candidate: StagedPackage): Promise<void> {
  if (candidate.manifest.name !== rootManifest.name || candidate.manifest.version !== rootManifest.version) {
    throw new Error(
      `build-exe-for-python-sdk: refusing to coalesce ${candidate.directory}; ${candidate.manifest.name}@${candidate.manifest.version} differs from ${rootManifest.name}@${rootManifest.version} at ${root}.`,
    )
  }

  const rootFiles = await packageFiles(root)
  const candidateFiles = await packageFiles(candidate.directory)
  const paths = new Set([...rootFiles.keys(), ...candidateFiles.keys()])
  for (const path of paths) {
    if (rootFiles.get(path) !== candidateFiles.get(path)) {
      const reason = path === 'package.json' ? 'manifests differ' : `package files differ at ${path}`
      throw new Error(`build-exe-for-python-sdk: refusing to coalesce ${candidate.directory}; ${reason} from ${root}.`)
    }
  }
}

async function packageFiles(packageDirectory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      const key = relative(packageDirectory, path).split(sep).join('/')
      if (entry.isDirectory()) {
        files.set(`${key}/`, 'directory')
        await visit(path)
      } else if (entry.isFile()) {
        const digest = createHash('sha256').update(await readFile(path)).digest('hex')
        files.set(key, digest)
      } else {
        throw new Error(`build-exe-for-python-sdk: ${packageDirectory} contains a non-file package entry at ${path}.`)
      }
    }
  }

  await visit(packageDirectory)
  return files
}

async function assertSameDependencyResolution(
  rootPackage: string,
  candidatePackage: string,
  manifest: PackageManifest,
  staging: string,
  componentNames: Set<string>,
  canonicalDirectories: Map<string, string>,
  duplicateDirectories: Set<string>,
): Promise<void> {
  for (const dependency of declaredPackages(manifest)) {
    const root = resolveDependency(dependency, rootPackage)
    const candidate = resolveDependency(dependency, candidatePackage)
    const optional = manifest.optionalDependencies?.[dependency] !== undefined
      || manifest.peerDependenciesMeta?.[dependency]?.optional === true
    if ('error' in root || 'error' in candidate) {
      if (optional && 'error' in root && 'error' in candidate && root.error === candidate.error) continue
      throw new Error(
        `build-exe-for-python-sdk: refusing to coalesce ${candidatePackage}; ${dependency} does not resolve equally from ${rootPackage} and ${candidatePackage}.`,
      )
    }
    if (resolveDirectory(fileURLToPath(root.url)) === resolveDirectory(fileURLToPath(candidate.url))) continue

    const rootDirectory = await packageDirectoryForUrl(root.url, dependency, staging)
    const candidateDirectory = await packageDirectoryForUrl(candidate.url, dependency, staging)
    const canonical = canonicalDirectories.get(dependency)
    if (
      !componentNames.has(dependency)
      || canonical === undefined
      || (
        resolveDirectory(rootDirectory) !== resolveDirectory(canonical)
        && !duplicateDirectories.has(resolveDirectory(rootDirectory))
      )
      || (
        resolveDirectory(candidateDirectory) !== resolveDirectory(canonical)
        && !duplicateDirectories.has(resolveDirectory(candidateDirectory))
      )
    ) {
      throw new Error(
        `build-exe-for-python-sdk: refusing to coalesce ${candidatePackage}; ${dependency} resolves to incompatible packages (${root.url} from ${rootPackage}, ${candidate.url} from ${candidatePackage}).`,
      )
    }
  }
}

function resolvePackage(packageName: string, importer: string): string {
  const result = resolveDependency(packageName, dirname(importer))
  if ('error' in result) {
    throw new Error(`build-exe-for-python-sdk: ${packageName} cannot resolve from ${importer} (${result.error}).`)
  }
  return result.url
}

function resolveDependency(packageName: string, packageDirectory: string): DependencyResolution {
  const parent = pathToFileURL(join(packageDirectory, 'package.json')).href
  try {
    return { url: resolveEsm(packageName, parent) }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown resolution error'
    return { error: code }
  }
}

async function packageDirectoryForUrl(url: string, name: string, root: string): Promise<string> {
  let directory = dirname(fileURLToPath(url))
  const rootDirectory = resolve(root)
  while (isWithin(rootDirectory, directory)) {
    try {
      if ((await readManifest(join(directory, 'package.json'))).name === name) return directory
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`build-exe-for-python-sdk: resolved ${name} entry ${url} has no package directory beneath ${root}.`)
}
