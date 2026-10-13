/** Cordis-free request configuration shared by the Native and Cordis Consumers. */
import z from '@deepseek-ai/schemastery'

/** Session-log request contribution configuration. */
export interface Config {
  /** Contribute `dsh_session_log` to official DeepSeek requests. Defaults to `false`. */
  enabled?: boolean
}

/** Validated Session-log request contribution configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
})

/**
 * Resolve the Session-log configuration for a Native installation.
 * @param input - raw Native installation configuration.
 * @returns the validated configuration with its default applied.
 */
export function resolveConfig(input: unknown): Required<Config> {
  const source = input === undefined ? {} : input
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new Error('session-log-deepseek: configuration must be an object')
  }
  for (const key of Object.keys(source)) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new Error(`session-log-deepseek: unknown native configuration field ${key}`)
    }
  }
  const parsed = Config(source)
  return parsed as Required<Config>
}
