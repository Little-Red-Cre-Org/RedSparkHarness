/** Native OS chooser registration does not open a dialog. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import { nativeDirectoryPicker, plugin, resolveNativeDirectoryPickerConfig } from '../src/native.ts'

it('rejects configuration and provides a stable native capability', async () => {
  resolveNativeDirectoryPickerConfig(undefined)
  resolveNativeDirectoryPickerConfig({})
  expect(() => resolveNativeDirectoryPickerConfig({ cwd: '/tmp' })).toThrow(/accepts no configuration/)
  expect(() => plugin.resolve({ cwd: '/tmp' })).toThrow(/accepts no configuration/)
  const direct = nativeDirectoryPicker()
  expect(direct.capability()).toBe(direct.capability())
  expect(direct.capability().kind).toBe('native')

  const scope = new NativeScope()
  let picker: NativeDirectoryPicker | undefined
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'directory-picker-native-consumer',
    targets: ['host'],
    requires: ['directoryPicker'],
    provides: [],
    resolve: () => (context) => { picker = context.require('directoryPicker') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin, scope, config: undefined },
  ], 'host'))
  try {
    await host.start()
    if (picker === undefined) throw new Error('directoryPicker was not installed')
    expect(picker.capability().kind).toBe('native')
  } finally {
    await host.stop()
  }
})
