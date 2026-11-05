import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { PiAiAdapter } from '@redspark/rsh-llm-pi-ai/src/adapter.ts'
import { resolveProfiles } from '@redspark/rsh-llm-pi-ai/src/config.ts'
import type { PiAiAuthInjection } from '@redspark/rsh-llm-pi-ai/src/adapter.ts'
import type { PiAiProviderProfile } from '@redspark/rsh-llm-pi-ai/src/config.ts'
import { SHIPPED_NATIVE_PROFILES, ensureShippedNativeProfile, shippedNativeProfileComposition } from '../src/native-profile-template.ts'
import { nativeProfileReloadMode, profileRuntime } from '../src/native-profile-config.ts'
import { loadNativeProfile } from '../src/native-profile-loader.ts'

const resolutionAuth: PiAiAuthInjection = {
  credentials: {
    read: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    modify: () => Promise.reject(new Error('Model resolution must not persist credentials')),
    delete: () => Promise.reject(new Error('Model resolution must not delete credentials')),
  },
  authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
  siwcRegistration: {
    reconcile: () => Promise.reject(new Error('Model resolution must not reconcile registration metadata')),
    modify: () => Promise.reject(new Error('Model resolution must not persist registration metadata')),
  },
}

function piAiResolver(installations: readonly { id: string; config?: unknown }[]): PiAiAdapter {
  const config = installations.find(row => row.id === 'pi-ai')?.config as { providers: Record<string, PiAiProviderProfile> }
  return new PiAiAdapter({
    profiles: () => resolveProfiles(config.providers),
    resolveApiKey: () => Promise.resolve(undefined),
    auth: resolutionAuth,
  })
}

async function expectModelResolves(
  installations: readonly { id: string; config?: unknown }[],
  route: { provider: string; model: string },
): Promise<void> {
  const adapter = piAiResolver(installations)
  try {
    await expect(adapter.resolveModel(route.provider, route.model))
      .resolves.toMatchObject({ provider: route.provider, id: route.model })
  } finally {
    await adapter.dispose()
  }
}

it('maps standard profile names to native compositions and preserves existing legacy manifests', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-standard-profile-template-'))
  const legacyHome = await mkdtemp(join(tmpdir(), 'rsh-standard-profile-legacy-'))
  try {
    const mappings = [
      ['headless', 'native-headless'],
      ['web', 'native-web'],
      ['sdk', 'native-sdk'],
      ['acp', 'native-acp'],
      ['rsh', 'native-tui'],
    ] as const
    for (const [name, nativeName] of mappings) {
      expect(SHIPPED_NATIVE_PROFILES()).toContain(name)
      const profile = shippedNativeProfileComposition(home, name, 'win32')
      const nativeProfile = shippedNativeProfileComposition(home, nativeName, 'win32')
      expect(profile.installations.find(row => row.id === 'app')?.plugin)
        .toBe(nativeProfile.installations.find(row => row.id === 'app')?.plugin)
      ensureShippedNativeProfile(name, home)
      const directory = join(home, 'profiles', name)
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        dsh: { profile: { runtime: string } }
      }
      expect(manifest.dsh.profile.runtime).toBe('native')
      if (name === 'web') {
        expect(profile.installations.find(row => row.id === 'app')?.config)
          .toMatchObject({ projectDir: directory })
        expect(profile.installations.find(row => row.id === 'task-scheduler')?.config)
          .toEqual({ path: join(directory, 'task-scheduler.sqlite') })
        expect(existsSync(join(directory, 'rsh.client.json'))).toBe(true)
      }
      if (name === 'rsh') {
        expect(profile.installations.find(row => row.id === 'task-scheduler')?.config)
          .toEqual({ path: join(directory, 'task-scheduler.sqlite') })
      }
    }

    const legacyDir = join(legacyHome, 'profiles', 'web')
    await mkdir(legacyDir, { recursive: true })
    const legacyManifest = `${JSON.stringify({ name: 'dsh-profile-web', private: true,
      dsh: { profile: { bundles: ['@redspark/rsh-base', '@redspark/rsh-web-app'] } } }, null, 2)}\n`
    await writeFile(join(legacyDir, 'package.json'), legacyManifest)
    ensureShippedNativeProfile('web', legacyHome)
    expect(profileRuntime('web', legacyHome)).toBe('legacy')
    expect(await readFile(join(legacyDir, 'package.json'), 'utf8')).toBe(legacyManifest)
    expect(existsSync(join(legacyDir, 'rsh.profile.json'))).toBe(false)
  } finally {
    await Promise.all([rm(home, { recursive: true, force: true }), rm(legacyHome, { recursive: true, force: true })])
  }
})

it('defines a native-web Host composition and Client profile without Cordis rows', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-web-template-'))
  try {
    const profile = shippedNativeProfileComposition(home, 'native-web', 'win32')
    const sessionController = profile.installations.find(row => row.id === 'session-controller')
    expect(sessionController?.config).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash' })
    const sessionModel = sessionController?.config as { provider: string; model: string }
    await expectModelResolves(profile.installations, sessionModel)
    expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
      plugin: '@redspark/rsh-native-web-host',
      config: { projectDir: join(home, 'profiles', 'native-web'), clientReload: 'live' },
    })
    expect(profile.installations.find(row => row.id === 'session-controller')?.plugin)
      .toBe('@redspark/rsh-native-web-session-controller')
    const nativeWebRows = new Map(profile.installations.map(row => [row.id, row]))
    expect(nativeWebRows.get('command-feedback')?.plugin).toBe('@redspark/rsh-command-feedback')
    expect(nativeWebRows.get('message-feedback')?.plugin).toBe('@redspark/rsh-message-feedback')
    expect(nativeWebRows.has('session-telemetry-otel')).toBe(false)
    expect(nativeWebRows.get('storage-hub')?.plugin).toBe('@redspark/rsh-storage')
    expect(nativeWebRows.get('storage-json')).toMatchObject({ config: { root: join(home, 'storages') } })
    expect(nativeWebRows.get('storage-domain')).toMatchObject({ config: { backend: 'json' } })
    expect(nativeWebRows.get('workspace')).toEqual({
      id: 'workspace', plugin: '@redspark/rsh-workspace', scope: 'root',
    })
    expect(nativeWebRows.get('session-controller')).toMatchObject({
      config: { workspaceRoutes: { maxRoutes: 64, allowedRoots: [process.cwd()] } },
    })
    expect(profile.installations.find(row => row.id === 'session-title')).toEqual({
      id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
      config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
    })
    expect(profile.installations.find(row => row.id === 'session-title-llm')?.plugin)
      .toBe('@redspark/rsh-session-title-first-prompt-llm')
    expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
    expect(profile.installations.filter(row => row.id === 'session-execution')).toHaveLength(1)
    expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
      { id: 'goal', plugin: '@redspark/rsh-goal', scope: 'root' },
      { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: 'root' },
      { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: 'root' },
    ])
    expect(profile.installations.find(row => row.id === 'task-scheduler')).toMatchObject({
      plugin: '@redspark/rsh-task-scheduler',
      config: { path: join(home, 'profiles', 'native-web', 'task-scheduler.sqlite') },
    })
    expect(profile.installations.find(row => row.id === 'schedule-controller')).toEqual({
      id: 'schedule-controller', plugin: '@redspark/rsh-native-schedule-controller', scope: 'root',
    })
    expect(profile.installations.findIndex(row => row.id === 'schedule-controller'))
      .toBeGreaterThan(profile.installations.findIndex(row => row.id === 'task-scheduler'))
    expect(new Set(profile.installations.map(row => row.id)).size).toBe(profile.installations.length)

    ensureShippedNativeProfile('native-web', home)
    expect(nativeProfileReloadMode('native-web', home)).toBe('live')
    await loadNativeProfile({ profile: 'native-web', patchFiles: [], target: 'host', home,
      installAnchor: fileURLToPath(new URL('../package.json', import.meta.url)) })
    for (const name of ['native-headless', 'native-headless-query', 'native-sdk', 'native-sdk-dsh-child', 'native-acp', 'native-tui']) {
      expect(shippedNativeProfileComposition(home, name, 'win32').installations
        .some(row => row.id === 'schedule-controller')).toBe(false)
      ensureShippedNativeProfile(name, home)
      expect(nativeProfileReloadMode(name, home)).toBe('startup')
    }
    const queryProfile = JSON.parse(await readFile(join(home, 'profiles', 'native-headless-query', 'rsh.profile.json'), 'utf8')) as {
      installations: Array<{ id: string; plugin: string; config?: unknown }>
    }
    expect(queryProfile.installations.find(row => row.id === 'session-query')).toEqual({
      id: 'session-query', plugin: '@redspark/rsh-session-query-sqlite', scope: 'root',
      config: { path: join(home, 'sessions', 'query.sqlite'), openAt: 'first-search' },
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-hub')).toEqual({
      id: 'storage-hub', plugin: '@redspark/rsh-storage', scope: 'root',
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-json')).toEqual({
      id: 'storage-json', plugin: '@redspark/rsh-storage-json', scope: 'root',
      config: { root: join(home, 'storages') },
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-domain')).toEqual({
      id: 'storage-domain', plugin: '@redspark/rsh-storage-domain', scope: 'root',
      config: { backend: 'json' },
    })
    expect(queryProfile.installations.find(row => row.id === 'session-projection-cache')).toEqual({
      id: 'session-projection-cache', plugin: '@redspark/rsh-session-projection-cache', scope: 'root',
      config: { writeEveryEvents: 200, writeIntervalMs: 5000 },
    })
    const client = JSON.parse(await readFile(join(home, 'profiles', 'native-web', 'rsh.client.json'), 'utf8')) as {
      installations: Array<{ id: string; plugin: string }>
    }
    expect(client.installations.map(row => row.id)).toEqual([
      'application', 'renderer', 'connection', 'session',
      'locale', 'theme', 'session-presentation', 'layout', 'sidebar', 'sidebar-right',
      'brand-official', 'input-trigger', 'jobs', 'message-feedback',
      'settings', 'commands',
      'plan-mode', 'resources', 'schedule-catalog',
      'pet', 'permission-presets-ui', 'model-selection-ui',
      'settings-plugins-ui', 'settings-models-ui',
      'file-upload', 'open-in-app',
    ])
    const cli = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
    for (const row of client.installations) expect(cli.dependencies).toHaveProperty([row.plugin])
    expect(existsSync(join(home, 'profiles', 'native-web', 'rsh.profile.json'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 10_000)

it('keeps the child SDK sandbox opt-in and confines its selected file provider', () => {
  const child = new Map(shippedNativeProfileComposition('C:/rsh-child', 'native-sdk-dsh-child', 'win32').installations.map(row => [row.id, row]))
  expect(child.get('sandbox-policy')).toMatchObject({ plugin: '@redspark/rsh-native-sandbox-policy',
    config: { mode: 'workspace-write', workspaceRoot: process.cwd() } })
  expect(child.get('process-sandbox')?.plugin).toBe('@redspark/rsh-sandbox-local')
  expect(child.get('fs')?.plugin).toBe('@redspark/rsh-fs-sandbox')

  const standard = new Map(shippedNativeProfileComposition('C:/rsh-standard', 'native-sdk', 'win32').installations.map(row => [row.id, row]))
  expect(standard.get('fs')?.plugin).toBe('@redspark/rsh-fs-local')
  expect(standard.has('sandbox-policy')).toBe(false)
  expect(standard.has('process-sandbox')).toBe(false)
  expect(standard.has('dsh-sdk-child')).toBe(false)
})

it('defines a native-acp Host composition without Cordis rows', () => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-acp', 'native-acp', 'win32')
  expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
    plugin: '@redspark/rsh-native-acp',
    config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxSteps: 8 },
  })
  expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
  expect(profile.installations.some(row => row.id === 'task-scheduler')).toBe(false)
})

it.each(['native-sdk', 'native-sdk-dsh-child', 'native-acp'] as const)('installs native list_agents and workspace instructions in %s', (profileName) => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-subagent', profileName, 'win32')
  expect(profile.installations.filter(row => row.id === 'subagent-directory')).toEqual([{
    id: 'subagent-directory', plugin: '@redspark/rsh-native-tool-subagent-list-agents', scope: 'root',
  }])
  expect(profile.installations.find(row => row.id === 'agent-instructions')).toEqual({
    id: 'agent-instructions', plugin: '@redspark/rsh-agent-instructions', scope: 'root', config: { maxBytes: 65_536 },
  })
})

it.each(['native-headless', 'native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui'] as const)(
  'selects one shared workflow engine and both model-facing consumers in %s', (profileName) => {
    const profile = shippedNativeProfileComposition('C:/rsh-native-workflow', profileName, 'win32')
    const byId = new Map(profile.installations.map(row => [row.id, row]))
    expect(byId.get('subagents')).toMatchObject({ plugin: '@redspark/rsh-native-subagent',
      config: { providerName: profileName === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' } })
    expect(profileName === 'native-sdk-dsh-child' ? byId.get('dsh-sdk-child')?.plugin : undefined)
      .toBe(profileName === 'native-sdk-dsh-child' ? '@redspark/rsh-sdk-child' : undefined)
    expect(byId.get('workflow')?.plugin).toBe('@redspark/rsh-workflow')
    expect(byId.get('workflow-worker')).toMatchObject({
      plugin: '@redspark/rsh-workflow-worker-thread',
      config: { subagentProvider: profileName === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' },
    })
    expect(byId.get('workflow-tool')).toMatchObject({
      plugin: '@redspark/rsh-tool-workflow', config: { provider: 'worker-thread' },
    })
    if (profileName === 'native-sdk-dsh-child') {
      expect(byId.has('ralph-tool')).toBe(false)
    } else {
      expect(byId.get('ralph-tool')).toMatchObject({
        plugin: '@redspark/rsh-tool-ralph',
        config: { workflowProvider: 'worker-thread', subagentProvider: 'spawn' },
      })
    }
    expect(profile.installations.filter(row => row.id === 'session-execution')).toHaveLength(1)
    expect(new Set(profile.installations.map(row => row.id)).size).toBe(profile.installations.length)
  })

it.each(['native-headless', 'native-sdk', 'native-web', 'native-acp', 'native-tui'] as const)(
  'installs the Cordis base guards natively in %s', (profileName) => {
    const profile = shippedNativeProfileComposition('C:/rsh-native-guards', profileName, 'win32')
    expect(profile.installations.filter(row => ['llm-retry', 'timeout-policy', 'repeat-tool-reminder'].includes(row.id))).toEqual([
      { id: 'llm-retry', plugin: '@redspark/rsh-llm-retry', scope: 'root' },
      { id: 'timeout-policy', plugin: '@redspark/rsh-tool-call-timeout-policy', scope: 'root' },
      // Same settings as the Cordis base bundle row.
      { id: 'repeat-tool-reminder', plugin: '@redspark/rsh-repeat-tool-reminder', scope: 'root',
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
    ])
  })

it('defines a native-tui composition over the shared headless Providers', () => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-tui', 'native-tui', 'win32')
  expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
    plugin: '@redspark/rsh-native-tui',
    config: { provider: 'deepseek', model: 'deepseek-flash', maxSteps: 8, maxStreamChunks: 500 },
  })
  expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
  expect(profile.installations.find(row => row.id === 'task-scheduler')).toMatchObject({
    config: { path: join('C:/rsh-native-tui', 'profiles', 'native-tui', 'task-scheduler.sqlite') },
  })
  expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
    { id: 'goal', plugin: '@redspark/rsh-goal', scope: 'root' },
    { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: 'root' },
    { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: 'standard' },
  ])
  expect(profile.scopes).toEqual([{ id: 'root' }, { id: 'standard', parent: 'root' }, { id: 'minimal', parent: 'root' }, { id: 'ptc', parent: 'root' }, { id: 'creation', parent: 'root' }])
  expect(profile.installations.filter(row => ['commands', 'command-goal', 'agent-presets', 'preset-standard', 'preset-minimal', 'tool-todo', 'tool-todo-minimal'].includes(row.id)))
    .toEqual([
      { id: 'commands', plugin: '@redspark/rsh-commands', scope: 'root' },
      { id: 'command-goal', plugin: '@redspark/rsh-command-goal', scope: 'root' },
      { id: 'agent-presets', plugin: '@redspark/rsh-agent-presets', scope: 'root', config: { default: 'standard' } },
      { id: 'preset-standard', plugin: '@redspark/rsh-agent-preset-standing', scope: 'standard',
        config: { id: 'standard', name: 'Standard', description: 'Goal planning and task tracking tools.' } },
      { id: 'preset-minimal', plugin: '@redspark/rsh-agent-preset-standing', scope: 'minimal',
        config: { id: 'minimal', name: 'Minimal', description: 'Task tracking tools without Goal tools.' } },
      { id: 'tool-todo', plugin: '@redspark/rsh-tool-todo', scope: 'standard', config: { allowParallelInProgress: true } },
      { id: 'tool-todo-minimal', plugin: '@redspark/rsh-tool-todo', scope: 'minimal', config: { allowParallelInProgress: true } },
    ])
  expect(profile.installations.filter(row => row.id === 'session-execution')).toHaveLength(1)
})

it('installs the native Goal Definition, driver, and model tools in headless profiles', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-goal', 'native-headless', platform)
    expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
      { id: 'goal', plugin: '@redspark/rsh-goal', scope: 'root' },
      { id: 'goal-round-driver', plugin: '@redspark/rsh-goal-round-driver', scope: 'root' },
      { id: 'tool-goal', plugin: '@redspark/rsh-tool-goal', scope: 'root' },
    ])
    expect(profile.installations.some(row => row.plugin === '@redspark/rsh-command-goal')).toBe(false)
  }
})

it('installs native compaction in each native runtime profile and /compact where commands are exposed', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const compaction = [
    { id: 'token-meter', plugin: '@redspark/rsh-token-meter', scope: 'root' },
    { id: 'tool-result-pruner', plugin: '@redspark/rsh-compaction-tool-result-pruner', scope: 'root' },
    { id: 'compaction', plugin: '@redspark/rsh-compaction-basic', scope: 'root' },
  ]
  for (const name of ['native-headless', 'native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-compaction', name, 'linux')
    expect(profile.installations.filter(row => compaction.some(expected => expected.id === row.id))).toEqual(compaction)
    const commandProfiles = ['native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui']
    expect(profile.installations.some(row => row.plugin === '@redspark/rsh-command-compact')).toBe(commandProfiles.includes(name))
    expect(profile.installations.some(row => row.plugin === '@redspark/rsh-commands')).toBe(commandProfiles.includes(name))
  }
  expect(shippedNativeProfileComposition('/tmp/rsh-compaction', 'native-tui', 'linux').installations
    .find(row => row.id === 'command-compact')).toEqual({ id: 'command-compact', plugin: '@redspark/rsh-command-compact', scope: 'root' })
  for (const row of [...compaction, { plugin: '@redspark/rsh-command-compact' }]) {
    expect(installed.resolve(`${row.plugin}/package.json`)).toBeTruthy()
  }
})

it('ships one-shot shell and file-reference Providers in the native headless profile', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  for (const [platform, provider, tool] of [
    ['win32', '@redspark/rsh-pwsh-sandbox', '@redspark/rsh-tool-pwsh'],
    ['linux', '@redspark/rsh-bash-sandbox', '@redspark/rsh-tool-bash'],
  ] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-shell', 'native-headless', platform)
    const plugins = profile.installations.map(row => row.plugin)
    expect(plugins).toContain('@redspark/rsh-shell-env')
    expect(plugins).toContain('@redspark/rsh-subprocess-local')
    expect(plugins).toContain('@redspark/rsh-sandbox-local')
    expect(plugins).toContain('@redspark/rsh-native-sandbox-policy')
    expect(plugins).toContain(provider)
    expect(installed.resolve(`${provider}/package.json`)).toBeTruthy()
    expect(plugins).toContain(tool)
  }
  const nativeHeadless = shippedNativeProfileComposition('/tmp/rsh-file-reference', 'native-headless', 'linux')
  expect(nativeHeadless.installations.find(row => row.id === 'file-reference')).toEqual({
    id: 'file-reference', plugin: '@redspark/rsh-native-file-reference-local', scope: 'root',
  })
  expect(installed.resolve('@redspark/rsh-native-file-reference-local/package.json')).toBeTruthy()
})

it('installs the Cordis-equivalent web search and fetch rows in the headless, web, and TUI profiles', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  for (const name of ['native-headless', 'native-web', 'native-tui'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-web-tools', name, 'linux')
    expect(profile.installations.filter(row => ['web', 'web-search-deepseek', 'web-fetch-http', 'tool-web'].includes(row.id))).toEqual([
      { id: 'web', plugin: '@redspark/rsh-web', scope: 'root', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
      { id: 'web-search-deepseek', plugin: '@redspark/rsh-web-search-deepseek', scope: 'root', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'web-fetch-http', plugin: '@redspark/rsh-web-fetch-http', scope: 'root' },
      { id: 'tool-web', plugin: '@redspark/rsh-tool-web', scope: 'root', config: { fetch: true, searchTimeoutMs: 60000 } },
    ])
  }
  for (const plugin of ['@redspark/rsh-web', '@redspark/rsh-web-search-deepseek', '@redspark/rsh-web-fetch-http', '@redspark/rsh-tool-web']) {
    expect(installed.resolve(`${plugin}/package.json`)).toBeTruthy()
  }
  for (const name of ['native-sdk', 'native-acp'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-web-tools', name, 'linux')
    expect(profile.installations.some(row => row.plugin === '@redspark/rsh-tool-web')).toBe(false)
  }
})

it.each(['native-web', 'native-tui'] as const)('installs native session titles with the Cordis base policy in %s', (profileName) => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const profile = shippedNativeProfileComposition('/tmp/rsh-title', profileName, 'linux')
  expect(profile.installations.filter(row => row.id === 'session-title' || row.id === 'session-title-llm')).toEqual([
    { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
      config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    { id: 'session-title-llm', plugin: '@redspark/rsh-session-title-first-prompt-llm', scope: 'root',
      config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
  ])
  for (const name of ['@redspark/rsh-session-title', '@redspark/rsh-session-title-first-prompt-llm']) {
    expect(installed.resolve(`${name}/package.json`)).toBeTruthy()
  }
})

it.each(['native-headless', 'native-sdk', 'native-acp'] as const)('keeps title and plan Consumers out of %s', (profileName) => {
  const plugins = shippedNativeProfileComposition('/tmp/rsh-title', profileName, 'linux').installations.map(row => row.plugin)
  expect(plugins).not.toContain('@redspark/rsh-session-title')
  expect(plugins).not.toContain('@redspark/rsh-plan-mode')
})

it('keeps exact query default and selects one SQLite provider only in the explicit Native profile', async () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const standard = shippedNativeProfileComposition('/tmp/rsh-reference', 'native-headless', 'linux').installations
  const selected = shippedNativeProfileComposition('/tmp/rsh-reference', 'native-headless-query', 'linux').installations
  const standardQuery = standard.findIndex(row => row.id === 'session-query')
  const reference = standard.findIndex(row => row.plugin === '@redspark/rsh-session-reference')
  const instructions = standard.findIndex(row => row.plugin === '@redspark/rsh-agent-instructions')
  expect(standard[standardQuery]?.plugin).toBe('@redspark/rsh-session-query')
  expect(standard.some(row => row.id === 'tool-session-query' || row.id === 'session-projections')).toBe(false)
  expect(standardQuery).toBeGreaterThan(standard.findIndex(row => row.id === 'session-execution'))
  expect(reference).toBeGreaterThan(standardQuery)
  expect(instructions).toBeGreaterThan(reference)

  expect(selected.filter(row => [
    '@redspark/rsh-session-query', '@redspark/rsh-session-query-sqlite',
  ].includes(row.plugin))).toEqual([{
    id: 'session-query', plugin: '@redspark/rsh-session-query-sqlite', scope: 'root',
    config: { path: join('/tmp/rsh-reference', 'sessions', 'query.sqlite'), openAt: 'first-search' },
  }])
  expect(standard.find(row => row.id === 'app')?.config).toMatchObject({ cwd: process.cwd() })
  expect(selected.find(row => row.id === 'app')?.config).toMatchObject({ cwd: process.cwd() })
  for (const profile of [standard, selected]) {
    const appConfig = profile.find(row => row.id === 'app')?.config as { provider: string; model: string }
    expect(appConfig).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash' })
    await expectModelResolves(profile, appConfig)
  }
  const query = selected.findIndex(row => row.id === 'session-query')
  const projection = selected.findIndex(row => row.id === 'session-projections')
  const cache = selected.findIndex(row => row.id === 'session-projection-cache')
  const tool = selected.findIndex(row => row.id === 'tool-session-query')
  const selectedReference = selected.findIndex(row => row.plugin === '@redspark/rsh-session-reference')
  expect(projection).toBeGreaterThan(selected.findIndex(row => row.id === 'session-execution'))
  expect(cache).toBeGreaterThan(projection)
  expect(query).toBeGreaterThan(cache)
  expect(tool).toBeGreaterThan(query)
  expect(selectedReference).toBeGreaterThan(tool)
  for (const packageName of [
    '@redspark/rsh-storage', '@redspark/rsh-storage-json', '@redspark/rsh-storage-domain',
    '@redspark/rsh-session-projection', '@redspark/rsh-session-projection-cache',
    '@redspark/rsh-session-query-sqlite', '@redspark/rsh-tool-session-query',
  ]) expect(installed.resolve(`${packageName}/package.json`)).toBeTruthy()
})

it('keeps Native tmux context opt-in in the two shipped headless profiles', () => {
  for (const profileName of ['native-headless', 'native-headless-query'] as const) {
    expect(shippedNativeProfileComposition('C:/rsh-native-tmux', profileName, 'linux').installations.find(row => row.id === 'tmux-context'))
      .toEqual({ id: 'tmux-context', plugin: '@redspark/rsh-native-tmux-context', scope: 'root', disabled: true })
  }
  for (const profileName of ['native-sdk', 'native-web', 'native-acp', 'native-tui'] as const) {
    expect(shippedNativeProfileComposition('C:/rsh-native-tmux', profileName, 'linux').installations.some(row => row.id === 'tmux-context'))
      .toBe(false)
  }
})

it.each(['native-tui', 'native-web'] as const)('installs plan mode and a preset roster in %s', (profileName) => {
  const profile = shippedNativeProfileComposition('/tmp/rsh-plan', profileName, 'linux')
  const ids = profile.installations.map(row => row.id)
  const plan = profile.installations.find(row => row.id === 'plan-mode')
  expect(plan).toMatchObject({ plugin: '@redspark/rsh-plan-mode', scope: 'root' })
  expect((plan?.config as { section: string }).section).toMatch(/^You are in plan mode\./)
  expect(ids).toContain('commands')
  expect(ids).toContain('user-questions')
  expect(profile.scopes).toEqual([{ id: 'root' }, { id: 'standard', parent: 'root' }, { id: 'minimal', parent: 'root' }, { id: 'ptc', parent: 'root' }, { id: 'creation', parent: 'root' }])
  expect(profile.installations.filter(row => ['agent-presets', 'preset-standard', 'preset-minimal'].includes(row.id))).toEqual([
    { id: 'agent-presets', plugin: '@redspark/rsh-agent-presets', scope: 'root', config: { default: 'standard' } },
    { id: 'preset-standard', plugin: '@redspark/rsh-agent-preset-standing', scope: 'standard',
      config: { id: 'standard', name: 'Standard', description: 'Goal planning and task tracking tools.' } },
    { id: 'preset-minimal', plugin: '@redspark/rsh-agent-preset-standing', scope: 'minimal',
      config: { id: 'minimal', name: 'Minimal', description: 'Task tracking tools without Goal tools.' } },
  ])
  expect(profile.installations.find(row => row.id === 'persona-standard')).toEqual({
    id: 'persona-standard', plugin: '@redspark/rsh-native-persona', scope: 'standard',
    config: {
      prefix: 'You are a coding agent powered by the {{model}} model.',
      suffix: 'Your working directory is {{cwd}}.',
    },
  })
  expect(profile.installations.find(row => row.id === 'preset-ptc')).toMatchObject({
    plugin: '@redspark/rsh-agent-preset-standing', scope: 'ptc',
    config: { id: 'ptc', name: 'PTC 模式' },
  })
  expect(profile.installations.find(row => row.id === 'preset-creation')).toMatchObject({
    plugin: '@redspark/rsh-agent-preset-standing', scope: 'creation',
    config: { id: 'creation', name: '创造模式' },
  })
  expect(profile.installations.find(row => row.id === 'code-tool-ptc')).toEqual({
    id: 'code-tool-ptc', plugin: '@redspark/rsh-tool-code-runtime', scope: 'ptc',
    config: { sdkPrompt: true, presentation: 'ptc', denyTools: ['workflow'] },
  })
  if (profileName === 'native-web') {
    expect(profile.installations.find(row => row.id === 'permission-presets')).toEqual({
      id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root',
    })
  }
})

it('keeps shipped ptc and creation folders aligned with the native web template', async () => {
  const profile = shippedNativeProfileComposition('/tmp/rsh-preset-files', 'native-web', 'linux')
  const root = fileURLToPath(new URL('../../../Engine/preset/agent-presets/presets/', import.meta.url))
  const readInstallations = async (id: string) => JSON.parse(await readFile(join(root, id, 'agent.native.json'), 'utf8')) as {
    installations: { id: string; plugin: string; config?: unknown }[]
  }
  const row = (id: string) => profile.installations.find(candidate => candidate.id === id)
  const persona = row('persona-ptc')
  const code = row('code-tool-ptc')
  const creation = row('persona-creation')
  expect((await readInstallations('ptc')).installations).toEqual([
    { id: 'persona', plugin: persona?.plugin, config: persona?.config },
    { id: 'code-tool', plugin: code?.plugin, config: code?.config },
  ])
  expect((await readInstallations('creation')).installations).toEqual([
    { id: 'persona', plugin: creation?.plugin, config: creation?.config },
  ])
})

it('declares every shipped template plugin as a CLI runtime dependency', async () => {
  const cli = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>
    optionalDependencies: Record<string, string>
  }
  const runtime = { ...cli.dependencies, ...cli.optionalDependencies }
  for (const name of SHIPPED_NATIVE_PROFILES()) {
    for (const platform of ['linux', 'win32'] as const) {
      for (const row of shippedNativeProfileComposition('/tmp/rsh-deps', name, platform).installations) {
        expect(runtime, `${name}/${platform}`).toHaveProperty([row.plugin])
      }
    }
  }
})
