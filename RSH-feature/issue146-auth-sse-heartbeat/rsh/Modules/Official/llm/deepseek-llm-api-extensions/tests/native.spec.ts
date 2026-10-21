import { afterEach, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as nativeExtensions } from '../src/native.ts'
import type { NativeDeepSeekLlmApiExtensions } from '../src/native.ts'

declare module '@deepseek-ai/dsh-deepseek-llm-api-extensions/types' {
  interface DeepSeekLlmApiExtensionMap {
    test_native: string
  }
}

const hosts: NativeHost[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
})

it('keeps scoped Native request snapshots and acceptance callbacks independent of registry removal', async () => {
  const root = new NativeScope()
  const child = new NativeScope(root)
  let registry: NativeDeepSeekLlmApiExtensions | undefined
  let childAccepts = 0
  let rootAccepts = 0
  const rootContribution: NativePlugin = {
    apiVersion: 1, name: 'test-root-extension', targets: ['host'],
    requires: ['deepseekLlmApiExtensions'], provides: [],
    resolve: () => (context) => {
      registry = context.require('deepseekLlmApiExtensions')
      context.effect(registry.register(context.scope, 'test_native', {
        prepare: () => ({ value: 'root', accept: () => { rootAccepts++ } }),
      }))
    },
  }
  const childContribution: NativePlugin = {
    apiVersion: 1, name: 'test-child-extension', targets: ['host'],
    requires: ['deepseekLlmApiExtensions'], provides: [],
    resolve: () => (context) => {
      const extensions = context.require('deepseekLlmApiExtensions')
      context.effect(extensions.register(context.scope, 'test_native', {
        prepare: () => ({ value: 'child', accept: () => { childAccepts++ } }),
      }))
    },
  }
  const rootRequest = { plugin: rootContribution, scope: root, config: undefined }
  const childRequest = { plugin: childContribution, scope: child, config: undefined }
  const host = new NativeHost(resolveInstallation([
    { plugin: nativeExtensions, scope: root, config: undefined }, rootRequest, childRequest,
  ], 'host'))
  hosts.push(host)
  await host.start()
  if (registry === undefined) throw new Error('Native extension service was not captured')

  const request = { body: {}, signal: new AbortController().signal }
  const dynamicChild = new NativeScope(child)
  const detached = await registry.prepare(dynamicChild, request)
  expect(detached.fields).toEqual({ test_native: 'child' })
  expect((await registry.prepare(new NativeScope(root), request)).fields).toEqual({ test_native: 'root' })

  await host.remove(childRequest)
  expect((await registry.prepare(dynamicChild, request)).fields).toEqual({ test_native: 'root' })
  await Promise.all([detached.accept(), detached.accept()])
  expect(childAccepts).toBe(1)
  expect(rootAccepts).toBe(0)
})
