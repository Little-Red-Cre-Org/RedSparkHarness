/**
 * Native host row.
 *
 * A Native profile has no Cordis `webServer`, so this row registers the shared
 * handlers on the Native listener's `httpRoutes`. The suite pins the three
 * route paths it claims and the trust fence it reads: a row that stopped
 * serving the shared handlers, or served them untrusted, fails here.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import { createLaunchEnvironmentSnapshot } from '@redspark/rsh-launch-environment/native'
import { plugin } from '../src/native.ts'
import { OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_ICON_PREFIX, OPEN_IN_APP_OPEN_ROUTE } from '../src/shared.ts'

/** Context stub: the row reads four services and owns three route disposers.
 * @param over - the trust-fence verdict the stubbed Connection handle returns.
 * @returns the routes the activated row registered, in registration order.
 */
async function harness(over: { rejection?: 401 | 403 } = {}) {
  const routes: { kind: string; path: string; handler: unknown }[] = []
  const http = {
    register: (route: { kind: string; path: string; handler: unknown }) => {
      routes.push(route)
      return async () => {}
    },
  }
  const context = {
    require: (name: string) => {
      if (name === 'httpRoutes') return http
      if (name === 'hostConnection') return { requestRejection: () => over.rejection }
      if (name === 'subprocess') return { resolveExecutable: async () => null }
      return createLaunchEnvironmentSnapshot([])
    },
    own: () => {},
  }
  await plugin.resolve(undefined)(context as unknown as NativeContext)
  return { routes }
}

describe('native open-in-app host row', () => {
  it('declares the Native services it reads', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['host'])
    expect(plugin.requires).toEqual(['httpRoutes', 'hostConnection', 'subprocess', 'launchEnvironment'])
    expect(plugin.optional).toEqual([])
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
