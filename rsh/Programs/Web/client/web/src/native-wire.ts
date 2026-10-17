/** One explicitly selected native Client row with its profile configuration. */
export interface NativeClientSelection {
  readonly id: string
  /** Configuration retained for identity comparison; keep it immutable while installed. */
  readonly config: unknown
}

/** Host-injected browser module graph and selections for one Client composition. */
export interface NativeClientBootWire {
  readonly formatVersion: 1
  /** One ESM bundle containing every selected Client entry. */
  readonly bundle: string
  /** Stylesheets emitted while the Host bundled the selected entries. */
  readonly styles: readonly string[]
  /** Installation ids exported by `bundle.plugins`. */
  readonly modules: readonly { readonly id: string }[]
  readonly selections: readonly NativeClientSelection[]
  /** Host endpoint and content revision used for live Client replacement. */
  readonly reload?: { readonly endpoint: string; readonly revision: string }
}
