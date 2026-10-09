import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../src/native-profile-template.ts'
import { nativeProfileReloadMode } from '../src/native-profile-config.ts'

it('defines a native-web Host composition and Client profile without Cordis rows', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-web-template-'))
  try {
    const profile = shippedNativeProfileComposition(home, 'native-web', 'win32')
    expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
      plugin: '@deepseek-ai/dsh-native-web-host',
      config: { projectDir: join(home, 'profiles', 'native-web'), clientReload: 'live' },
    })
    expect(profile.installations.find(row => row.id === 'session-controller')?.plugin)
      .toBe('@deepseek-ai/dsh-native-web-session-controller')
    expect(profile.installations.find(row => row.id === 'session-title')).toEqual({
      id: 'session-title', plugin: '@deepseek-ai/dsh-session-title', scope: 'root',
      config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 },
    })
    expect(profile.installations.find(row => row.id === 'session-title-llm')?.plugin)
      .toBe('@deepseek-ai/dsh-session-title-first-prompt-llm')
    expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
    expect(profile.installations.filter(row => row.id === 'session-execution')).toHaveLength(1)
    expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
      { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: 'root' },
      { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: 'root' },
      { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: 'root' },
    ])
    expect(profile.installations.find(row => row.id === 'task-scheduler')).toMatchObject({
      plugin: '@deepseek-ai/dsh-task-scheduler',
      config: { path: join(home, 'profiles', 'native-web', 'task-scheduler.sqlite') },
    })
    expect(new Set(profile.installations.map(row => row.id)).size).toBe(profile.installations.length)

    ensureShippedNativeProfile('native-web', home)
    expect(nativeProfileReloadMode('native-web', home)).toBe('live')
    for (const name of ['native-headless', 'native-headless-query', 'native-sdk', 'native-sdk-dsh-child', 'native-acp', 'native-tui']) {
      ensureShippedNativeProfile(name, home)
      expect(nativeProfileReloadMode(name, home)).toBe('startup')
    }
    const queryProfile = JSON.parse(await readFile(join(home, 'profiles', 'native-headless-query', 'rsh.profile.json'), 'utf8')) as {
      installations: Array<{ id: string; plugin: string; config?: unknown }>
    }
    expect(queryProfile.installations.find(row => row.id === 'session-query')).toEqual({
      id: 'session-query', plugin: '@deepseek-ai/dsh-session-query-sqlite', scope: 'root',
      config: { path: join(home, 'sessions', 'query.sqlite'), openAt: 'first-search' },
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-hub')).toEqual({
      id: 'storage-hub', plugin: '@deepseek-ai/dsh-storage', scope: 'root',
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-json')).toEqual({
      id: 'storage-json', plugin: '@deepseek-ai/dsh-storage-json', scope: 'root',
      config: { root: join(home, 'storages') },
    })
    expect(queryProfile.installations.find(row => row.id === 'storage-domain')).toEqual({
      id: 'storage-domain', plugin: '@deepseek-ai/dsh-storage-domain', scope: 'root',
      config: { backend: 'json' },
    })
    expect(queryProfile.installations.find(row => row.id === 'session-projection-cache')).toEqual({
      id: 'session-projection-cache', plugin: '@deepseek-ai/dsh-session-projection-cache', scope: 'root',
      config: { writeEveryEvents: 200, writeIntervalMs: 5000 },
    })
    const client = JSON.parse(await readFile(join(home, 'profiles', 'native-web', 'rsh.client.json'), 'utf8')) as {
      installations: Array<{ id: string; plugin: string }>
    }
    expect(client.installations.map(row => row.id)).toEqual([
      'application', 'renderer', 'connection', 'session',
      'locale', 'theme', 'session-presentation', 'layout', 'sidebar', 'sidebar-right',
    ])
    expect(existsSync(join(home, 'profiles', 'native-web', 'rsh.profile.json'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('keeps the child SDK sandbox opt-in and confines its selected file provider', () => {
  const child = new Map(shippedNativeProfileComposition('C:/rsh-child', 'native-sdk-dsh-child', 'win32').installations.map(row => [row.id, row]))
  expect(child.get('sandbox-policy')).toMatchObject({ plugin: '@deepseek-ai/dsh-native-sandbox-policy',
    config: { mode: 'workspace-write', workspaceRoot: process.cwd() } })
  expect(child.get('process-sandbox')?.plugin).toBe('@deepseek-ai/dsh-sandbox-local')
  expect(child.get('fs')?.plugin).toBe('@deepseek-ai/dsh-fs-sandbox')

  const standard = new Map(shippedNativeProfileComposition('C:/rsh-standard', 'native-sdk', 'win32').installations.map(row => [row.id, row]))
  expect(standard.get('fs')?.plugin).toBe('@deepseek-ai/dsh-fs-local')
  expect(standard.has('sandbox-policy')).toBe(false)
  expect(standard.has('process-sandbox')).toBe(false)
  expect(standard.has('dsh-sdk-child')).toBe(false)
})

it('defines a native-acp Host composition without Cordis rows', () => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-acp', 'native-acp', 'win32')
  expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
    plugin: '@deepseek-ai/dsh-native-acp',
    config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxSteps: 8 },
  })
  expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
  expect(profile.installations.some(row => row.id === 'task-scheduler')).toBe(false)
})

it.each(['native-sdk', 'native-sdk-dsh-child', 'native-acp'] as const)('installs native list_agents explicitly in %s', (profileName) => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-subagent', profileName, 'win32')
  expect(profile.installations.filter(row => row.id === 'subagent-directory')).toEqual([{
    id: 'subagent-directory', plugin: '@deepseek-ai/dsh-native-tool-subagent-list-agents', scope: 'root',
  }])
})

it.each(['native-headless', 'native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui'] as const)(
  'selects one shared workflow engine and both model-facing consumers in %s', (profileName) => {
    const profile = shippedNativeProfileComposition('C:/rsh-native-workflow', profileName, 'win32')
    const byId = new Map(profile.installations.map(row => [row.id, row]))
    expect(byId.get('subagents')).toMatchObject({ plugin: '@deepseek-ai/dsh-native-subagent',
      config: { providerName: profileName === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' } })
    expect(profileName === 'native-sdk-dsh-child' ? byId.get('dsh-sdk-child')?.plugin : undefined)
      .toBe(profileName === 'native-sdk-dsh-child' ? '@deepseek-ai/dsh-sdk-child' : undefined)
    expect(byId.get('workflow')?.plugin).toBe('@deepseek-ai/dsh-workflow')
    expect(byId.get('workflow-worker')).toMatchObject({
      plugin: '@deepseek-ai/dsh-workflow-worker-thread',
      config: { subagentProvider: profileName === 'native-sdk-dsh-child' ? 'dsh-sdk' : 'spawn' },
    })
    expect(byId.get('workflow-tool')).toMatchObject({
      plugin: '@deepseek-ai/dsh-tool-workflow', config: { provider: 'worker-thread' },
    })
    if (profileName === 'native-sdk-dsh-child') {
      expect(byId.has('ralph-tool')).toBe(false)
    } else {
      expect(byId.get('ralph-tool')).toMatchObject({
        plugin: '@deepseek-ai/dsh-tool-ralph',
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
      { id: 'llm-retry', plugin: '@deepseek-ai/dsh-llm-retry', scope: 'root' },
      { id: 'timeout-policy', plugin: '@deepseek-ai/dsh-tool-call-timeout-policy', scope: 'root' },
      // Same settings as the Cordis base bundle row.
      { id: 'repeat-tool-reminder', plugin: '@deepseek-ai/dsh-repeat-tool-reminder', scope: 'root',
        config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
    ])
  })

it('defines a native-tui composition over the shared headless Providers', () => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-tui', 'native-tui', 'win32')
  expect(profile.installations.find(row => row.id === 'app')).toMatchObject({
    plugin: '@deepseek-ai/dsh-native-tui',
    config: { provider: 'deepseek', model: 'deepseek-v4-flash', maxSteps: 8 },
  })
  expect(profile.installations.some(row => /cordis/.test(row.plugin))).toBe(false)
  expect(profile.installations.find(row => row.id === 'task-scheduler')).toMatchObject({
    config: { path: join('C:/rsh-native-tui', 'profiles', 'native-tui', 'task-scheduler.sqlite') },
  })
  expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
    { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: 'root' },
    { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: 'root' },
    { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: 'standard' },
  ])
  expect(profile.scopes).toEqual([{ id: 'root' }, { id: 'standard', parent: 'root' }, { id: 'minimal', parent: 'root' }])
  expect(profile.installations.filter(row => ['commands', 'command-goal', 'agent-presets', 'preset-standard', 'preset-minimal', 'tool-todo', 'tool-todo-minimal'].includes(row.id)))
    .toEqual([
      { id: 'commands', plugin: '@deepseek-ai/dsh-commands', scope: 'root' },
      { id: 'command-goal', plugin: '@deepseek-ai/dsh-command-goal', scope: 'root' },
      { id: 'agent-presets', plugin: '@deepseek-ai/dsh-agent-presets', scope: 'root', config: { default: 'standard' } },
      { id: 'preset-standard', plugin: '@deepseek-ai/dsh-agent-preset-standing', scope: 'standard',
        config: { id: 'standard', name: 'Standard', description: 'Goal planning and task tracking tools.' } },
      { id: 'preset-minimal', plugin: '@deepseek-ai/dsh-agent-preset-standing', scope: 'minimal',
        config: { id: 'minimal', name: 'Minimal', description: 'Task tracking tools without Goal tools.' } },
      { id: 'tool-todo', plugin: '@deepseek-ai/dsh-tool-todo', scope: 'standard', config: { allowParallelInProgress: true } },
      { id: 'tool-todo-minimal', plugin: '@deepseek-ai/dsh-tool-todo', scope: 'minimal', config: { allowParallelInProgress: true } },
    ])
  expect(profile.installations.filter(row => row.id === 'session-execution')).toHaveLength(1)
})

it('installs the native Goal Definition, driver, and model tools in headless profiles', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-goal', 'native-headless', platform)
    expect(profile.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))).toEqual([
      { id: 'goal', plugin: '@deepseek-ai/dsh-goal', scope: 'root' },
      { id: 'goal-round-driver', plugin: '@deepseek-ai/dsh-goal-round-driver', scope: 'root' },
      { id: 'tool-goal', plugin: '@deepseek-ai/dsh-tool-goal', scope: 'root' },
    ])
    expect(profile.installations.some(row => row.plugin === '@deepseek-ai/dsh-command-goal')).toBe(false)
  }
})

it('installs native compaction in each native runtime profile and /compact where commands are exposed', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const compaction = [
    { id: 'token-meter', plugin: '@deepseek-ai/dsh-token-meter', scope: 'root' },
    { id: 'tool-result-pruner', plugin: '@deepseek-ai/dsh-compaction-tool-result-pruner', scope: 'root' },
    { id: 'compaction', plugin: '@deepseek-ai/dsh-compaction-basic', scope: 'root' },
  ]
  for (const name of ['native-headless', 'native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-compaction', name, 'linux')
    expect(profile.installations.filter(row => compaction.some(expected => expected.id === row.id))).toEqual(compaction)
    const commandProfiles = ['native-sdk', 'native-sdk-dsh-child', 'native-web', 'native-acp', 'native-tui']
    expect(profile.installations.some(row => row.plugin === '@deepseek-ai/dsh-command-compact')).toBe(commandProfiles.includes(name))
    expect(profile.installations.some(row => row.plugin === '@deepseek-ai/dsh-commands')).toBe(commandProfiles.includes(name))
  }
  expect(shippedNativeProfileComposition('/tmp/rsh-compaction', 'native-tui', 'linux').installations
    .find(row => row.id === 'command-compact')).toEqual({ id: 'command-compact', plugin: '@deepseek-ai/dsh-command-compact', scope: 'root' })
  for (const row of [...compaction, { plugin: '@deepseek-ai/dsh-command-compact' }]) {
    expect(installed.resolve(`${row.plugin}/package.json`)).toBeTruthy()
  }
})

it('ships one-shot shell and file-reference Providers in the native headless profile', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  for (const [platform, provider, tool] of [
    ['win32', '@deepseek-ai/dsh-pwsh-sandbox', '@deepseek-ai/dsh-tool-pwsh'],
    ['linux', '@deepseek-ai/dsh-bash-sandbox', '@deepseek-ai/dsh-tool-bash'],
  ] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-shell', 'native-headless', platform)
    const plugins = profile.installations.map(row => row.plugin)
    expect(plugins).toContain('@deepseek-ai/dsh-shell-env')
    expect(plugins).toContain('@deepseek-ai/dsh-subprocess-local')
    expect(plugins).toContain('@deepseek-ai/dsh-sandbox-local')
    expect(plugins).toContain('@deepseek-ai/dsh-native-sandbox-policy')
    expect(plugins).toContain(provider)
    expect(installed.resolve(`${provider}/package.json`)).toBeTruthy()
    expect(plugins).toContain(tool)
  }
  const nativeHeadless = shippedNativeProfileComposition('/tmp/rsh-file-reference', 'native-headless', 'linux')
  expect(nativeHeadless.installations.find(row => row.id === 'file-reference')).toEqual({
    id: 'file-reference', plugin: '@deepseek-ai/dsh-native-file-reference-local', scope: 'root',
  })
  expect(installed.resolve('@deepseek-ai/dsh-native-file-reference-local/package.json')).toBeTruthy()
})

it('installs the Cordis-equivalent web search and fetch rows in the headless, web, and TUI profiles', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  for (const name of ['native-headless', 'native-web', 'native-tui'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-web-tools', name, 'linux')
    expect(profile.installations.filter(row => ['web', 'web-search-deepseek', 'web-fetch-http', 'tool-web'].includes(row.id))).toEqual([
      { id: 'web', plugin: '@deepseek-ai/dsh-web', scope: 'root', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
      { id: 'web-search-deepseek', plugin: '@deepseek-ai/dsh-web-search-deepseek', scope: 'root', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'web-fetch-http', plugin: '@deepseek-ai/dsh-web-fetch-http', scope: 'root' },
      { id: 'tool-web', plugin: '@deepseek-ai/dsh-tool-web', scope: 'root', config: { fetch: true, searchTimeoutMs: 60000 } },
    ])
  }
  for (const plugin of ['@deepseek-ai/dsh-web', '@deepseek-ai/dsh-web-search-deepseek', '@deepseek-ai/dsh-web-fetch-http', '@deepseek-ai/dsh-tool-web']) {
    expect(installed.resolve(`${plugin}/package.json`)).toBeTruthy()
  }
  for (const name of ['native-sdk', 'native-acp'] as const) {
    const profile = shippedNativeProfileComposition('/tmp/rsh-web-tools', name, 'linux')
    expect(profile.installations.some(row => row.plugin === '@deepseek-ai/dsh-tool-web')).toBe(false)
  }
})

it.each(['native-web', 'native-tui'] as const)('installs native session titles with the Cordis base policy in %s', (profileName) => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const profile = shippedNativeProfileComposition('/tmp/rsh-title', profileName, 'linux')
  expect(profile.installations.filter(row => row.id === 'session-title' || row.id === 'session-title-llm')).toEqual([
    { id: 'session-title', plugin: '@deepseek-ai/dsh-session-title', scope: 'root',
      config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    { id: 'session-title-llm', plugin: '@deepseek-ai/dsh-session-title-first-prompt-llm', scope: 'root',
      config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
  ])
  for (const name of ['@deepseek-ai/dsh-session-title', '@deepseek-ai/dsh-session-title-first-prompt-llm']) {
    expect(installed.resolve(`${name}/package.json`)).toBeTruthy()
  }
})

it.each(['native-headless', 'native-sdk', 'native-acp'] as const)('keeps title and plan Consumers out of %s', (profileName) => {
  const plugins = shippedNativeProfileComposition('/tmp/rsh-title', profileName, 'linux').installations.map(row => row.plugin)
  expect(plugins).not.toContain('@deepseek-ai/dsh-session-title')
  expect(plugins).not.toContain('@deepseek-ai/dsh-plan-mode')
})

it('keeps exact query default and selects one SQLite provider only in the explicit Native profile', () => {
  const installed = createRequire(new URL('../package.json', import.meta.url))
  const standard = shippedNativeProfileComposition('/tmp/rsh-reference', 'native-headless', 'linux').installations
  const selected = shippedNativeProfileComposition('/tmp/rsh-reference', 'native-headless-query', 'linux').installations
  const standardQuery = standard.findIndex(row => row.id === 'session-query')
  const reference = standard.findIndex(row => row.plugin === '@deepseek-ai/dsh-session-reference')
  const instructions = standard.findIndex(row => row.plugin === '@deepseek-ai/dsh-agent-instructions')
  expect(standard[standardQuery]?.plugin).toBe('@deepseek-ai/dsh-session-query')
  expect(standard.some(row => row.id === 'tool-session-query' || row.id === 'session-projections')).toBe(false)
  expect(standardQuery).toBeGreaterThan(standard.findIndex(row => row.id === 'session-execution'))
  expect(reference).toBeGreaterThan(standardQuery)
  expect(instructions).toBeGreaterThan(reference)

  expect(selected.filter(row => [
    '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-session-query-sqlite',
  ].includes(row.plugin))).toEqual([{
    id: 'session-query', plugin: '@deepseek-ai/dsh-session-query-sqlite', scope: 'root',
    config: { path: join('/tmp/rsh-reference', 'sessions', 'query.sqlite'), openAt: 'first-search' },
  }])
  expect(standard.find(row => row.id === 'app')?.config).not.toHaveProperty('cwd')
  expect(selected.find(row => row.id === 'app')?.config).toMatchObject({ cwd: process.cwd() })
  const query = selected.findIndex(row => row.id === 'session-query')
  const projection = selected.findIndex(row => row.id === 'session-projections')
  const cache = selected.findIndex(row => row.id === 'session-projection-cache')
  const tool = selected.findIndex(row => row.id === 'tool-session-query')
  const selectedReference = selected.findIndex(row => row.plugin === '@deepseek-ai/dsh-session-reference')
  expect(projection).toBeGreaterThan(selected.findIndex(row => row.id === 'session-execution'))
  expect(cache).toBeGreaterThan(projection)
  expect(query).toBeGreaterThan(cache)
  expect(tool).toBeGreaterThan(query)
  expect(selectedReference).toBeGreaterThan(tool)
  for (const packageName of [
    '@deepseek-ai/dsh-storage', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-session-projection-cache',
    '@deepseek-ai/dsh-session-query-sqlite', '@deepseek-ai/dsh-tool-session-query',
  ]) expect(installed.resolve(`${packageName}/package.json`)).toBeTruthy()
})

it('installs plan mode beside the native TUI command registry', () => {
  const profile = shippedNativeProfileComposition('/tmp/rsh-plan', 'native-tui', 'linux')
  const ids = profile.installations.map(row => row.id)
  const plan = profile.installations.find(row => row.id === 'plan-mode')
  expect(plan).toMatchObject({ plugin: '@deepseek-ai/dsh-plan-mode', scope: 'root' })
  expect((plan?.config as { section: string }).section).toMatch(/^You are in plan mode\./)
  expect(ids).toContain('commands')
  expect(ids).toContain('user-questions')
  expect(shippedNativeProfileComposition('/tmp/rsh-plan', 'native-web', 'linux').installations
    .some(row => row.plugin === '@deepseek-ai/dsh-plan-mode')).toBe(false)
})
