/**
 * Resolve the public SDK launch configuration to one dsh subprocess.
 * @module @deepseek-ai/dsh-sdk-client/launch
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome, resolveDshProfileExecution } from '@deepseek-ai/dsh-home-paths'
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

/** Node argv plus internal profile patches required by one resolved dsh entry. */
export interface DshNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Internal patches applied below caller-supplied patches. */
  patches: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
  dsh?: { nativeProfileTemplates?: unknown }
}

interface DshNodeLaunchOptions {
  profile?: string
  dshHome?: string
  environment?: Record<string, string | undefined>
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
 * @param options - Profile, home, and environment settings with an optional source-loader override for tests.
 * @returns Built output or a source entry configured for the profile's declared runtime.
 */
export function resolveDshNodeLaunchFromManifests(
  dshManifestUrl: string,
  clientManifestUrl: string,
  options: DshNodeLaunchOptions = {},
): DshNodeLaunch {
  const profile = options.profile ?? 'sdk'
  const environment = options.environment ?? process.env
  const home = resolveDshHome(options.dshHome, environment)
  const bin = resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl)
  if (existsSync(bin)) return { nodeArgs: [bin], patches: [], environment: {} }

  const packageDir = dirname(fileURLToPath(dshManifestUrl))
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  const sourcePatch = resolve(packageDir, 'src/sdk-source.cordis.patch.yml')
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  const cliManifest = manifest(dshManifestUrl)
  const nativeTemplates = cliManifest.dsh?.nativeProfileTemplates
  if (!Array.isArray(nativeTemplates) || nativeTemplates.some(name => typeof name !== 'string' || name === '')) {
    throw new Error('@deepseek-ai/dsh does not declare its native profile templates')
  }
  const shippedNativeProfile = nativeTemplates.includes(profile)
  const profileDirectory = join(home, 'profiles', profile)
  const runtime = shippedNativeProfile && !existsSync(profileDirectory)
    ? 'native'
    : resolveDshProfileExecution(profile, home).runtime
  if (shippedNativeProfile && runtime !== 'native') {
    throw new Error(`dsh: existing ${profile} profile is not a complete native profile`)
  }
  const cordisSourcePatch = runtime === 'legacy'
  const sourceFiles = [sourceBin, ...(cordisSourcePatch ? [sourcePatch] : []), sourceTsconfig]
  if (sourceFiles.some(path => !existsSync(path))) {
    throw new Error(
      `@deepseek-ai/dsh is missing its built executable ${bin} and complete source launch files ${sourceFiles.join(', ')}`,
    )
  }
  const loader = options.sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
  return {
    nodeArgs: ['--import', loader, sourceBin],
    patches: cordisSourcePatch ? [sourcePatch] : [],
    environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
  }
}

/**
 * Resolve the installed dsh package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 */
function installedDshNodeLaunch(
  profile: string,
  dshHome: string | undefined,
  environment: Record<string, string | undefined>,
): DshNodeLaunch {
  return resolveDshNodeLaunchFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
    { profile, ...dshHome === undefined ? {} : { dshHome }, environment },
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
    ? installedDshNodeLaunch(profile, dshHome, childEnvironment)
    : { nodeArgs: [resolve(callerCwd, options.dshBin)], patches: [], environment: {} }
  const patches = [
    ...dshLaunch.patches,
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
