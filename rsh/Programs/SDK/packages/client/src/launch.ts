/**
 * Resolve the public SDK launch configuration to one dsh subprocess.
 * @module @deepseek-ai/dsh-sdk-client/launch
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessClientOptions } from './types.ts'

/** Default bound for the SDK profile-ready handshake across a cold startup. */
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000

/** Internal generic process launch used by the transport and fake-runtime tests. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  /** Materialize the complete child environment when the client starts its subprocess. */
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  /** Provider termination grace for escalation and owned-range confirmation during close. */
  disposeGraceMs?: number
}

/** Node argv and environment required by one resolved dsh entry. */
export interface DshNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
}

interface DshNodeLaunchOptions {
  sourceLoaderUrl?: string
}

/** Read a package manifest from one resolved package.json URL. */
function manifest(url: string): PackageManifest {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/**
 * Resolve and version-check a dsh executable from package manifests.
 * @param dshManifestUrl - resolved URL of the dsh package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @returns the absolute dsh executable path.
 */
export function resolveDshBinFromManifests(dshManifestUrl: string, clientManifestUrl: string): string {
  const dshManifest = manifest(dshManifestUrl)
  const clientManifest = manifest(clientManifestUrl)
  if (typeof dshManifest.version !== 'string' || dshManifest.version !== clientManifest.version) {
    throw new Error(`dsh SDK client ${String(clientManifest.version)} requires the same dsh version, got ${String(dshManifest.version)}`)
  }
  const bin = typeof dshManifest.bin === 'object' && dshManifest.bin !== null
    ? (dshManifest.bin as Record<string, unknown>).dsh
    : dshManifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return resolve(dirname(fileURLToPath(dshManifestUrl)), bin)
}

/**
 * Resolve and version-check the built dsh executable installed with this SDK.
 * @returns the absolute built executable path, whether or not it exists in a source checkout.
 */
export function installedDshBin(): string {
  return resolveDshBinFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve the Node launch for one same-version dsh package.
 * @param dshManifestUrl - Resolved URL of the dsh package manifest.
 * @param clientManifestUrl - Resolved URL of the SDK client manifest.
 * @param options - Optional source-loader override for tests.
 * @returns The built entry or the source entry configured with tsx.
 */
export function resolveDshNodeLaunchFromManifests(
  dshManifestUrl: string,
  clientManifestUrl: string,
  options: DshNodeLaunchOptions = {},
): DshNodeLaunch {
  const bin = resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl)
  if (existsSync(bin)) return { nodeArgs: [bin], environment: {} }

  const packageDir = dirname(fileURLToPath(dshManifestUrl))
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  const sourceFiles = [sourceBin, sourceTsconfig]
  if (sourceFiles.some(path => !existsSync(path))) {
    throw new Error(
      `@deepseek-ai/dsh is missing its built executable ${bin} and complete source launch files ${sourceFiles.join(', ')}`,
    )
  }
  const loader = options.sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
  return {
    nodeArgs: ['--import', loader, sourceBin],
    environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
  }
}

/**
 * Resolve the installed dsh package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 */
function installedDshNodeLaunch(): DshNodeLaunch {
  return resolveDshNodeLaunchFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve caller-relative filesystem inputs and construct canonical dsh argv.
 * @param options - public SDK launch options.
 * @param callerCwd - parent-process directory used for lexical resolution.
 * @returns one generic subprocess spec for the JSON-RPC transport.
 */
export function resolveDshLaunch(
  options: HarnessClientOptions = {},
  callerCwd: string = process.cwd(),
): RuntimeProcessOptions {
  const profile = options.profile ?? 'sdk'
  const dshHome = options.dshHome === undefined ? undefined : resolve(callerCwd, options.dshHome)
  const childEnvironment = options.env ?? process.env
  const dshLaunch = options.dshBin === undefined
    ? installedDshNodeLaunch()
    : { nodeArgs: [resolve(callerCwd, options.dshBin)], environment: {} }
  const patches = [
    ...(options.patches ?? []).map(path => resolve(callerCwd, path)),
  ]
  return {
    command: process.execPath,
    args: [...dshLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])],
    ...options.processCwd === undefined ? {} : { cwd: resolve(callerCwd, options.processCwd) },
    environment: () => {
      const hasSystemRoot = Object.keys(childEnvironment).some(name => name.toUpperCase() === 'SYSTEMROOT')
      return {
        ...(process.platform === 'win32' && !hasSystemRoot && process.env.SystemRoot !== undefined
          ? { SystemRoot: process.env.SystemRoot } : {}),
        ...childEnvironment,
        ...dshLaunch.environment,
        ...dshHome === undefined ? {} : { DSH_HOME: dshHome },
      }
    },
    description: `dsh profile ${JSON.stringify(profile)}`,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
  }
}
