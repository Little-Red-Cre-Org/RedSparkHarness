/** Cordis-free Native Host route registry and listener capability. */

import type {} from '@redspark/rsh-native-runtime'
import type { HttpRouteListener } from './host.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { httpRoutes: HttpRouteListener }
}

export { HttpRouteTable } from './route-table.ts'
export type { HttpRoute, HttpRouteListener } from './host.ts'
