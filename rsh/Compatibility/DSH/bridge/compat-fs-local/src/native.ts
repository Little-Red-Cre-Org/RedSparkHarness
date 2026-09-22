/** Explicit Cordis filesystem Provider inside one native installation. */
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import LegacyLocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'

interface LegacyManifest {
  dsh?: { runtime?: { apiVersion?: unknown; role?: unknown; capability?: unknown } }
}

/**
 * Refuse a changed legacy declaration before constructing its Cordis Context.
 * @param manifest - selected package metadata.
 */
export function validateLegacyFilesystemManifest(manifest: LegacyManifest): void {
  const runtime = manifest.dsh?.runtime
  if (runtime?.apiVersion !== 1 || runtime.role !== 'provider' || runtime.capability !== 'filesystem') {
    throw new Error('compat-fs-local: unsupported @deepseek-ai/dsh-fs-local runtime declaration')
  }
}

/** Native Provider slot backed by one selected legacy filesystem plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-compat-fs-local',
  targets: ['host'],
  requires: [],
  provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyFilesystemManifest(require('@deepseek-ai/dsh-fs-local/package.json') as LegacyManifest)
    return async (native) => {
      const legacy = new Context()
      native.own(() => legacy.fiber.dispose())
      await legacy.plugin(LegacyLocalFileSystem, config)
      const filesystem = legacy.get('fs')
      if (filesystem === undefined) throw new Error('compat-fs-local: legacy Provider did not publish fs')
      native.provide('fs', filesystem)
    }
  },
}
