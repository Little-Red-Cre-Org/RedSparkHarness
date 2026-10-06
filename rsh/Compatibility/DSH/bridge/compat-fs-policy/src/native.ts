/** Explicit Cordis observation policy forwarding one native event direction. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs/native'
import * as LegacyPolicy from '@deepseek-ai/dsh-fs-observation-policy'

interface LegacyManifest {
  dsh?: { runtime?: { apiVersion?: unknown; role?: unknown; capability?: unknown } }
}

/**
 * Reject a changed policy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyPolicyManifest(manifest: LegacyManifest): void {
  const runtime = manifest.dsh?.runtime
  if (runtime?.apiVersion !== 1 || runtime.role !== 'policy' || runtime.capability !== 'filesystem') {
    throw new Error('compat-fs-policy: unsupported @deepseek-ai/dsh-fs-observation-policy runtime declaration')
  }
}

/** Native event policy slot implemented by the selected legacy plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-compat-fs-policy',
  targets: ['host'],
  requires: ['compatDshRuntime'],
  provides: ['fsObservationPolicy'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('compat-fs-policy: configuration must be empty')
    }
    const require = createRequire(import.meta.url)
    validateLegacyPolicyManifest(require('@deepseek-ai/dsh-fs-observation-policy/package.json') as LegacyManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const mount = runtime.mount('@deepseek-ai/dsh-fs-observation-policy', LegacyPolicy)
      native.own(() => mount.dispose())
      await mount.ready
      const legacy = runtime.context
      native.on('fs/write-intent', (target, actor) => legacy.waterfall('fs/write-intent', target, actor, () => undefined))
      native.on('fs/edit-intent', (target, actor) => legacy.waterfall('fs/edit-intent', target, actor, () => undefined))
      native.on('fs/observed', (target, observation, actor) => {
        runtime.forwardFsObserved(native.scope, target, observation, actor,
          () => { legacy.emit('fs/observed', target, observation, actor) })
      })
      native.provide('fsObservationPolicy', { kind: 'observed-state' })
    }
  },
}
