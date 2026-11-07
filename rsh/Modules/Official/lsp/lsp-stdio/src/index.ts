/**
 * Generic stdio language-server backend for `ctx.lsp`. One plugin instance configures a named table
 * of server commands and registers one isolated provider for each entry. Every provider lazily
 * single-flights one server process per canonical workspace target, serves transient-open queries
 * through it, and replaces a selected transport that fails before or during the next read-only
 * query. Providers read sources through `ctx.fs` and launch servers through
 * `ctx.subprocess`, so both local and remote implementations share one host.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is effect-scoped: disposal
 * unregisters from `ctx.lsp` and tears down every live server. Resolution and registration live in
 * `providers.ts` so the native entry can use them without importing Cordis.
 * @module @redspark/rsh-lsp-stdio
 */

import type { Context } from '@redspark/cordis'
import type {} from '@redspark/rsh-fs'
import type {} from '@redspark/rsh-lsp'
import type {} from '@redspark/rsh-subprocess'
import {
  bindStdioProviders,
  loadStdioProviders,
  type Config,
} from './providers.ts'

export { canonicalizeWorkspace, readHostSource } from './host.ts'
export { encodeMessage, MessageDecoder } from './framing.ts'
export {
  negotiatePositionEncoding,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from './translate.ts'
export { LspInstance } from './instance.ts'
export { LspConnection } from './connection.ts'
export { bindStdioProviders, Config, loadStdioProviders } from './providers.ts'
export type { LspLocalServerConfig, StdioHostPorts } from './providers.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'lsp-stdio'

/** Services required by this plugin. */
export const inject = ['fs', 'lsp', 'subprocess']

/**
 * Register the configured stdio LSP providers. Resolves every executable at load (after credential
 * scrubbing) before publishing any provider; each process launches lazily on its first matching
 * query.
 * @param ctx - the plugin context carrying `fs`, `lsp`, and `subprocess`.
 * @param config - the resolved plugin configuration (schemastery has filled every default).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    // An async plugin callback must observe its own disposal before Cordis can
    // run effect cleanup, because unload otherwise waits for this callback.
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('lsp-stdio setup disposed'))
    }
  })
  let providers: Awaited<ReturnType<typeof loadStdioProviders>>
  try {
    providers = await loadStdioProviders({
      fs: ctx.fs,
      resolveExecutable: (command, env, signal) => ctx.subprocess.resolveExecutable(command, env, signal),
      spawn: spec => ctx.subprocess.spawn(spec),
    }, config, setupAbort)
  } finally {
    stopSetupCancellation()
  }
  ctx.effect(() => bindStdioProviders(ctx.lsp, providers), 'lsp-stdio.registerProviders')
}
