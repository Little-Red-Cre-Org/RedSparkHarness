/**
 * JSON storage backend: one human-readable document per unit under a
 * configured root — a whole-unit file (`single` layout) or one document per
 * record (`per-record` layout), published by atomic rewrite. Registers as
 * backend `json` on the storage hub.
 * @module @deepseek-ai/dsh-storage-json
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from './backend.ts'
export { JsonStorageBackend } from './backend.ts'

/** Cordis plugin name. */
export const name = 'storage-json'
/** The hub must exist before the backend can register. */
export const inject = ['storage']

/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file (or `<unit>/` tree) per unit. */
  root: string
}

/** Config schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/**
 * Register the `json` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new JsonStorageBackend(config.root)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('json', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('json'), backend)
}
