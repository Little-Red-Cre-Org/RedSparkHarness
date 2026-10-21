/** Sandbox filesystem Provider mounted in the shared Cordis Context. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { validateSupportManifest, type CompatPackageManifest } from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'

/**
 * Refuse a changed legacy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacySandboxManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@deepseek-ai/dsh-fs-sandbox', manifest)
}

/** Provide a confining filesystem only when a native policy was selected. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-compat-fs-sandbox', targets: ['host'],
  requires: ['sandboxPolicy', 'compatDshRuntime'], provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacySandboxManifest(require('@deepseek-ai/dsh-fs-sandbox/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const legacy = runtime.context
      const policy = native.require('sandboxPolicy')
      const legacyPolicy = {
        defaultMode: policy.defaultMode,
        resolve: policy.resolve.bind(policy),
      } as unknown as import('@deepseek-ai/dsh-sandbox-policy').SandboxPolicyService
      if (legacy.get('sandboxPolicy') === undefined) {
        const policyMount = runtime.mount('@deepseek-ai/dsh-compat-dsh-runtime/sandbox-policy-adapter', (context) => {
          context.provide('sandboxPolicy', legacyPolicy)
        })
        native.own(() => policyMount.dispose())
        await policyMount.ready
      }
      const mount = runtime.mount('@deepseek-ai/dsh-fs-sandbox', SandboxedFileSystem, config)
      native.own(() => mount.dispose())
      await mount.ready
      native.provide('fs', runtime.liveService('fs') as import('@deepseek-ai/dsh-fs/native').FileSystemOperations)
    }
  },
}
