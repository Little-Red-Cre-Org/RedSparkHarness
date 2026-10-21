/** Native filesystem observation policy; the invoking session owns observation identity. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import { ObservedStateGate } from './gate.ts'

/** Read-before-edit and compare-and-swap guard registration. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-fs-observation-policy',
  targets: ['host'],
  requires: [],
  provides: ['fsObservationPolicy'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('fs-observation-policy: configuration must be empty')
    }
    return (context) => {
      const gate = new ObservedStateGate()
      context.own(() => { gate.clear() })
      context.on('fs/write-intent', (target, actor) => gate.writeIntent(target, actor))
      context.on('fs/edit-intent', (target, actor) => gate.editIntent(target, actor))
      context.on('fs/observed', (target, observation, actor) => { gate.observe(target, observation, actor) })
      context.provide('fsObservationPolicy', { kind: 'observed-state' })
    }
  },
}
