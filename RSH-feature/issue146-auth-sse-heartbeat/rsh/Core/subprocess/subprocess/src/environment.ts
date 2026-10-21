/** Shared child-process environment policy for legacy and native subprocess Providers. */
import { proxyEnvironmentForChild } from '@deepseek-ai/dsh-http-proxy'
import { DSH_ENV_PREFIX } from './types.ts'

/** Credential-shaped environment names never forwarded to children implicitly. */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * Build the ambient child environment without credentials or inherited DSH identities.
 * Explicit spawn-spec values merge after this result and can deliberately restore a key.
 * @returns a fresh environment that preserves executable paths, locale, and active proxy routing.
 */
export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) env[key] = value
  }
  for (const [name, value] of Object.entries(proxyEnvironmentForChild())) {
    if (value === undefined) Reflect.deleteProperty(env, name)
    else env[name] = value
  }
  return env
}
