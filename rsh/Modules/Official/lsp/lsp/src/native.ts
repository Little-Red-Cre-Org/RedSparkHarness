/**
 * Native Provider for the LSP capability seam.
 *
 * The registry, extension routing, and conflict checks are the same {@link LspRegistry} the Cordis
 * service commits. This entry only publishes that registry as the `lsp` service and clears it when
 * the installation drains. Callers own each `registerProvider` disposer; there is no Cordis fiber.
 * @module @redspark/rsh-lsp/native
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { LspService } from './types.ts'
import { LspRegistry } from './registry.ts'

export { finalExtension, LspError, LspRegistry } from './registry.ts'
export type { LspReservation } from './registry.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { lsp: LspService }
}

/** Native LSP registry Provider. Configuration is empty; providers register at runtime. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-lsp',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['lsp'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('lsp: native configuration must be empty')
    }
    return (context) => {
      const registry = new LspRegistry()
      context.own(() => { registry.clear() })
      context.provide('lsp', registry)
    }
  },
}
