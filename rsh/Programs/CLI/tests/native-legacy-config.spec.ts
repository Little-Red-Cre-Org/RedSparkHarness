import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { shippedNativeProfileClientComposition, shippedNativeProfileComposition } from '../src/native-profile-template.ts'
import { migrateNativeLegacyConfig } from '../src/native-legacy-config.ts'

async function nativeWebProfile() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-native-legacy-config-'))
  const directory = join(home, 'profiles', 'native-web')
  await mkdir(directory, { recursive: true })
  const presetDirectory = join(home, '.agent-presets', 'compact')
  await mkdir(presetDirectory, { recursive: true })
  await writeFile(join(presetDirectory, 'agent.native.json'), '{"formatVersion":1,"installations":[]}\n')
  const profile = shippedNativeProfileComposition(home, 'native-web')
  const client = shippedNativeProfileClientComposition('native-web').map(({ plugin }) => ({
    id: plugin.split('/').at(-1) ?? plugin,
    plugin,
  }))
  await writeFile(join(directory, 'rsh.profile.json'), `${JSON.stringify(profile, null, 2)}\n`)
  await writeFile(join(directory, 'rsh.client.json'), `${JSON.stringify({ formatVersion: 1, installations: client }, null, 2)}\n`)
  return { home, directory, profile }
}

const emptyEnvironment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }])
const installAnchor = fileURLToPath(import.meta.url)

it('migrates recognized settings into native profile and Client installations without editing settings.yaml', async () => {
  const { home, directory, profile } = await nativeWebProfile()
  const settingsPath = join(home, 'settings.yaml')
  const settingsText = 'agent-presets:\n  default: compact\npermission:\n  defaultPreset: read-only\nlocale:\n  preference: zh\nui-theme:\n  preference: dark\n'
  await writeFile(settingsPath, settingsText)
  const profilePath = join(directory, 'rsh.profile.json')
  const presetRow = profile.installations.find(row => row.id === 'agent-presets')!
  const storedProfile = {
    ...profile,
    installations: profile.installations.map(row => row.id === presetRow.id ? { ...row, disabled: true } : row)
      .concat({ ...presetRow, id: 'agent-presets-secondary', config: { default: 'operator' } }),
  }
  const effectiveProfile = {
    ...storedProfile,
    installations: storedProfile.installations.map(row => row.id === presetRow.id
      ? { ...row, disabled: false } : row.id === 'agent-presets-secondary' ? { ...row, disabled: true } : row),
  }
  await writeFile(profilePath, `${JSON.stringify(storedProfile, null, 2)}\n`)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  try {
    await migrateNativeLegacyConfig({ profileName: 'native-web', installAnchor, home, profile: effectiveProfile, patchFiles: [], environment: emptyEnvironment })
    const migrated = JSON.parse(await readFile(profilePath, 'utf8')) as typeof profile
    const client = JSON.parse(await readFile(join(directory, 'rsh.client.json'), 'utf8')) as {
      installations: { plugin: string; config?: Record<string, unknown> }[]
    }
    expect(migrated.installations.find(row => row.id === 'agent-presets')?.config)
      .toMatchObject({ default: 'compact' })
    expect(migrated.installations.find(row => row.id === 'agent-presets-secondary')?.config)
      .toMatchObject({ default: 'operator' })
    expect(migrated.installations.find(row => row.plugin === '@deepseek-ai/dsh-native-sandbox-policy')?.config)
      .toMatchObject({ mode: 'read-only' })
    expect(migrated.installations.find(row => row.plugin === '@deepseek-ai/dsh-native-approval')?.config)
      .toMatchObject({ policy: 'ask' })
    expect(client.installations.find(row => row.plugin === '@deepseek-ai/dsh-client-locale')?.config)
      .toMatchObject({ locale: 'zh' })
    expect(client.installations.find(row => row.plugin === '@deepseek-ai/dsh-client-ui-theme')?.config)
      .toMatchObject({ preference: 'dark' })
    expect(await readFile(settingsPath, 'utf8')).toBe(settingsText)
    const report = stderr.mock.calls.flat().join('')
    expect(report).toContain('permission.defaultPreset="read-only" to ')
    expect(report).toContain('installations[approval].config.policy="ask"')
    expect(report).toContain('rsh/Docs/native-config-migration.md')

    const withoutPresetDefault = {
      ...migrated,
      installations: migrated.installations.map((row) => {
        if (row.id !== 'agent-presets') return row
        const config = { ...(row.config as Record<string, unknown>) }
        delete config.default
        return { ...row, config }
      }),
    }
    const effectiveWithoutDefault = {
      ...withoutPresetDefault,
      installations: withoutPresetDefault.installations.map(row => row.id === 'agent-presets'
        ? { ...row, disabled: false } : row.id === 'agent-presets-secondary' ? { ...row, disabled: true } : row),
    }
    await writeFile(profilePath, `${JSON.stringify(withoutPresetDefault, null, 2)}\n`)
    await writeFile(settingsPath, 'agent-presets:\n  default: standard\n')
    await migrateNativeLegacyConfig({ profileName: 'native-web', installAnchor, home,
      profile: effectiveWithoutDefault, patchFiles: [], environment: emptyEnvironment })
    const standingPresetFile = await readFile(profilePath, 'utf8')
    const standingProfile = JSON.parse(standingPresetFile) as typeof profile
    expect(standingProfile.installations.find(row => row.id === 'agent-presets')?.config)
      .toMatchObject({ default: 'standard' })
    const effectiveStandingProfile = {
      ...standingProfile,
      installations: standingProfile.installations.map(row => row.id === 'agent-presets'
        ? { ...row, disabled: false } : row.id === 'agent-presets-secondary' ? { ...row, disabled: true } : row),
    }
    await migrateNativeLegacyConfig({ profileName: 'native-web', installAnchor, home,
      profile: effectiveStandingProfile, patchFiles: [], environment: emptyEnvironment })
    expect(await readFile(profilePath, 'utf8')).toBe(standingPresetFile)
  } finally {
    stderr.mockRestore()
    await rm(home, { recursive: true, force: true })
  }
})

it('rejects a migration target that differs from both the legacy value and shipped template', async () => {
  const { home, directory, profile } = await nativeWebProfile()
  const settingsPath = join(home, 'settings.yaml')
  const settingsText = 'agent-presets:\n  default: compact\n'
  await writeFile(settingsPath, settingsText)
  const profilePath = join(directory, 'rsh.profile.json')
  const conflicting = {
    ...profile,
    installations: profile.installations.map(row => row.plugin === '@deepseek-ai/dsh-agent-presets'
      ? { ...row, config: { default: 'operator' } } : row),
  }
  await writeFile(profilePath, `${JSON.stringify(conflicting, null, 2)}\n`)
  try {
    await expect(migrateNativeLegacyConfig({ profileName: 'native-web', installAnchor, home, profile: conflicting,
      patchFiles: [], environment: emptyEnvironment }))
      .rejects.toThrow('migration conflict:')
    expect(JSON.parse(await readFile(profilePath, 'utf8'))).toEqual(conflicting)
    expect(await readFile(settingsPath, 'utf8')).toBe(settingsText)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('rejects a legacy process environment variable only when its native surface is installed', async () => {
  const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_PERMISSION_MODE: 'danger-full-access' } }])
  await expect(migrateNativeLegacyConfig({
    profileName: 'native-headless', installAnchor, home: tmpdir(),
    profile: { formatVersion: 1, scopes: [{ id: 'root' }], installations: [
      { id: 'policy', plugin: '@deepseek-ai/dsh-native-sandbox-policy', scope: 'root' },
    ] },
    patchFiles: [],
    environment,
  })).rejects.toThrow('DSH_PERMISSION_MODE is not supported')

  const { home, profile } = await nativeWebProfile()
  try {
    const presetPath = join(home, '.agent-presets', 'compact', 'agent.native.json')
    await writeFile(presetPath, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'model', plugin: '@deepseek-ai/dsh-llm-pi-ai' },
    ] }))
    const contextEnvironment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_CONTEXT_WINDOW: '32000' } }])
    await expect(migrateNativeLegacyConfig({
      profileName: 'native-web', installAnchor, home, profile, patchFiles: [], environment: contextEnvironment,
    })).rejects.toThrow('DSH_CONTEXT_WINDOW is not supported')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
