/** Native E2B registration validates configuration before opening a sandbox. */
import { beforeEach, expect, it, vi } from 'vitest'
import type { Sandbox as SandboxType } from 'e2b'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { E2BSandboxOwner, resolveE2BSandboxConfig } from '../src/owner.ts'
import { plugin, resolveNativeE2BConfig } from '../src/native.ts'
import { FileType } from 'e2b'

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('e2b')>()
  // The mock replaces only the SDK's static factory surface and is never constructed.
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with a static factory.
  class FakeSandbox {
    static create(...args: unknown[]): unknown {
      return sdk.create(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

beforeEach(() => {
  sdk.create.mockReset()
  vi.unstubAllEnvs()
})

it('rejects a missing key, a relative cwd, a non-positive lifetime, and unknown fields', () => {
  const original = process.env.E2B_API_KEY
  delete process.env.E2B_API_KEY
  try {
    expect(() => resolveNativeE2BConfig(undefined)).toThrow('dsh-e2b: configure apiKey or set E2B_API_KEY')
    expect(() => resolveNativeE2BConfig({})).toThrow('dsh-e2b: configure apiKey or set E2B_API_KEY')
    expect(() => plugin.resolve({})).toThrow('dsh-e2b: configure apiKey or set E2B_API_KEY')
  } finally {
    if (original === undefined) delete process.env.E2B_API_KEY
    else process.env.E2B_API_KEY = original
  }
  vi.stubEnv('E2B_API_KEY', 'from-env')
  expect(() => plugin.resolve({ apiKey: '' })).toThrow('dsh-e2b: configure apiKey or set E2B_API_KEY')
  expect(() => plugin.resolve({ apiKey: 'k', cwd: 'relative' })).toThrow('dsh-e2b: cwd must be an absolute Linux path: relative')
  expect(() => plugin.resolve({ apiKey: 'k', timeoutMs: 0 })).toThrow('dsh-e2b: timeoutMs must be a positive finite number')
  expect(() => plugin.resolve({ apiKey: 'k', timeoutMs: -1 })).toThrow('dsh-e2b: timeoutMs must be a positive finite number')
  expect(() => resolveE2BSandboxConfig({ apiKey: 'k', timeoutMs: Number.POSITIVE_INFINITY })).toThrow('dsh-e2b: timeoutMs must be a positive finite number')
  expect(() => plugin.resolve({ apiKey: 'k', extra: true })).toThrow()
  expect(sdk.create).not.toHaveBeenCalled()
})

it('defaults cwd and timeout without opening a sandbox', () => {
  expect(resolveE2BSandboxConfig({ apiKey: 'k' })).toEqual({
    apiKey: 'k',
    cwd: '/home/user/workspace',
    timeoutMs: 300_000,
  })
  expect(resolveNativeE2BConfig({ apiKey: 'explicit', cwd: '/workspace/project', timeoutMs: 60_000 })).toEqual({
    apiKey: 'explicit',
    cwd: '/workspace/project',
    timeoutMs: 60_000,
  })
  expect(resolveNativeE2BConfig({ apiKey: 'k' })).toEqual({
    apiKey: 'k',
    cwd: '/home/user/workspace',
    timeoutMs: 300_000,
  })
  const activate = plugin.resolve({ apiKey: 'k' })
  expect(activate).toEqual(expect.any(Function))
  expect(sdk.create).not.toHaveBeenCalled()
})

it('provides the sandbox owner and kills it when the host stops', async () => {
  const kill = vi.fn().mockResolvedValue(undefined)
  const sandbox = {
    sandboxId: 'native-sandbox',
    files: {
      makeDir: vi.fn().mockResolvedValue(true),
      getInfo: vi.fn().mockResolvedValue({ type: FileType.DIR }),
    },
    commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    kill,
  } as unknown as SandboxType
  sdk.create.mockResolvedValue(sandbox)
  const scope = new NativeScope()
  let owner: E2BSandboxOwner | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'e2b-native-consumer',
    targets: ['host'],
    requires: ['e2b'],
    provides: [],
    resolve: () => (context) => { owner = context.require('e2b') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: { apiKey: 'native-key' } },
  ], 'host'))
  await host.start()
  if (!(owner instanceof E2BSandboxOwner)) throw new Error('e2b service was not provided')
  await expect(owner.getSandbox()).resolves.toBe(sandbox)
  expect(owner.cwd).toBe('/home/user/workspace')
  expect(owner.runtimeRoot).toBe('/home/user/workspace/.dsh-e2b')
  expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: 'native-key',
    timeoutMs: 300_000,
    secure: true,
    lifecycle: { onTimeout: 'kill' },
  }))
  await host.stop()
  expect(kill).toHaveBeenCalledOnce()
  await expect(owner.getSandbox()).rejects.toThrow('E2B sandbox service is disposing')
})
