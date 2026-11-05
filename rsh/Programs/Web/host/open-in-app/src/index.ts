/**
 * Host half of open-in-app: the Cordis row that serves the application catalog,
 * per-application icons, and the launch endpoint the browser split button
 * (`@redspark/rsh-client-ui-open-in-app`) posts to.
 *
 * The handlers live in `routes.ts` so a Native build serves byte-identical
 * routes; this row only supplies the Cordis carrier and its PATH resolver.
 *
 * Security has one home, there. Every route asks the composition's
 * `connection` service for a rejection first (`requestRejection`): its
 * Host/Origin fence defeats DNS rebinding and cross-site calls, and its
 * browser authentication (the login-token cookie) gates every caller before
 * any resolution result, icon, or launch is reachable.
 */

import type { Context } from '@redspark/cordis'
import type {} from '@redspark/rsh-http-routes-cordis'
import type {} from '@redspark/rsh-subprocess'
import { launchedThroughSsh, launchEnvironmentOf } from '@redspark/rsh-launch-environment'
import type { OpenInAppInternals } from './resolver.ts'
import { internals } from './internals.ts'
import { createOpenInAppRoutes } from './routes.ts'
import type { OpenInAppRouteConfig } from './routes.ts'

export type * from './shared.ts'
export { Config } from './routes.ts'

/** Cordis function-plugin name. */
export const name = 'open-in-app'
/** The route carrier, the trust fence guarding every route, and the PATH resolver. */
export const inject = ['webServer', 'connection', 'subprocess']

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface OpenInAppConnection {
  /** @param request - inbound request headers.
   * @returns 401 or 403 when the composition refuses the caller. */
  requestRejection(request: { readonly headers: import('node:http').IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** The composition's connection service (typed locally: its package is browser-side). */
function connectionOf(ctx: Context): OpenInAppConnection {
  return Reflect.get(ctx, 'connection') as OpenInAppConnection
}

/**
 * Register the apps, icon, and open routes on the Cordis `webServer`.
 * @param ctx - the host context supplying the carrier, trust fence, and PATH resolver.
 * @param config - per-route deadlines and the launch watch window.
 */
export function apply(ctx: Context, config: OpenInAppRouteConfig): void {
  const ssh = launchedThroughSsh(launchEnvironmentOf(ctx))
  /** Test-seam facts completed with the composition's PATH resolver. */
  const catalogInternals = (): OpenInAppInternals => ({
    ssh,
    resolveExecutable: async (name) => {
      try {
        return await ctx.subprocess.resolveExecutable(name)
      } catch {
        // Swallows the provider's not-found rejection: for detection, a name
        // that does not resolve has exactly one meaning — unavailable.
        return null
      }
    },
    ...internals.catalog,
  })
  const routes = createOpenInAppRoutes(config, connectionOf(ctx), catalogInternals)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routes.paths.apps, handler: routes.apps }),
    `open-in-app: GET ${routes.paths.apps}`)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: routes.paths.icon, handler: routes.icon }),
    `open-in-app: GET ${routes.paths.icon}/<id>`)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routes.paths.open, handler: routes.open }),
    `open-in-app: POST ${routes.paths.open}`)
}
