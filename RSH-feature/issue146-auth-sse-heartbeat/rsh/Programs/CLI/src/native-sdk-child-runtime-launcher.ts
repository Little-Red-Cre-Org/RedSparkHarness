/** Program-owned launcher for one fixed Native SDK child. */

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, lstat, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess/native'
import type { SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'
import type {
  NativeSdkChildRuntime, NativeSdkChildRuntimeLauncher, NativeSdkChildRuntimeRequest,
  RuntimeProcessOptions,
} from '@deepseek-ai/dsh-sdk-runtime'

export const NATIVE_SDK_CHILD_APPROVAL_RELAY_ENV = 'DSH_NATIVE_SDK_CHILD_APPROVAL_RELAY'

interface CliManifest {
  readonly bin?: unknown
}

function resolveNativeSdkChildRuntime(request: NativeSdkChildRuntimeRequest, home: string, overlay: string): RuntimeProcessOptions {
  const packageManifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
  const packageRoot = dirname(packageManifestPath)
  const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as CliManifest
  const bin = typeof manifest.bin === 'object' && manifest.bin !== null
    ? (manifest.bin as Record<string, unknown>).dsh : manifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('dsh: CLI package declares no dsh executable')
  const builtBin = resolve(packageRoot, bin)
  let nodeArgs: string[]
  let sourceEnvironment: NodeJS.ProcessEnv = {}
  if (existsSync(builtBin)) {
    nodeArgs = [builtBin]
  } else if (import.meta.url.endsWith('.ts')) {
    const sourceBin = resolve(packageRoot, 'src/bin.ts')
    const sourceTsconfig = resolve(packageRoot, 'tsconfig.json')
    if (!existsSync(sourceBin) || !existsSync(sourceTsconfig)) {
      throw new Error(`dsh: source SDK child launch is missing ${sourceBin} or ${sourceTsconfig}`)
    }
    nodeArgs = ['--import', import.meta.resolve('tsx/esm'), sourceBin]
    sourceEnvironment = { TSX_TSCONFIG_PATH: sourceTsconfig }
  } else {
    throw new Error(`dsh: built SDK child launch is missing ${builtBin}`)
  }
  const environment = { ...scrubbedParentEnv(), ...request.environment }
  const hasSystemRoot = Object.keys(environment).some(name => name.toUpperCase() === 'SYSTEMROOT')
  if (process.platform === 'win32' && !hasSystemRoot && process.env.SystemRoot !== undefined) {
    environment.SystemRoot = process.env.SystemRoot
  }
  return {
    command: process.execPath,
    args: [...nodeArgs, '--profile', 'native-sdk', '--patch', overlay],
    cwd: resolve(process.cwd(), request.cwd),
    environment: () => ({ ...environment, ...sourceEnvironment, DSH_HOME: resolve(home) }),
    description: 'dsh profile "native-sdk"',
    initializeTimeoutMs: 30_000,
  }
}

function inheritsParentWorkspaceWrite(request: NativeSdkChildRuntimeRequest): boolean {
  return request.parentPolicy.mode === 'workspace-write' && request.builtinTools.includes('write_file')
}

function inheritedWorkspacePolicy(request: NativeSdkChildRuntimeRequest): SandboxPolicy | undefined {
  if (!inheritsParentWorkspaceWrite(request)) return undefined
  return {
    mode: 'workspace-write',
    workspaceRoot: request.parentPolicy.workspaceRoot,
    sessionId: request.parentSessionId,
  }
}

function policyFor(request: NativeSdkChildRuntimeRequest, home: string): SandboxPolicy | undefined {
  if (request.parentPolicy.mode === 'danger-full-access' && request.builtinTools.includes('write_file')) return undefined
  return inheritedWorkspacePolicy(request) ?? {
    mode: 'read-only',
    workspaceRoot: home,
    sessionId: request.parentSessionId,
  }
}

function containsPath(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function removePrivateHome(path: string, root: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('dsh: private child home was replaced before cleanup')
  }
  const [actualRoot, actualHome] = await Promise.all([realpath(root), realpath(path)])
  if (!containsPath(actualRoot, actualHome) || resolve(path) !== actualHome) {
    throw new Error('dsh: private child home moved before cleanup')
  }
  await rm(path, { recursive: true, force: false })
}

/** Install the fixed same-version launcher capability into a native Host. */
export const nativeSdkChildRuntimeLauncher: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-sdk-child-runtime-launcher',
  targets: ['host'],
  requires: ['childConnection', 'sandbox'],
  provides: ['sdkChildRuntimeLauncher'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).length > 0)) {
      throw new Error('dsh native SDK child launcher accepts no configuration')
    }
    return (context) => {
      const baseConnection = context.require('childConnection')
      const sandbox = context.require('sandbox')
      const launcher: NativeSdkChildRuntimeLauncher = {
        async launch(request, signal): Promise<NativeSdkChildRuntime> {
          signal.throwIfAborted()
          let privateRoot = await realpath(tmpdir())
          const inheritedPolicy = inheritedWorkspacePolicy(request)
          if (process.platform === 'win32' && inheritedPolicy !== undefined) {
            const authorizedTempRoot = sandbox.prepareWritableTempRoot?.(inheritedPolicy)
            if (authorizedTempRoot === undefined) {
              throw new Error('dsh: Windows sandbox did not expose the parent Session temp capability')
            }
            privateRoot = await realpath(authorizedTempRoot)
          }
          const createdHome = await mkdtemp(join(privateRoot, 'dsh-sdk-child-'))
          try {
            const home = await realpath(createdHome)
            if (resolve(home) !== resolve(createdHome) || !containsPath(privateRoot, home)) {
              throw new Error('dsh: private child home changed during creation')
            }
            signal.throwIfAborted()
            const overlay = join(home, 'provider.json')
            await writeFile(overlay, JSON.stringify({
              formatVersion: 1,
              installations: [{ id: 'pi-ai', config: { providers: { [request.provider]: request.providerProfile } } }],
            }), { encoding: 'utf8', flag: 'wx' })
            const policy = inheritedPolicy ?? policyFor(request, home)
            const resolvedRuntime = resolveNativeSdkChildRuntime(request, home, overlay)
            const runtime = request.parentApprovalRelay
              ? {
                ...resolvedRuntime,
                environment: () => ({
                  ...resolvedRuntime.environment(),
                  [NATIVE_SDK_CHILD_APPROVAL_RELAY_ENV]: '1',
                }),
              }
              : resolvedRuntime
            let enforcement: SandboxEnforcement | 'unconfined'
            let argv: string[]
            if (policy === undefined) {
              argv = [runtime.command, ...runtime.args]
              enforcement = 'unconfined'
            } else {
              const childArgv = [runtime.command, ...runtime.args]
              const cwd = await realpath(runtime.cwd ?? request.cwd)
              const confined = sandbox.confineChildProcess(childArgv, policy, { cwd, privateHome: home })
              argv = confined.argv
              enforcement = confined.enforcement
            }
            const childConnection: ChildConnectionDefinition = {
              connect(spec) {
                signal.throwIfAborted()
                if (spec.cwd !== runtime.cwd && resolve(spec.cwd) !== resolve(runtime.cwd ?? request.cwd)) {
                  throw new Error('dsh: child launcher received a different process cwd')
                }
                const expected = [runtime.command, ...runtime.args]
                if (spec.argv.length !== expected.length || spec.argv.some((arg, index) => arg !== expected[index])) {
                  throw new Error('dsh: child launcher received a different executable or argv')
                }
                return baseConnection.connect({ ...spec, argv })
              },
            }
            let disposeTask: Promise<void> | undefined
            return {
              runtime,
              childConnection,
              enforcement,
              dispose(): Promise<void> {
                return disposeTask ??= removePrivateHome(createdHome, privateRoot)
              },
            }
          } catch (error) {
            try { await removePrivateHome(createdHome, privateRoot) } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], 'dsh: child launch and private-home cleanup failed')
            }
            throw error
          }
        },
      }
      context.provide('sdkChildRuntimeLauncher', launcher)
    }
  },
}
