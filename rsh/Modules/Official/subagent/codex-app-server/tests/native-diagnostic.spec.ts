import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '@redspark/rsh-native-subagent/native'
import type { ChildConnectionDefinition } from '@redspark/rsh-subprocess/native'
import type { NativeCodexProductRun } from '../src/native-product-run.ts'
import { plugin as codexPlugin } from '../src/native.ts'

const { startNativeCodexProductRun } = vi.hoisted(() => ({ startNativeCodexProductRun: vi.fn() }))

vi.mock('../src/native-product-run.ts', () => ({ startNativeCodexProductRun }))

const limits = { requestBytes: 1024, responseBytes: 1024, jsonDepth: 8, sseEvents: 4 }

function request(): NativeExternalSubagentRequest {
  return {
    prompt: [{ type: 'text', text: 'inspect the failure' }],
    cwd: '/workspace',
    route: { provider: 'deepseek', model: 'deepseek-v4-flash', overrides: {} },
    limits: { maxSteps: 4 },
    responses: {
      route: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      outputTokenLimit: 'supported',
      forward: () => { throw new Error('codex diagnostic test: forward is unused') },
      projectRequest: () => { throw new Error('codex diagnostic test: projectRequest is unused') },
    },
    model: {},
  } as unknown as NativeExternalSubagentRequest
}

function product(diagnostic: string | undefined): NativeCodexProductRun {
  return {
    remoteId: 'thread-1',
    codexHome: '/codex-home',
    configPath: '/codex-home/config.toml',
    gatewayUrl: 'http://127.0.0.1:9',
    result: Promise.resolve({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'error',
      ...diagnostic === undefined ? {} : { diagnostic },
    }),
    collectOutput: () => [],
    dispose: () => Promise.resolve(),
  }
}

async function withDriver(run: (driver: NativeExternalSubagentDriver) => Promise<void>): Promise<void> {
  const scope = new NativeScope()
  let driver: NativeExternalSubagentDriver | undefined
  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'codex-diagnostic-capture',
    targets: ['host'],
    requires: ['externalSubagentDriver'],
    provides: [],
    resolve: () => (context) => { driver = context.require('externalSubagentDriver') },
  }
  const connection = { connect: () => { throw new Error('codex diagnostic test: connection is unused') } } as unknown as ChildConnectionDefinition
  const dependency: NativePlugin = {
    apiVersion: 1,
    name: 'codex-diagnostic-connection',
    targets: ['host'],
    requires: [],
    provides: ['childConnection'],
    resolve: () => (context) => { context.provide('childConnection', connection) },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: codexPlugin, scope, config: { name: 'codex-test', limits } },
    { plugin: dependency, scope, config: undefined },
  ], 'host'))
  await host.start()
  try {
    if (driver === undefined) throw new Error('codex diagnostic test: driver was not installed')
    await run(driver)
  } finally {
    await host.stop()
  }
}

it('keeps a product diagnostic on the Native Codex outcome', async () => {
  startNativeCodexProductRun.mockResolvedValue(product('permission denied'))
  await withDriver(async (driver) => {
    const started = await driver.start(request(), new AbortController().signal)
    await expect(started.result).resolves.toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'error',
      diagnostic: 'permission denied',
    })
    await started.dispose()
  })
  expect(startNativeCodexProductRun).toHaveBeenCalledOnce()
})

it('omits diagnostic when the product result has none', async () => {
  startNativeCodexProductRun.mockResolvedValue(product(undefined))
  await withDriver(async (driver) => {
    const started = await driver.start(request(), new AbortController().signal)
    await expect(started.result).resolves.toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'error',
    })
    await started.dispose()
  })
})
