/** Sandbox filesystem Provider mounted in one isolated Cordis Context. */
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'

interface LegacyManifest {
  dsh?: { runtime?: { apiVersion?: unknown; role?: unknown; capability?: unknown } }
}

/**
 * Refuse a changed legacy declaration before constructing its Cordis Context.
 * @param manifest - selected package metadata.
 */
export function validateLegacySandboxManifest(manifest: LegacyManifest): void {
  const runtime = manifest.dsh?.runtime
  if (runtime?.apiVersion !== 1 || runtime.role !== 'provider' || runtime.capability !== 'filesystem') {
    throw new Error('compat-fs-sandbox: unsupported @deepseek-ai/dsh-fs-sandbox runtime declaration')
  }
}

/** Provide a confining filesystem only when a native policy was selected. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-compat-fs-sandbox', targets: ['host'],
  requires: ['sandboxPolicy'], provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacySandboxManifest(require('@deepseek-ai/dsh-fs-sandbox/package.json') as LegacyManifest)
    return async (native) => {
      const legacy = new Context()
      native.own(() => legacy.fiber.dispose())
      const policy = native.require('sandboxPolicy')
      // The legacy class uses defaultMode and resolve; Cordis types the slot as its concrete service class.
      legacy.provide('sandboxPolicy', {
        defaultMode: policy.defaultMode,
        resolve: policy.resolve.bind(policy),
      } as unknown as import('@deepseek-ai/dsh-sandbox-policy').SandboxPolicyService)
      await legacy.plugin(SandboxedFileSystem, config)
      const filesystem = legacy.get('fs')
      if (filesystem === undefined) throw new Error('compat-fs-sandbox: legacy Provider did not publish fs')
      native.provide('fs', filesystem)
    }
  },
}
