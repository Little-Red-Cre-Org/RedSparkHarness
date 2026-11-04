import { Service } from '@redspark/cordis'

/** Service exported only by the Client-only native entry. */
export class ClientOnlyNativeMarker extends Service {
  /** Report a stable marker value. */
  marker(): string {
    return 'client-only-native'
  }
}

declare module '@redspark/cordis' {
  interface Context {
    clientOnlyNativeMarker: ClientOnlyNativeMarker
  }
}
