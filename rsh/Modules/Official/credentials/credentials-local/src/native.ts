/** Native local credential provider over the shared document backend. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import { NativeLocalCredentialProvider } from './backend.ts'
import type { Config } from './document.ts'

/**
 * Validate local credential storage configuration before activation.
 * @param input - untrusted native plugin configuration.
 * @returns the frozen validated credential storage configuration.
 * @throws when configuration is not an object, has an unknown field, or contains an invalid value.
 */
export function resolveNativeCredentialConfig(input: unknown): Config {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('credentials-local: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['path', 'dshHome', 'watch', 'debounceMs'].includes(key)) {
      throw new TypeError(`credentials-local: unknown native configuration field ${JSON.stringify(key)}`)
    }
  }
  if (fields['path'] !== undefined && typeof fields['path'] !== 'string') throw new TypeError('credentials-local: path must be a string')
  if (fields['dshHome'] !== undefined && typeof fields['dshHome'] !== 'string') throw new TypeError('credentials-local: dshHome must be a string')
  if (fields['watch'] !== undefined && typeof fields['watch'] !== 'boolean') throw new TypeError('credentials-local: watch must be a boolean')
  if (fields['debounceMs'] !== undefined && (typeof fields['debounceMs'] !== 'number' || !Number.isFinite(fields['debounceMs']) || fields['debounceMs'] < 0)) {
    throw new TypeError('credentials-local: debounceMs must be a non-negative finite number')
  }
  return Object.freeze({
    ...fields['path'] === undefined ? {} : { path: fields['path'] },
    ...fields['dshHome'] === undefined ? {} : { dshHome: fields['dshHome'] },
    ...fields['watch'] === undefined ? {} : { watch: fields['watch'] },
    ...fields['debounceMs'] === undefined ? {} : { debounceMs: fields['debounceMs'] },
  })
}

/** File-backed Provider selected for native Host compositions. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-credentials-local',
  targets: ['host'],
  requires: ['launchEnvironment'],
  provides: ['credentials'],
  resolve(input) {
    const config = resolveNativeCredentialConfig(input)
    return async (context) => {
      const backend = new NativeLocalCredentialProvider({
        environment: () => context.require('launchEnvironment'),
        logger: console,
        referenceUpdated: (ref) => {
          void context.events.parallel(context.scope, 'credentials/reference-updated', ref)
            .catch((error: unknown) => { console.warn('credentials-local: reference listener failed', error) })
        },
        recordUpdated: (key) => {
          void context.events.parallel(context.scope, 'credentials/record-updated', key)
            .catch((error: unknown) => { console.warn('credentials-local: record listener failed', error) })
        },
      }, config)
      context.own(() => backend.dispose())
      await backend.start()
      context.provide('credentials', backend)
    }
  },
}
