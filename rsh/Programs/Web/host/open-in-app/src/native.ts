/**
 * Native host half of open-in-app.
 *
 * A Native profile has no Cordis `webServer`; the Native listener exposes the
 * same `HttpRouteListener` as `httpRoutes`, so this row registers the
 * byte-identical handlers from `routes.ts` there. The trust fence is the
 * Native Connection handle's own `requestRejection`, so loopback and origin
 * rules still gate every caller before any catalog fact is reachable.
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-http-routes/native'
import type {} from '@redspark/rsh-subprocess/native'
import type {} from '@redspark/rsh-client-connection/native-host'
import type {} from '@redspark/rsh-launch-environment/native'
import { launchedThroughSsh } from '@redspark/rsh-launch-environment/native'
import type { OpenInAppInternals } from './resolver.ts'
import { internals } from './internals.ts'
import { createOpenInAppRoutes, type OpenInAppRejection, type OpenInAppRouteConfig } from './routes.ts'

/** Per-command deadlines the shipped profile sets; a Native row takes no config. */
const ROUTE_CONFIG: OpenInAppRouteConfig = {
  probeTimeoutMs: 5_000,
  iconTimeoutMs: 10_000,
  launchWatchMs: 2_000,
}

/** Native provider name, shared with the browser row. */
export const name = 'open-in-app'

/** The Native route carrier, the trust fence, and the PATH resolver. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-host-open-in-app',
  targets: ['host'],
  requires: ['httpRoutes', 'hostConnection', 'subprocess', 'launchEnvironment'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    // The route carrier and the trust fence are read by service name: their
    // packages are browser-side, so this Host row keeps narrow local types.
    const http = context.require('httpRoutes')
    const connection = context.require('hostConnection') as unknown as OpenInAppRejection
    const subprocess = context.require('subprocess')
    const environment = context.require('launchEnvironment')
    const ssh = launchedThroughSsh(environment)
    const catalogInternals = (): OpenInAppInternals => ({
      ssh,
      resolveExecutable: async (name) => {
        try {
          return await subprocess.resolveExecutable(name)
        } catch {
          // Swallows the provider's not-found rejection: for detection, a name
          // that does not resolve has exactly one meaning — unavailable.
          return null
        }
      },
      ...internals.catalog,
    })
    const routes = createOpenInAppRoutes(ROUTE_CONFIG, connection, catalogInternals)
    context.own(http.register({ kind: 'exact', path: routes.paths.apps, handler: routes.apps }))
    context.own(http.register({ kind: 'prefix', path: routes.paths.icon, handler: routes.icon }))
    context.own(http.register({ kind: 'exact', path: routes.paths.open, handler: routes.open }))
  },
}
