/**
 * SDK-facing JSON-RPC plugin over stdio. The selected dsh profile decides
 * whether to load it; see the single-launch Agent Note and package README.
 * Stdout is reserved for protocol frames, so the tree must not load a stdout logger.
 * This plugin answers `shutdown`, disposes the complete root runtime, and exits 0; the app bin
 * owns EOF and signal exits. Keep named plugin exports with no default export so
 * Loader `unwrapExports` preserves `name`, `inject`, `Config`, and `apply`.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Readable, Writable } from 'node:stream'
import Schema from '@deepseek-ai/schemastery'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from './server.ts'

export * from './server.ts'

export const name = 'sdk-jsonrpc-server'
// Only the agent factory is required; initialize reads the optional LLM seam with ctx.get().
export const inject = ['agents']

/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Report max-token turn/subagent termination as a successful SDK result. */
  maxTokensAsSuccess?: boolean
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}

export const Config: Schema<JsonRpcConfig> = Schema.object({
  maxTokensAsSuccess: Schema.boolean().default(false),
})

const LOADER_ENTRY_FAILURE = /^failed to \w+ loader entry (.+?) \((.*?)\): /
const DUPLICATE_SERVICE = /^service "([^"]+)" has been registered/

/** Loader tree methods used for startup settlement; this package does not depend on the Loader. */
interface StartupLoader {
  getTasks(): Promise<unknown>[]
  await(): Promise<void>
}

/**
 * Wait until the Loader tree settles and return the first startup failure. A
 * failed entry rejects its task before rollback removes it, so the tasks are
 * observed directly; the final `await()` reports fibers that failed after
 * their entry task resolved (for example after a delayed injection).
 * @param loader - the Loader whose current tree is starting.
 * @returns the first rejection, or `undefined` when the tree started.
 */
async function startupFailure(loader: StartupLoader): Promise<unknown> {
  let failure: unknown
  for (let tasks = loader.getTasks(); tasks.length > 0; tasks = loader.getTasks()) {
    for (const outcome of await Promise.allSettled(tasks)) {
      if (outcome.status === 'rejected') failure ??= outcome.reason
    }
  }
  try {
    await loader.await()
  } catch (reason) {
    failure ??= reason
  }
  return failure
}

/**
 * Describe a Loader startup failure for SDK clients. The Loader wraps each
 * entry failure as `failed to <stage> loader entry <id> (<name>): <detail>`
 * with the inner error as `cause`; the deepest wrapper names the failing
 * entry. Only that entry, the plugin error type, and the Cordis
 * duplicate-service rule are reported: plugin messages can carry
 * configuration values and stay in the runtime stderr log.
 * @param failure - a rejection from {@link startupFailure}.
 * @returns the error returned to `initialize` and later requests.
 */
function bootFailureError(failure: unknown): Error {
  let entry = ''
  // The Loader rejects with Error wrappers, and plugin startup errors are Error instances.
  let error = failure as Error
  for (;;) {
    if (error instanceof AggregateError) error = error.errors[0] as Error
    const wrapper = LOADER_ENTRY_FAILURE.exec(error.message)
    if (wrapper === null) break
    entry = ` "${wrapper[1]}" (${wrapper[2]})`
    error = error.cause as Error
  }
  const service = DUPLICATE_SERVICE.exec(error.message)?.[1]
  const rule = service === undefined ? '' : `: service "${service}" is already provided by another plugin`
  return new Error(`SDK runtime failed to start: loader entry${entry} failed: ${error.name}${rule}; see the runtime stderr log for details`)
}

/**
 * Serve SDK requests over the configured streams. Effect disposal shuts down
 * SDK-created agents and closes the transport. A `shutdown` response is flushed
 * before the root runtime is disposed and the process exits 0; the app bin
 * owns root-context disposal for EOF and signals.
 */
export function apply(ctx: Context, config: JsonRpcConfig): void {
  // Cordis applies the schema default before invoking the plugin.
  const resolvedConfig = config as JsonRpcConfig & { maxTokensAsSuccess: boolean }
  // Protocol shutdown owns the complete runtime process, so it must await the
  // root lifecycle (including persistence) before exiting.
  const rootFiber = ctx.root.fiber
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const input = config.input ?? process.stdin
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const output = config.output ?? process.stdout
  /* v8 ignore next -- production exit wiring; tests always inject the runtime hooks */
  const exit = config.exit ?? ((code: number): void => { process.exit(code) })

  const transport = new JsonRpcLineTransport(input, output)
  const server = new HarnessSdkJsonRpcServer(ctx, transport, {
    maxTokensAsSuccess: resolvedConfig.maxTokensAsSuccess,
  })

  const loader = ctx.get('loader') as StartupLoader | undefined
  let bootFailure: Error | undefined

  // Share one exit task so racing shutdown requests cannot dispose the root or
  // exit the process more than once.
  let exitTask: Promise<void> | undefined
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    // `initialize` is the SDK's readiness boundary. This plugin can activate
    // before async sibling Loader entries (for example an MCP client's initial
    // tool discovery), so do not advertise a ready runtime until the complete
    // current tree has settled. Loader settlement joins entry imports, fiber
    // lifecycle work, and synchronous effect registration; no scheduler delay
    // is part of readiness. A hand-built context without Loader remains
    // immediately usable.
    if (method === 'initialize' && loader !== undefined) {
      const failure = await startupFailure(loader)
      if (failure !== undefined) bootFailure = bootFailureError(failure)
    }
    if (bootFailure !== undefined) throw bootFailure
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      // Run after the handler result is written; the task then flushes, disposes, and exits.
      setImmediate(() => { void disposeAndExit() })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
