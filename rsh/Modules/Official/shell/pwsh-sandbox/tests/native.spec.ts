import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ShellOperations } from '@deepseek-ai/dsh-shell/native'
import type { SubprocessOperations, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess/native'
import type { ProcessSandbox } from '@deepseek-ai/dsh-sandbox/native'
import { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { plugin } from '../src/native.ts'
import { ENCODING_PREAMBLE } from '@deepseek-ai/dsh-pwsh-local/src/controller.ts'

it('reports a confined denial and never falls back when the runner fails', async () => {
  const spawns: SubprocessSpawnSpec[] = []
  const subprocess: SubprocessOperations = {
    resolveExecutable: async command => command,
    spawn(spec) {
      spawns.push(spec)
      if (spawns.length === 2) throw new Error('runner unavailable')
      return {
        stdin: undefined, stdout: undefined, stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: 'permission denied', nextOffset: 17, lossy: false }) },
        },
        done: Promise.resolve({ exitCode: 1, signal: null }),
        terminate: vi.fn(), waitForExit: async () => true,
      }
    },
    spawnTerminal: async () => { throw new Error('terminal not requested') },
  }
  const sandbox: ProcessSandbox = {
    confine: argv => ({ argv: ['test-runner', ...argv], enforcement: 'full', denialSignatures: ['permission denied'], runnerFailureRules: [] }),
  }
  const services: NativePlugin = {
    apiVersion: 1, name: 'test-shell-services', targets: ['host'], requires: [],
    provides: ['subprocess', 'sandbox', 'sandboxPolicy'],
    resolve: () => (context) => {
      context.provide('subprocess', subprocess)
      context.provide('sandbox', sandbox)
      context.provide('sandboxPolicy', new NativeSandboxPolicy({ mode: 'read-only', workspaceRoot: process.cwd() }))
    },
  }
  let shell: ShellOperations | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'test-shell-consumer', targets: ['host'], requires: ['shell'], provides: [],
    resolve: () => (context) => { shell = context.require('shell') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { pwshPath: 'C:\test-pwsh.exe' } },
    { plugin: services, scope, config: undefined },
  ], 'host'))
  expect(() => resolveInstallation([
    { plugin, scope, config: { pwshPath: ' ' } },
    { plugin: services, scope, config: undefined },
  ], 'host')).toThrow('pwsh-local: pwshPath must be a nonempty executable')
  await host.start()
  try {
    if (shell === undefined) throw new Error('shell was not installed')
    const command = 'touch file'
    const first = await shell.run(shell.resolve({ command }))
    expect(first.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    await expect(shell.run(shell.resolve({ command }))).rejects.toThrow('runner unavailable')
    expect(spawns.map(spec => spec.argv)).toEqual([
      ['test-runner', 'C:\test-pwsh.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ENCODING_PREAMBLE + command],
      ['test-runner', 'C:\test-pwsh.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ENCODING_PREAMBLE + command],
    ])
  } finally {
    await host.stop()
  }
})
