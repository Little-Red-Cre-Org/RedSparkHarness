/** Synchronous file discovery for native agent-preset installations. */
import { readFileSync, readdirSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { parsePresetMetadata, renderPresetMetadata, METADATA_FILE, type PresetMetadata } from './metadata.ts'
import { PRESET_ID, type PresetRoot } from './preset.ts'

/** File containing a native preset's ordered plugin installations. */
export const NATIVE_COMPOSITION_FILE = 'agent.native.json'

/** Stable native preset refusal codes shared with the Host RPC. */
export type NativeAgentPresetErrorCode = 'agent-preset/not-found' | 'agent-preset/invalid' | 'agent-preset/read-only'

/** A native preset operation refused by its roster or authoring policy. */
export class NativeAgentPresetError extends Error {
  /** @param code - stable Host refusal code. @param details - safe preset identity and reason. */
  constructor(readonly code: NativeAgentPresetErrorCode, message: string,
    readonly details: { readonly agentPreset: string; readonly available?: readonly string[]; readonly reason?: string }) {
    super(message)
    this.name = 'NativeAgentPresetError'
  }
}

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

function invalidId(id: string): NativeAgentPresetError {
  const reason = `preset id ${JSON.stringify(id)} must match ${String(PRESET_ID)} — the id is a directory name`
  return new NativeAgentPresetError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: id, reason })
}

function presetNotFound(id: string, roots: readonly PresetRoot[]): NativeAgentPresetError {
  const available = scanNativePresetFolders(roots).map(folder => folder.id)
  return new NativeAgentPresetError('agent-preset/not-found',
    `agent-presets: preset ${JSON.stringify(id)} not found (available: ${available.join(', ') || 'none'})`,
    { agentPreset: id, available })
}

function presetReadOnly(id: string, reason: string): NativeAgentPresetError {
  return new NativeAgentPresetError('agent-preset/read-only',
    `agent-presets: preset ${JSON.stringify(id)} cannot be written: ${reason}`, { agentPreset: id, reason })
}

function presetExists(id: string): NativeAgentPresetError {
  const reason = `preset ${JSON.stringify(id)} already exists — a copy never overwrites; choose another id`
  return new NativeAgentPresetError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: id, reason })
}

function resolveFolder(roots: readonly PresetRoot[], id: string): NativePresetFolder {
  if (!PRESET_ID.test(id)) throw invalidId(id)
  const folder = scanNativePresetFolders(roots).find(candidate => candidate.id === id)
  if (folder === undefined) throw presetNotFound(id, roots)
  return folder
}

/**
 * Return file-backed folder details, or undefined for a profile-only composition.
 * @param roots - Host-owned preset roots in precedence order.
 * @param id - preset directory id.
 * @returns the matching file-backed folder, if one exists.
 */
export function nativePresetFolder(roots: readonly PresetRoot[], id: string): NativePresetFolder | undefined {
  if (!PRESET_ID.test(id)) throw invalidId(id)
  return scanNativePresetFolders(roots).find(candidate => candidate.id === id)
}

/**
 * Read the raw native composition file without parsing or activating it.
 * @param folder - discovered preset folder.
 * @returns file contents, or undefined when the folder needs migration.
 */
export async function readNativePresetComposition(folder: NativePresetFolder): Promise<string | undefined> {
  if (folder.status === 'needs-migration') return undefined
  return await readFile(join(folder.directory, NATIVE_COMPOSITION_FILE), 'utf8')
}

async function tightenModes(directory: string): Promise<void> {
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) await tightenModes(target)
    else await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
  }
}

/**
 * Copy one complete preset folder into the first user root without replacing an existing directory.
 * @param roots - Host-owned preset roots in precedence order.
 * @param from - existing file-backed source id.
 * @param id - new directory id.
 * @param name - optional display name for the copy.
 * @returns completion after the folder and metadata are written.
 */
export async function copyNativePreset(
  roots: readonly PresetRoot[], from: string, id: string, name?: string,
): Promise<void> {
  const source = resolveFolder(roots, from)
  if (source.status !== 'ready') {
    const reason = `preset ${JSON.stringify(from)} is not ready to copy`
    throw new NativeAgentPresetError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: from, reason })
  }
  if (!PRESET_ID.test(id)) throw invalidId(id)
  const userRoot = roots.find(root => root.trust === 'user')
  if (userRoot === undefined) throw presetReadOnly(id, 'this deployment configures no user preset directory')
  if (scanNativePresetFolders(roots).some(folder => folder.id === id)) throw presetExists(id)
  const destination = join(userRoot.path, id)
  await mkdir(userRoot.path, { recursive: true, mode: 0o700 })
  try {
    await mkdir(destination, { mode: 0o700 })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw presetExists(id)
    throw error
  }
  try {
    for (const entry of await readdir(source.directory)) {
      await cp(join(source.directory, entry), join(destination, entry), {
        recursive: true, dereference: true, force: false, errorOnExist: true,
      })
    }
    await tightenModes(destination)
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...source.description === undefined ? {} : { description: source.description },
    })
    const metadataPath = join(destination, METADATA_FILE)
    if (rendered === undefined) await rm(metadataPath, { force: true })
    else await writeFile(metadataPath, rendered, { encoding: 'utf8', mode: 0o600 })
  } catch (error: unknown) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

/**
 * Delete a user preset folder; system folders remain read-only.
 * @param roots - Host-owned preset roots in precedence order.
 * @param id - preset directory id.
 * @returns completion after the folder is removed.
 */
export async function deleteNativePreset(roots: readonly PresetRoot[], id: string): Promise<void> {
  const folder = resolveFolder(roots, id)
  if (folder.trust !== 'user') throw presetReadOnly(id, 'it ships with the deployment')
  await rm(folder.directory, { recursive: true, force: true })
}

/**
 * Resolve a user preset directory for opening or revealing on the Host.
 * @param roots - Host-owned preset roots in precedence order.
 * @param id - preset directory id.
 * @returns the Host-local folder path.
 */
export function nativePresetDirectory(roots: readonly PresetRoot[], id: string): string {
  const folder = resolveFolder(roots, id)
  if (folder.trust !== 'user') throw presetReadOnly(id, 'it ships with the deployment')
  return folder.directory
}
