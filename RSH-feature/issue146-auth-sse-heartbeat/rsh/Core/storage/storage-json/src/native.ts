/** Native JSON storage registers the shared backend and exposes explicit readiness for domain Consumers. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-storage/native'
import { JsonStorageBackend } from './backend.ts'
export { JsonStorageBackend } from './backend.ts'

/** Explicit medium root; native and compatibility Providers use the same paths and unit formats. */
export interface NativeJsonStorageConfig { readonly root: string }

/**
 * Validate the configured medium root without inventing a process-cwd default.
 * @param input - untrusted profile fields.
 * @returns immutable explicit root configuration.
 */
export function resolveNativeJsonStorageConfig(input: unknown): NativeJsonStorageConfig {
  return Object.freeze(z.object({ root: z.string().min(1) }).strict().parse(input))
}

/** Provider registration is owned until its accepted unit operations drain. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-storage-json', targets: ['host'],
  requires: ['storage'], provides: ['storageBackendsReady'],
  resolve(input) {
    const config = resolveNativeJsonStorageConfig(input)
    return (context) => {
      const backend = new JsonStorageBackend(config.root)
      context.own(() => backend.close())
      const registry = context.require('storage').backend
      const unregister = registry.register('json', backend)
      context.effect(unregister)
      context.provide('storageBackendsReady', { registry })
    }
  },
}
