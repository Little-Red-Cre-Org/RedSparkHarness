/** Native host Provider for the managed subprocess capability. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
export type {} from '@redspark/rsh-subprocess/native'
import { LocalSubprocessController } from './controller.ts'

/** Explicit local process owner with the same lifecycle semantics as the Cordis adapter. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-subprocess-local',
  targets: ['host'],
  requires: [],
  provides: ['subprocess', 'childConnection'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('subprocess-local: native Provider accepts no configuration')
    }
    return (context) => {
      const controller = new LocalSubprocessController((message) => { process.emitWarning(message) })
      context.own(() => controller.dispose())
      context.provide('subprocess', controller)
      context.provide('childConnection', controller)
    }
  },
}
