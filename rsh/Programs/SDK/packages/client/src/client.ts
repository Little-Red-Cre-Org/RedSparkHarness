/** Program-owned launcher facade for the Engine SDK transport. */

import { HarnessClient as SdkHarnessClient } from '@redspark/rsh-sdk-runtime'
import type { HarnessClientOptions, RuntimeProcessOptions } from '@redspark/rsh-sdk-runtime'
import { resolveDshLaunch } from './launch.ts'

/** Low-level public SDK client using the Program-owned dsh launcher. */
export class HarnessClient extends SdkHarnessClient {
  constructor(options: HarnessClientOptions = {}, runtime: RuntimeProcessOptions = resolveDshLaunch(options)) {
    super(options, runtime)
  }
}

export {
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from '@redspark/rsh-sdk-runtime'
export type { NotificationSubscription } from '@redspark/rsh-sdk-runtime'
export { JsonRpcResponseError } from '@redspark/rsh-sdk-runtime'
