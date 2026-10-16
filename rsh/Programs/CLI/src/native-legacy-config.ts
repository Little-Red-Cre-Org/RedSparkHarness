/** Migrate recognized legacy settings into one native CLI profile or reject values without a target. */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { NativePresetFolderSummary } from '@deepseek-ai/dsh-agent-presets/native'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { parseNativeClientProfile } from '@deepseek-ai/dsh-native-web-assets/native-client'
import { parseNativeSettingsDocument, resolveNativeSettingsConfig } from '@deepseek-ai/dsh-settings-file/native'
import {
  SHIPPED_NATIVE_PROFILES, shippedNativeProfileClientComposition, shippedNativeProfileComposition,
} from './native-profile-template.ts'
import {
  applyNativeProfilePatches, parseNativeProfileConfig, type NativeProfileConfig,
} from './native-profile-config.ts'
import { expandNativeProfilePresets, nearestNativeProfileInstallation } from './native-profile-loader.ts'

const MIGRATION_DOC = 'rsh/Docs/native-config-migration.md'
const NATIVE_CLI = 'native CLI launch'
const WEB_SESSION_CONTROLLER = '@deepseek-ai/dsh-native-web-session-controller'
const SETTINGS_FILE = '@deepseek-ai/dsh-settings-file'
const NATIVE_SANDBOX_POLICY = '@deepseek-ai/dsh-native-sandbox-policy'
const NATIVE_APPROVAL = '@deepseek-ai/dsh-native-approval'
const AGENT_PRESETS = '@deepseek-ai/dsh-agent-presets'
const AGENT_PRESET_STANDING = '@deepseek-ai/dsh-agent-preset-standing'
const CLIENT_LOCALE = '@deepseek-ai/dsh-client-locale'
const CLIENT_THEME = '@deepseek-ai/dsh-client-ui-theme'

type SettingsRule = {
  namespace: string
  key?: string
  surfaces: readonly string[]
  action: 'pass' | 'error' | 'agent-default' | 'permission-default' | 'locale' | 'theme'
  remedy?: string
}

const SETTINGS_RULES: readonly SettingsRule[] = [
  { namespace: 'llm-pi-ai', surfaces: ['@deepseek-ai/dsh-llm-pi-ai'], action: 'pass' },
  { namespace: 'web-search-deepseek', surfaces: ['@deepseek-ai/dsh-web-search-deepseek'], action: 'pass' },
  { namespace: 'ui-conversation', key: 'busyEnter', surfaces: [WEB_SESSION_CONTROLLER], action: 'pass' },
  { namespace: 'agent-default-model', key: 'provider', surfaces: [WEB_SESSION_CONTROLLER], action: 'pass' },
  { namespace: 'agent-default-model', key: 'model', surfaces: [WEB_SESSION_CONTROLLER], action: 'pass' },
  { namespace: 'agent-presets', key: 'default', surfaces: [AGENT_PRESETS], action: 'agent-default' },
  { namespace: 'permission', key: 'defaultPreset', surfaces: [NATIVE_SANDBOX_POLICY], action: 'permission-default' },
  { namespace: 'locale', key: 'preference', surfaces: [CLIENT_LOCALE], action: 'locale' },
  { namespace: 'ui-theme', key: 'preference', surfaces: [CLIENT_THEME], action: 'theme' },
  { namespace: 'agent-default-model', key: 'reasoningEffort', surfaces: [WEB_SESSION_CONTROLLER], action: 'error',
    remedy: 'agent-default-model.reasoningEffort is deleted; remove this key' },
  { namespace: 'llm-deepseek', surfaces: ['@deepseek-ai/dsh-llm-deepseek'], action: 'error',
    remedy: 'native does not read llm-deepseek settings; move provider values to llm-pi-ai.providers, or install @deepseek-ai/dsh-llm-deepseek and put them in its rsh.profile.json installation config' },
  { namespace: 'agent-loop', key: 'maxParallelToolCalls', surfaces: ['@deepseek-ai/dsh-native-agent'], action: 'error',
    remedy: 'native has no maxParallelToolCalls setting; remove this key' },
  { namespace: 'subagent-model-selection', key: '*', surfaces: ['@deepseek-ai/dsh-tool-subagent'], action: 'error',
    remedy: 'move provider and model to the @deepseek-ai/dsh-tool-subagent installation config in rsh.profile.json; enabled and allowedModels are deleted' },
  { namespace: 'agent-presets', key: 'modeSelectionEnabled', surfaces: [AGENT_PRESETS], action: 'error',
    remedy: 'agent-presets.modeSelectionEnabled is deleted; remove this key' },
  {
    namespace: 'shell',
    surfaces: [
      '@deepseek-ai/dsh-bash-sandbox', '@deepseek-ai/dsh-pwsh-sandbox',
      '@deepseek-ai/dsh-bash-local', '@deepseek-ai/dsh-pwsh-local',
    ],
    action: 'error',
    remedy: 'native does not support the shell settings namespace; remove it',
  },
  { namespace: 'ui-theme', key: 'fontSize', surfaces: [CLIENT_THEME], action: 'error',
    remedy: 'ui-theme.fontSize has no persistent native setting; remove this key' },
  { namespace: 'ui-chat', key: 'transcriptView', surfaces: ['@deepseek-ai/dsh-client-ui-chat'], action: 'error',
    remedy: 'ui-chat.transcriptView is deleted; remove this key' },
  { namespace: 'ui-pet', surfaces: ['@deepseek-ai/dsh-client-ui-pet'], action: 'error',
    remedy: 'ui-pet is deleted; remove this namespace' },
  { namespace: 'ui-onboarding', surfaces: ['@deepseek-ai/dsh-client-ui-settings-general'], action: 'error',
    remedy: 'ui-onboarding is deleted; remove this namespace' },
]

type EnvironmentRule = {
  name: string
  surfaces: readonly string[]
  remedy: string
  allowDisabled?: boolean
}

const ENVIRONMENT_RULES: readonly EnvironmentRule[] = [
  { name: 'DSH_PERMISSION_MODE', surfaces: [NATIVE_SANDBOX_POLICY],
    remedy: 'remove it and set @deepseek-ai/dsh-native-sandbox-policy config.mode and @deepseek-ai/dsh-native-approval config.policy in rsh.profile.json' },
  { name: 'DSH_TOOLS_MODE', surfaces: ['@deepseek-ai/dsh-native-headless', '@deepseek-ai/dsh-native-web-host'],
    remedy: 'native selects tools through rsh.profile.json installations; remove this variable' },
  { name: 'DSH_CONTEXT_WINDOW', surfaces: ['@deepseek-ai/dsh-llm-pi-ai'],
    remedy: 'DSH_CONTEXT_WINDOW is deleted; set the provider context window in the @deepseek-ai/dsh-llm-pi-ai installation config.providers.<provider>.models[].contextWindow in rsh.profile.json' },
  { name: 'DSH_SYSTEM_PROMPT', surfaces: ['@deepseek-ai/dsh-native-sdk-server'],
    remedy: 'DSH_SYSTEM_PROMPT is deleted; remove this variable' },
  { name: 'DSH_MAX_TOKENS_AS_SUCCESS', surfaces: ['@deepseek-ai/dsh-native-sdk-server'],
    remedy: 'DSH_MAX_TOKENS_AS_SUCCESS is deleted; remove this variable' },
  { name: 'DSH_TUI_BG', surfaces: ['@deepseek-ai/dsh-native-tui'],
    remedy: 'DSH_TUI_BG is deleted; remove this variable' },
  { name: 'DSH_TELEMETRY_MODE', surfaces: ['@deepseek-ai/dsh-session-telemetry-otel'],
    remedy: 'set config.mode on the @deepseek-ai/dsh-session-telemetry-otel installation in rsh.profile.json', allowDisabled: true },
  { name: 'DSH_TELEMETRY_OTLP_URL', surfaces: ['@deepseek-ai/dsh-session-telemetry-otel'],
    remedy: 'set config.exporter.url on the @deepseek-ai/dsh-session-telemetry-otel installation in rsh.profile.json' },
  { name: 'CORDIS_SHARED', surfaces: [NATIVE_CLI],
    remedy: 'native does not run the Cordis Loader; remove this variable' },
]

type Installation = { id: string; plugin: string; config?: unknown; disabled?: boolean }
type MigrationIntent = {
  target: 'profile' | 'client'
  installationId: string
  plugin: string
  key: string
  value: unknown
  sourceValue: unknown
  source: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function settingValue(document: Record<string, unknown>, namespace: string, key: string | undefined): { present: boolean; value: unknown } {
  if (!Object.hasOwn(document, namespace)) return { present: false, value: undefined }
  const section = document[namespace]
  if (key === undefined || key === '*') {
    const fields = record(section)
    return { present: fields === undefined ? section !== undefined : Object.keys(fields).length > 0, value: section }
  }
  const fields = record(section)
  return fields === undefined
    ? { present: section !== undefined, value: section }
    : { present: Object.hasOwn(fields, key), value: fields[key] }
}

function hasSurface(
  surface: string, profilePackages: ReadonlySet<string>, clientPackages: ReadonlySet<string>, hasClient: boolean,
): boolean {
  if (surface === NATIVE_CLI) return true
  return profilePackages.has(surface) || hasClient && clientPackages.has(surface)
}

function targetValue(row: { config?: unknown }, key: string): { present: boolean; value: unknown } {
  const config = record(row.config)
  return config !== undefined && Object.hasOwn(config, key)
    ? { present: true, value: config[key] } : { present: false, value: undefined }
}

function sameTargetValue(left: { present: boolean; value: unknown }, right: { present: boolean; value: unknown }): boolean {
  return left.present === right.present && (!left.present || isDeepStrictEqual(left.value, right.value))
}

function templateValue(
  rows: readonly { plugin: string; config?: unknown }[], plugin: string, key: string,
): { present: boolean; value: unknown } {
  const row = rows.find(candidate => candidate.plugin === plugin)
  return row === undefined ? { present: false, value: undefined } : targetValue(row, key)
}

function rendered(value: unknown): string {
  return value === undefined ? '<unset>' : JSON.stringify(value)
}

function settingsDocument(profile: NativeProfileConfig): { filename: string; document: Record<string, unknown> } | undefined {
  const settings = profile.installations.find(row => row.plugin === SETTINGS_FILE && row.disabled !== true)
  if (settings === undefined) return undefined
  const config = resolveNativeSettingsConfig(settings.config)
  const configuredFilename = config.path === undefined ? undefined : resolve(config.path)
  const extension = extname(configuredFilename ?? 'settings.yaml').toLowerCase()
  if (!['.yaml', '.yml', '.json'].includes(extension)) {
    throw new Error('settings-file: extension "' + extension + '" is not supported (use .yaml, .yml, or .json)')
  }
  const filename = configuredFilename ?? resolve(join(resolveDshHome(config.dshHome), 'settings.yaml'))
  const text = existsSync(filename) ? readFileSync(filename, 'utf8') : ''
  return { filename, document: parseNativeSettingsDocument(text, filename, extension === '.json' ? 'json' : 'yaml') }
}

function nativeClientPath(profile: NativeProfileConfig): string | undefined {
  const webHost = profile.installations.find(row => row.plugin === '@deepseek-ai/dsh-native-web-host' && row.disabled !== true)
  if (webHost === undefined) return undefined
  const projectDir = record(webHost.config)?.projectDir
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    throw new Error('native web host: projectDir must be a nonempty string')
  }
  return join(resolve(projectDir), 'rsh.client.json')
}

function validateNativePreset(id: unknown, profile: NativeProfileConfig, target: Installation): void {
  if (typeof id !== 'string') throw new Error(`dsh: agent-presets.default must name a native preset; see ${MIGRATION_DOC}`)
  const standings = profile.installations.filter(row => row.plugin === AGENT_PRESET_STANDING && row.disabled !== true
    && record(row.config)?.id === id)
  const registered = standings.some(row => nearestNativeProfileInstallation(profile, row.scope, AGENT_PRESETS)?.id === target.id)
  if (registered) return
  if (standings.length > 0) throw new Error(`dsh: preset ${id} does not exist; see ${MIGRATION_DOC}`)
  const folders = record(target.config)?.folders as readonly NativePresetFolderSummary[] | undefined
  const folder = folders?.find(candidate => candidate.id === id)
  if (folder?.status === 'needs-migration') {
    throw new Error(`dsh: preset ${id} still uses agent.cordis.yml; rewrite it as agent.native.json; see ${MIGRATION_DOC}`)
  }
  if (folder?.status === 'invalid') {
    throw new Error(`dsh: preset ${id} is invalid${folder.problem === undefined ? '' : `: ${folder.problem}`}; see ${MIGRATION_DOC}`)
  }
  if (folder?.status === 'ready') {
    throw new Error(`dsh: preset ${id} is not registered as an active native preset; see ${MIGRATION_DOC}`)
  }
  throw new Error(`dsh: preset ${id} does not exist; see ${MIGRATION_DOC}`)
}

function activeInstallation(rows: readonly Installation[], plugin: string): Installation | undefined {
  return rows.find(row => row.plugin === plugin && row.disabled !== true)
}

function applySettingsRules(options: {
  settings: { filename: string; document: Record<string, unknown> } | undefined
  profile: NativeProfileConfig
  clientProfile: { installations: readonly Installation[] } | undefined
  profilePackages: ReadonlySet<string>
  clientPackages: ReadonlySet<string>
  hasClient: boolean
}): MigrationIntent[] {
  const { settings, profile, clientProfile } = options
  if (settings === undefined) return []
  const intents: MigrationIntent[] = []
  const migrate = (target: MigrationIntent['target'], plugin: string, key: string, value: unknown,
    sourceValue: unknown, source: string): void => {
    const rows: readonly Installation[] = target === 'profile' ? profile.installations : clientProfile?.installations ?? []
    const installation = activeInstallation(rows, plugin)
    if (installation === undefined) {
      throw new Error(`${source} has no active native target installation ${plugin}; see ${MIGRATION_DOC}`)
    }
    intents.push({ target, installationId: installation.id, plugin, key, value, sourceValue, source })
  }
  for (const rule of SETTINGS_RULES) {
    if (rule.action === 'pass' || !rule.surfaces.some(surface => hasSurface(surface, options.profilePackages, options.clientPackages, options.hasClient))) continue
    const old = settingValue(settings.document, rule.namespace, rule.key)
    if (!old.present) continue
    const setting = `${settings.filename} ${rule.namespace}${rule.key === undefined ? '' : `.${rule.key}`}`
    if (rule.action === 'error') throw new Error(`dsh: ${setting}; ${rule.remedy}; see ${MIGRATION_DOC}`)
    if (rule.action === 'agent-default') {
      const target = activeInstallation(profile.installations, AGENT_PRESETS)
      if (target !== undefined) validateNativePreset(old.value, profile, target)
      migrate('profile', AGENT_PRESETS, 'default', old.value, old.value, setting)
      continue
    }
    if (rule.action === 'permission-default') {
      let mode: string
      let policy: string
      switch (old.value) {
        case 'read-only': mode = 'read-only'; policy = 'ask'; break
        case 'workspace-write': mode = 'workspace-write'; policy = 'ask'; break
        case 'danger-full-access': mode = 'danger-full-access'; policy = 'never'; break
        default:
          throw new Error(`dsh: ${setting}=${rendered(old.value)} must be read-only, workspace-write, or danger-full-access; see ${MIGRATION_DOC}`)
      }
      migrate('profile', NATIVE_SANDBOX_POLICY, 'mode', mode, old.value, setting)
      migrate('profile', NATIVE_APPROVAL, 'policy', policy, old.value, setting)
      continue
    }
    if (rule.action === 'locale') {
      if (old.value === 'system') continue
      if (old.value !== 'en' && old.value !== 'zh') {
        throw new Error(`dsh: ${setting}=${rendered(old.value)} must be en, zh, or system; see ${MIGRATION_DOC}`)
      }
      migrate('client', CLIENT_LOCALE, 'locale', old.value, old.value, setting)
      continue
    }
    if (old.value !== 'light' && old.value !== 'dark' && old.value !== 'system') {
      throw new Error(`dsh: ${setting}=${rendered(old.value)} must be light, dark, or system; see ${MIGRATION_DOC}`)
    }
    migrate('client', CLIENT_THEME, 'preference', old.value, old.value, setting)
  }
  return intents
}

type PreparedMigration = { path: string; document: Record<string, unknown>; mode: number; changed: boolean; report: string[] }

function prepareMigrations(path: string, target: MigrationIntent['target'], intents: readonly MigrationIntent[],
  templateRows: readonly { plugin: string; config?: unknown }[]): PreparedMigration {
  const report: string[] = []
  const mode = statSync(path).mode & 0o777
  const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (target === 'profile') parseNativeProfileConfig(document)
  else parseNativeClientProfile(document)
  const rows = document.installations as Installation[]
  let changed = false
  for (const intent of intents) {
    const row = rows.find(candidate => candidate.id === intent.installationId && candidate.plugin === intent.plugin)
    if (row === undefined) {
      throw new Error(`dsh: target installation ${intent.installationId} for ${intent.plugin} is not in ${path}; it exists only in a --patch or preset expansion. Set ${intent.plugin} config.${intent.key} manually in the file that declares the installation; see ${MIGRATION_DOC}`)
    }
    const current = targetValue(row, intent.key)
    if (current.present && isDeepStrictEqual(current.value, intent.value)) continue
    const shipped = templateValue(templateRows, intent.plugin, intent.key)
    if (!current.present || shipped.present && isDeepStrictEqual(current.value, shipped.value)) {
      const config = record(row.config) ?? {}
      row.config = { ...config, [intent.key]: intent.value }
      report.push(`dsh: migrated ${intent.source}=${rendered(intent.sourceValue)} to ${path} installations[${row.id}].config.${intent.key}=${rendered(intent.value)}; see ${MIGRATION_DOC}`)
      changed = true
      continue
    }
    throw new Error(`dsh: migration conflict: ${intent.source}=${rendered(intent.sourceValue)}; ${path} installations[${row.id}].config.${intent.key}=${rendered(current.value)} (shipped value ${rendered(shipped.value)}); see ${MIGRATION_DOC}`)
  }
  return { path, document, mode, changed, report }
}

async function verifyProfileMigration(prepared: PreparedMigration, intents: readonly MigrationIntent[],
  patchFiles: readonly string[], anchors: readonly ReturnType<typeof createRequire>[], home: string): Promise<void> {
  const effective = await expandNativeProfilePresets(
    applyNativeProfilePatches(parseNativeProfileConfig(prepared.document),
      patchFiles.map(file => JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown)),
    anchors, home)
  for (const intent of intents) {
    const row = effective.installations.find(candidate => candidate.id === intent.installationId
      && candidate.plugin === intent.plugin)
    const value = row === undefined ? { present: false, value: undefined } : targetValue(row, intent.key)
    if (!sameTargetValue(value, { present: true, value: intent.value })) {
      throw new Error(`dsh: ${intent.source} cannot migrate because the effective ${prepared.path} installations[${intent.installationId}].config.${intent.key}=${rendered(value.value)} does not match migrated value ${rendered(intent.value)} after --patch and preset expansion; handle that override manually; see ${MIGRATION_DOC}`)
    }
  }
}

async function writeMigration(prepared: PreparedMigration): Promise<void> {
  if (prepared.changed) await writeFileAtomic(prepared.path, `${JSON.stringify(prepared.document, null, 2)}\n`, { mode: prepared.mode })
}

async function commitMigrations(options: {
  profilePath: string
  clientPath: string | undefined
  profileIntents: readonly MigrationIntent[]
  clientIntents: readonly MigrationIntent[]
  profileTemplate: readonly Installation[]
  clientTemplate: readonly { plugin: string }[]
  patchFiles: readonly string[]
  anchors: readonly ReturnType<typeof createRequire>[]
  home: string
}): Promise<string[]> {
  const { profilePath, clientPath, profileIntents, clientIntents } = options
  const applyUnderLocks = async (): Promise<string[]> => {
    const prepared = [
      ...(profileIntents.length === 0 ? [] : [prepareMigrations(profilePath, 'profile', profileIntents, options.profileTemplate)]),
      ...(clientIntents.length === 0 || clientPath === undefined ? [] : [prepareMigrations(clientPath, 'client', clientIntents, options.clientTemplate)]),
    ]
    const profileMigration = prepared.find(migration => migration.path === profilePath)
    if (profileMigration !== undefined) {
      await verifyProfileMigration(profileMigration, profileIntents, options.patchFiles, options.anchors, options.home)
    }
    for (const migration of prepared) await writeMigration(migration)
    return prepared.flatMap(migration => migration.report)
  }
  if (profileIntents.length > 0 && clientIntents.length > 0 && clientPath !== undefined) {
    return withFileLock(profilePath, () => withFileLock(clientPath, applyUnderLocks))
  }
  if (profileIntents.length > 0) return withFileLock(profilePath, applyUnderLocks)
  if (clientIntents.length > 0 && clientPath !== undefined) return withFileLock(clientPath, applyUnderLocks)
  return []
}

function checkEnvironment(options: {
  environment: LaunchEnvironmentSnapshot
  profilePackages: ReadonlySet<string>
  clientPackages: ReadonlySet<string>
  hasClient: boolean
}): void {
  for (const rule of ENVIRONMENT_RULES) {
    if (!rule.surfaces.some(surface => hasSurface(surface, options.profilePackages, options.clientPackages, options.hasClient))) continue
    const entry = options.environment.getFrom(rule.name, ['process'])
    if (entry === undefined || rule.allowDisabled === true && entry.value === 'DISABLED') continue
    throw new Error(`dsh: ${rule.name} is not supported for this native profile; ${rule.remedy}; see ${MIGRATION_DOC}`)
  }
}

/** Expand the selected composition, migrate supported settings, and reject legacy launch configuration.
 * @param options - selected profile, its JSON patches, CLI resolver anchor, Harness home, and launch environment.
 * @returns completion after optional profile-file updates; `settings.yaml` is never written.
 * @throws when an active surface has unsupported legacy values or a migration target conflicts.
 */
export async function migrateNativeLegacyConfig(options: {
  profileName: string
  installAnchor: string
  home: string
  profile: NativeProfileConfig
  patchFiles: readonly string[]
  environment: LaunchEnvironmentSnapshot
}): Promise<void> {
  const profileDirectory = join(options.home, 'profiles', options.profileName)
  const profilePath = join(profileDirectory, 'rsh.profile.json')
  const anchors = [
    createRequire(options.installAnchor), createRequire(join(profileDirectory, 'package.json')),
  ]
  const profile = await expandNativeProfilePresets(options.profile, anchors, options.home)
  const clientPath = nativeClientPath(profile)
  const profilePackages = new Set(profile.installations.filter(row => row.disabled !== true).map(row => row.plugin))
  const hasClient = clientPath !== undefined
  const clientProfile = clientPath !== undefined && existsSync(clientPath)
    ? parseNativeClientProfile(JSON.parse(readFileSync(clientPath, 'utf8')) as unknown) : undefined
  const clientRows: Installation[] = clientProfile?.installations.map(row => ({ ...row })) ?? []
  const clientPackages = new Set(clientRows.filter(row => row.disabled !== true).map(row => row.plugin))
  checkEnvironment({ environment: options.environment, profilePackages, clientPackages, hasClient })
  const settings = settingsDocument(profile)
  const profileTemplate = SHIPPED_NATIVE_PROFILES.includes(options.profileName)
    ? shippedNativeProfileComposition(options.home, options.profileName).installations : []
  const clientTemplate = shippedNativeProfileClientComposition(options.profileName)
  const intents = applySettingsRules({ settings, profile, clientProfile,
    profilePackages, clientPackages, hasClient })
  const reports = await commitMigrations({ profilePath, clientPath,
    profileIntents: intents.filter(intent => intent.target === 'profile'),
    clientIntents: intents.filter(intent => intent.target === 'client'), profileTemplate, clientTemplate,
    patchFiles: options.patchFiles, anchors, home: options.home })
  for (const line of reports) process.stderr.write(`${line}\n`)
}
