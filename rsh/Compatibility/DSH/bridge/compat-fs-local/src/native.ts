/** Explicit Cordis filesystem Provider inside one native installation. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-compat-dsh-runtime/native'
import { validateSupportManifest, type CompatPackageManifest } from '@redspark/rsh-compat-dsh-runtime/native'
import type { FileSystemOperations } from '@redspark/rsh-fs/native'
import LegacyLocalFileSystem from '@redspark/rsh-fs-local'
import { resolveLocalFilesystemConfig } from '@redspark/rsh-fs-local/backend'

/**
 * Refuse a changed legacy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyFilesystemManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@redspark/rsh-fs-local', manifest)
}

/** Native Provider slot backed by one selected legacy filesystem plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-compat-fs-local',
  targets: ['host'],
  requires: ['compatDshRuntime'],
  provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyFilesystemManifest(require('@redspark/rsh-fs-local/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const mount = runtime.mount('@redspark/rsh-fs-local', LegacyLocalFileSystem, config)
      native.own(() => mount.dispose())
      await mount.ready
      native.provide('fs', runtime.liveService('fs') as FileSystemOperations)
    }
  },
}
