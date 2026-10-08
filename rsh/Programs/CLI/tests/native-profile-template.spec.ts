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
    for (const name of ['native-headless', 'native-sdk', 'native-acp', 'native-tui']) {
      ensureShippedNativeProfile(name, home)
      expect(nativeProfileReloadMode(name, home)).toBe('startup')
    }
    const client = JSON.parse(await readFile(join(home, 'profiles', 'native-web', 'rsh.client.json'), 'utf8')) as {
      installations: Array<{ id: string; plugin: string }>
    }
    expect(client.installations.map(row => row.id)).toEqual([
      'application', 'renderer', 'connection', 'session',
    ])
    expect(existsSync(join(home, 'profiles', 'native-web', 'rsh.profile.json'))).toBe(true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
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

it.each(['native-sdk', 'native-acp'] as const)('installs native list_agents explicitly in %s', (profileName) => {
  const profile = shippedNativeProfileComposition('C:/rsh-native-subagent', profileName, 'win32')
  expect(profile.installations.filter(row => row.id === 'subagent-directory')).toEqual([{
    id: 'subagent-directory', plugin: '@deepseek-ai/dsh-native-tool-subagent-list-agents', scope: 'root',
  }])
})

it.each(['native-headless', 'native-sdk', 'native-web', 'native-acp', 'native-tui'] as const)(
  'selects one shared workflow engine and both model-facing consumers in %s', (profileName) => {
    const profile = shippedNativeProfileComposition('C:/rsh-native-workflow', profileName, 'win32')
    const byId = new Map(profile.installations.map(row => [row.id, row]))
    expect(byId.get('subagents')).toMatchObject({ plugin: '@deepseek-ai/dsh-native-subagent', config: { providerName: 'spawn' } })
    expect(byId.get('workflow')?.plugin).toBe('@deepseek-ai/dsh-workflow')
    expect(byId.get('workflow-worker')).toMatchObject({
      plugin: '@deepseek-ai/dsh-workflow-worker-thread', config: { subagentProvider: 'spawn' },
    })
    expect(byId.get('workflow-tool')).toMatchObject({
      plugin: '@deepseek-ai/dsh-tool-workflow', config: { provider: 'worker-thread' },
    })
    expect(byId.get('ralph-tool')).toMatchObject({
      plugin: '@deepseek-ai/dsh-tool-ralph', config: { workflowProvider: 'worker-thread', subagentProvider: 'spawn' },
    })
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

it('ships a complete one-shot shell seam in the native headless profile', () => {
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
})
