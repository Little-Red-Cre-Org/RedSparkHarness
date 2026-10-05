/** Cordis-free Host Connection registry factory for native carriers. */

import type {} from '@deepseek-ai/dsh-native-runtime'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { assertTrustedAuthority } from './api-request-trust.ts'
import { BrowserAuth } from './browser-auth.ts'
import { HostConnectionRegistry } from './host-core.ts'
import type { HostConnectionHandle } from './rpc.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Carrier-owned Connection routes shared by Web and Desktop applications. */
    hostConnection: HostConnectionHandle
  }
}

/** Native Host authentication and trust configuration. */
export interface NativeHostConnectionConfig {
  /** Authorities accepted beyond loopback. */
  readonly trustedHosts?: readonly string[]
  /** Absolute browser-session lifetime in days. */
  readonly cookieMaxAgeDays?: number
}

/** Validate native Host Connection configuration before creating credentials or routes.
 * @param input - trust and cookie configuration.
 * @returns normalized native Host Connection configuration.
 */
export function resolveNativeHostConnectionConfig(input: unknown = {}): Required<NativeHostConnectionConfig> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('native client-connection: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'trustedHosts' && key !== 'cookieMaxAgeDays') {
      throw new Error(`native client-connection: unknown configuration field ${key}`)
    }
  }
  const trustedHostsValue = fields.trustedHosts === undefined ? [] : fields.trustedHosts
  if (!Array.isArray(trustedHostsValue) || trustedHostsValue.some(value => typeof value !== 'string')) {
    throw new TypeError('native client-connection: trustedHosts must be an array of strings')
  }
  const trustedHosts = trustedHostsValue as string[]
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  const cookieMaxAgeDays = fields.cookieMaxAgeDays === undefined ? 30 : fields.cookieMaxAgeDays
  if (typeof cookieMaxAgeDays !== 'number' || !Number.isSafeInteger(cookieMaxAgeDays) || cookieMaxAgeDays < 1) {
    throw new TypeError('native client-connection: cookieMaxAgeDays must be a positive integer')
  }
  return { trustedHosts, cookieMaxAgeDays }
}

/**
 * Create the shared Host registry after the native carrier has selected its transport.
 * @param owner - stable owner identity for the process launch token.
 * @param credentials - native credential store used for the browser-session signing secret.
 * @param input - trust and cookie configuration.
 * @returns a registry whose route contributions can be mounted by a native carrier.
 */
export async function createNativeHostConnectionRegistry(
  owner: object,
  credentials: Pick<NativeCredentials, 'modifyRecord'>,
  input: unknown = {},
): Promise<HostConnectionRegistry> {
  const config = resolveNativeHostConnectionConfig(input)
  const auth = await BrowserAuth.create(owner, credentials, config.cookieMaxAgeDays)
  return new HostConnectionRegistry(config.trustedHosts, auth)
}

export { HostConnectionRegistry }
export type { ConnectionFetchHandler, ConnectionRpcEndpointMatcher, ConnectionRpcHandler, ConnectionRpcResult, HostConnectionHandle } from './rpc.ts'
export type { HostConnectionOwner } from './host-core.ts'

export { NativeConnectionRequestOwner, NativeConnectionRequestAdmissionError } from './native-request-owner.ts'
