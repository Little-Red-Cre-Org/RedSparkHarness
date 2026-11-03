/** Program route identity shared by Host execution and detached Client requests. */
import type { Branded } from '@redspark/rsh-brand'

/** Profile-selected identity of one Program configuration and its existing policy scope. */
export type NativeRootRouteId = Branded<'NativeRootRouteId'>
