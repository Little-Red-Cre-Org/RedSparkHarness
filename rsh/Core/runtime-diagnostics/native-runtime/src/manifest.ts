/** JSON metadata validation before importing a native plugin entry. */
import type { NativePlugin } from './host.ts'

/** Static native entry declaration under package.json.dsh.native. */
export interface NativeEntryManifest {
  readonly apiVersion: 1
  readonly entry: string
  readonly targets: readonly ('host' | 'client')[]
  readonly requires: readonly string[]
  readonly optional: readonly string[]
  readonly provides: readonly string[]
}

const fields = new Set(['apiVersion', 'entry', 'targets', 'requires', 'optional', 'provides'])

function names(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error(`native-runtime: ${field} must be a nonempty-name array`)
  }
  const result = value as string[]
  if (new Set(result).size !== result.length) throw new Error(`native-runtime: ${field} repeats a name`)
  return [...result]
}

/**
 * Validate JSON metadata and its declared package export before loading code.
 * @param value - untrusted package.json.dsh.native value.
 * @param exports - subpath names in the same package's exports map.
 * @returns copied protocol metadata.
 */
export function parseNativeEntryManifest(value: unknown, exports: ReadonlySet<string>): NativeEntryManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('native-runtime: native manifest must be an object')
  }
  const input = value as Record<string, unknown>
  for (const field of Object.keys(input)) {
    if (!fields.has(field)) throw new Error(`native-runtime: unknown native manifest field ${field}`)
  }
  if (input.apiVersion !== 1) throw new Error('native-runtime: unsupported native manifest version')
  if (typeof input.entry !== 'string' || !/^\.\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(input.entry)
    || input.entry.split('/').includes('..') || !exports.has(input.entry)) {
    throw new Error('native-runtime: native entry must name a published package export')
  }
  const targets = names(input.targets, 'targets')
  if (targets.length === 0 || targets.some(target => target !== 'host' && target !== 'client')) {
    throw new Error('native-runtime: targets must select host or client')
  }
  const requires = names(input.requires, 'requires')
  const optional = names(input.optional, 'optional')
  const provides = names(input.provides, 'provides')
  if (optional.some(name => requires.includes(name))) throw new Error('native-runtime: required and optional services overlap')
  return { apiVersion: 1, entry: input.entry, targets: targets as ('host' | 'client')[], requires, optional, provides }
}

/**
 * Check the imported entry against its validated package declaration.
 * @param value - named `plugin` export from the selected package subpath.
 * @param manifest - static metadata validated before the import.
 * @returns a checked native plugin.
 */
export function validateNativePluginEntry(value: unknown, manifest: NativeEntryManifest): NativePlugin {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('native-runtime: native entry must export a plugin object')
  }
  const plugin = value as Record<string, unknown>
  if (typeof plugin.name !== 'string' || plugin.name.length === 0 || typeof plugin.resolve !== 'function') {
    throw new Error('native-runtime: native entry lacks a name or configuration resolver')
  }
  if (plugin.apiVersion !== manifest.apiVersion) throw new Error('native-runtime: entry API version differs from manifest')
  for (const field of ['targets', 'requires', 'optional', 'provides'] as const) {
    const declared: readonly string[] = manifest[field]
    const actual = field === 'optional' && plugin.optional === undefined ? [] : plugin[field]
    if (!Array.isArray(actual) || actual.length !== declared.length
      || new Set(actual).size !== actual.length
      || actual.some((name: unknown) => typeof name !== 'string' || !declared.includes(name))) {
      throw new Error(`native-runtime: entry ${field} differs from manifest`)
    }
  }
  return value as NativePlugin
}
