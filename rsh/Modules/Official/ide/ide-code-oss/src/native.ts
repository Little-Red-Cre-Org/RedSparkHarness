/** Native Provider for a separately installed Code - OSS Web Host distribution. */
import { createHash, randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import type {} from './index.ts'

const absolutePath = z.string().min(1).refine(isAbsolute, 'must be an absolute path')
const configSchema = z.strictObject({
  runtimeDirectory: absolutePath,
  workspaceDirectory: absolutePath,
  dataDirectory: absolutePath,
  builtinExtension: absolutePath.optional(),
  languagePack: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/i).optional(),
  startupTimeoutMs: z.number().int().min(1).max(2_147_483_647),
  shutdownGraceMs: z.number().int().min(1).max(2_147_483_647),
  maxOutputBytes: z.number().int().min(1024),
})

/** Native IDE Provider; resolve validates configuration without acquiring resources. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-ide-code-oss',
  targets: ['host'],
  requires: ['subprocess'],
  provides: ['ide'],
  resolve(input) {
    const config = configSchema.parse(input)
    return async (context) => {
      const runtime = await realpath(config.runtimeDirectory)
      const workspace = await realpath(config.workspaceDirectory)
      if (!(await stat(workspace)).isDirectory()) throw new Error('IDE workspace must be a directory')
      const executable = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node')
      const entry = join(runtime, 'out', 'server-main.js')
      await Promise.all([access(executable), access(entry)])
      await mkdir(config.dataDirectory, { recursive: true })
      const portFile = join(config.dataDirectory, 'server-port')
      let savedPort: string | undefined
      try { savedPort = await readFile(portFile, 'utf8') } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const requestedPort = savedPort === undefined ? 0 : z.coerce.number().int().min(1).max(65535).parse(savedPort)
      const workspaceKey = createHash('sha256').update(process.platform === 'win32' ? workspace.toLowerCase() : workspace).digest('hex')
      const workspaceRoot = join(config.dataDirectory, 'workspaces', workspaceKey)
      await mkdir(workspaceRoot, { recursive: true })
      const workspaceFile = join(workspaceRoot, 'RedSpark.code-workspace')
      try { await writeFile(workspaceFile, JSON.stringify({ folders: [{ path: workspace }] }), { flag: 'wx' }) } catch (error) {
        // Code OSS owns subsequent folder and workspace-setting edits.
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      const dataArgs = ['--server-data-dir', config.dataDirectory,
        '--user-data-dir', join(config.dataDirectory, 'user-data'),
        '--extensions-dir', join(config.dataDirectory, 'extensions')]
      for (const extension of [config.builtinExtension, config.languagePack]) {
        if (extension === undefined) continue
        const signal = AbortSignal.any([context.signal, AbortSignal.timeout(config.startupTimeoutMs)])
        const installer = context.require('subprocess').spawn({
          argv: [executable, entry, ...dataArgs, '--install-extension', extension, ...(extension === config.builtinExtension ? ['--force'] : [])],
          cwd: workspace,
          stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxOutputBytes }, stderr: { maxBytes: config.maxOutputBytes } },
          graceMs: config.shutdownGraceMs,
          signal,
          env: { NODE_OPTIONS: undefined, NODE_PATH: undefined },
        })
        try {
          const outcome = await installer.done
          signal.throwIfAborted()
          if (outcome.exitCode !== 0) throw new Error(`IDE extension installation failed (code ${String(outcome.exitCode)})`)
        } finally {
          installer.terminate()
          await installer.waitForExit()
        }
      }
      const privateDirectory = await mkdtemp(join(config.dataDirectory, '.connection-'))
      context.own(() => rm(privateDirectory, { recursive: true, force: true }))
      const token = randomBytes(32).toString('hex')
      const tokenFile = join(privateDirectory, 'token')
      await writeFile(tokenFile, token, { flag: 'wx', mode: 0o600 })
      const ready = Promise.withResolvers<number>()
      let startupOutput = ''
      const child = context.require('subprocess').spawn({
        argv: [executable, entry, '--start-server', '--host', '127.0.0.1', '--port', String(requestedPort),
          '--connection-token-file', tokenFile, '--telemetry-level', 'off',
          ...dataArgs],
        cwd: workspace,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: config.maxOutputBytes, onData(chunk) {
            startupOutput = (startupOutput + Buffer.from(chunk).toString('utf8')).slice(-config.maxOutputBytes)
            const match = /Extension host agent listening on (\d+)\r?\n/u.exec(startupOutput)
            if (match !== null) ready.resolve(Number(match[1]))
          } },
          stderr: { maxBytes: config.maxOutputBytes },
        },
        graceMs: config.shutdownGraceMs,
        signal: context.signal,
        env: { NODE_OPTIONS: undefined, NODE_PATH: undefined },
      })
      context.own(async () => {
        child.terminate()
        await child.waitForExit()
        await child.done
      })
      const exited = child.done.then((outcome) => {
        if (outcome.exitCode === null) throw new Error(`IDE server terminated by ${outcome.signal ?? 'an unknown signal'}`)
        return outcome.exitCode
      })
      const abort = (): void => { ready.reject(context.signal.reason) }
      context.signal.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() =>{  ready.reject(new Error('IDE server startup timed out')) }, config.startupTimeoutMs)
      let port: number
      try {
        context.signal.throwIfAborted()
        port = await Promise.race([ready.promise, exited.then((code) => {
          throw new Error(`IDE server exited before readiness (code ${code})`)
        })])
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IDE server reported an invalid port')
        if (requestedPort !== 0 && port !== requestedPort) throw new Error(`IDE server did not bind its saved port ${requestedPort}`)
        if (savedPort === undefined) await writeFile(portFile, `${port}\n`, { flag: 'wx' })
        const url = new URL(`http://127.0.0.1:${port}/`)
        url.searchParams.set('tkn', token)
        // Code OSS parses an unprefixed Windows drive as a URI scheme.
        url.searchParams.set('workspace', (process.platform === 'win32' ? '/' : '') + workspaceFile.replaceAll('\\', '/'))
        context.provide('ide', { url: url.href, exited })
      } finally {
        clearTimeout(timeout)
        context.signal.removeEventListener('abort', abort)
      }
    }
  },
}
