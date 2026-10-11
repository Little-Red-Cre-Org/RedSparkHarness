/** Synchronous file discovery for native agent-preset installations. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { parsePresetMetadata, METADATA_FILE, type PresetMetadata } from './metadata.ts'
import { PRESET_ID, type PresetRoot } from './preset.ts'

/** File containing a native preset's ordered plugin installations. */
export const NATIVE_COMPOSITION_FILE = 'agent.native.json'

/** One plugin installation declared by a native preset folder. */
export interface NativePresetInstallation {
  /** Profile installation id, unique within the preset. */
  readonly id: string
  /** Installed native plugin package name. */
  readonly plugin: string
  /** Plugin configuration, when declared. */
  readonly config?: unknown
  /** Whether the plugin installation is disabled. */
  readonly disabled?: boolean
}

/** File-backed preset information used by the native profile loader. */
export interface NativePresetFolder {
  /** Stable id taken from the preset directory name. */
  readonly id: string
  /** Trust inherited from the preset root. */
  readonly trust: PresetRoot['trust']
  /** Absolute path of the preset directory. */
  readonly directory: string
  /** Display name from `preset.yml`, or the directory id. */
  readonly name: string
  /** Optional description from `preset.yml`. */
  readonly description?: string
  /** Optional display order from `preset.yml`. */
  readonly order?: number
  /** Native installation file state. */
  readonly status: 'ready' | 'needs-migration' | 'invalid'
  /** Short reason for an invalid native installation file or missing plugin. */
  readonly problem?: string
  /** Parsed plugin rows, present only when `status` is `ready`. */
  readonly installations?: readonly NativePresetInstallation[]
}

/** Client-safe native preset folder metadata exposed by the registry. */
export interface NativePresetFolderSummary {
  /** Stable preset id. */
  readonly id: string
  /** Display name from `preset.yml`, or the preset id. */
  readonly name: string
  /** Optional display description from `preset.yml`. */
  readonly description?: string
  /** Trust inherited from the preset root. */
  readonly trust: PresetRoot['trust']
  /** Native installation file state. */
  readonly status: NativePresetFolder['status']
  /** Short reason when the native preset cannot be installed. */
  readonly problem?: string
}

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const nativeCompositionSchema = z.strictObject({
  formatVersion: z.literal(1),
  installations: z.array(z.strictObject({
    id: z.string().min(1),
    plugin: z.string().regex(packageName),
    config: z.unknown().optional(),
    disabled: z.boolean().optional(),
  })),
})

function metadata(directory: string): PresetMetadata {
  try {
    return parsePresetMetadata(readFileSync(join(directory, METADATA_FILE), 'utf8'))
  } catch {
    return {}
  }
}

function nativeInstallations(directory: string): Pick<NativePresetFolder, 'status' | 'problem' | 'installations'> {
  let raw: string
  try {
    raw = readFileSync(join(directory, NATIVE_COMPOSITION_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'needs-migration' }
    return { status: 'invalid', problem: `${NATIVE_COMPOSITION_FILE} cannot be read` }
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return { status: 'invalid', problem: `${NATIVE_COMPOSITION_FILE} is not valid JSON` }
  }
  const parsed = nativeCompositionSchema.safeParse(value)
  if (!parsed.success || new Set(parsed.data.installations.map(row => row.id)).size !== parsed.data.installations.length) {
    return { status: 'invalid', problem: `${NATIVE_COMPOSITION_FILE} has an invalid format` }
  }
  const installations: NativePresetInstallation[] = parsed.data.installations.map(({ id, plugin, config, disabled }) => ({
    id, plugin,
    ...config === undefined ? {} : { config },
    ...disabled === undefined ? {} : { disabled },
  }))
  return { status: 'ready', installations }
}

/**
 * Return shipped and home-local roots in duplicate-id precedence order.
 * @param home - selected Harness home.
 * @returns shipped system root followed by the writable user root.
 */
export function nativePresetRoots(home: string): readonly PresetRoot[] {
  return [
    { path: fileURLToPath(new URL('../presets/', import.meta.url)), trust: 'system' },
    { path: join(home, '.agent-presets'), trust: 'user' },
  ]
}

/**
 * Synchronously scan native preset folders, keeping the first root's duplicate id.
 * @param roots - roots in trust and duplicate-id precedence order.
 * @returns folders ordered by declared metadata order, then id.
 */
export function scanNativePresetFolders(roots: readonly PresetRoot[]): NativePresetFolder[] {
  const found: NativePresetFolder[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    let children
    try {
      children = readdirSync(root.path, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const child of children) {
      if (!child.isDirectory() || !PRESET_ID.test(child.name) || seen.has(child.name)) continue
      seen.add(child.name)
      const directory = join(root.path, child.name)
      const display = metadata(directory)
      found.push({ id: child.name, trust: root.trust, directory, name: display.name ?? child.name,
        ...display.description === undefined ? {} : { description: display.description },
        ...display.order === undefined ? {} : { order: display.order },
        ...nativeInstallations(directory) })
    }
  }
  return found.sort((left, right) => {
    const leftOrder = left.order ?? Number.POSITIVE_INFINITY
    const rightOrder = right.order ?? Number.POSITIVE_INFINITY
    return leftOrder === rightOrder ? left.id.localeCompare(right.id) : leftOrder - rightOrder
  })
}
