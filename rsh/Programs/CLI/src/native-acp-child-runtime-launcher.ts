/** Program-owned launcher for one fixed Native ACP child profile. */

import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { disposeChildConnection } from '@deepseek-ai/dsh-subprocess/native'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess/native'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'
import type {
  NativeAcpChildRuntime, NativeAcpChildRuntimeLauncher, NativeAcpChildRuntimeRequest,
} from '@deepseek-ai/dsh-acp-child/native'

interface CliManifest {
  readonly bin?: unknown
}

interface FixedChildProcess {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function fixedChildProcess(request: NativeAcpChildRuntimeRequest, cwd: string, home: string, overlay: string): FixedChildProcess {
  const manifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
  const packageRoot = dirname(manifestPath)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CliManifest
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
      throw new Error(`dsh: source ACP child launch is missing ${sourceBin} or ${sourceTsconfig}`)
    }
    nodeArgs = ['--import', import.meta.resolve('tsx/esm'), sourceBin]
    sourceEnvironment = { TSX_TSCONFIG_PATH: sourceTsconfig }
  } else {
    throw new Error(`dsh: built ACP child launch is missing ${builtBin}`)
  }
  const env = { ...scrubbedParentEnv(), ...request.environment }
  const hasSystemRoot = Object.keys(env).some(name => name.toUpperCase() === 'SYSTEMROOT')
  if (process.platform === 'win32' && !hasSystemRoot && process.env.SystemRoot !== undefined) {
    env.SystemRoot = process.env.SystemRoot
  }
  return {
    argv: [process.execPath, ...nodeArgs, '--profile', 'native-acp-dsh-child', '--patch', overlay],
    cwd,
    env: { ...env, ...sourceEnvironment, DSH_HOME: resolve(home) },
  }
}

function isWithin(root: string, path: string, allowSame = false): boolean {
  const child = relative(root, path)
  return (allowSame && child === '') || (child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function writeAuthority(request: NativeAcpChildRuntimeRequest): boolean {
  const unsupported = request.allowedTools.find(name => name !== 'read_file' && name !== 'write_file')
  if (unsupported !== undefined) {
    throw new Error(`dsh: ACP child does not support the requested tool ${JSON.stringify(unsupported)}`)
  }
  if (request.allowedTools.some(name => !request.builtinTools.some(tool => tool === name))) {
    throw new Error('dsh: ACP child allowlist exceeds its builtin grants')
  }
  const builtinWrite = request.builtinTools.includes('write_file')
  const allowed = request.allowedTools.includes('write_file')
  const requested = builtinWrite && allowed
  if (allowed && !builtinWrite) {
    throw new Error('dsh: ACP child allowlist grants write_file without a builtin grant')
  }
  if (request.permissionMode === 'parent-relay' && !requested) {
    throw new Error('dsh: ACP child parent-relay requires an allowed write_file builtin')
  }
  const parentAllows = request.permissionMode === 'parent-relay' && request.parentPolicy.mode === 'workspace-write'
  if (requested && !parentAllows) {
    throw new Error('dsh: ACP child write_file requires parent-relay and workspace-write authority')
  }
  if (requested !== (request.workspaceWriteRoot !== undefined)) {
    throw new Error('dsh: ACP child workspaceWriteRoot must match write_file authority')
  }
  return requested
}

async function removePrivateHome(path: string, root: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('dsh: private ACP child home was replaced before cleanup')
  }
  const [actualRoot, actualHome] = await Promise.all([realpath(root), realpath(path)])
  if (!isWithin(actualRoot, actualHome) || resolve(path) !== actualHome) {
    throw new Error('dsh: private ACP child home moved before cleanup')
  }
  await rm(path, { recursive: true, force: false })
}

/** Install the fixed same-version launcher capability into a native Host. */
export const nativeAcpChildRuntimeLauncher: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-acp-child-runtime-launcher',
  targets: ['host'],
  requires: ['childConnection', 'sandbox'],
  provides: ['acpChildRuntimeLauncher'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).length > 0)) {
      throw new Error('dsh native ACP child launcher accepts no configuration')
    }
    return (context) => {
      const baseConnection = context.require('childConnection')
      const sandbox = context.require('sandbox')
      const launcher: NativeAcpChildRuntimeLauncher = {
        async launch(request, signal): Promise<NativeAcpChildRuntime> {
          signal.throwIfAborted()
          if (!isAbsolute(request.cwd) || !isAbsolute(request.parentPolicy.workspaceRoot)) {
            throw new Error('dsh: ACP child workspace paths must be absolute')
          }
          if (request.parentPolicy.sessionId !== undefined && request.parentPolicy.sessionId !== request.parentSessionId) {
            throw new Error('dsh: ACP child sandbox policy belongs to a different parent Session')
          }
          const [workspaceRoot, cwd] = await Promise.all([
            realpath(request.parentPolicy.workspaceRoot), realpath(request.cwd),
          ])
          if (!isWithin(workspaceRoot, cwd, true)) {
            throw new Error('dsh: ACP child cwd escapes its parent workspace')
          }
          const canWrite = writeAuthority(request)
          let writeRoot: string | undefined
          if (canWrite) {
            writeRoot = await realpath(request.workspaceWriteRoot as string)
            if (writeRoot !== workspaceRoot) {
              throw new Error('dsh: ACP child workspaceWriteRoot differs from the parent sandbox root')
            }
          }
          const policy: SandboxPolicy = canWrite
            ? { mode: 'workspace-write', workspaceRoot, sessionId: request.parentSessionId }
            : { mode: 'read-only', workspaceRoot, sessionId: request.parentSessionId }
          let privateRoot = await realpath(tmpdir())
          if (process.platform === 'win32' && canWrite) {
            const authorizedTempRoot = sandbox.prepareWritableTempRoot?.(policy)
            if (authorizedTempRoot === undefined) {
              throw new Error('dsh: Windows sandbox did not expose the parent Session temp capability')
            }
            privateRoot = await realpath(authorizedTempRoot)
          }
          const createdHome = await mkdtemp(join(privateRoot, 'dsh-acp-child-'))
          try {
            const home = await realpath(createdHome)
            if (resolve(home) !== resolve(createdHome) || !isWithin(privateRoot, home)) {
              throw new Error('dsh: private ACP child home changed during creation')
            }
            signal.throwIfAborted()
            const overlay = join(home, 'provider.json')
            const appConfig = {
              provider: request.provider,
              model: request.model,
              systemPrompt: request.systemPrompt,
              maxSteps: request.maxSteps,
              ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
              builtinTools: request.builtinTools.length > 0,
              allowedTools: request.allowedTools,
              ...(writeRoot === undefined ? {} : { workspaceWriteRoot: writeRoot }),
            }
            await writeFile(overlay, JSON.stringify({
              formatVersion: 1,
              installations: [
                { id: 'app', config: appConfig },
                { id: 'pi-ai', config: { providers: { [request.provider]: request.providerProfile } } },
              ],
            }), { encoding: 'utf8', flag: 'wx' })
            const runtime = fixedChildProcess(request, cwd, home, overlay)
            const confined = sandbox.confineChildProcess(runtime.argv, policy, { cwd, privateHome: home })
            signal.throwIfAborted()
            const child: ChildConnectionDefinition = baseConnection
            const handle = child.connect({ argv: confined.argv, cwd, env: runtime.env,
              envMode: 'replace', graceMs: 3_000, signal })
            let shutdownTask: Promise<void> | undefined
            let disposeTask: Promise<void> | undefined
            return {
              child: handle,
              enforcement: confined.enforcement,
              shutdown(): Promise<void> {
                return shutdownTask ??= disposeChildConnection(handle, { eofGraceMs: 3_000, terminationGraceMs: 3_000 })
              },
              dispose(): Promise<void> {
                return disposeTask ??= (async () => {
                  await (shutdownTask ??= disposeChildConnection(handle, { eofGraceMs: 3_000, terminationGraceMs: 3_000 }))
                  await removePrivateHome(createdHome, privateRoot)
                })()
              },
            }
          } catch (error) {
            try { await removePrivateHome(createdHome, privateRoot) } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], 'dsh: ACP child launch and private-home cleanup failed')
            }
            throw error
          }
        },
      }
      context.provide('acpChildRuntimeLauncher', launcher)
    }
  },
}
