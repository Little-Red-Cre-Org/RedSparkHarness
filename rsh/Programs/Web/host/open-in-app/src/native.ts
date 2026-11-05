/**
 * Native host half of open-in-app.
 *
 * A Native profile has no Cordis `webServer`; a Native process that serves its
 * own HTTP listener exposes the same `HttpRouteListener` as `httpRoutes`, so
 * this row registers the byte-identical handlers from `routes.ts` there. The
 * trust fence is the Native Connection handle's own `requestRejection`, so
 * loopback and origin rules still gate every caller before any catalog fact is
 * reachable.
 *
 * `httpRoutes` is optional, not required: the shipped composition is shared by
 * carriers that serve the browser over HTTP (`native-web-host`) and carriers
 * that tunnel every call through a private channel (the Desktop shell), and the
 * latter never provides a route listener. A row that demanded one would fail
 * assembly for the whole profile, so absence means "no HTTP surface here" and
 * the row installs nothing rather than refusing to load.
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-http-routes/native'
import type {} from '@redspark/rsh-subprocess/native'
import type {} from '@redspark/rsh-client-connection/native-host'
import type {} from '@redspark/rsh-launch-environment/native'
import { launchedThroughSsh } from '@redspark/rsh-launch-environment/native'
import type { OpenInAppInternals } from './resolver.ts'
import { internals } from './internals.ts'
import { Config, createOpenInAppRoutes, type OpenInAppRejection, type OpenInAppRouteConfig } from './routes.ts'

export { Config }

/**
 * Deadlines a Native profile that sets none gets. They match the shipped
 * cordis.yml values so one product does not behave differently per carrier.
 */
const DEFAULT_ROUTE_CONFIG: OpenInAppRouteConfig = {
  probeTimeoutMs: 10_000,
  iconTimeoutMs: 10_000,
  launchWatchMs: 1_000,
}

/**
 * Validate one Native row's configuration: absent takes the defaults, and an
 * unknown or out-of-range field fails at load rather than silently defaulting.
 * @param input - the row's `config`, or undefined when the profile set none.
 * @returns the deadlines the route handlers use.
 */
function resolveConfig(input: unknown): OpenInAppRouteConfig {
  if (input === undefined) return DEFAULT_ROUTE_CONFIG
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('open-in-app: native configuration must be an object')
  }
  for (const key of Object.keys(input)) {
    if (!['probeTimeoutMs', 'iconTimeoutMs', 'launchWatchMs'].includes(key)) {
      throw new TypeError(`open-in-app: unknown native configuration field ${key}`)
    }
  }
  return Config({ ...DEFAULT_ROUTE_CONFIG, ...input })
}

/** Native provider name, shared with the browser row. */
export const name = 'open-in-app'

/** The Native route carrier, the trust fence, and the PATH resolver. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-host-open-in-app',
  targets: ['host'],
  requires: ['hostConnection', 'subprocess', 'launchEnvironment'],
  optional: ['httpRoutes'],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      // A carrier without a route listener serves the browser some other way and
      // has nowhere to mount these routes; its button reads the catalog it has.
      const http = context.optional('httpRoutes')
      if (http === undefined) return
      // The route carrier and the trust fence are read by service name: their
      // packages are browser-side, so this Host row keeps narrow local types.
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
      const routes = createOpenInAppRoutes(config, connection, catalogInternals)
      context.own(http.register({ kind: 'exact', path: routes.paths.apps, handler: routes.apps }))
      context.own(http.register({ kind: 'prefix', path: routes.paths.icon, handler: routes.icon }))
      context.own(http.register({ kind: 'exact', path: routes.paths.open, handler: routes.open }))
    }
  },
}
