/** Provider-neutral package identity normalization for the version-1 wire field. */
import type { DeepSeekPluginPackageIdentity, DeepSeekPluginPackageInventoryExtension } from './types.ts'

/** Deterministic text order independent of the host's ICU data and locale. */
function compareWireText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Deduplicate and order package identities for the version-1 request field.
 * @param identities - exact package name/version pairs to normalize.
 * @returns the deterministic version-1 wire field.
 */
export function createInventoryExtension(
  identities: readonly DeepSeekPluginPackageIdentity[],
): DeepSeekPluginPackageInventoryExtension {
  const unique = new Map<string, DeepSeekPluginPackageIdentity>()
  for (const identity of identities) unique.set(`${identity.name}\u0000${identity.version}`, identity)
  return {
    version: 1,
    packages: [...unique.values()].sort((left, right) => (
      compareWireText(left.name, right.name) || compareWireText(left.version, right.version)
    )),
  }
}
