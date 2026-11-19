import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startMockLlmServer } from '@redspark/rsh-llm-mock-server'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadNativeProfile } from '../src/native-profile-loader.ts'
import { ensureShippedNativeProfile } from '../src/native-profile-template.ts'
import { startMessagesFixture } from '../../../Modules/Official/subagent/subagent-claude-code/tests/messages-fixture.ts'

/** Published-entry acceptance for argument errors, profile lifecycle, and boot-free config dumps. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
// The dsh built bin cold-starts slowly on the contended self-hosted Windows pool; the
// execa deadline, its error text, the outer vitest case budget, and waitForFile all
// share this value so a widening cannot leave a stale 25s diagnostic behind.
const SPAWN_TIMEOUT_MS = 60_000
// The release version, including a prerelease such as 0.0.1-rc.1: `--version`
// prints what this manifest carries, so no test may pin it to a literal.
const cliVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
const rshBin = join(repoRoot, 'rsh/Programs/CLI/lib/bin.js')

async function runBuiltBin(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = {},
  cwd?: string,
  timeoutMs = SPAWN_TIMEOUT_MS,
  onSpawned?: (pid: number | undefined) => void,
): Promise<{ stdout: string; code: number; stderr: string }> {
  // Node 24 reports the experimental node:sqlite import used by the compatibility
  // bundle on stderr. The built-entry assertions cover CLI diagnostics, so keep this
  // runtime notice out of their stderr channel while preserving caller-supplied flags.
  const nodeOptions = [env.NODE_OPTIONS ?? process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning']
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(' ')
  const childEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env, NODE_OPTIONS: nodeOptions })
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const child = execa(process.execPath, [rshBin, ...args], {
    input: '',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    reject: false,
    env: childEnv,
    extendEnv: false,
    ...cwd === undefined ? {} : { cwd },
  })
  onSpawned?.(child.pid)
  const result = await child
  if (result.timedOut) {
    throw new Error(`dsh built bin did not exit within ${timeoutMs / 1_000}s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { stdout: result.stdout, code: result.exitCode ?? -1, stderr: result.stderr }
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + SPAWN_TIMEOUT_MS
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`dsh profile lifecycle marker did not appear: ${file}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function waitForChildConnectionObservation(file: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + SPAWN_TIMEOUT_MS
  let last: Record<string, unknown> | undefined
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      last = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const connections: unknown[] = Array.isArray(last.connections) ? last.connections : []
      if (connections.some(connection => typeof connection === 'object'
        && connection !== null && 'settled' in connection && connection.settled === true)) return last
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('native child connection did not settle: ' + JSON.stringify(last))
}

function findNativeClaudeHome(tempRoot: string, workspace: string): string | undefined {
  const parents = [tempRoot, ...readdirSync(tempRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(tempRoot, entry.name))]
  for (const parent of parents) {
    for (const home of readdirSync(parent, { withFileTypes: true })) {
      if (!home.isDirectory() || !home.name.startsWith('dsh-claude-code-native-')) continue
      const homePath = join(parent, home.name)
      const settingsPath = join(homePath, '.claude', 'settings.json')
      if (!existsSync(settingsPath)) continue
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        permissions?: { additionalDirectories?: string[]; blockReadsOutsideWorkingDirectories?: boolean }
      }
      if (settings.permissions?.blockReadsOutsideWorkingDirectories === true
        && settings.permissions.additionalDirectories?.length === 1
        && settings.permissions.additionalDirectories[0] === workspace) return homePath
    }
  }
  return undefined
}

async function waitForNativeClaudeHome(
  tempRoot: string,
  workspace: string,
  childSettled: () => boolean,
): Promise<string> {
  const deadline = Date.now() + SPAWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    const home = findNativeClaudeHome(tempRoot, workspace)
    if (home !== undefined) return home
    if (childSettled()) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Native Claude did not create its workspace-bound home while the profile was running')
}

function createNativeCliFixture(): { home: string; marker: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-cli-'))
  const profile = join(home, 'profiles', 'native-smoke')
  const packageDir = join(profile, 'node_modules', 'native-smoke-app')
  const marker = join(home, 'native-result.json')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'native-smoke-profile',
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    formatVersion: 1,
    scopes: [{ id: 'root' }],
    installations: [{ id: 'app', plugin: 'native-smoke-app', scope: 'root' }],
  }))
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: 'native-smoke-app',
    version: '0.0.0',
    type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: {
      apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['application'],
    } },
  }))
  writeFileSync(join(packageDir, 'native.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    'export const plugin = {',
    "  apiVersion: 1, name: 'native-smoke-app', targets: ['host'], requires: [], provides: ['application'],",
    '  resolve: () => context => context.provide(\'application\', {',
    '    run: async args => { writeFileSync(process.env.NATIVE_PROFILE_MARKER, JSON.stringify(args)); return 0 },',
    '  }),',
    '}',
    '',
  ].join('\n'))
  return { home, marker }
}

function persistedEvents(storageRoot: string): unknown[] {
  const events: unknown[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        events.push(...readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean)
          .map(line => JSON.parse(line) as unknown))
      }
    }
  }
  visit(storageRoot)
  return events
}

function sessionEvents(events: readonly unknown[], type: string): Record<string, unknown>[] {
  return events.flatMap(event => typeof event === 'object' && event !== null && 'type' in event
    && event.type === type && 'data' in event && typeof event.data === 'object' && event.data !== null
    ? [event.data as Record<string, unknown>] : [])
}

function installChildConnectionObserver(profileDirectory: string): void {
  const observerPackage = join(profileDirectory, 'node_modules', '@fixture', 'child-connection-observer')
  mkdirSync(observerPackage, { recursive: true })
  writeFileSync(join(observerPackage, 'package.json'), JSON.stringify({
    name: '@fixture/child-connection-observer',
    version: '0.0.0',
    type: 'module',
    exports: { './package.json': './package.json', './native.js': './native.js' },
    dsh: { native: {
      apiVersion: 1, entry: './native.js', targets: ['host'], requires: ['childConnection'], optional: [], provides: [],
    } },
  }))
  writeFileSync(join(observerPackage, 'native.js'), [
    "import { existsSync, writeFileSync } from 'node:fs'",
    'export const plugin = {',
    "  apiVersion: 1, name: 'test-child-connection-observer', targets: ['host'], requires: ['childConnection'], optional: [], provides: [],",
    '  resolve(config) {',
    '    return context => {',
    "      const childConnection = context.require('childConnection')",
    '      const originalConnect = childConnection.connect',
    '      const connections = []',
    '      const write = () => writeFileSync(config.observationPath, JSON.stringify({ connections }))',
    '      childConnection.connect = function (spec) {',
    '        const handle = originalConnect.call(childConnection, spec)',
    "        if (!spec.argv.includes('--profile') || !spec.argv.includes('native-acp-dsh-child')) return handle",
    '        const home = spec.env?.RSH_HOME ?? null',
    '        const record = { argv: spec.argv, cwd: spec.cwd, home, homeExistedAtConnect: home !== null && existsSync(home),',
    '          nodeOptions: spec.env?.NODE_OPTIONS ?? null, stdin: "", stdout: "", stderr: "", outcome: null, rangeEmpty: null }',
    '        connections.push(record)',
    '        const persist = () => write()',
    '        const originalWrite = handle.stdin.write.bind(handle.stdin)',
    '        handle.stdin.write = function (chunk, ...args) {',
    '          record.stdin += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")',
    '          return originalWrite(chunk, ...args)',
    '        }',
    '        handle.stdout.on("data", chunk => { record.stdout += chunk.toString("utf8"); persist() })',
    '        handle.stderr.on("data", chunk => { record.stderr += chunk.toString("utf8"); persist() })',
    '        void handle.done.then(async outcome => {',
    '          record.outcome = outcome',
    '          try { record.rangeEmpty = await handle.waitForExit() }',
    '          catch (error) { record.rangeEmpty = String(error) }',
    '          record.settled = true',
    '          persist()',
    '        }, async error => {',
    '          record.outcome = String(error)',
    '          try { record.rangeEmpty = await handle.waitForExit() }',
    '          catch (rangeError) { record.rangeEmpty = String(rangeError) }',
    '          record.settled = true',
    '          persist()',
    '        })',
    '        return handle',
    '      }',
    '      context.own(() => { childConnection.connect = originalConnect })',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
}

/** A live native profile whose app can prove candidate rejection, turnover, and run failures. */
function createNativeProfileReloadFixture(runFailure?: 'abort-reason' | 'after-abort' | 'during-preflight'): {
  home: string
  profileFile: string
  patch: string
  events: string
  ready: string
  preflightStart: string
  preflightRelease: string
  runFailure: string
  runFailureObserved: string
} {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-profile-reload-'))
  const profile = join(home, 'profiles', 'native-reload')
  const profileFile = join(profile, 'rsh.profile.json')
  const providerDir = join(profile, 'node_modules', 'native-reload-provider')
  const appDir = join(profile, 'node_modules', 'native-reload-app')
  const preflightDir = join(profile, 'node_modules', 'native-reload-preflight')
  const patch = join(home, 'reload.json')
  const events = join(home, 'events')
  const ready = join(home, 'ready')
  const preflightStart = join(home, 'preflight-start')
  const preflightRelease = join(home, 'preflight-release')
  const runFailureFile = join(home, 'run-failure')
  const runFailureObserved = join(home, 'run-failure-observed')
  mkdirSync(providerDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })
  mkdirSync(preflightDir, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'native-reload-profile',
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: 'live' } },
  }))
  writeFileSync(profileFile, JSON.stringify({
    formatVersion: 1,
    scopes: [{ id: 'root' }],
    installations: [
      { id: 'provider', plugin: 'native-reload-provider', scope: 'root' },
      { id: 'app', plugin: 'native-reload-app', scope: 'root', config: {
        generation: 'first', ...(runFailure === undefined ? {} : { runFailure }),
      } },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [] }))
  writeFileSync(join(providerDir, 'package.json'), JSON.stringify({
    name: 'native-reload-provider', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['credentials'] } },
  }))
  writeFileSync(join(providerDir, 'native.mjs'), [
    "import { appendFileSync } from 'node:fs'",
    'export const plugin = {',
    "  apiVersion: 1, name: 'native-reload-provider', targets: ['host'], requires: [], provides: ['credentials'],",
    '  resolve: () => context => {',
    "    appendFileSync(process.env.NATIVE_RELOAD_EVENTS, 'provider:start\\n')",
    "    context.provide('credentials', {})",
    "    context.own(() => appendFileSync(process.env.NATIVE_RELOAD_EVENTS, 'provider:cleanup\\n'))",
    '  },',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'native-reload-app', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['credentials'], optional: [], provides: ['application'] } },
  }))
  writeFileSync(join(appDir, 'native.mjs'), [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs'",
    "import { setTimeout as delay } from 'node:timers/promises'",
    'export const plugin = {',
    "  apiVersion: 1, name: 'native-reload-app', targets: ['host'], requires: ['credentials'], provides: ['application'],",
    '  resolve: input => {',
    "    if (input === null || typeof input !== 'object' || typeof input.generation !== 'string') throw new Error('native-reload-app generation must be a string')",
    '    const generation = input.generation',
    '    const finishAfterRun = input.finishAfterRun === true',
    '    const runFailure = input.runFailure',
    '    return context => {',
    '      let runCount = 0',
    '      context.own(() => appendFileSync(process.env.NATIVE_RELOAD_EVENTS, `app:cleanup:${generation}\\n`))',
    '      context.provide(\'application\', { run: async (_args, signal) => {',
    '        runCount += 1',
    '        appendFileSync(process.env.NATIVE_RELOAD_EVENTS, `app:start:${generation}\\n`)',
    '        if (generation === \'first\') writeFileSync(process.env.NATIVE_RELOAD_READY, \'ready\')',
    '        if (runFailure === \'during-preflight\') {',
    '          if (runCount > 1) return 0',
    '          appendFileSync(process.env.NATIVE_RELOAD_EVENTS, \'app:waiting-for-failure\\n\')',
    '          while (!existsSync(process.env.NATIVE_RELOAD_RUN_FAILURE)) await delay(5)',
    '          appendFileSync(process.env.NATIVE_RELOAD_EVENTS, `app:failure-aborted:${signal.aborted}\\n`)',
    '          writeFileSync(process.env.NATIVE_RELOAD_RUN_FAILURE_OBSERVED, \'failed\')',
    '          throw new Error(\'SENTINEL_RUN_NOT_ABORTED\')',
    '        }',
    '        if (!finishAfterRun) await new Promise(resolve => signal.addEventListener(\'abort\', resolve, { once: true }))',
    '        if (runFailure === \'after-abort\') {',
    '          appendFileSync(process.env.NATIVE_RELOAD_EVENTS, \'app:failure-after-abort\\n\')',
    '          writeFileSync(process.env.NATIVE_RELOAD_RUN_FAILURE_OBSERVED, \'failed\')',
    '          throw new Error(\'SENTINEL_RUN_DRAIN_FAILURE\')',
    '        }',
    '        if (runFailure === \'abort-reason\') {',
    '          appendFileSync(process.env.NATIVE_RELOAD_EVENTS, \'app:cancelled-with-abort-reason\\n\')',
    '          writeFileSync(process.env.NATIVE_RELOAD_RUN_FAILURE_OBSERVED, \'cancelled\')',
    '          throw signal.reason',
    '        }',
    '        appendFileSync(process.env.NATIVE_RELOAD_EVENTS, `app:return:${generation}\\n`)',
    '        return 0',
    '      } })',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(preflightDir, 'package.json'), JSON.stringify({
    name: 'native-reload-preflight', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: [] } },
  }))
  writeFileSync(join(preflightDir, 'native.mjs'), [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs'",
    "import { setTimeout as delay } from 'node:timers/promises'",
    "appendFileSync(process.env.NATIVE_RELOAD_EVENTS, 'preflight:start\\n')",
    "writeFileSync(process.env.NATIVE_RELOAD_PREFLIGHT_START, 'started')",
    'while (!existsSync(process.env.NATIVE_RELOAD_PREFLIGHT_RELEASE)) await delay(5)',
    'export const plugin = { apiVersion: 1, name: \'native-reload-preflight\', targets: [\'host\'], requires: [], provides: [], resolve: () => () => {} }',
    '',
  ].join('\n'))
  return { home, profileFile, patch, events, ready, preflightStart, preflightRelease, runFailure: runFailureFile, runFailureObserved }
}

function startNativeProfileReload(fixture: ReturnType<typeof createNativeProfileReloadFixture>) {
  const nodeOptions = [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning']
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(' ')
  return execa(process.execPath, [rshBin, '--profile', 'native-reload', '--patch', fixture.patch], {
    cwd: fixture.home,
    reject: false,
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      RSH_HOME: fixture.home,
      NATIVE_RELOAD_EVENTS: fixture.events,
      NATIVE_RELOAD_READY: fixture.ready,
      NATIVE_RELOAD_PREFLIGHT_START: fixture.preflightStart,
      NATIVE_RELOAD_PREFLIGHT_RELEASE: fixture.preflightRelease,
      NATIVE_RELOAD_RUN_FAILURE: fixture.runFailure,
      NATIVE_RELOAD_RUN_FAILURE_OBSERVED: fixture.runFailureObserved,
    },
    extendEnv: false,
  })
}

describe.skipIf(process.env.RSH_EXAMPLE_MODE !== 'lib' && !existsSync(rshBin))('dsh BUILT bin (node lib/bin.js, no tsx)', () => {
  it('resolves the shipped native-headless profile through the public loader', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rsh-native-headless-profile-'))
    try {
      ensureShippedNativeProfile('native-headless', home)
      await loadNativeProfile({ profile: 'native-headless', patchFiles: [], target: 'host', home,
        installAnchor: fileURLToPath(new URL('../package.json', import.meta.url)) })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('requires --profile and rejects removed commands', async () => {
    const bare = await runBuiltBin()
    expect(bare.code).toBe(1)
    expect(bare.stdout).toBe('')
    expect(bare.stderr).toContain('--profile <name> is required')
    const help = await runBuiltBin(['--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('dsh --profile web')
    expect(help.stdout).toContain('--from-default-profile')
    expect(help.stdout).not.toContain('dsh plugin')
    expect(help.stdout).not.toMatch(/^\s+(?:tui|meta|upgrade)\b/mu)
    for (const removed of [['tui'], ['--config', 'x.yml'], ['-p', 'task'], ['run', 'task']]) {
      const result = await runBuiltBin(removed)
      expect(result.code).toBe(1)
    }
  }, SPAWN_TIMEOUT_MS * 3 + 30_000)

  it('boots a native profile without resolving Cordis', async () => {
    const fixture = createNativeCliFixture()
    const noCordisHook = pathToFileURL(fileURLToPath(new URL('./fixtures/deny-cordis-import.mjs', import.meta.url))).href
    try {
      const result = await runBuiltBin(['--profile', 'native-smoke', 'native', 'launch'], {
        RSH_HOME: fixture.home,
        NATIVE_PROFILE_MARKER: fixture.marker,
        NODE_OPTIONS: `--import=${noCordisHook}`,
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stderr).toBe('')
      expect(readFileSync(fixture.marker, 'utf8')).toBe(JSON.stringify(['native', 'launch']))
    } finally {
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS)

  it('runs Claude through the shipped Native headless Subagent Consumer and parent Session without Cordis', async () => {
    const parentKey = 'built-native-claude-parent-key'
    const childTask = 'NATIVE_CLAUDE_PROFILE_CHILD_TASK_20261012'
    const parentServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      apiKey: parentKey,
      toolName: 'subagent',
      toolArguments: JSON.stringify({ description: 'Return a short fixture result', prompt: childTask }),
      successText: 'Native parent completed after Claude.',
    })
    let completeMessages!: () => void
    const messagesComplete = new Promise<void>((resolve) => { completeMessages = resolve })
    const messages = await startMessagesFixture({
      kind: 'complete',
      text: 'Claude child fixture result.',
      beforeComplete: messagesComplete,
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-native-claude-session-'))
    const workspace = join(home, 'workspace')
    const sandboxTempRoot = join(home, 'sandbox-temp')
    mkdirSync(workspace)
    mkdirSync(sandboxTempRoot)
    const profilePath = join(home, 'profiles', 'headless', 'rsh.profile.json')
    const observerPackage = join(home, 'profiles', 'headless', 'node_modules', '@fixture', 'subprocess-observer')
    const observationPath = join(home, 'native-subprocess-observation.json')
    const noCordisHook = pathToFileURL(fileURLToPath(new URL('./fixtures/deny-cordis-import.mjs', import.meta.url))).href
    let profileRun: Promise<{ stdout: string; code: number; stderr: string }> | undefined
    let cliPid: number | undefined
    let cliSettled = false
    let nativeHome: string | undefined
    try {
      ensureShippedNativeProfile('headless', home)
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
        installations: Array<{ id: string; plugin: string; scope: string; config?: Record<string, unknown> }>
      }
      const app = profile.installations.find(row => row.id === 'app')
      const subagents = profile.installations.find(row => row.id === 'subagents')
      const modelProvider = profile.installations.find(row => row.id === 'pi-ai')
      const workflowWorker = profile.installations.find(row => row.id === 'workflow-worker')
      const ralphTool = profile.installations.find(row => row.id === 'ralph-tool')
      const sandboxPolicy = profile.installations.find(row => row.id === 'sandbox-policy')
      if (app === undefined || subagents === undefined || modelProvider === undefined
        || workflowWorker === undefined || ralphTool === undefined || sandboxPolicy === undefined) {
        throw new Error('shipped Native headless profile omitted its model, Subagent or workflow Provider')
      }
      app.config = { ...app.config, cwd: workspace, provider: 'deepseek', model: 'native-claude-parent-fixture', maxSteps: 4 }
      sandboxPolicy.config = { ...sandboxPolicy.config, workspaceRoot: workspace }
      subagents.config = { providerName: 'claude-code' }
      workflowWorker.config = { ...workflowWorker.config, subagentProvider: 'claude-code' }
      ralphTool.config = { ...ralphTool.config, subagentProvider: 'claude-code' }
      modelProvider.config = { providers: { deepseek: {
        apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL: parentServer.baseURL,
        models: [{ id: 'native-claude-parent-fixture' }],
      } } }
      profile.installations.push({
        id: 'subagent-tool',
        plugin: '@redspark/rsh-tool-subagent',
        scope: 'root',
        config: { toolName: 'subagent', maxDepth: 2, maxSteps: 2 },
      })
      profile.installations.push({
        id: 'claude-code-driver',
        plugin: '@redspark/rsh-subagent-claude-code',
        scope: 'root',
        config: { name: 'claude-code', model: 'native-claude-child-fixture', apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrl: messages.baseUrl },
      })
      mkdirSync(observerPackage, { recursive: true })
      writeFileSync(join(observerPackage, 'package.json'), JSON.stringify({
        name: '@fixture/subprocess-observer',
        version: '0.0.0',
        type: 'module',
        exports: { './package.json': './package.json', './native.js': './native.js' },
        dsh: { native: {
          apiVersion: 1, entry: './native.js', targets: ['host'], requires: ['subprocess'], optional: [], provides: [],
        } },
      }))
      writeFileSync(join(observerPackage, 'native.js'), [
        "import { writeFileSync } from 'node:fs'",
        'export const plugin = {',
        "  apiVersion: 1, name: 'test-subprocess-observer', targets: ['host'], requires: ['subprocess'], optional: [], provides: [],",
        '  resolve(config) {',
        '    const observationPath = config.observationPath',
        '    return context => {',
        "      const subprocess = context.require('subprocess')",
        '      const originalSpawn = subprocess.spawn',
        '      const spawns = []',
        '      const write = () => writeFileSync(observationPath, JSON.stringify({ spawns }))',
        '      subprocess.spawn = function (spec) {',
        '        const handle = originalSpawn.call(subprocess, spec)',
        "        if (typeof spec.env?.CLAUDE_CONFIG_DIR === 'string') {",
        '          const record = { cwd: spec.cwd, home: spec.env.HOME, configDir: spec.env.CLAUDE_CONFIG_DIR, outcome: null, rangeEmpty: null }',
        '          spawns.push(record)',
        '          write()',
        '          const waitForExit = handle.waitForExit.bind(handle)',
        '          handle.waitForExit = async signal => {',
        '            const rangeEmpty = await waitForExit(signal)',
        '            record.rangeEmpty = rangeEmpty',
        '            write()',
        '            return rangeEmpty',
        '          }',
        '          void handle.done.then(outcome => {',
        '            record.outcome = { exitCode: outcome.exitCode, signal: outcome.signal }',
        '            write()',
        '          }, () => { record.outcome = "rejected"; write() })',
        '        }',
        '        return handle',
        '      }',
        '      context.own(() => { subprocess.spawn = originalSpawn })',
        '    }',
        '  },',
        '}',
      ].join('\n'))
      profile.installations.push({
        id: 'subprocess-observer',
        plugin: '@fixture/subprocess-observer',
        scope: 'root',
        config: { observationPath },
      })
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)

      profileRun = runBuiltBin(['--profile', 'headless', 'complete', 'the', 'requested', 'work'], {
        RSH_HOME: home,
        RSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: parentKey,
        ANTHROPIC_API_KEY: 'built-native-claude-child-key',
        TMP: sandboxTempRoot,
        TEMP: sandboxTempRoot,
        TMPDIR: sandboxTempRoot,
        RSH_NATIVE_PROFILE_OBSERVATION_PATH: undefined,
        NODE_OPTIONS: `--import=${noCordisHook}`,
      }, workspace, 25_000, (pid) => { cliPid = pid }).finally(() => { cliSettled = true })
      try {
        nativeHome = await waitForNativeClaudeHome(sandboxTempRoot, workspace, () => cliSettled)
      } catch (error: unknown) {
        if (cliSettled && profileRun !== undefined) {
          const exited = await profileRun
          throw new Error(`${error instanceof Error ? error.message : String(error)}; dsh exit ${exited.code}; stderr: ${exited.stderr}`)
        }
        throw error
      }
      await messages.requestStarted
      expect(existsSync(join(nativeHome, '.claude', 'settings.json'))).toBe(true)
      completeMessages()
      const result = await profileRun

      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toBe('Native parent completed after Claude.')
      expect(parentServer.requests).toHaveLength(2)
      expect(JSON.stringify(parentServer.requests[0]?.body)).toContain('complete the requested work')
      expect(JSON.stringify(parentServer.requests[1]?.body)).toContain('Claude child fixture result.')
      expect(messages.requests).toHaveLength(1)
      expect(messages.requests[0]?.body.model).toBe('native-claude-child-fixture')

      const events = persistedEvents(join(home, 'sessions'))
      const starts = sessionEvents(events, 'subagent/external-start')
      const ends = sessionEvents(events, 'subagent/external-end')
      expect(starts).toHaveLength(1)
      expect(ends).toHaveLength(1)
      const start = starts[0]
      if (start === undefined) throw new Error('Native Claude Session omitted its external start event')
      expect(start).toMatchObject({
        version: 0,
        provider: 'claude-code',
      })
      if (typeof start.remoteId !== 'string' || typeof start.parentSessionId !== 'string'
        || typeof start.rootSessionId !== 'string') {
        throw new Error('Native Claude Session omitted its external operation identifiers')
      }
      expect(start.remoteId.length).toBeGreaterThan(0)
      expect(ends[0]).toMatchObject({
        id: start.id,
        provider: 'claude-code',
        remoteId: start.remoteId,
        stopReason: 'completed',
      })
      expect(nativeHome).toBeDefined()
      expect(existsSync(nativeHome)).toBe(false)
      expect(findNativeClaudeHome(sandboxTempRoot, workspace)).toBeUndefined()
      const backendTempRoot = dirname(nativeHome)
      if (backendTempRoot !== sandboxTempRoot) expect(existsSync(backendTempRoot)).toBe(false)
      expect(cliPid).toBeDefined()
      expect(() => process.kill(cliPid!, 0)).toThrow()
      const observed = JSON.parse(readFileSync(observationPath, 'utf8')) as {
        spawns: Array<{
          cwd: string
          home: string
          configDir: string
          outcome: { exitCode: number; signal: string | null } | 'rejected' | null
          rangeEmpty: boolean | null
        }>
      }
      expect(observed.spawns).toHaveLength(1)
      expect(observed.spawns[0]).toMatchObject({
        cwd: workspace,
        home: nativeHome,
        configDir: join(nativeHome, '.claude'),
        outcome: { exitCode: 0, signal: null },
        rangeEmpty: true,
      })
      const evidencePath = process.env.RSH_NATIVE_PROFILE_OBSERVATION_PATH
      if (evidencePath !== undefined) {
        writeFileSync(evidencePath, `${JSON.stringify({
          formatVersion: 1,
          cliPid: cliPid ?? null,
          cliExited: cliSettled,
          cliExitCode: result.code,
          selectedChildHome: nativeHome,
          selectedChildHomeObservedBeforeMessagesCompleted: true,
          selectedChildHomeRemovedAfterRun: !existsSync(nativeHome),
          backendTempCapabilityRoot: backendTempRoot === sandboxTempRoot ? null : backendTempRoot,
          backendTempCapabilityRootRemoved: backendTempRoot === sandboxTempRoot ? null : !existsSync(backendTempRoot),
          managedSubprocess: observed.spawns[0],
        }, null, 2)}\n`)
      }
    } finally {
      completeMessages()
      await profileRun?.catch(() => undefined)
      await parentServer.close()
      await messages.close()
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2)

  it('runs an ACP child through the fixed shipped Native profile and parent Session without Cordis', async () => {
    const apiKey = 'built-native-acp-loopback-key'
    const providerName = 'dsh-acp-child'
    const parentModel = 'native-acp-parent-fixture'
    const childModel = 'native-acp-child-fixture'
    const childTask = 'NATIVE_ACP_PROFILE_CHILD_TASK_20261013'
    const server = await startMockLlmServer({
      sequence: ['tool_call_success', 'success', 'success'],
      apiKey,
      toolName: 'subagent',
      toolArguments: JSON.stringify({ description: 'Return the fixture result', prompt: childTask }),
      successText: 'Native ACP fixture completed.',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-session-'))
    const workspace = join(home, 'workspace')
    const sandboxTempRoot = join(home, 'sandbox-temp')
    mkdirSync(workspace)
    mkdirSync(sandboxTempRoot)
    const profilePath = join(home, 'profiles', 'native-headless', 'rsh.profile.json')
    const observationPath = join(home, 'native-acp-child-observation.json')
    const noCordisHook = pathToFileURL(fileURLToPath(new URL('./fixtures/deny-cordis-import.mjs', import.meta.url))).href
    let profileRun: Promise<{ stdout: string; code: number; stderr: string }> | undefined
    let profileResult: { stdout: string; code: number; stderr: string } | undefined
    let cliPid: number | undefined
    try {
      ensureShippedNativeProfile('native-headless', home)
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
        installations: Array<{ id: string; plugin: string; scope: string; config?: Record<string, unknown> }>
      }
      const app = profile.installations.find(row => row.id === 'app')
      const subagents = profile.installations.find(row => row.id === 'subagents')
      const modelProvider = profile.installations.find(row => row.id === 'pi-ai')
      const workflowWorker = profile.installations.find(row => row.id === 'workflow-worker')
      const ralphTool = profile.installations.find(row => row.id === 'ralph-tool')
      const sandboxPolicy = profile.installations.find(row => row.id === 'sandbox-policy')
      if (app === undefined || subagents === undefined || modelProvider === undefined
        || workflowWorker === undefined || ralphTool === undefined || sandboxPolicy === undefined) {
        throw new Error('shipped Native headless profile omitted its app, model or child Provider')
      }
      app.config = { ...app.config, cwd: workspace, provider: 'deepseek', model: parentModel, maxSteps: 4, maxTokens: 64 }
      sandboxPolicy.config = { ...sandboxPolicy.config, workspaceRoot: workspace }
      subagents.config = { providerName }
      workflowWorker.config = { ...workflowWorker.config, subagentProvider: providerName }
      ralphTool.config = { ...ralphTool.config, subagentProvider: providerName }
      modelProvider.config = { providers: { deepseek: {
        apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL: server.baseURL,
        models: [{ id: parentModel }, { id: childModel }],
      } } }
      profile.installations.push(
        { id: 'subagent-tool', plugin: '@redspark/rsh-tool-subagent', scope: 'root',
          config: { toolName: 'subagent', maxDepth: 2, maxSteps: 2, maxTokens: 48,
            provider: 'deepseek', model: childModel, toolFilter: { allow: ['read_file'] } } },
        { id: 'acp-child', plugin: '@redspark/rsh-acp-child', scope: 'root',
          config: { providerName, providers: {} } },
        { id: 'child-connection-observer', plugin: '@fixture/child-connection-observer', scope: 'root',
          config: { observationPath } },
      )
      installChildConnectionObserver(dirname(profilePath))
      writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')

      profileRun = runBuiltBin(['--profile', 'native-headless', 'complete', 'the', 'requested', 'work'], {
        RSH_HOME: home,
        RSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: apiKey,
        TMP: sandboxTempRoot,
        TEMP: sandboxTempRoot,
        TMPDIR: sandboxTempRoot,
        NODE_OPTIONS: '--import=' + noCordisHook,
      }, workspace, SPAWN_TIMEOUT_MS, (pid) => { cliPid = pid })
      const result = profileResult = await profileRun
      expect(result.code, result.stderr).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe('Native ACP fixture completed.')
      expect(cliPid).toBeDefined()
      expect(() => process.kill(cliPid!, 0)).toThrow()

      const observation = await waitForChildConnectionObservation(observationPath)
      const connections = observation.connections as Record<string, unknown>[]
      expect(connections).toHaveLength(1)
      const connection = connections[0]
      if (connection === undefined) throw new Error('fixed Native ACP child connection was not observed')
      expect(connection.argv).toEqual(expect.arrayContaining(['--profile', 'native-acp-dsh-child', '--patch']))
      expect(connection.cwd).toBe(workspace)
      expect(connection.homeExistedAtConnect).toBe(true)
      expect(connection.nodeOptions).toContain(noCordisHook)
      expect(connection.outcome).toEqual({ exitCode: 0, signal: null })
      expect(connection.rangeEmpty).toBe(true)
      expect(connection.settled).toBe(true)
      expect(connection.stderr).not.toContain('native CLI imported Cordis')
      expect(typeof connection.home).toBe('string')
      const childHome = connection.home as string
      expect(childHome.split(/[\\/]/u).at(-1)).toMatch(/^dsh-acp-child-/u)
      expect(existsSync(childHome)).toBe(false)

      const wireRequests = String(connection.stdin).split(/\r?\n/u).filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>)
      const newSession = wireRequests.find(request => request.method === 'session/new')
      if (newSession === undefined || typeof newSession.params !== 'object' || newSession.params === null) {
        throw new Error('fixed Native ACP child did not send session/new')
      }
      const sessionParams = newSession.params as Record<string, unknown>
      const metadata = sessionParams._meta as Record<string, unknown>
      expect(metadata['com.deepseek.ai/dsh-native-subagent']).toEqual({
        version: 1, maxSteps: 2, maxTokens: 48, permissionMode: 'deny',
      })
      expect(sessionParams.cwd).toBe(workspace)

      expect(server.requests).toHaveLength(3)
      const requestModels = server.requests.map(request => (request.body as Record<string, unknown>).model)
      expect(requestModels).toEqual([parentModel, childModel, parentModel])
      expect(server.requests[1]?.body).toMatchObject({ model: childModel, max_tokens: 48 })

      const events = persistedEvents(join(home, 'sessions'))
      const starts = sessionEvents(events, 'subagent/external-start')
      const ends = sessionEvents(events, 'subagent/external-end')
      expect(starts).toHaveLength(1)
      expect(ends).toHaveLength(1)
      const start = starts[0]
      if (start === undefined) throw new Error('Native ACP Session omitted its external start event')
      expect(start).toMatchObject({
        version: 0,
        provider: providerName,
      })
      if (typeof start.remoteId !== 'string' || typeof start.parentSessionId !== 'string'
        || typeof start.rootSessionId !== 'string') {
        throw new Error('Native ACP Session omitted its external operation identifiers')
      }
      expect(ends[0]).toMatchObject({
        id: start.id,
        provider: providerName,
        remoteId: start.remoteId,
        stopReason: 'completed',
      })
      const operationFacts = sessionEvents(events, 'subagent/external-operation')
        .filter(event => event.id === starts[0]?.id
          && ['model-request', 'model-response', 'model-failure', 'tool-call', 'tool-result', 'tool-settlement']
            .includes(String(event.kind)))
      expect(operationFacts).toHaveLength(0)
    } finally {
      await profileRun?.catch(() => undefined)
      const evidencePath = process.env.RSH_NATIVE_PROFILE_OBSERVATION_PATH
      if (evidencePath !== undefined) {
        const sessionsPath = join(home, 'sessions')
        writeFileSync(evidencePath, `${JSON.stringify({
          formatVersion: 1,
          cliPid: cliPid ?? null,
          profileResult: profileResult ?? null,
          childObservation: existsSync(observationPath)
            ? JSON.parse(readFileSync(observationPath, 'utf8')) as unknown
            : null,
          parentSessionEvents: existsSync(sessionsPath) ? persistedEvents(sessionsPath) : [],
          modelRequests: server.requests.map(request => request.body),
        }, null, 2)}\n`)
      }
      await server.close()
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2)

  it('keeps a running native Host on invalid JSON patch and hands an in-flight app to the valid generation', async () => {
    const fixture = createNativeProfileReloadFixture()
    const child = startNativeProfileReload(fixture)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const waitForStderr = (message: string): Promise<void> => new Promise((resolve, reject) => {
      const cleanup = (): void => {
        child.stderr.off('data', onData)
        child.stderr.off('end', onEnd)
      }
      const onData = (): void => {
        if (!stderr.includes(message)) return
        cleanup()
        resolve()
      }
      const onEnd = (): void => {
        cleanup()
        reject(new Error(`native profile stderr closed before ${JSON.stringify(message)}: ${stderr}`))
      }
      child.stderr.on('data', onData)
      child.stderr.once('end', onEnd)
    })
    try {
      await waitForFile(fixture.ready)
      writeFileSync(fixture.patch, JSON.stringify({
        formatVersion: 1, installations: [{ id: 'app', config: { generation: 17 } }],
      }))
      await waitForStderr('native profile reload rejected: native-reload-app generation must be a string')
      const originalProfile = readFileSync(fixture.profileFile, 'utf8')
      writeFileSync(fixture.profileFile, '{')
      await waitForStderr(`native profile reload rejected: native profile cannot read JSON ${fixture.profileFile}`)
      expect(readFileSync(fixture.events, 'utf8')).toBe('provider:start\napp:start:first\n')

      writeFileSync(fixture.profileFile, originalProfile)
      writeFileSync(fixture.patch, JSON.stringify({
        formatVersion: 1, installations: [{ id: 'app', config: { generation: 'second', finishAfterRun: true } }],
      }))
      const result = await child
      expect(result.timedOut, stderr).toBe(false)
      expect(result.signal, stderr).toBeUndefined()
      expect(result.exitCode, stderr).toBe(0)
      expect(stderr).toContain('native profile reload rejected: native-reload-app generation must be a string')
      expect(readFileSync(fixture.events, 'utf8')).toBe([
        'provider:start',
        'app:start:first',
        'app:return:first',
        'app:cleanup:first',
        'app:start:second',
        'app:return:second',
        'app:cleanup:second',
        'provider:cleanup',
        '',
      ].join('\n'))
    } finally {
      child.kill('SIGKILL')
      await child
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('continues replacement when the application rejects with its invocation abort reason', async () => {
    const fixture = createNativeProfileReloadFixture('abort-reason')
    const child = startNativeProfileReload(fixture)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    try {
      await waitForFile(fixture.ready)
      writeFileSync(fixture.patch, JSON.stringify({
        formatVersion: 1, installations: [{ id: 'app', config: { generation: 'second', finishAfterRun: true } }],
      }))
      const result = await child
      expect(result.timedOut, stderr).toBe(false)
      expect(result.signal, stderr).toBeUndefined()
      expect(result.exitCode, stderr).toBe(0)
      expect(stderr).toBe('')
      expect(readFileSync(fixture.events, 'utf8')).toBe([
        'provider:start',
        'app:start:first',
        'app:cancelled-with-abort-reason',
        'app:cleanup:first',
        'app:start:second',
        'app:return:second',
        'app:cleanup:second',
        'provider:cleanup',
        '',
      ].join('\n'))
    } finally {
      child.kill('SIGKILL')
      await child
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it.each([
    { runFailure: 'after-abort' as const, sentinel: 'SENTINEL_RUN_DRAIN_FAILURE' },
    { runFailure: 'during-preflight' as const, sentinel: 'SENTINEL_RUN_NOT_ABORTED' },
  ])('fails the Host on an independent app rejection ($runFailure)', async ({ runFailure, sentinel }) => {
    const fixture = createNativeProfileReloadFixture(runFailure)
    const child = startNativeProfileReload(fixture)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    try {
      await waitForFile(fixture.ready)
      if (runFailure === 'after-abort') {
        writeFileSync(fixture.patch, JSON.stringify({
          formatVersion: 1, installations: [{ id: 'app', config: { generation: 'second', finishAfterRun: true } }],
        }))
        await waitForFile(fixture.runFailureObserved)
        expect(readFileSync(fixture.events, 'utf8')).toContain('app:failure-after-abort\n')
      } else {
        const profile = JSON.parse(readFileSync(fixture.profileFile, 'utf8')) as { installations: unknown[] }
        profile.installations.push({ id: 'preflight', plugin: 'native-reload-preflight', scope: 'root' })
        writeFileSync(fixture.profileFile, JSON.stringify(profile))
        await waitForFile(fixture.preflightStart)
        writeFileSync(fixture.runFailure, 'fail')
        await waitForFile(fixture.runFailureObserved)
        expect(readFileSync(fixture.events, 'utf8')).toContain('app:failure-aborted:false\n')
        writeFileSync(fixture.preflightRelease, 'continue')
      }

      const result = await child
      expect(result.timedOut, stderr).toBe(false)
      expect(result.signal, stderr).toBeUndefined()
      expect(result.exitCode, stderr).toBe(1)
      expect(stderr).toContain(sentinel)
      const events = readFileSync(fixture.events, 'utf8')
      expect(events.match(/app:start:first\n/g)).toHaveLength(1)
      expect(events).not.toContain('app:start:second\n')
    } finally {
      child.kill('SIGKILL')
      await child
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)





  it('runs the headless profile through its app-owned task positional', async () => {
    const apiKey = 'built-dsh-headless-key'
    const server = await startMockLlmServer({
      sequence: ['reasoning_success'],
      apiKey,
      reasoningText: 'Inspecting the published entry.',
      successText: 'published headless profile reached the mock',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-built-headless-'))
    try {
      const result = await runBuiltBin(['--profile', 'headless', 'answer', 'from', 'the', 'published', 'entry'], {
        RSH_HOME: home,
        RSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toBe('published headless profile reached the mock')
      expect(result.stderr).toBe('dsh: reasoning:\nInspecting the published entry.')
      expect(server.requests.length).toBeGreaterThan(0)
      expect(server.requests.every(request => request.path === '/chat/completions')).toBe(true)
      expect(JSON.stringify(server.requests.map(request => request.body))).toContain('answer from the published entry')
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('runs the opt-in Native query profile through a model-visible query tool call', async () => {
    const apiKey = 'built-native-query-key'
    const server = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      apiKey,
      toolName: 'session_search',
      toolArguments: JSON.stringify({ query: 'history' }),
      successText: 'Native session query completed.',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-native-query-profile-'))
    const profileDir = join(home, 'profiles', 'native-headless-query')
    const profilePath = join(profileDir, 'rsh.profile.json')
    const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
    try {
      ensureShippedNativeProfile('native-headless-query', home)
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
        installations: Array<{ id: string; plugin: string; scope: string; config?: Record<string, unknown> }>
      }
      const app = profile.installations.find(row => row.id === 'app')
      expect(app?.config).toMatchObject({ cwd: process.cwd() })
      if (app === undefined) throw new Error('native query profile has no app installation')
      app.config = { ...app.config, provider: 'deepseek', model: 'session-query-fixture' }
      const modelProvider = profile.installations.find(row => row.id === 'pi-ai')
      if (modelProvider === undefined) throw new Error('native query profile has no pi-ai installation')
      modelProvider.config = {
        providers: {
          deepseek: {
            apiKeyEnv: 'DEEPSEEK_API_KEY',
            api: 'openai-completions',
            baseURL: server.baseURL,
            models: [{ id: 'session-query-fixture' }],
          },
        },
      }
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
      const options = { profile: 'native-headless-query', patchFiles: [], target: 'host' as const, installAnchor, home }
      const loaded = await loadNativeProfile(options)
      expect(loaded.requests.get('session-query')?.plugin.name).toBe('@redspark/rsh-session-query-sqlite')
      expect(loaded.requests.get('tool-session-query')?.plugin.name).toBe('@redspark/rsh-tool-session-query')

      profile.installations.push({ id: 'session-query-exact', plugin: '@redspark/rsh-session-query', scope: 'root' })
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
      await expect(loadNativeProfile(options)).rejects.toThrow(/duplicate provider for sessionQuery/)
      profile.installations.pop()
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)

      const result = await runBuiltBin(
        ['--profile', 'native-headless-query', 'search', 'prior', 'session', 'history'],
        {
          RSH_HOME: home,
          RSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: apiKey,
          DEEPSEEK_BASE_URL: server.baseURL,
        },
      )
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toBe('Native session query completed.')
      expect(server.requests).toHaveLength(2)
      expect(JSON.stringify(server.requests[0]?.body)).toContain('session_search')
      expect(JSON.stringify(server.requests[1]?.body)).toContain('No prior session matches found.')
      expect(existsSync(join(home, 'sessions', 'query.sqlite'))).toBe(true)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('does not load a project environment for --version', async () => {
    const project = mkdtempSync(join(tmpdir(), 'dsh-version-project-'))
    writeFileSync(join(project, '.env'), 'PATH=/project-only-path\n')
    try {
      const result = await runBuiltBin(['--version'], {}, project)
      expect(result).toEqual({ code: 0, stdout: cliVersion, stderr: '' })
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('runs through an installed-style symlink', async () => {
    const installation = mkdtempSync(join(tmpdir(), 'dsh-bin-link-'))
    const installedBin = join(installation, 'dsh')
    symlinkSync(rshBin, installedBin)
    try {
      const result = await execa(process.execPath, [installedBin, '--version'], {
        input: '',
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe(cliVersion)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(installation, { recursive: true, force: true })
    }
  })

  it('fails loud on a nonexistent profile with the template-creation hint', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-missing-profile-'))
    try {
      const result = await runBuiltBin(['--profile', 'nope'], { RSH_HOME: home })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('profile "nope" does not exist')
      expect(result.stderr).toContain('--from-default-profile <template>')
      expect(result.stderr).toContain('rsh/Docs/native-config-migration.md')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('creates a custom Native profile from an explicit native template', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-native-from-default-profile-'))
    try {
      const created = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'native-headless', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(created.code).toBe(0)
      expect(created.stderr).toBe('')
      const dumped = JSON.parse(created.stdout) as {
        formatVersion: number
        installations: Array<{ id: string; plugin: string }>
      }
      expect(dumped.formatVersion).toBe(1)
      expect(dumped.installations.find(row => row.id === 'app')?.plugin).toBe('@redspark/rsh-native-headless')
      const directory = join(home, 'profiles', 'rescue')
      expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))).toMatchObject({
        dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
      })
      expect(existsSync(join(directory, 'cordis.patch.yml'))).toBe(false)

      const repeated = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'native-headless', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(repeated.code).toBe(1)
      expect(repeated.stderr).toContain('is not empty')

      const shipped = await runBuiltBin(
        ['--profile', 'web', '--from-default-profile', 'native-headless', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(shipped.code).toBe(1)
      expect(shipped.stderr).toContain('shipped profile name')

      const unknown = await runBuiltBin(
        ['--profile', 'other', '--from-default-profile', 'native-missing', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(unknown.code).toBe(1)
      expect(unknown.stderr).toContain('unknown profile template')
      expect(unknown.stderr).toContain('native-headless')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('creates a custom Native profile from a standard template alias before dumping it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-from-default-profile-'))
    try {
      const created = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(created.code).toBe(0)
      expect(created.stderr).toBe('')
      const dumped = JSON.parse(created.stdout) as {
        formatVersion: number
        installations: Array<{ id: string; plugin: string }>
      }
      expect(dumped.formatVersion).toBe(1)
      expect(dumped.installations.find(row => row.id === 'app')?.plugin).toBe('@redspark/rsh-native-web-host')

      const dir = join(home, 'profiles', 'rescue')
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh: { profile: { runtime: string; config: string; configReload: string } }
      }
      expect(manifest.dependencies).toBeUndefined()
      expect(manifest.dsh.profile).toEqual({ runtime: 'native', config: 'rsh.profile.json', configReload: 'live' })
      expect(existsSync(join(dir, 'cordis.patch.yml'))).toBe(false)
      expect(existsSync(join(dir, 'rsh.client.json'))).toBe(true)

      const repeated = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(repeated.code).toBe(1)
      expect(repeated.stderr).toContain('is not empty')

      const reopened = await runBuiltBin(['--profile', 'rescue', '--dump-config'], { RSH_HOME: home })
      expect(reopened.code).toBe(0)
      expect(reopened.stderr).toBe('')
      expect(JSON.parse(reopened.stdout)).toMatchObject({ formatVersion: 1 })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2 + 30_000)

  describe('native config dump', () => {
    let home: string
    beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'dsh-dump-bin-')) })
    afterEach(() => { rmSync(home, { recursive: true, force: true }) })

    it('installs a shipped standard profile as Native and dumps its composition', async () => {
      const { stdout, code, stderr } = await runBuiltBin(['--profile', 'web', '--dump-config'], { RSH_HOME: home })
      expect(code).toBe(0)
      expect(stderr).toBe('')
      const dump = JSON.parse(stdout) as { formatVersion: number; installations: Array<{ id: string; plugin: string }> }
      expect(dump.formatVersion).toBe(1)
      expect(dump.installations.find(row => row.id === 'app')?.plugin).toBe('@redspark/rsh-native-web-host')
      expect(JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')))
        .toMatchObject({ dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } })
      expect(existsSync(join(home, 'profiles', 'web', 'cordis.patch.yml'))).toBe(false)
      expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('rejects an unknown template before creating the target profile', async () => {
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'unknown', '--dump-config'],
        { RSH_HOME: home },
      )
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('unknown profile template "unknown"')
      expect(stderr).toContain('expected one of headless, web,')
      expect(existsSync(join(home, 'profiles', 'rescue'))).toBe(false)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('refuses the retired sdk-minimal profile instead of printing a tree', async () => {
      const { stdout, code, stderr } = await runBuiltBin(['--profile', 'sdk-minimal', '--dump-config'], { RSH_HOME: home })
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('profile "sdk-minimal" no longer boots')
      expect(stderr).toContain('use --profile sdk')
      expect(existsSync(join(home, 'profiles', 'sdk-minimal'))).toBe(false)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('applies ordered patch overlays over the profile composition', async () => {
      const first = join(home, 'first.json')
      writeFileSync(first, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { port: 1 } },
        { id: 'extra-tool', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
      ] }))
      const second = join(home, 'second.json')
      writeFileSync(second, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { port: 2 } },
      ] }))
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'web', '--patch', first, '--patch', second, '--dump-config'],
        { RSH_HOME: home },
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
      const dump = JSON.parse(stdout) as { installations: Array<{ id: string; plugin?: string; config?: unknown }> }
      expect(dump.installations.find(row => row.id === 'app')?.config).toEqual({ port: 2 })
      expect(dump.installations.find(row => row.id === 'extra-tool')?.plugin).toBe('@redspark/rsh-tool-bash')
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('rejects a patch that targets an absent installation', async () => {
      const patch = join(home, 'absent.json')
      writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [{ id: 'absent-row', config: { x: 1 } }] }))
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'web', '--patch', patch, '--dump-config'],
        { RSH_HOME: home },
      )
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('unknown installation absent-row')
    }, SPAWN_TIMEOUT_MS + 30_000)
  })
})
