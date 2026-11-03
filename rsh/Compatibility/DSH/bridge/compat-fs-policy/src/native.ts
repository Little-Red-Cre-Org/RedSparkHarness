/** Explicit Cordis observation policy forwarding one native event direction. */
import { createRequire } from 'node:module'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { validateSupportManifest, type CompatPackageManifest } from '@redspark/rsh-compat-dsh-runtime/native'
import type {} from '@redspark/rsh-fs'
import type {} from '@redspark/rsh-fs/native'
import * as LegacyPolicy from '@redspark/rsh-fs-observation-policy'

/**
 * Reject a changed policy declaration before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyPolicyManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@redspark/rsh-fs-observation-policy', manifest)
}

/** Native event policy slot implemented by the selected legacy plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-compat-fs-policy',
  targets: ['host'],
  requires: ['compatRshRuntime'],
  provides: ['fsObservationPolicy'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('compat-fs-policy: configuration must be empty')
    }
    const require = createRequire(import.meta.url)
    validateLegacyPolicyManifest(require('@redspark/rsh-fs-observation-policy/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatRshRuntime')
      const mount = runtime.mount('@redspark/rsh-fs-observation-policy', LegacyPolicy)
      native.own(() => mount.dispose())
      await mount.ready
      const legacy = runtime.context
      let listeners: (() => Promise<void>)[] = []
      const attach = (): void => {
        if (listeners.length > 0 || native.signal.aborted || !runtime.isEnabled('@redspark/rsh-fs-observation-policy')) return
        listeners = [
          native.on('fs/write-intent', (target, actor) => legacy.waterfall('fs/write-intent', target, actor, () => undefined)),
          native.on('fs/edit-intent', (target, actor) => legacy.waterfall('fs/edit-intent', target, actor, () => undefined)),
          native.on('fs/observed', (target, observation, actor) => {
            runtime.forwardFsObserved(native.scope, target, observation, actor,
              () => { legacy.emit('fs/observed', target, observation, actor) })
          }),
        ]
      }
      const detach = async (): Promise<void> => {
        const previous = listeners
        listeners = []
        const outcomes = await Promise.allSettled(previous.map(dispose => dispose()))
        const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
          .map(outcome => outcome.reason as unknown)
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'compat-fs-policy: Native event listeners failed to drain')
      }
      const participant = { suspend: detach, resume: () => { attach(); return Promise.resolve() } }
      const unregister = runtime.registerLifecycleParticipant(participant)
      native.own(async () => { unregister(); await detach() })
      attach()
      native.provide('fsObservationPolicy', { kind: 'observed-state' })
    }
  },
}
