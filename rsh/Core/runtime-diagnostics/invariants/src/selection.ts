/**
 * Package-name admission shared by the Cordis service and the Native registry.
 * This module imports no Cordis symbol.
 * @module @redspark/rsh-invariants/selection
 */

/** Runtime invariant selection configured on either registry. */
export interface InvariantSelectionConfig {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: readonly string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: readonly string[]
}

/** Compiled filters. Invalid sources never reach this object. */
export interface InvariantSelection {
  /** Global switch after the default is applied. */
  readonly enabled: boolean
  /** Compiled allowlist; empty admits every package name. */
  readonly packageAllowlist: readonly RegExp[]
  /** Compiled blocklist applied after the allowlist. */
  readonly packageBlocklist: readonly RegExp[]
}

/** Compile and validate one package-filter list. */
function compilePatterns(field: 'package_allowlist' | 'package_blocklist', values: readonly string[]): RegExp[] {
  const seen = new Set<string>()
  return values.map((value) => {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`invariants: ${field} entries must be non-blank and have no surrounding whitespace`)
    }
    if (seen.has(value)) {
      throw new Error(`invariants: ${field} contains duplicate regex ${JSON.stringify(value)}`)
    }
    seen.add(value)
    try {
      return new RegExp(value)
    } catch (cause) {
      throw new Error(`invariants: ${field} contains invalid regex ${JSON.stringify(value)}`, { cause })
    }
  })
}

/**
 * Compile one registry row, applying the enabled default without reading the process environment.
 * @param config - caller-supplied filters; omitted lists are empty.
 * @returns frozen compiled selection.
 */
export function compileInvariantSelection(config: InvariantSelectionConfig = {}): InvariantSelection {
  return Object.freeze({
    enabled: config.enabled ?? true,
    packageAllowlist: compilePatterns('package_allowlist', config.package_allowlist ?? []),
    packageBlocklist: compilePatterns('package_blocklist', config.package_blocklist ?? []),
  })
}

/**
 * Return whether one full package name passes the compiled filters.
 * @param selection - compiled registry filters.
 * @param packageName - full npm package name.
 * @returns true when the installer should run.
 */
export function invariantPackageSelected(selection: InvariantSelection, packageName: string): boolean {
  if (!selection.enabled) return false
  if (selection.packageAllowlist.length > 0
    && !selection.packageAllowlist.some(pattern => pattern.test(packageName))) return false
  return !selection.packageBlocklist.some(pattern => pattern.test(packageName))
}

/**
 * Reject a package name that could not be a stable registration key.
 * @param packageName - claimed npm package name.
 */
export function assertInvariantPackageName(packageName: string): void {
  if (packageName.length === 0 || packageName.trim() !== packageName || /\s/.test(packageName)) {
    throw new Error('invariants: packageName must be non-blank and contain no whitespace')
  }
}
