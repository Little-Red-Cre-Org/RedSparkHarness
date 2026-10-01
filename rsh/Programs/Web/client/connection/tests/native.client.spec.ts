// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as connectionProvider } from '../src/native.ts'
import type { ConnectionHandle } from '../src/client/native-core.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('native Client connection', () => {
  it('shares browser RPC and waits for generation cleanup on Host stop', async () => {
    const rpc = { call: vi.fn(), open: vi.fn() }
    vi.stubGlobal('__DSH_TRANSPORT__', { rpc, ownsHost: true })
    let connection: ConnectionHandle | undefined
    const consumer: NativePlugin = {
      apiVersion: 1,
      name: 'connection-consumer',
      targets: ['client'],
      requires: ['clientConnection'],
      provides: [],
      resolve: () => (context) => { connection = context.require('clientConnection') },
    }
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: connectionProvider, scope, config: {} },
      { plugin: consumer, scope, config: undefined },
    ], 'client'))
    await host.start()
    expect(connection?.rpc).toBe(rpc)
    expect(connection?.isLoopback).toBe(true)

    let release!: () => void
    const draining = new Promise<void>((resolve) => { release = resolve })
    const sourceEnded = vi.fn()
    connection?.registerGenerationSource(async (signal, ready) => {
      ready({ home: '/native-home' })
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      await draining
      sourceEnded()
    })
    const loop = connection?.start({})
    await vi.waitFor(() => {
      expect(connection?.generation.getSnapshot()?.host.home).toBe('/native-home')
    })

    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    await vi.waitFor(() => { expect(connection?.generation.getSnapshot()).toBeUndefined() })
    expect(stopped).toBe(false)
    expect(sourceEnded).not.toHaveBeenCalled()
    release()
    await stopping
    expect(sourceEnded).toHaveBeenCalledOnce()
    expect(host.diagnostics().every(row => row.state === 'disposed')).toBe(true)
    loop?.stop()
  })

  it('waits for a previously stopped generation when the Host stops', async () => {
    let connection: ConnectionHandle | undefined
    const consumer: NativePlugin = {
      apiVersion: 1,
      name: 'connection-consumer',
      targets: ['client'],
      requires: ['clientConnection'],
      provides: [],
      resolve: () => (context) => { connection = context.require('clientConnection') },
    }
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin: connectionProvider, scope, config: {} },
      { plugin: consumer, scope, config: undefined },
    ], 'client'))
    await host.start()

    let release!: () => void
    const draining = new Promise<void>((resolve) => { release = resolve })
    const sourceEnded = vi.fn()
    connection?.registerGenerationSource(async (signal, ready) => {
      ready({ home: '/native-home' })
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      await draining
      sourceEnded()
    })
    const loop = connection?.start({})
    await vi.waitFor(() => { expect(connection?.generation.getSnapshot()).toBeDefined() })
    loop?.stop()

    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    await vi.waitFor(() => { expect(connection?.generation.getSnapshot()).toBeUndefined() })
    expect(stopped).toBe(false)
    release()
    await stopping
    expect(sourceEnded).toHaveBeenCalledOnce()
  })

  it('rejects unsupported profile configuration before installation', () => {
    expect(() => resolveInstallation([
      { plugin: connectionProvider, scope: new NativeScope(), config: { reconnect: true } },
    ], 'client')).toThrow('client-connection: configuration must be an empty object')
  })
})
