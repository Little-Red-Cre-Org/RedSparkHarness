import { resolve as resolveEsm } from 'import-meta-resolve'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE_NAME = '@deepseek-ai/dsh-tools'

type PackageManifest = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

type StagedPackage = {
  directory: string
  containingNodeModules: string
  manifest: PackageManifest
}

type DependencyResolution = { url: string } | { error: string }

/** Remove identical staged copies of the runtime's directly declared dsh-tools peer.
 * @param staging - staged runtime package directory.
 * @returns the number of nested copies removed.
 */
export async function coalesceStagedDshToolsPeer(staging: string): Promise<number> {
  const stagedManifest = await readManifest(join(staging, 'package.json'))
  const directVersion = stagedManifest.dependencies?.[PACKAGE_NAME]
  if (typeof directVersion !== 'string' || !directVersion.startsWith('workspace:')) {
    throw new Error(`build-exe-for-python-sdk: ${PACKAGE_NAME} must remain a direct workspace dependency of dsh-python-runtime-closure.`)
  }

  const nodeModules = join(staging, 'node_modules')
  const rootPackage = join(nodeModules, '@deepseek-ai', 'dsh-tools')
  const rootManifest = await readManifest(join(rootPackage, 'package.json'))
  if (rootManifest.name !== PACKAGE_NAME) {
    throw new Error(`build-exe-for-python-sdk: ${rootPackage} does not declare ${PACKAGE_NAME}.`)
  }

  const { packages, consumers } = await scanNodeModules(nodeModules)
  const rootDirectory = resolveDirectory(rootPackage)
  const rootPackageEntry = await resolvePackage(PACKAGE_NAME, join(staging, 'runtime-bootstrap.mjs'))
  const duplicates = packages.filter(candidate => resolveDirectory(candidate.directory) !== rootDirectory)

  for (const candidate of duplicates) {
    await assertSamePackage(rootPackage, rootManifest, candidate)
    await assertSameDependencyResolution(rootPackage, candidate.directory, rootManifest)
    const consumerDirectory = dirname(candidate.containingNodeModules)
    const consumerManifest = await readManifest(join(consumerDirectory, 'package.json'))
    if (!declaresPackage(consumerManifest, PACKAGE_NAME)) {
      throw new Error(
        `build-exe-for-python-sdk: nested ${PACKAGE_NAME} at ${candidate.directory} has no declaring consumer at ${consumerDirectory}.`,
      )
    }
    consumers.add(consumerDirectory)
  }

  for (const candidate of duplicates) {
    await rm(candidate.directory, { recursive: true })
  }

  for (const consumer of consumers) {
    if (duplicates.some(candidate => isWithin(candidate.directory, consumer))) continue
    const entry = consumer === staging ? join(staging, 'runtime-bootstrap.mjs') : join(consumer, 'package.json')
    const resolved = await resolvePackage(PACKAGE_NAME, entry)
    if (resolved !== rootPackageEntry) {
      throw new Error(
        `build-exe-for-python-sdk: ${consumer} resolves ${PACKAGE_NAME} to ${resolved}, expected the runtime copy ${rootPackageEntry}.`,
      )
    }
  }

  return duplicates.length
}

async function scanNodeModules(nodeModules: string): Promise<{ packages: StagedPackage[]; consumers: Set<string> }> {
  const packages: StagedPackage[] = []
  const consumers = new Set<string>()

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
        manifest.name === PACKAGE_NAME
        && resolveDirectory(directory) === resolveDirectory(join(containingNodeModules, PACKAGE_NAME))
      ) packages.push({ directory, containingNodeModules, manifest })
      if (declaresPackage(manifest, PACKAGE_NAME)) consumers.add(directory)
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
  consumers.add(dirname(nodeModules))
  return { packages, consumers }
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function declaresPackage(manifest: PackageManifest, name: string): boolean {
  return manifest.dependencies?.[name] !== undefined
    || manifest.optionalDependencies?.[name] !== undefined
    || manifest.peerDependencies?.[name] !== undefined
}

function resolveDirectory(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function assertSamePackage(root: string, rootManifest: PackageManifest, candidate: StagedPackage): Promise<void> {
  if (candidate.manifest.name !== PACKAGE_NAME || candidate.manifest.version !== rootManifest.version) {
    throw new Error(
      `build-exe-for-python-sdk: refusing to coalesce ${candidate.directory}; ${PACKAGE_NAME} versions differ (${rootManifest.version} at ${root}, ${candidate.manifest.version} at ${candidate.directory}).`,
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
): Promise<void> {
  const dependencyNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const dependency of dependencyNames) {
    const root = await resolveDependency(dependency, rootPackage)
    const candidate = await resolveDependency(dependency, candidatePackage)
    const optional = manifest.optionalDependencies?.[dependency] !== undefined
      || manifest.peerDependenciesMeta?.[dependency]?.optional === true
    if ('error' in root || 'error' in candidate) {
      if (optional && 'error' in root && 'error' in candidate && root.error === candidate.error) continue
      throw new Error(
        `build-exe-for-python-sdk: refusing to coalesce ${candidatePackage}; ${dependency} does not resolve equally from ${rootPackage} and ${candidatePackage}.`,
      )
    }
    if (root.url !== candidate.url) {
      throw new Error(
        `build-exe-for-python-sdk: refusing to coalesce ${candidatePackage}; ${dependency} resolves to different packages (${root.url} from ${rootPackage}, ${candidate.url} from ${candidatePackage}).`,
      )
    }
  }
}

async function resolvePackage(packageName: string, importer: string): Promise<string> {
  const result = await resolveDependency(packageName, dirname(importer))
  if ('error' in result) {
    throw new Error(`build-exe-for-python-sdk: ${packageName} cannot resolve from ${importer} (${result.error}).`)
  }
  return result.url
}

async function resolveDependency(packageName: string, packageDirectory: string): Promise<DependencyResolution> {
  const parent = pathToFileURL(join(packageDirectory, 'package.json')).href
  try {
    return { url: resolveEsm(packageName, parent) }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown resolution error'
    return { error: code }
  }
}
