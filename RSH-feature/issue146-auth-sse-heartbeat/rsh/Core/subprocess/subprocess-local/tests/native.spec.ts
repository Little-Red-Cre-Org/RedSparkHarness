import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SubprocessOperations, SubprocessHandle } from '@deepseek-ai/dsh-subprocess/native'
import { plugin } from '../src/native.ts'

describe('native local subprocess Provider', () => {
  it('rejects configuration because every process choice belongs to its request', () => {
    expect(() => plugin.resolve({ graceMs: 50 })).toThrow('accepts no configuration')
  })

  it('registers the local service and drains a live process on host stop', async () => {
    const before = new Set(process.listeners('exit'))
    const scope = new NativeScope()
    let subprocess: SubprocessOperations | undefined
    const capture: NativePlugin = {
      apiVersion: 1, name: 'test-subprocess-consumer', targets: ['host'], requires: ['subprocess'], provides: [],
      resolve: () => (context) => { subprocess = context.require('subprocess') },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: capture, scope, config: undefined },
      { plugin, scope, config: undefined },
    ], 'host'))
    await host.start()
    if (subprocess === undefined) throw new Error('native subprocess service was not installed')
    let handle: SubprocessHandle | undefined
    try {
      expect(await subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
      handle = subprocess.spawn({
        argv: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
        graceMs: 200,
      })
      const listener = process.listeners('exit').find(candidate => !before.has(candidate))
      expect(listener).toBeTypeOf('function')
      await host.stop()
      expect(await handle.waitForExit()).toBe(true)
      expect(process.listeners('exit')).not.toContain(listener)
    } finally {
      await host.stop()
      await handle?.waitForExit()
    }
  })
})
