/** Cordis-free request configuration shared by the Native and Cordis Consumers. */
import z from '@deepseek-ai/schemastery'

/** Plugin-package request contribution configuration. */
export interface Config {
  /** Contribute `dsh_plugin_packages` to official DeepSeek requests. Defaults to `true`. */
  enabled?: boolean
}

/** Validated plugin-package request contribution configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Resolve the package inventory configuration for a Native installation.
 * @param input - raw Native installation configuration.
 * @returns the validated configuration with its default applied.
 */
export function resolveConfig(input: unknown): Required<Config> {
  const source = input === undefined ? {} : input
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new Error('plugin-package-inventory-deepseek: configuration must be an object')
  }
  for (const key of Object.keys(source)) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new Error(`plugin-package-inventory-deepseek: unknown native configuration field ${key}`)
    }
  }
  const parsed = Config(source)
  return parsed as Required<Config>
}
