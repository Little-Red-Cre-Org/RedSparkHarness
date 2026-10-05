/** Cordis adapter for the shared MCP connection supervisor. */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './types.ts'
import { startConnection as startSharedConnection, type ResolvedReconnectPolicy, type ConnectionHandle } from './connection-core.ts'
import { syncTools } from './tools.ts'
export { RECONNECT_DEFAULTS, resolveReconnectPolicy } from './connection-core.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy, ConnectionOutcome, ConnectionHandle } from './connection-core.ts'
/**
 * Start the shared supervisor with Cordis-owned tool registrations.
 * @param ctx - legacy registration authority.
 * @param config - transport configuration.
 * @param policy - resolved reconnect policy.
 * @returns shared supervisor readiness and cleanup.
 */
export function startConnection(ctx: Context, config: Config, policy: ResolvedReconnectPolicy): ConnectionHandle {
  return startSharedConnection({
    logger: ctx.logger, syncTools: (client, options, previous) => syncTools(client, ctx, options, previous),
  }, config, policy)
}
