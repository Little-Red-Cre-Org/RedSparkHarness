/** Real package-export loading from a profile, including pre-import refusal. */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadNativeProfile, readNativeProfile } from '../src/native-profile-loader.ts'
import { runNativeProfile } from '../src/native-profile-boot.ts'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-profile-load-'))
  const app = join(home, 'app')
  const profileDir = join(home, 'profiles', 'probe')
  await mkdir(app)
  await mkdir(join(profileDir, 'node_modules'), { recursive: true })
  const installAnchor = join(app, 'package.json')
  await writeFile(installAnchor, JSON.stringify({ name: 'test-app', type: 'module' }))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'probe', private: true, dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  return { home, profileDir, installAnchor }
}

async function packageEntry(profileDir: string, name: string, marker: string, valid = true): Promise<void> {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name, type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: valid ? './native' : './missing', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }))
  await writeFile(join(dir, 'native.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export const plugin = { apiVersion: 1, name: ${JSON.stringify(name)}, targets: ['host'], requires: [], provides: ['fs'], resolve: () => context => context.provide('fs', { read: () => 1 }) }\n`)
}

async function emptyNativePackage(
  profileDir: string, name: string, requires: readonly string[], provides: readonly string[],
): Promise<void> {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name, type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires, optional: [], provides } },
  }))
  await writeFile(join(dir, 'native.mjs'), `export const plugin = { apiVersion: 1, name: ${JSON.stringify(name)}, targets: ['host'],
    requires: ${JSON.stringify(requires)}, provides: ${JSON.stringify(provides)}, resolve: () => () => {} }\n`)
}

it('inherits the selected pi-ai provider catalog into the opt-in SDK child profile', async () => {
  const { home, profileDir } = await fixture()
  try {
    const selectedProviders = {
      'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY', models: [{ id: 'current-route' }] },
      'operator-catalog-route': { apiKeyEnv: 'OPERATOR_ROUTE_KEY', baseURL: 'https://provider.invalid/v1' },
    }
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }], installations: [
        { id: 'pi-ai', plugin: '@deepseek-ai/dsh-llm-pi-ai', scope: 'root', config: { providers: selectedProviders } },
        { id: 'dsh-sdk-child', plugin: '@deepseek-ai/dsh-sdk-child', scope: 'root', config: { providerName: 'dsh-sdk' } },
      ],
    }))
    const profile = readNativeProfile({ profile: 'probe', patchFiles: [], home, profileDir })
    expect(profile.installations.find(row => row.id === 'dsh-sdk-child')?.config)
      .toEqual({ providerName: 'dsh-sdk', providers: selectedProviders })
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('loads a named package export through a native profile and owns its lifecycle', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const marker = join(home, 'loaded.txt')
  try {
    await packageEntry(profileDir, 'test-native-provider', marker)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'provider', plugin: 'test-native-provider', scope: 'root' }],
    }))
    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home })
    expect(existsSync(marker)).toBe(true)
    expect(loaded.host.diagnostics()[0]?.state).toBe('planned')
    await loaded.host.start()
    expect(loaded.host.diagnostics()[0]?.state).toBe('ready')
    await loaded.host.stop()
    expect(loaded.host.diagnostics()[0]?.state).toBe('disposed')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('registers ready user native preset folders under child scopes and lists their summaries', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await emptyNativePackage(profileDir, 'test-native-tools', [], [])
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-preset-standing', ['agentPresets'], [])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\ndescription: User tools.\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [
      { id: 'tools', plugin: 'test-native-tools', config: { enabled: true } },
    ] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root', config: { default: 'operator' } }],
    }))

    const loaded = await loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home })

    expect(loaded.profile.scopes).toContainEqual({ id: 'preset:operator', parent: 'root' })
    expect(loaded.profile.installations).toContainEqual({ id: 'preset:operator/tools', plugin: 'test-native-tools',
      config: { enabled: true }, scope: 'preset:operator' })
    expect(loaded.profile.installations).toContainEqual({ id: 'preset:operator', plugin: '@deepseek-ai/dsh-agent-preset-standing',
      scope: 'preset:operator', config: { id: 'operator', name: 'Operator', description: 'User tools.' } })
    expect(loaded.requests.has('preset:operator')).toBe(true)
    const presetConfig = loaded.profile.installations.find(row => row.id === 'agent-presets')?.config as {
      readonly default: string
      readonly folders: readonly unknown[]
      readonly managementRoots: readonly { readonly path: string; readonly trust: 'system' | 'user' }[]
    }
    expect(presetConfig.default).toBe('operator')
    expect(presetConfig.folders).toContainEqual(expect.objectContaining({ id: 'operator', trust: 'user', status: 'ready' }))
    expect(presetConfig.managementRoots).toContainEqual({ path: join(home, '.agent-presets'), trust: 'user' })
  } finally { await rm(home, { recursive: true, force: true }) }
})

it.each(['preset:operator/tools', 'preset:operator'])('rejects native preset install id %s when it collides with the profile', async (collisionId) => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await emptyNativePackage(profileDir, 'test-native-tools', [], [])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [
      { id: 'tools', plugin: 'test-native-tools' },
    ] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }], installations: [
        { id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root' },
        { id: collisionId, plugin: 'test-native-tools', scope: 'root' },
      ],
    }))

    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow(`dsh: preset operator install id ${collisionId} collides with an existing profile installation`)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('rejects a preset folder whose scope is declared without registering that preset', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const directory = join(home, '.agent-presets', 'operator')
  try {
    await emptyNativePackage(profileDir, '@deepseek-ai/dsh-agent-presets', [], ['agentPresets'])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'preset.yml'), 'name: Operator\n')
    await writeFile(join(directory, 'agent.native.json'), JSON.stringify({ formatVersion: 1, installations: [] }))
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }, { id: 'preset:operator', parent: 'root' }],
      installations: [{ id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root' }],
    }))

    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('dsh: profile already declares scope preset:operator but does not register preset operator')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('rejects every static manifest before importing any selected plugin', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  const marker = join(home, 'premature-import.txt')
  try {
    await packageEntry(profileDir, 'test-first', marker)
    await packageEntry(profileDir, 'test-invalid', join(home, 'invalid-import.txt'), false)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }], installations: [
        { id: 'first', plugin: 'test-first', scope: 'root' },
        { id: 'invalid', plugin: 'test-invalid', scope: 'root' },
      ],
    }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('invalid package test-invalid')
    expect(existsSync(marker)).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('refuses a legacy patch on an explicitly native profile', async () => {
  const { home, profileDir, installAnchor } = await fixture()
  try {
    await writeFile(join(profileDir, 'cordis.patch.yml'), '- id: old-provider\n  disabled: true\n')
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [], installations: [] }))
    await expect(loadNativeProfile({ profile: 'probe', patchFiles: [], target: 'host', installAnchor, home }))
      .rejects.toThrow('cannot apply Cordis patch')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('runs one native application through the profile launcher and awaits disposal', async () => {
  const { home, profileDir } = await fixture()
  const packageDir = join(profileDir, 'node_modules', 'test-native-app')
  const marker = join(home, 'events.txt')
  const priorExitCode = process.exitCode
  try {
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'test-native-app', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['application'] } },
    }))
    await writeFile(join(packageDir, 'native.mjs'), `import { appendFileSync } from 'node:fs';
      export const plugin = { apiVersion: 1, name: 'test-native-app', targets: ['host'], requires: [], provides: ['application'],
        resolve: () => context => { context.own(() => appendFileSync(${JSON.stringify(marker)}, 'closed\\n'));
          context.provide('application', { run: async args => { appendFileSync(${JSON.stringify(marker)}, args.join(' ') + '\\n'); return 0 } }) } }
    `)
    await writeFile(join(profileDir, 'rsh.profile.json'), JSON.stringify({
      formatVersion: 1, scopes: [{ id: 'root' }],
      installations: [{ id: 'app', plugin: 'test-native-app', scope: 'root' }],
    }))
    await runNativeProfile({ profile: 'probe', patchFiles: [], args: ['hello', 'native'], home })
    expect(await import('node:fs/promises').then(fs => fs.readFile(marker, 'utf8'))).toBe('hello native\nclosed\n')
  } finally {
    process.exitCode = priorExitCode
    await rm(home, { recursive: true, force: true })
  }
})
