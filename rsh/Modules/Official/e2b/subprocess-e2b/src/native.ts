/** Native host installer for the E2B subprocess backend. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-subprocess/native'
import type {} from '@redspark/rsh-e2b/native'
import { E2BSubprocessBackend, resolveE2BSubprocessPollMs } from './backend.ts'

/**
 * Validate a native subprocess row and apply the poll default.
 * @param input - untrusted profile fields.
 * @returns the accepted poll cadence.
 */
export function resolveNativeE2BSubprocessConfig(input: unknown): { readonly pollMs: number } {
  const parsed = z.object({
    pollMs: z.number().default(20),
  }).strict().parse(input === undefined ? {} : input)
  return { pollMs: resolveE2BSubprocessPollMs(parsed.pollMs) }
}

/** Host installer. It requires `e2b` and provides only `subprocess`. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-subprocess-e2b',
  targets: ['host'],
  requires: ['e2b'],
  provides: ['subprocess'],
  resolve(input) {
    const config = resolveNativeE2BSubprocessConfig(input)
    return (context) => {
      const backend = new E2BSubprocessBackend(context.require('e2b'), config.pollMs)
      context.own(() => backend.dispose())
      context.provide('subprocess', backend)
    }
  },
}
