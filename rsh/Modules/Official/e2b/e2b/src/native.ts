/** Native host installer for the shared E2B sandbox owner. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { E2BSandboxOwner, resolveE2BSandboxConfig, type ResolvedE2BSandboxConfig } from './owner.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    e2b: E2BSandboxOwner
  }
}

/**
 * Validate a native profile row and apply the family defaults.
 * @param input - untrusted profile fields.
 * @returns immutable sandbox settings.
 */
export function resolveNativeE2BConfig(input: unknown): ResolvedE2BSandboxConfig {
  const parsed = z.object({
    apiKey: z.string().optional(),
    cwd: z.string().default('/home/user/workspace'),
    timeoutMs: z.number().default(300_000),
  }).strict().parse(input === undefined ? {} : input)
  return resolveE2BSandboxConfig({
    ...(parsed.apiKey === undefined ? {} : { apiKey: parsed.apiKey }),
    cwd: parsed.cwd,
    timeoutMs: parsed.timeoutMs,
  })
}

/** Host installer. Resolution validates configuration and does not open a sandbox. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-e2b',
  targets: ['host'],
  requires: [],
  provides: ['e2b'],
  resolve(input) {
    const config = resolveNativeE2BConfig(input)
    return (context) => {
      const owner = new E2BSandboxOwner(config)
      context.own(() => owner.dispose())
      context.provide('e2b', owner)
    }
  },
}
