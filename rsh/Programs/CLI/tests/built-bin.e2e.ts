import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { initProfile, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { execa } from 'execa'
import * as yaml from 'js-yaml'
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
const dshBin = join(repoRoot, 'rsh/Programs/CLI/lib/bin.js')
const invalidProvider = fileURLToPath(new URL('./fixtures/invalid-provider.native.json', import.meta.url))

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
  const child = execa(process.execPath, [dshBin, ...args], {
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

interface ProfileLifecycleFixture {
  home: string
  ready: string
  settled: string
  disposed: string
  interrupt: string
}

/**
 * A minimal custom profile: one lifecycle-marker plugin bundle listed in
 * dsh.profile.bundles, no dsh-base — proving out-of-box composition machinery without
 * booting the entire product tree.
 */
function createProfileLifecycleFixture(): ProfileLifecycleFixture {
  const home = mkdtempSync(join(tmpdir(), 'dsh-profile-lifecycle-'))
  const ready = join(home, 'ready')
  const settled = join(home, 'settled')
  const disposed = join(home, 'disposed')
  const interrupt = join(home, 'interrupt')
  const bundleDir = join(home, 'lifecycle-bundle')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'plugin.mjs'), [
    "import { existsSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'profile-lifecycle-fixture'",
    'export function apply(ctx, config = {}) {',
    '  let active = true',
    '  // Keep the event loop alive so process lifetime is signal-owned, like a real surface.',
    '  // Windows has no deliverable SIGTERM; the marker emits the same process event there.',
    '  let interrupted = false',
    '  const heartbeat = setInterval(() => {',
    '    if (interrupted || !existsSync(process.env.RAW_INTERRUPT_FILE)) return',
    '    interrupted = true',
    "    process.emit('SIGTERM')",
    '  }, 20)',
    '  // Echo the mounted generation so the hot-reload e2e can assert both an',
    '  // applied override and its removal reverting to this bundle default.',
    "  writeFileSync(join(process.env.DSH_HOME, 'config-echo'), String(config.generation ?? 'bundle-default'))",
    "  writeFileSync(process.env.RAW_READY_FILE, 'ready')",
    '  void ctx.loader.await().then(() => {',
    "    if (active) writeFileSync(process.env.RAW_SETTLED_FILE, 'settled')",
    '  })',
    '  ctx.effect(() => () => {',
    '    active = false',
    '    clearInterval(heartbeat)',
    "    writeFileSync(process.env.RAW_DISPOSED_FILE, 'disposed')",
    '  })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: profile-lifecycle-fixture',
    `      name: ${pathToFileURL(join(bundleDir, 'plugin.mjs')).href}`,
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'dsh-lifecycle-bundle',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2))
  const profileDir = join(home, 'profiles', 'lifecycle')
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-lifecycle',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-lifecycle-bundle'] } },
  }, undefined, 2))
  // Hand-place the "installed" bundle where profile resolution finds it.
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const linkTarget = join(profileDir, 'node_modules', 'dsh-lifecycle-bundle')
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  try {
    rmSync(linkTarget, { recursive: true, force: true })
  } catch { /* fresh dir */ }
  // Copy-free: a package.json redirecting via a relative main is enough for require.resolve.
  mkdirSync(linkTarget, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'plugin.mjs']) {
    writeFileSync(join(linkTarget, file), readFileSync(join(bundleDir, file)))
  }
  return { home, ready, settled, disposed, interrupt }
}

/** Native package fixture for the built CLI's Cordis-free launch path. */
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
    '        const home = spec.env?.DSH_HOME ?? null',
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
  return execa(process.execPath, [dshBin, '--profile', 'native-reload', '--patch', fixture.patch], {
    cwd: fixture.home,
    reject: false,
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      DSH_HOME: fixture.home,
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

function startProfileLifecycle(fixture: ProfileLifecycleFixture, args: readonly string[] = []) {
  return execa(process.execPath, [dshBin, '--profile', 'lifecycle', ...args], {
    cwd: fixture.home,
    input: '',
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    reject: false,
    env: {
      DSH_HOME: fixture.home,
      RAW_READY_FILE: fixture.ready,
      RAW_SETTLED_FILE: fixture.settled,
      RAW_DISPOSED_FILE: fixture.disposed,
      RAW_INTERRUPT_FILE: fixture.interrupt,
    },
  })
}

function requestProfileShutdown(
  child: Pick<ReturnType<typeof startProfileLifecycle>, 'kill'>,
  fixture: Pick<ProfileLifecycleFixture, 'interrupt'>,
): void {
  if (process.platform === 'win32') {
    writeFileSync(fixture.interrupt, 'interrupt')
    return
  }
  child.kill('SIGTERM')
}

function createEnvironmentProbeProfile(home: string, project: string): void {
  const pluginFile = join(project, 'environment-probe.mjs')
  writeFileSync(pluginFile, [
    "export const name = 'environment-probe'",
    "export const inject = ['llm']",
    'export function apply(ctx) {',
    '  void ctx.loader.await().then(async () => {',
    "    let text = ''",
    '    for await (const chunk of ctx.llm.stream({',
    "      provider: 'deepseek-official',",
    "      model: 'deepseek-v4-flash',",
    '      messages: [],',
    '      maxTokens: 32,',
    '    })) {',
    "      if (chunk.type === 'text-delta') text += chunk.text",
    '    }',
    '    process.stdout.write(`${text}\\n`)',
    "    if (process.platform === 'win32') process.emit('SIGTERM')",
    "    else process.kill(process.pid, 'SIGTERM')",
    '  })',
    '}',
    '',
  ].join('\n'))
  const profileDir = join(home, 'profiles', 'environment-probe')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-environment-probe',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, undefined, 2))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: environment-probe',
    `      name: ${pathToFileURL(pluginFile).href}`,
    '',
  ].join('\n'))
}

interface StartupFixture {
  home: string
  ready: string
  echo: string
  interrupt: string
  /** An always-running row's echo, used to observe that a user patch reload landed. */
  witness: string
}

/**
 * A custom profile whose ordinary provider plugin injects `cmdlineArgs`, plus
 * a row that reads its app-owned service through a `!!js` config expression.
 * Both plugin modules resolve
 * `@deepseek-ai/dsh-cmdline` and `commander` through the profile module
 * fallback, exactly as an installed out-of-tree bundle does.
 */
function createStartupFixture(): StartupFixture {
  const home = mkdtempSync(join(tmpdir(), 'dsh-profile-startup-'))
  const profileDir = join(home, 'profiles', 'startup')
  // Written straight into the installed location: a row module resolves its
  // own imports from where it is installed, and only inside the profile does
  // Node's parent walk reach the installation fallback these plugins need.
  const bundleDir = join(profileDir, 'node_modules', 'dsh-startup-bundle')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'startup.mjs'), [
    "import { Command } from 'commander'",
    "import { parseCmdline } from '@deepseek-ai/dsh-cmdline'",
    "export const name = 'fixture-startup'",
    "export const inject = ['cmdlineArgs']",
    'export function apply(ctx) {',
    "  const program = new Command().name('fixture').option('--generation <value>', 'echoed generation')",
    "  program.action(() => ctx.provide('fixtureStartup', { generation: program.opts().generation }))",
    '  parseCmdline(ctx, program)',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'waiting.mjs'), [
    "import { existsSync, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'startup-fixture'",
    'export function apply(ctx, config = {}) {',
    '  let interrupted = false',
    '  const heartbeat = setInterval(() => {',
    '    if (interrupted || !existsSync(process.env.RAW_INTERRUPT_FILE)) return',
    '    interrupted = true',
    "    process.emit('SIGTERM')",
    '  }, 20)',
    "  writeFileSync(join(process.env.DSH_HOME, 'config-echo'), String(config.generation ?? 'bundle-default'))",
    "  writeFileSync(process.env.RAW_READY_FILE, 'ready')",
    '  ctx.effect(() => () => { clearInterval(heartbeat) })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'witness.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'reload-witness'",
    'export function apply(ctx, config = {}) {',
    "  writeFileSync(join(process.env.DSH_HOME, 'witness'), String(config.generation ?? 'bundle-default'))",
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: startup-fixture',
    `      name: ${pathToFileURL(join(bundleDir, 'waiting.mjs')).href}`,
    '      inject: [fixtureStartup]',
    '      config:',
    // Lazy interpolation runs only after the provider's service is injected.
    "        generation: !!js ctx.fixtureStartup.generation ?? 'bundle-default'",
    '    - id: fixture-startup',
    `      name: ${pathToFileURL(join(bundleDir, 'startup.mjs')).href}`,
    '    - id: reload-witness',
    `      name: ${pathToFileURL(join(bundleDir, 'witness.mjs')).href}`,
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'dsh-startup-bundle',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2))
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-startup',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-startup-bundle'] } },
  }, undefined, 2))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return {
    home,
    ready: join(home, 'ready'),
    echo: join(home, 'config-echo'),
    interrupt: join(home, 'interrupt'),
    witness: join(home, 'witness'),
  }
}

function startStartupProfile(fixture: StartupFixture, args: readonly string[]) {
  return execa(process.execPath, [dshBin, '--profile', 'startup', ...args], {
    cwd: fixture.home,
    input: '',
    reject: false,
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      DSH_HOME: fixture.home,
      RAW_READY_FILE: fixture.ready,
      RAW_INTERRUPT_FILE: fixture.interrupt,
    },
  })
}

describe.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib' && !existsSync(dshBin))('dsh BUILT bin (node lib/bin.js, no tsx)', () => {
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
    expect(help.stdout).toContain('dsh plugin --profile')
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
        DSH_HOME: fixture.home,
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
        plugin: '@deepseek-ai/dsh-tool-subagent',
        scope: 'root',
        config: { toolName: 'subagent', maxDepth: 2, maxSteps: 2 },
      })
      profile.installations.push({
        id: 'claude-code-driver',
        plugin: '@deepseek-ai/dsh-subagent-claude-code',
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
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: parentKey,
        ANTHROPIC_API_KEY: 'built-native-claude-child-key',
        TMP: sandboxTempRoot,
        TEMP: sandboxTempRoot,
        TMPDIR: sandboxTempRoot,
        DSH_NATIVE_PROFILE_OBSERVATION_PATH: undefined,
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
      const evidencePath = process.env.DSH_NATIVE_PROFILE_OBSERVATION_PATH
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
        { id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: 'root',
          config: { toolName: 'subagent', maxDepth: 2, maxSteps: 2, maxTokens: 48,
            provider: 'deepseek', model: childModel, toolFilter: { allow: ['read_file'] } } },
        { id: 'acp-child', plugin: '@deepseek-ai/dsh-acp-child', scope: 'root',
          config: { providerName, providers: {} } },
        { id: 'child-connection-observer', plugin: '@fixture/child-connection-observer', scope: 'root',
          config: { observationPath } },
      )
      installChildConnectionObserver(dirname(profilePath))
      writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')

      profileRun = runBuiltBin(['--profile', 'native-headless', 'complete', 'the', 'requested', 'work'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
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
      const evidencePath = process.env.DSH_NATIVE_PROFILE_OBSERVATION_PATH
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

  it('routes help and usage errors without activating startup-dependent rows', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-app-help-'))
    try {
      const web = await runBuiltBin(['--profile', 'legacy-web', '--from-default-profile', 'web', '--help'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(web.code).toBe(0)
      expect(web.stderr).toBe('')
      expect(web.stdout).toContain('Usage: dsh --profile web')
      expect(web.stdout).toContain('--port <port>')
      expect(web.stdout).not.toContain('dsh web: http://')

      const wildcardHost = await runBuiltBin(['--profile', 'legacy-web', '--host', '0.0.0.0'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(wildcardHost.code).toBe(1)
      expect(wildcardHost.stdout).toBe('')
      expect(wildcardHost.stderr).toContain('--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
      expect(wildcardHost.stderr).not.toContain('dsh web: http://')

      const headlessHelp = await runBuiltBin(['--profile', 'legacy-headless', '--from-default-profile', 'headless', '--help'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(headlessHelp.code).toBe(0)
      expect(headlessHelp.stderr).toBe('')
      expect(headlessHelp.stdout).toContain('Usage: dsh --profile headless')

      const sdkHelp = await runBuiltBin(['--profile', 'legacy-sdk', '--from-default-profile', 'sdk', '--help'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(sdkHelp.code).toBe(0)
      expect(sdkHelp.stderr).toBe('')
      expect(sdkHelp.stdout).toContain('Usage: dsh --profile sdk')

      const acpHelp = await runBuiltBin(['--profile', 'legacy-acp', '--from-default-profile', 'acp', '--help'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(acpHelp.code).toBe(0)
      expect(acpHelp.stderr).toBe('')
      expect(acpHelp.stdout).toContain('Usage: dsh --profile acp')

      const missingTask = await runBuiltBin(['--profile', 'legacy-headless'], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(missingTask.code).toBe(1)
      expect(missingTask.stderr).toContain('a task is required')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 3 + 30_000)

  it('reports SDK startup failure when stdin reaches EOF first', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-built-sdk-startup-failure-'))
    const patch = join(home, 'broken-sdk.cordis.yml')
    writeFileSync(patch, [
      '- insert:',
      '    - id: missing-sdk-startup-plugin',
      '      name: "@deepseek-ai/dsh-missing-sdk-startup-plugin"',
      '',
    ].join('\n'))
    try {
      const result = await runBuiltBin(['--profile', 'legacy-sdk', '--from-default-profile', 'sdk', '--patch', patch], {
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'built-sdk-startup-failure-no-call',
      }, home)
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('plugin tree failed to load')
      expect(result.stderr).toContain('@deepseek-ai/dsh-missing-sdk-startup-plugin')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('serves the SDK protocol with an absolute-path overlay plugin and exits after shutdown', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-built-sdk-'))
    const pluginPath = join(home, 'plugin #100%.mjs')
    const marker = join(home, 'plugin-loaded')
    writeFileSync(pluginPath, [
      "import { writeFileSync } from 'node:fs'",
      'export function apply(ctx, config) { writeFileSync(config.marker, "loaded") }',
      '',
    ].join('\n'))
    const patch = join(home, 'absolute.patch.yml')
    writeFileSync(patch, JSON.stringify([{ insert: [
      { id: 'absolute-plugin', name: pluginPath, config: { marker } },
    ] }]))
    const child = execa(process.execPath, [dshBin, '--profile', 'legacy-sdk', '--from-default-profile', 'sdk', '--patch', patch], {
      cwd: home,
      reject: false,
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'built-sdk-profile-no-call',
      },
      extendEnv: false,
    })
    const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]()
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const response = async (id: number): Promise<Record<string, unknown>> => {
      for (;;) {
        const line = await stdoutLines.next()
        if (line.done) throw new Error(`SDK profile stdout closed before response ${String(id)}; stderr=${stderr}`)
        let value: Record<string, unknown>
        try {
          value = JSON.parse(line.value) as Record<string, unknown>
        } catch {
          throw new Error(`SDK profile wrote non-JSON stdout: ${line.value}`)
        }
        if (value.id === id) return value
      }
    }
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { cwd: home, provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      })}\n`)
      const initialized = await response(1)
      expect(initialized, `${JSON.stringify(initialized)}\n${stderr}`).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown' })}\n`)
      expect(await response(2)).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
      const result = await child
      expect(result.timedOut, stderr).toBe(false)
      expect(result.signal, stderr).toBeUndefined()
      expect(result.exitCode, stderr).toBe(0)
      expect(stderr).toBe('')
      expect(readFileSync(marker, 'utf8')).toBe('loaded')
    } finally {
      child.kill('SIGKILL')
      await child
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('runs a mock-backed ACP turn through the acp profile and exits on disconnect', async () => {
    const apiKey = 'built-acp-profile-key'
    const server = await startMockLlmServer({
      sequence: ['success'],
      apiKey,
      successText: 'ACP BUILT PROFILE OK',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-built-acp-'))
    const child = execa(process.execPath, [dshBin, '--profile', 'legacy-acp', '--from-default-profile', 'acp'], {
      cwd: home,
      reject: false,
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: server.baseURL,
        DSH_PERMISSION_MODE: 'danger-full-access',
      },
      extendEnv: false,
    })
    const rawOut: string[] = []
    const passthrough = new Readable({ read() {} })
    child.stdout.on('data', (chunk: Buffer) => {
      rawOut.push(chunk.toString('utf8'))
      passthrough.push(chunk)
    })
    child.stdout.on('end', () => { passthrough.push(null) })
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(passthrough) as ReadableStream<Uint8Array>,
    )
    const updates: SessionNotification['update'][] = []
    const clientApp = createAcpClientApp({ name: 'dsh-built-acp-profile' })
      .onNotification(methods.client.session.update, ({ params }) => {
        updates.push(params.update)
        return Promise.resolve()
      })
      .onRequest(methods.client.session.requestPermission, () => {
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      })
    const client = clientApp.connect(stream).agent
    try {
      const initialized = await client.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      expect(initialized.agentInfo).toMatchObject({ name: 'deepseek-harness-acp' })
      expect(initialized.agentCapabilities).toEqual({
        mcpCapabilities: { http: true },
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      })
      expect('_meta' in initialized).toBe(false)
      const session = await client.request(methods.agent.session.new, { cwd: home, mcpServers: [] })
      expect(session.sessionId).toBeTruthy()
      expect(await client.request(methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'reply from the built ACP profile' }],
      })).toEqual({ stopReason: 'end_turn' })
      expect(updates).toContainEqual(expect.objectContaining({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'ACP BUILT PROFILE OK' },
      }))
      const message = updates.find(update => update.sessionUpdate === 'agent_message_chunk')
      expect(message !== undefined && 'messageId' in message && typeof message.messageId === 'string').toBe(true)
      expect(server.requests).toHaveLength(1)
      child.stdin.end()
      const result = await child
      expect(result.exitCode, `signal=${String(result.signal)}; stderr=${result.stderr}`).toBe(0)
      expect(result.stderr).toBe('')
      for (const line of rawOut.join('').split('\n').filter(value => value.trim() !== '')) {
        expect(() => JSON.parse(line) as unknown).not.toThrow()
      }
    } finally {
      child.kill('SIGKILL')
      await child
      await server.close()
      rmSync(home, { recursive: true, force: true })
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
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: '1',
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
      expect(loaded.requests.get('session-query')?.plugin.name).toBe('@deepseek-ai/dsh-session-query-sqlite')
      expect(loaded.requests.get('tool-session-query')?.plugin.name).toBe('@deepseek-ai/dsh-tool-session-query')

      profile.installations.push({ id: 'session-query-exact', plugin: '@deepseek-ai/dsh-session-query', scope: 'root' })
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
      await expect(loadNativeProfile(options)).rejects.toThrow(/duplicate provider for sessionQuery/)
      profile.installations.pop()
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)

      const result = await runBuiltBin(
        ['--profile', 'native-headless-query', 'search', 'prior', 'session', 'history'],
        {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
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
    symlinkSync(dshBin, installedBin)
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

  it('fails loud on a nonexistent profile with the plugin-command hint', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-missing-profile-'))
    try {
      const result = await runBuiltBin(['--profile', 'nope'], { DSH_HOME: home })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('profile "nope" does not exist')
      expect(result.stderr).toContain('dsh plugin --profile nope add')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('creates a custom profile from the shipped web template before booting it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-from-default-profile-'))
    try {
      const created = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--help'],
        { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      )
      expect(created.code).toBe(0)
      expect(created.stderr).toBe('')
      expect(created.stdout).toContain('Usage: dsh --profile web')

      const dir = join(home, 'profiles', 'rescue')
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { runtime: 'legacy'; bundles: string[]; patchReload: string } }
      }
      expect(manifest.dependencies).toEqual({})
      expect(manifest.dsh.profile).toEqual({
        runtime: 'legacy',
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
        patchReload: 'live',
      })
      expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('[]')
      expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('nodeLinker: hoisted')

      const repeated = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--help'],
        { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      )
      expect(repeated.code).toBe(1)
      expect(repeated.stdout).toBe('')
      expect(repeated.stderr).toContain('profile "rescue" already exists')
      expect(repeated.stderr).toContain('omit --from-default-profile to use it')

      const reopened = await runBuiltBin(
        ['--profile', 'rescue', '--help'],
        { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      )
      expect(reopened.code).toBe(0)
      expect(reopened.stderr).toBe('')
      expect(reopened.stdout).toContain('Usage: dsh --profile web')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 3 + 30_000)

  it('keeps a newly created profile when application boot rejects its arguments', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-from-default-profile-failed-boot-'))
    try {
      const failed = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--port', 'not-a-number'],
        { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      )
      expect(failed.code).toBe(1)
      expect(failed.stderr).toContain('--port must be a number')
      expect(existsSync(join(home, 'profiles', 'rescue', 'package.json'))).toBe(true)

      const retried = await runBuiltBin(
        ['--profile', 'rescue', '--help'],
        { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      )
      expect(retried.code).toBe(0)
      expect(retried.stderr).toBe('')
      expect(retried.stdout).toContain('Usage: dsh --profile web')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2 + 30_000)

  it('uses the launching endpoint and managed credential through the published entry', async () => {
    const apiKey = 'built-home-layer-key'
    const server = await startMockLlmServer({
      sequence: ['success'],
      apiKey,
      successText: 'launching endpoint reached the mock',
    })
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-environment-'))
    const project = mkdtempSync(join(tmpdir(), 'dsh-home-project-'))
    writeFileSync(join(home, '.credentials.yaml'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${apiKey}\n`, { mode: 0o600 })
    createEnvironmentProbeProfile(home, project)
    try {
      const result = await runBuiltBin(
        ['--profile', 'environment-probe'],
        {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: undefined,
          DEEPSEEK_BASE_URL: server.baseURL,
        },
        project,
      )
      expect(
        result.code,
        `${result.stderr}\nstdout:\n${result.stdout}\nmock requests: ${String(server.requests.length)}`,
      ).toBe(0)
      expect(result.stdout).toBe('launching endpoint reached the mock')
      expect(result.stdout).not.toContain(apiKey)
      expect(result.stderr).not.toContain(apiKey)
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]?.path).toBe('/chat/completions')
      expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${apiKey}`)
      expect(JSON.stringify(server.requests[0]?.body)).not.toContain(apiKey)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('reports a patch-overlay boot failure without hanging', async () => {
    // The HMR main watcher's initial scan once refreshed the include
    // mid-initial-apply, deadlocking the failing apply's rollback against the
    // refresh drain: dsh exited 13 with no diagnostic instead of settling
    // ([rsh/Core/vendor/README.md](../../../Core/vendor/README.md)).
    const home = mkdtempSync(join(tmpdir(), 'dsh-invalid-patch-'))
    try {
      const result = await runBuiltBin(['--profile', 'web', '--patch', invalidProvider], {
        DSH_HOME: home,
        DEEPSEEK_API_KEY: 'keyless-invalid-config',
        DSH_TELEMETRY_DISABLED: '1',
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('llm-pi-ai')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('lets a profile without a parser ignore app arguments and dispose on a startup-time signal', async () => {
    const fixture = createProfileLifecycleFixture()
    const child = startProfileLifecycle(fixture, ['--unclaimed'])
    try {
      await waitForFile(fixture.ready)
      requestProfileShutdown(child, fixture)
      const result = await child
      expect(result.exitCode, `${result.stderr}\nstdout:\n${result.stdout}\nsignal: ${String(result.signal)}`).toBe(0)
      expect(result.signal).toBeUndefined()
      expect(existsSync(fixture.disposed)).toBe(true)
    } finally {
      child.kill('SIGKILL')
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('fully settles a custom profile, hot-reloads its patch layer with removal reverting, and disposes on a signal', async () => {
    const fixture = createProfileLifecycleFixture()
    const child = startProfileLifecycle(fixture)
    const profilePatch = join(fixture.home, 'profiles', 'lifecycle', 'cordis.patch.yml')
    const configFile = join(fixture.home, 'config-echo')
    try {
      await waitForFile(fixture.settled)
      // The live profile layer: even without an hmr row in the composition,
      // the launcher mounts a config-only watcher, so an edited
      // cordis.patch.yml lands in the running tree (the reload disposes the
      // patched row's old fiber — observable as the disposed marker — and
      // mounts the new config, which echoes its generation and re-writes the
      // ready marker).
      rmSync(fixture.ready)
      writeFileSync(profilePatch, [
        '- id: profile-lifecycle-fixture',
        '  config:',
        '    generation: 2',
        '',
      ].join('\n'))
      await waitForFile(fixture.ready)
      expect(readFileSync(configFile, 'utf8')).toBe('2')
      // Unlink exercises layer removal without racing Chokidar's change-event
      // suppression window after the preceding edit. The bundle default must return.
      rmSync(fixture.ready)
      rmSync(profilePatch)
      await waitForFile(fixture.ready)
      expect(existsSync(profilePatch)).toBe(false)
      expect(readFileSync(configFile, 'utf8')).toBe('bundle-default')
      // The home-level user layer ($DSH_HOME/cordis.patch.yml) is live too
      // and outranks the per-profile layer.
      rmSync(fixture.ready)
      writeFileSync(join(fixture.home, 'cordis.patch.yml'), [
        '- id: profile-lifecycle-fixture',
        '  config:',
        '    generation: home',
        '',
      ].join('\n'))
      await waitForFile(fixture.ready)
      expect(readFileSync(configFile, 'utf8')).toBe('home')
      requestProfileShutdown(child, fixture)
      const result = await child
      expect(result.exitCode, `${result.stderr}\nstdout:\n${result.stdout}\nsignal: ${String(result.signal)}`).toBe(0)
      expect(result.signal).toBeUndefined()
      expect(existsSync(fixture.disposed)).toBe(true)
    } finally {
      child.kill('SIGKILL')
      await child
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('hands the app arguments to the profile, which applies them before its rows start', async () => {
    const fixture = createStartupFixture()
    const child = startStartupProfile(fixture, ['--generation', 'flagged'])
    try {
      await waitForFile(fixture.ready)
      // The consumer started once, already carrying the flag value: the
      // launcher never saw --generation, and the app provider resolved it first.
      expect(readFileSync(fixture.echo, 'utf8')).toBe('flagged')
      requestProfileShutdown(child, fixture)
      expect((await child).exitCode).toBe(0)
    } finally {
      child.kill('SIGKILL')
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('starts a consumer on its composed value when the invocation carries no app arguments', async () => {
    const fixture = createStartupFixture()
    const child = startStartupProfile(fixture, [])
    try {
      await waitForFile(fixture.ready)
      expect(readFileSync(fixture.echo, 'utf8')).toBe('bundle-default')
      requestProfileShutdown(child, fixture)
      expect((await child).exitCode).toBe(0)
    } finally {
      child.kill('SIGKILL')
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('keeps the app arguments across a user patch reload', async () => {
    // A live edit recomposes every row while the provider service remains
    // active, so each config expression reads the same invocation value (a
    // served port does not move back to its composed fallback).
    const fixture = createStartupFixture()
    const profilePatch = join(fixture.home, 'profiles', 'startup', 'cordis.patch.yml')
    const child = startStartupProfile(fixture, ['--generation', 'flagged'])
    try {
      // Both rows: the waiting one carries the flag value, and the witness is
      // what a reload will re-mount. They start independently, so neither
      // marker implies the other.
      await waitForFile(fixture.ready)
      await waitForFile(fixture.witness)
      expect(readFileSync(fixture.echo, 'utf8')).toBe('flagged')
      // An edit to an unrelated row: the witness re-mounts, which is how this
      // test knows the whole tree was recomposed.
      rmSync(fixture.witness)
      writeFileSync(profilePatch, [
        '- id: reload-witness',
        '  config:',
        '    generation: reloaded',
        '',
      ].join('\n'))
      await waitForFile(fixture.witness)
      expect(readFileSync(fixture.witness, 'utf8')).toBe('reloaded')
      expect(readFileSync(fixture.echo, 'utf8')).toBe('flagged')
      requestProfileShutdown(child, fixture)
      expect((await child).exitCode).toBe(0)
    } finally {
      child.kill('SIGKILL')
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it("prints the app's own help, starts none of its rows, and exits", async () => {
    const fixture = createStartupFixture()
    try {
      const result = await startStartupProfile(fixture, ['--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: fixture')
      expect(result.stdout).toContain('--generation')
      expect(existsSync(fixture.ready)).toBe(false)
    } finally {
      rmSync(fixture.home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS + 30_000)

  it('anchors a relative add spec to the invoking directory, not the profile', async () => {
    // `dsh plugin --profile x add .` from a plugin checkout must install THAT
    // checkout — pnpm's cwd is the profile directory, so an un-anchored `.`
    // would self-link the profile.
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-anchor-'))
    const checkout = mkdtempSync(join(tmpdir(), 'dsh-plugin-checkout-'))
    try {
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({
        name: 'anchored-bundle',
        version: '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      writeFileSync(join(checkout, 'cordis.patch.yml'), '[]\n')
      const result = await execa(process.execPath, [dshBin, 'plugin', '--profile', 'anchor', 'add', '.'], {
        cwd: checkout,
        input: '',
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        reject: false,
        env: { DSH_HOME: home },
      })
      expect(result.exitCode).toBe(0)
      const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'anchor', 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      expect(Object.keys(manifest.dependencies)).toEqual(['anchored-bundle'])
      expect(manifest.dsh.profile.bundles).toContain('anchored-bundle')

      const removed = await runBuiltBin(
        ['plugin', '--profile', 'anchor', 'remove', 'anchored-bundle'],
        { DSH_HOME: home },
        checkout,
      )
      expect(removed.code).toBe(0)
      const afterRemove = JSON.parse(
        readFileSync(join(home, 'profiles', 'anchor', 'package.json'), 'utf8'),
      ) as {
        dependencies?: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      expect(Object.keys(afterRemove.dependencies ?? {})).toEqual([])
      expect(afterRemove.dsh.profile.bundles).not.toContain('anchored-bundle')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(checkout, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2 + 30_000)

  it('activates a dependency that gained dsh.bundle in a later update', async () => {
    // Reconcile runs against the INSTALLED state on every successful pnpm
    // run, so `update` (not only `add`) activates a package whose newer
    // version declares dsh.bundle. Simulated without a registry: hand-place
    // the installed package, flip its manifest, and run a benign pnpm verb.
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-update-'))
    try {
      const profileDir = join(home, 'profiles', 'up')
      const installed = join(profileDir, 'node_modules', 'late-bundle')
      mkdirSync(installed, { recursive: true })
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: 'dsh-profile-up',
        private: true,
        dependencies: { 'late-bundle': 'file:./late-bundle' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      }))
      writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
      // v1: no dsh manifest — a plain dependency.
      writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'late-bundle', version: '1.0.0' }))
      const first = await runBuiltBin(['plugin', '--profile', 'up', 'root'], { DSH_HOME: home })
      expect(first.code).toBe(0)
      let manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
      expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
      // v2: the installed package now declares dsh.bundle (an update landed).
      writeFileSync(join(installed, 'package.json'), JSON.stringify({
        name: 'late-bundle', version: '2.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      writeFileSync(join(installed, 'cordis.patch.yml'), '[]\n')
      const second = await runBuiltBin(['plugin', '--profile', 'up', 'root'], { DSH_HOME: home })
      expect(second.code).toBe(0)
      manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
      expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'late-bundle'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, SPAWN_TIMEOUT_MS * 2 + 30_000)

  describe('config dump', () => {
    let home: string
    beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'dsh-dump-bin-')) })
    afterEach(() => { rmSync(home, { recursive: true, force: true }) })

    it('rejects bundle-default dumps for a native standard profile', async () => {
      const { stdout, code, stderr } = await runBuiltBin(['--profile', 'web', '--dump-default-config'], { DSH_HOME: home })
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('native profile has no bundle default to dump')
      expect(JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')))
        .toMatchObject({ dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } })
      expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
      const noCordisHook = pathToFileURL(fileURLToPath(new URL('./fixtures/deny-cordis-import.mjs', import.meta.url))).href
      const plugin = await runBuiltBin(['plugin', '--profile', 'web', 'add', 'unused'], {
        DSH_HOME: home, NODE_OPTIONS: `--import=${noCordisHook}`,
      })
      expect(plugin.code).toBe(1)
      expect(plugin.stderr).toContain('dsh plugin does not manage native profile web')
      expect(plugin.stderr).toContain('edit its rsh.profile.json installations instead')
      expect(plugin.stderr).toContain('rsh/Docs/native-config-migration.md')
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('prints bundle defaults for an existing legacy standard profile', async () => {
      const profileDir = join(home, 'profiles', 'web')
      mkdirSync(profileDir, { recursive: true })
      const template = PROFILE_TEMPLATES.web!
      initProfile(profileDir, template.bundles, template.patchReload)

      const { stdout, code, stderr } = await runBuiltBin(['--profile', 'web', '--dump-default-config'], { DSH_HOME: home })
      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(stdout).toContain('# == @deepseek-ai/dsh-web-app')
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('creates a custom profile from a shipped template before printing it', async () => {
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'web', '--dump-default-config'],
        { DSH_HOME: home },
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(stdout).toContain('# == @deepseek-ai/dsh-web-app')
      expect(existsSync(join(home, 'profiles', 'rescue', 'package.json'))).toBe(true)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('rejects an unknown source before creating the target profile', async () => {
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'rescue', '--from-default-profile', 'unknown', '--dump-default-config'],
        { DSH_HOME: home },
      )
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr).toContain('unknown default profile "unknown"')
      expect(stderr).toContain('"web"')
      expect(existsSync(join(home, 'profiles', 'rescue'))).toBe(false)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('prints the headless profile without Host or browser layers', async () => {
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'legacy-headless', '--from-default-profile', 'headless', '--dump-default-config'],
        { DSH_HOME: home },
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
      expect(stdout).toContain("name: '@deepseek-ai/dsh-headless'")
      expect(stdout).not.toMatch(/name: '@deepseek-ai\/dsh-host-/)
      expect(stdout).not.toContain("name: '@deepseek-ai/dsh-web-app'")
      expect(stdout).not.toMatch(/name: '@deepseek-ai\/dsh-client-/)
    }, SPAWN_TIMEOUT_MS + 30_000)

    it('prints the exact standalone sdk-minimal tree without dsh-base', async () => {
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'sdk-minimal', '--dump-default-config'],
        { DSH_HOME: home },
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
      const rows = yaml.load(stdout, { schema: entryListSchema }) as Array<{ id?: string; name?: string }>
      expect(rows.map(row => [row.id, row.name])).toEqual([
        ['sdk-app-startup', '@deepseek-ai/dsh-sdk-app'],
        ['sdk-jsonrpc-server', '@deepseek-ai/dsh-sdk-jsonrpc-server'],
        ['deepseek-llm-api-extensions', '@deepseek-ai/dsh-deepseek-llm-api-extensions'],
        ['session-log-deepseek', '@deepseek-ai/dsh-session-log-deepseek'],
        ['plugin-package-inventory-deepseek', '@deepseek-ai/dsh-plugin-package-inventory-deepseek'],
        ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek'],
        ['sandbox', '@deepseek-ai/dsh-sandbox-local'],
        ['session-projection', '@deepseek-ai/dsh-session-projection'],
        ['sandbox-policy', '@deepseek-ai/dsh-sandbox-policy'],
        ['subprocess', '@deepseek-ai/dsh-subprocess-local'],
        ['pty', '@deepseek-ai/dsh-terminal'],
        ['terminal-bash', '@deepseek-ai/dsh-terminal-bash'],
        ['terminal-pwsh', '@deepseek-ai/dsh-terminal-bash'],
        ['timer', '@deepseek-ai/cordis-plugin-timer'],
        ['llm', '@deepseek-ai/dsh-llm'],
        ['session', '@deepseek-ai/dsh-session'],
        ['session-title', '@deepseek-ai/dsh-session-title'],
        ['system-prompt', '@deepseek-ai/dsh-system-prompt'],
        ['tools', '@deepseek-ai/dsh-tools'],
        ['agent', '@deepseek-ai/dsh-agent'],
        ['llm-retry', '@deepseek-ai/dsh-llm-retry'],
        ['jobs', '@deepseek-ai/dsh-jobs-local'],
        ['invariants', '@deepseek-ai/dsh-invariants'],
        ['session-invariant', '@deepseek-ai/dsh-session/invariant'],
        ['agent-invariant', '@deepseek-ai/dsh-agent/invariant'],
        ['scope-invariant', '@deepseek-ai/dsh-scope/invariant'],
        ['agent-loop-invariant', '@deepseek-ai/dsh-agent-loop/invariant'],
        ['agent-loop', '@deepseek-ai/dsh-agent-loop'],
        ['persistent-bash', '@deepseek-ai/dsh-tool-bash-persistent'],
        ['persistent-pwsh', '@deepseek-ai/dsh-tool-pwsh-persistent'],
        ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl'],
      ])
      expect(stdout).toContain('# == @deepseek-ai/dsh-sdk-minimal')
      expect(stdout).not.toContain('@deepseek-ai/dsh-base')
      expect(stdout).not.toContain('@deepseek-ai/dsh-web-app')
    }, SPAWN_TIMEOUT_MS * 2 + 30_000)

    it('composes the profile user layer and a --patch overlay in order', async () => {
      // Create a legacy custom profile first, then write its user layer.
      const init = await runBuiltBin(['--profile', 'legacy-web', '--from-default-profile', 'web', '--dump-default-config'], { DSH_HOME: home })
      expect(init.code).toBe(0)
      const profilePatch = join(home, 'profiles', 'legacy-web', 'cordis.patch.yml')
      writeFileSync(profilePatch, [
        '- id: agent-loop',
        '  config:',
        '    agents:',
        '      - id: personal',
        '        provider: personal-provider',
        '        model: personal-model',
        '- id: absent-row',
        '  config:',
        '    x: 1',
        '',
      ].join('\n'))
      const overlay = join(home, 'overlay.cordis.yml')
      writeFileSync(overlay, [
        '- id: agent-loop',
        '  config:',
        '    agents:',
        '      - id: configured',
        '        provider: configured-provider',
        '        model: configured-model',
        '',
      ].join('\n'))
      const { stdout, code, stderr } = await runBuiltBin(
        ['--profile', 'legacy-web', '--patch', overlay, '--dump-config'],
        { DSH_HOME: home },
      )
      expect(code).toBe(0)
      expect(stdout).toContain('provider: configured-provider')
      expect(stdout).not.toContain('personal-provider')
      // Both layers patched the row; the comment lists them in application order.
      expect(stdout).toContain(`patched by ${profilePatch}, ${overlay}`)
      expect(stderr).toContain('patch: entry "absent-row" not found')
    }, SPAWN_TIMEOUT_MS * 2 + 30_000)
  })
})
