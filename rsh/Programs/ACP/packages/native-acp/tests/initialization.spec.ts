/** Initialization remains owned until asynchronous model lookup has settled. */
import { setImmediate } from 'node:timers/promises'
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { LlmAdapter, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import { NativeAcpApplication, plugin as nativeAcpPlugin } from '../src/native.ts'

const inactiveSessions: NativeActiveSessionOperations = {
  register: async () => async () => {}, owner: () => undefined, owners: () => [],
  onAttached: () => async () => {}, onDetached: () => async () => {},
}

const inactiveSessionsPlugin: NativePlugin = {
  apiVersion: 1, name: 'initialization-active-sessions', targets: ['host'], requires: [], provides: ['activeSessions'],
  resolve: () => (context) => { context.provide('activeSessions', inactiveSessions) },
}

it('rejects ACP installation before activation without its active Session Provider', () => {
  const scope = new NativeScope()
  const provided = ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents'] as const
  const providers: NativePlugin[] = provided.map(service => ({
    apiVersion: 1, name: `planning-${service}`, targets: ['host'], requires: [], provides: [service],
    resolve: () => () => {},
  }))
  const requests = [
    ...providers.map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: nativeAcpPlugin, scope, config: undefined },
  ]
  expect(() => resolveInstallation(requests, 'host'))
    .toThrow('native-runtime: @deepseek-ai/dsh-native-acp requires missing activeSessions')
})

it('drains model initialization after EOF before releasing its Provider', async () => {
  const entered = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let modelSettled = false
  let modelReleased = false
  let runReturned = false
  class DeferredModel extends LlmAdapter {
    override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
      signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      entered.resolve(undefined)
      try {
        await release.promise
        signal?.throwIfAborted()
        return { provider, id: model, name: model }
      } finally { modelSettled = true }
    }

    override stream(): AsyncIterable<StreamChunk> { throw new Error('this fixture performs no model request') }
  }
  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()
  const scope = new NativeScope()
  let app: NativeAcpApplication | undefined
  const persistence: NativeSessionPersistenceOperations = {
    create: async () => { throw new Error('initialization fixture does not create Sessions') },
    open: async () => { throw new Error('initialization fixture does not open Sessions') },
    flush: async () => {}, stat: async () => undefined, list: async () => [],
  }
  const storage: NativePlugin = {
    apiVersion: 1, name: 'initialization-storage', targets: ['host'], requires: [], provides: ['sessionPersistence'],
    resolve: () => (context) => { context.provide('sessionPersistence', persistence) },
  }
  const model: NativePlugin = {
    apiVersion: 1, name: 'deferred-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', new DeferredModel())
      context.own(() => { modelReleased = true })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'initialization-carrier', targets: ['host'], requires: ['model', 'sessionPersistence', 'activeSessions'], optional: ['approval'],
    provides: ['application', 'rootExecution'],
    resolve: () => (context) => {
      app = new NativeAcpApplication(context, { provider: 'fixture', model: 'fixture', systemPrompt: 'fixture', maxSteps: 1,
        maxPendingPermissions: 32, mcpToolCallTimeoutMs: 60_000 }, input, output)
      context.provide('application', app)
      context.provide('rootExecution', app.rootExecution)
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: storage, scope, config: undefined },
    { plugin: inactiveSessionsPlugin, scope, config: undefined },
    { plugin: model, scope, config: undefined },
    { plugin: carrier, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined) throw new Error('fixture carrier did not activate')
  const application = app
  const done = host.run(scope, { kind: 'test' }, invocation => application.run([], invocation.signal)).then(async (result) => {
    runReturned = true
    await host.stop()
    return result
  })
  try {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })}\n`)
    await entered.promise
    input.end()
    await aborted.promise
    await setImmediate()
    expect({ runReturned, modelReleased, modelSettled }).toEqual({ runReturned: false, modelReleased: false, modelSettled: false })
    release.resolve(undefined)
    expect(await done).toBe(0)
    expect({ modelReleased, modelSettled }).toEqual({ modelReleased: true, modelSettled: true })
  } finally {
    release.resolve(undefined)
    input.end()
    await done
    await host.stop()
    input.destroy()
    output.destroy()
  }
})
