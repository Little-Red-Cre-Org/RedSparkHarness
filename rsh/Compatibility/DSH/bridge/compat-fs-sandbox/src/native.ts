/** Sandbox filesystem Provider mounted in the shared Cordis Context. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { validateSupportManifest, type CompatPackageManifest } from '@redspark/rsh-compat-dsh-runtime/native'
import type {} from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-native-sandbox-policy/native'
import type {} from '@redspark/rsh-sandbox-policy'
import SandboxedFileSystem from '@redspark/rsh-fs-sandbox'
import { resolveLocalFilesystemConfig } from '@redspark/rsh-fs-local/backend'

/**
 * Refuse a changed legacy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacySandboxManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@redspark/rsh-fs-sandbox', manifest)
}

/** Provide a confining filesystem only when a native policy was selected. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-compat-fs-sandbox', targets: ['host'],
  requires: ['sandboxPolicy', 'compatRshRuntime'], provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacySandboxManifest(require('@redspark/rsh-fs-sandbox/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatRshRuntime')
      const legacy = runtime.context
      const policy = native.require('sandboxPolicy')
      const legacyPolicy = {
        defaultMode: policy.defaultMode,
        resolve: policy.resolve.bind(policy),
      } as unknown as import('@redspark/rsh-sandbox-policy').SandboxPolicyService
      if (legacy.get('sandboxPolicy') === undefined) {
        const policyMount = runtime.mount('@redspark/rsh-compat-dsh-runtime/sandbox-policy-adapter', (context) => {
          context.provide('sandboxPolicy', legacyPolicy)
        })
        native.own(() => policyMount.dispose())
        await policyMount.ready
      }
      const mount = runtime.mount('@redspark/rsh-fs-sandbox', SandboxedFileSystem, config)
      native.own(() => mount.dispose())
      await mount.ready
      native.provide('fs', runtime.liveService('fs') as import('@redspark/rsh-fs/native').FileSystemOperations)
    }
  },
}
