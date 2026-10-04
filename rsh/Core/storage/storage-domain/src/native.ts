/** Native domain Provider uses the shared validated facility and post-durability change facts. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-storage/native'
import { DomainFacilityCore, type DomainFacilityConfiguration } from './facility.ts'
import type { DomainChanged } from './event-types.ts'

export { DomainFacilityCore } from './facility.ts'
export type { DomainFacilityConfiguration, DomainFacilityEffects } from './facility.ts'
export { DomainError } from './error.ts'
export type { DomainErrorCode, DomainErrorOptions, InvalidRecordDetail } from './error.ts'
export { defineDomain, domainTable, descriptorOf } from './spec.ts'
export type { DomainSpec, DomainGlobalSpec, DomainTableSpec, TableKeyOf, TableValueOf, GlobalValueOf } from './spec.ts'
export type { Domain, DomainGlobal, DomainGlobalHandleOf, KvTable, DomainRuntimeEffects } from './domain.ts'
export type { DomainChanged, DomainChangedBase, DomainChangedPut, DomainChangedDeleted } from './event-types.ts'

/**
 * Resolve the explicit default backend and per-domain routes before activation.
 * @param input - untrusted profile configuration.
 * @returns immutable validated routes; selected backend references are checked during activation.
 */
export function resolveNativeDomainConfiguration(input: unknown): DomainFacilityConfiguration {
  const value = z.object({ backend: z.string().min(1), routes: z.record(z.string().min(1), z.string().min(1)).default({}) })
    .strict().parse(input)
  return Object.freeze({ backend: value.backend, routes: Object.freeze(value.routes) })
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { storageDomain: DomainFacilityCore }
  interface NativeEvents {
    /**
     * Notify observers only after backend durability and authoritative memory publication.
     * @param change - exact committed domain/table/key and operation value.
     * @mode sync
     */
    'domain/changed': { mode: 'sync'; args: [change: DomainChanged]; result: void }
  }
}

/** Native domain Provider waits for the selected backend readiness authority rather than registration order. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-storage-domain', targets: ['host'],
  requires: ['storage', 'storageBackendsReady'], provides: ['storageDomain'],
  resolve(input) {
    const config = resolveNativeDomainConfiguration(input)
    return (context) => {
      const registry = context.require('storage').backend
      if (context.require('storageBackendsReady').registry !== registry) throw new Error('Selected backend readiness belongs to another storage hub')
      for (const name of new Set([config.backend, ...Object.values(config.routes ?? {})])) registry.get(name)
      const facility = new DomainFacilityCore(registry, {
        changed: (change) => { context.events.emit(context.scope, 'domain/changed', change) },
        warning: (message) => { console.warn(message) },
        error: (message) => { console.error(message) },
      }, config, context.signal)
      context.own(() => facility.closeAll())
      context.provide('storageDomain', facility)
    }
  },
}
