/**
 * Native host row.
 *
 * A Native process that serves its own HTTP listener supplies `httpRoutes`, and
 * this row registers the shared handlers there. A carrier that tunnels every
 * call through a private channel supplies none, and the row must install
 * nothing rather than refuse assembly: the shipped composition is shared by
 * both. The suite pins that split, the three route paths it claims, and the
 * trust fence it reads.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import { createLaunchEnvironmentSnapshot } from '@redspark/rsh-launch-environment/native'
import { plugin } from '../src/native.ts'
import { OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_ICON_PREFIX, OPEN_IN_APP_OPEN_ROUTE } from '../src/shared.ts'

/** Context stub: the row reads its services and owns one route disposer per route.
 * @param over - the trust-fence verdict, and whether a route listener exists.
 * @returns the routes the activated row registered, in registration order.
 */
async function harness(over: { rejection?: 401 | 403; routeListener?: boolean } = {}) {
  const routes: { kind: string; path: string; handler: unknown }[] = []
  const http = {
    register: (route: { kind: string; path: string; handler: unknown }) => {
      routes.push(route)
      return async () => {}
    },
  }
  const context = {
    require: (name: string) => {
      if (name === 'hostConnection') return { requestRejection: () => over.rejection }
      if (name === 'subprocess') return { resolveExecutable: async () => null }
      return createLaunchEnvironmentSnapshot([])
    },
    optional: (name: string) => name === 'httpRoutes' && over.routeListener !== false ? http : undefined,
    own: () => {},
  }
  await plugin.resolve(undefined)(context as unknown as NativeContext)
  return { routes }
}

describe('native open-in-app host row', () => {
  it('requires the services every carrier has and treats the route listener as optional', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['host'])
    // httpRoutes is optional on purpose: the Desktop carrier provides none, and
    // a required row there would fail assembly for the whole shipped profile.
    expect(plugin.requires).toEqual(['hostConnection', 'subprocess', 'launchEnvironment'])
    expect(plugin.optional).toEqual(['httpRoutes'])
    expect(plugin.provides).toEqual([])
  })

  it('registers the apps, icon, and open routes on httpRoutes', async () => {
    const { routes } = await harness()
    expect(routes.map(route => [route.kind, route.path])).toEqual([
      ['exact', OPEN_IN_APP_APPS_ROUTE],
      ['prefix', OPEN_IN_APP_ICON_PREFIX],
      ['exact', OPEN_IN_APP_OPEN_ROUTE],
    ])
  })

  it('installs nothing when the carrier has no route listener', async () => {
    const { routes } = await harness({ routeListener: false })
    expect(routes).toEqual([])
  })

  it('answers with the shared route semantics', async () => {
    const { routes } = await harness()
    const handler = routes[0]?.handler as (req: unknown, res: unknown) => Promise<void>
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
    await handler({ method: 'POST', headers: {}, url: OPEN_IN_APP_APPS_ROUTE }, res)
    // 405 plus the route's one supported method is the shared handler's answer,
    // so a Native fork that reimplemented the route would fail here.
    expect(res.statusCode).toBe(405)
    expect(res.setHeader).toHaveBeenCalledWith('allow', 'GET')
  })

  it('refuses the request when the Native trust fence rejects the caller', async () => {
    const { routes } = await harness({ rejection: 401 })
    const handler = routes[0]?.handler as (req: unknown, res: unknown) => Promise<void>
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
    await handler({ method: 'GET', headers: {}, url: OPEN_IN_APP_APPS_ROUTE }, res)
    expect(res.statusCode).toBe(401)
  })
})
