// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as renderer } from '../src/native.ts'

const root = vi.hoisted(() => ({
  unmount: vi.fn(() => { throw new Error('cleanup failed') }),
}))

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: () => {}, unmount: root.unmount }),
}))

it('reports both the initial render error and React root cleanup error', async () => {
  const application: NativePlugin = {
    apiVersion: 1, name: 'failing-application', targets: ['client'], requires: [], provides: ['clientApplication'],
    resolve: () => (context) => {
      context.provide('clientApplication', { render: () => { throw new Error('render failed') } })
    },
  }
  const mount: NativePlugin = {
    apiVersion: 1, name: 'mount', targets: ['client'], requires: ['clientApplication', 'clientRenderer'], provides: [],
    resolve: () => (context) => {
      context.own(context.require('clientRenderer').mount(
        document.createElement('div'), context.require('clientApplication'), context.signal,
      ))
    },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: application, scope, config: undefined },
    { plugin: renderer, scope, config: undefined },
    { plugin: mount, scope, config: undefined },
  ], 'client'))

  await expect(host.start()).rejects.toMatchObject({
    message: 'native Client render and cleanup failed',
    errors: [{ message: 'render failed' }, { message: 'cleanup failed' }],
  })
  expect(root.unmount).toHaveBeenCalledOnce()
  await expect(host.stop()).rejects.toThrow('native Client render and cleanup failed')
})
