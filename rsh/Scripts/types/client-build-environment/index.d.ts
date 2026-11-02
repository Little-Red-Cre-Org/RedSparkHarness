/** Build-time values that bundlers replace before client code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly [name: `RSH_CLIENT_${string}`]: string | undefined
  }
}
