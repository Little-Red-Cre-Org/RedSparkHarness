import { Service } from '@redspark/cordis'

/** Host service that gives the package a Host-face surface. */
export class MixedRoute extends Service {
  /** Report the route path. */
  path(): string {
    return '/mixed'
  }
}

declare module '@redspark/cordis' {
  interface Context {
    mixedRoute: MixedRoute
  }
}

export default MixedRoute
