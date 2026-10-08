/** Program-owned launcher for one fixed Native SDK child. */

import { mkdtemp, lstat, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess/native'
import type { SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'
import type { NativeSdkChildRuntime, NativeSdkChildRuntimeLauncher,
  NativeSdkChildRuntimeRequest } from '@deepseek-ai/dsh-sdk-runtime/native'
import { resolveDshLaunch } from './launch.ts'

export const NATIVE_SDK_CHILD_APPROVAL_RELAY_ENV = 'DSH_NATIVE_SDK_CHILD_APPROVAL_RELAY'

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
    mode: 'workspace-write',
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
    throw new Error('dsh-sdk-client: private child home was replaced before cleanup')
  }
  const [actualRoot, actualHome] = await Promise.all([realpath(root), realpath(path)])
  if (!containsPath(actualRoot, actualHome) || resolve(path) !== actualHome) {
    throw new Error('dsh-sdk-client: private child home moved before cleanup')
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
      throw new Error('dsh-sdk-client native launcher accepts no configuration')
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
              throw new Error('dsh-sdk-client: Windows sandbox did not expose the parent Session temp capability')
            }
            privateRoot = await realpath(authorizedTempRoot)
          }
          const createdHome = await mkdtemp(join(privateRoot, 'dsh-sdk-child-'))
          try {
            const home = await realpath(createdHome)
            if (resolve(home) !== resolve(createdHome) || !containsPath(privateRoot, home)) {
              throw new Error('dsh-sdk-client: private child home changed during creation')
            }
            signal.throwIfAborted()
            const overlay = join(home, 'provider.json')
            await writeFile(overlay, JSON.stringify({
              formatVersion: 1,
              installations: [{ id: 'pi-ai', config: { providers: { [request.provider]: request.providerProfile } } }],
            }), { encoding: 'utf8', flag: 'wx' })
            const policy = inheritedPolicy ?? policyFor(request, home)
            const resolvedRuntime = resolveDshLaunch({
              profile: 'native-sdk',
              processCwd: request.cwd,
              dshHome: home,
              patches: [overlay],
              env: { ...scrubbedParentEnv(), ...request.environment },
            })
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
              const confined = sandbox.confine(childArgv, policy)
              argv = confined.argv
              enforcement = confined.enforcement
            }
            const childConnection: ChildConnectionDefinition = {
              connect(spec) {
                signal.throwIfAborted()
                if (spec.cwd !== runtime.cwd && resolve(spec.cwd) !== resolve(runtime.cwd ?? request.cwd)) {
                  throw new Error('dsh-sdk-client: child launcher received a different process cwd')
                }
                const expected = [runtime.command, ...runtime.args]
                if (spec.argv.length !== expected.length || spec.argv.some((arg, index) => arg !== expected[index])) {
                  throw new Error('dsh-sdk-client: child launcher received a different executable or argv')
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
              throw new AggregateError([error, cleanupError], 'dsh-sdk-client: child launch and private-home cleanup failed')
            }
            throw error
          }
        },
      }
      context.provide('sdkChildRuntimeLauncher', launcher)
    }
  },
}
