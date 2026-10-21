import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as ide } from '@deepseek-ai/dsh-ide-code-oss/native'
import type { SubprocessOperations } from '@deepseek-ai/dsh-subprocess/native'

it.each(['builtinExtension', 'languagePack'] as const)('rejects a timed-out %s installer even when it exits zero', async (extension) => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-ide-install-'))
  const waitForExit = vi.fn(async () => true)
  const terminate = vi.fn()
  const spawn = vi.fn<SubprocessOperations['spawn']>((spec) => {
    if (!spec.argv.includes('--install-extension')) throw new Error('Server started after installation timed out')
    const signal = spec.signal!
    return {
      stdin: undefined, stdout: undefined, stderr: undefined, collected: {}, terminate, waitForExit,
      done: new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
      }),
    }
  })
  const provider: NativePlugin = {
    apiVersion: 1, name: 'test-installer', targets: ['host'], requires: [], provides: ['subprocess'],
    resolve: () => (context) => {
      context.provide('subprocess', {
        spawn,
        async resolveExecutable() { throw new Error('Unexpected executable lookup') },
        async spawnTerminal() { throw new Error('Unexpected terminal allocation') },
      })
    },
  }
  let host: NativeHost | undefined
  try {
    await mkdir(join(directory, 'out'))
    await writeFile(join(directory, process.platform === 'win32' ? 'node.exe' : 'node'), '')
    await writeFile(join(directory, 'out', 'server-main.js'), '')
    const scope = new NativeScope()
    host = new NativeHost(resolveInstallation([
      { plugin: provider, scope, config: undefined },
      { plugin: ide, scope, config: {
        runtimeDirectory: directory, workspaceDirectory: directory, dataDirectory: join(directory, 'data'),
        startupTimeoutMs: 30, shutdownGraceMs: 10, maxOutputBytes: 1024,
        [extension]: extension === 'builtinExtension' ? join(directory, 'adapter.vsix') : 'example.language',
      } },
    ], 'host'))
    await expect(host.start()).rejects.toThrow(/timeout/i)
    await expect(host.stop()).rejects.toThrow(/timeout/i)
    host = undefined
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledOnce()
    expect(waitForExit).toHaveBeenCalledOnce()
  } finally {
    await host?.stop().catch(() => { /* Failed activation is asserted above; release the test directory. */ })
    await rm(directory, { recursive: true, force: true })
  }
})
