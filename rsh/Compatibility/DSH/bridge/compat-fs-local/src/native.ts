/** Explicit Cordis filesystem Provider inside one native installation. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import { validateSupportManifest, type CompatPackageManifest } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import LegacyLocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'

/**
 * Refuse a changed legacy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyFilesystemManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@deepseek-ai/dsh-fs-local', manifest)
}

/** Native Provider slot backed by one selected legacy filesystem plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-compat-fs-local',
  targets: ['host'],
  requires: ['compatDshRuntime'],
  provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyFilesystemManifest(require('@deepseek-ai/dsh-fs-local/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const mount = runtime.mount('@deepseek-ai/dsh-fs-local', LegacyLocalFileSystem, config)
      native.own(() => mount.dispose())
      await mount.ready
      native.provide('fs', runtime.liveService('fs') as FileSystemOperations)
    }
  },
}
