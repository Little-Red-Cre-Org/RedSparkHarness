/**
 * Native Provider for the generic stdio language-server backend.
 *
 * Executable resolution, provider isolation, and teardown are {@link loadStdioProviders} and
 * {@link bindStdioProviders}, the same path the Cordis plugin runs. This entry only supplies the
 * native filesystem, subprocess, and LSP services, and owns the registration for the installation.
 * @module @redspark/rsh-lsp-stdio/native
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-subprocess/native'
import type { LspService } from '@redspark/rsh-lsp/native'
import { Config, bindStdioProviders, loadStdioProviders, type Config as LspStdioConfig } from './providers.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { lsp: LspService }
}

/** Native stdio LSP Provider. `servers` matches the Cordis plugin configuration. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-lsp-stdio',
  targets: ['host'],
  requires: ['fs', 'lsp', 'subprocess'],
  optional: [],
  provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
      throw new TypeError('lsp-stdio: native configuration must be an object')
    }
    const config = Config((input ?? {}) as LspStdioConfig)
    return async (context) => {
      const setup = new AbortController()
      const onAbort = (): void => { setup.abort(context.signal.reason) }
      if (context.signal.aborted) onAbort()
      else context.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const subprocess = context.require('subprocess')
        const providers = await loadStdioProviders({
          fs: context.require('fs'),
          resolveExecutable: (command, env, signal) => subprocess.resolveExecutable(command, env, signal),
          spawn: spec => subprocess.spawn(spec),
        }, config, setup)
        context.effect(bindStdioProviders(context.require('lsp'), providers))
      } finally {
        context.signal.removeEventListener('abort', onAbort)
      }
    }
  },
}
