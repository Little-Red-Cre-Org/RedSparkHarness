/** Native worker-thread execution through the framework-free Host provider. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig, type NativeCodeRuntime } from '../src/index.ts'
import { plugin } from '../src/native.ts'

describe('native code runtime', () => {
  it('matches its native manifest and admits default profile configuration', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { native: unknown }
      exports: Record<string, unknown>
    }
    const entry = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
    expect(validateNativePluginEntry(plugin, entry)).toBe(plugin)
    expect(resolveNativeWorkerThreadConfig(undefined)).toEqual({
      computeMs: 60_000, maxWallMs: 600_000, maxOutputBytes: 67_108_864, maxOldGenerationSizeMb: 512,
    })
    expect(() => resolveNativeWorkerThreadConfig({ computeMs: 1, unexpected: true })).toThrow('unknown configuration field unexpected')
  })

  it('runs TypeScript with lossless binding calls and releases workers on Host stop', async () => {
    const root = new NativeScope()
    let runtime: NativeCodeRuntime | undefined
    const capture: NativePlugin = {
      apiVersion: 1, name: 'native-code-runtime-capture', targets: ['host'], requires: ['codeRuntime'], provides: [],
      resolve: () => (context) => { runtime = context.require('codeRuntime') },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: capture, scope: root, config: undefined },
      { plugin, scope: root, config: { computeMs: 2_000, maxWallMs: 2_000 } },
    ], 'host'))
    try {
      await host.start()
      if (runtime === undefined) throw new Error('native code runtime fixture lost its service')
      const calls: unknown[] = []
      await expect(runtime.run({
        program: 'console.log("before"); return await tools.echo({ answer: 42 })',
        bindings: [{ global: 'tools', functions: { echo: async (args) => { calls.push(args); return args as { answer: number } } } }],
      })).resolves.toEqual({ logs: ['before'], value: { answer: 42 } })
      expect(calls).toEqual([{ answer: 42 }])
    } finally {
      await host.stop()
    }
  })

  it('reports an abort and refuses new runs after explicit disposal', async () => {
    const runtime = new NativeWorkerThreadCodeRuntime(resolveNativeWorkerThreadConfig({ computeMs: 2_000, maxWallMs: 2_000 }))
    const controller = new AbortController()
    try {
      setTimeout(() => { controller.abort('operator stopped') }, 50)
      await expect(runtime.run({ program: 'for (;;) {}', bindings: [], signal: controller.signal }))
        .resolves.toEqual({ logs: [], error: { kind: 'abort', message: 'operator stopped' } })
    } finally {
      await runtime.dispose()
    }
    await expect(runtime.run({ program: 'return 1', bindings: [] })).rejects.toThrow('run() after disposal')
  })
})
