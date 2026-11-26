/**
 * Boot the shipped `native-web` composition for one browser e2e scenario.
 *
 * A Native scenario needs the same four things every time: an isolated Harness
 * home whose profile keeps only the rows the scenario exercises, a seeded
 * Session written through the real JSONL backend, workspace package links so
 * the profile resolves from source, and a live Host that announces its URL.
 * The Cordis scaffold in `scaffold.ts` supplies the equivalent surface through
 * an in-process Loader; this one owns the subprocess the Native profiles boot.
 */
import { randomUUID } from 'node:crypto'
import { globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { chromium, type Browser, type Page } from 'playwright'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { generationLogPath } from '../../../../Engine/session/session-persistence-jsonl/src/format.ts'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@redspark/rsh-session/native'
import { ensureShippedNativeProfile,
  shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'
import { parseSeedFixture, realizeSeedText } from './scaffold.ts'

/** One installation row of a shipped Native composition. */
export type NativeInstallation = ReturnType<typeof shippedNativeProfileComposition>['installations'][number]

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/** Seeded Session material written before the Host starts. */
export interface NativeSeedOptions {
  /** `session.vN.jsonl` fixture path to copy into the Session root. */
  readonly fixture?: string
  /** Fixture text, used when a scenario synthesizes its recording. */
  readonly text?: string
  /** Session id the browser lists; also the fixture's rewritten owner. */
  readonly seedId: string
  /** Prompt the Host profile composes; resume rejects a stored prompt that differs. */
  readonly systemPrompt?: string
  /** Agent preset recorded in the Session header. */
  readonly agentPreset?: string
  /** Header creation time; fixes timestamps that a golden would otherwise carry. */
  readonly createdAt?: number
}

/** Options for {@link launchNativeWeb}. */
export interface NativeWebOptions {
  /** Installation ids to keep from the shipped `native-web` composition. */
  readonly keep?: readonly string[]
  /** Installation ids to drop from the shipped `native-web` composition. */
  readonly drop?: readonly string[]
  /** Rewrite or drop one kept installation row; returning `undefined` drops it. */
  readonly configure?: (row: NativeInstallation) => NativeInstallation | readonly NativeInstallation[] | undefined
  /** Extra host installations appended after the kept rows. */
  readonly extraInstallations?: readonly NativeInstallation[]
  /**
   * Install the deterministic catalog model that refuses every stream call.
   * Scenarios that finish from a seeded Session need it for assembly; a
   * scenario with recorded model turns supplies its own `model` row instead.
   */
  readonly silentModel?: boolean
  /**
   * Replay one recorded model script instead of the silent catalog model.
   * `file` is a `session.vN.jsonl` recording; `providers` is the catalog the
   * composer shows. The wrapper publishes both `model` and `modelDirectory`
   * because the shipped `model-selection` row requires the pair.
   */
  readonly replay?: {
    readonly file: string
    /** Replay override document, for scripts that need hang sidecars or path tokens. */
    readonly overrideFile?: string
    readonly paceMs?: number
    readonly providers?: readonly {
      readonly id: string
      readonly models: readonly { readonly id: string }[]
      /** Provider-owned retry policy, as the replay adapter's own config accepts it. */
      readonly retryPolicy?: import('@redspark/rsh-llm').RetryPolicyConfig
    }[]
  }
  /** Write package directories (and their links) before boot. */
  readonly prepareProfile?: (profileDir: string) => void
  /** Seed one Session through the real JSONL backend before boot. */
  readonly seed?: NativeSeedOptions
  /** Seed several Sessions, for scenarios that read a populated sidebar. */
  readonly seeds?: readonly NativeSeedOptions[]
  /**
   * Write one released V2 predecessor generation before boot, so a scenario can
   * observe the Host's adjacent migration on first open.
   */
  readonly predecessor?: NativePredecessorOptions
  /**
   * Prompt the profile's `session-controller` row composes. Resume rejects a
   * seeded System message that differs, so the seed rewrite uses the same value.
   */
  readonly systemPrompt?: string
  /** Environment variables layered over the scrubbed process environment. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Credential references written to the fixture home's credentials document
   * before boot. Values the host reads through the credentials seam, such as a
   * search provider key, cannot arrive through `env`, which drops secret-named
   * variables.
   */
  readonly credentials?: Readonly<Record<string, string>>
  /** Fixed `Date.now()` for the Host process. */
  readonly clockMs?: number
  /** Files created inside the workspace before boot, keyed by relative path. */
  readonly workspaceFiles?: Readonly<Record<string, string>>
  /** Page viewport and locale; the defaults match the other browser scenarios. */
  readonly page?: { readonly width?: number; readonly height?: number; readonly locale?: string; readonly timezoneId?: string }
  /** Dismiss first-run onboarding after boot; defaults on. */
  readonly onboard?: boolean
}

/** Released-generation material written before the Host starts. */
export interface NativePredecessorOptions {
  /** `session.v2.jsonl` fixture path to copy into the Session root. */
  readonly fixture: string
  /** Session id the browser lists; also the fixture's rewritten owner. */
  readonly seedId: string
  /** Rewrite the realized fixture text before it is written, for variants of one recording. */
  readonly transform?: (text: string) => string
}

/** A booted Native Web composition with one open browser page. */
export interface NativeWebScaffold {
  /** Isolated Harness home (`$RSH_HOME`). */
  readonly home: string
  /** Profile directory the Host booted. */
  readonly profileDir: string
  /** Workspace the Session and tools run in. */
  readonly workspaceCwd: string
  /** Durable Session root. */
  readonly sessionRoot: string
  /** Announced Host URL, already authenticated for loopback use. */
  readonly url: string
  /** Browser page opened on {@link url}. */
  readonly page: Page
  /** Owning browser, closed by {@link close}. */
  readonly browser: Browser
  /** Page errors observed since navigation. */
  readonly pageErrors: string[]
  /**
   * Call one Host RPC endpoint with the page's authenticated session.
   * @param endpoint - Host endpoint such as `session/list`.
   * @param payload - endpoint payload; `{}` when the endpoint reads none.
   * @returns the decoded result envelope.
   */
  rpc<T>(endpoint: string, payload?: unknown): Promise<RpcResult<T>>
  /** Stop the Host, close the browser, and remove the temp home. */
  close(): Promise<void>
}

/** Connection RPC result envelope carried by the Host transport. */
export type RpcResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

interface AnnouncedProcess {
  readonly stdout?: NodeJS.ReadableStream | null
}

function isInstallationRows(value: NativeInstallation | readonly NativeInstallation[]): value is readonly NativeInstallation[] {
  return Array.isArray(value)
}

async function writeSeed(seedId: string, options: NativeSeedOptions,
  workspace: string, sessionRoot: string, home: string): Promise<void> {
  if ((options.fixture === undefined) === (options.text === undefined)) {
    throw new Error('native web seed requires exactly one of fixture or text')
  }
  const raw = options.text ?? readFileSync(options.fixture!, 'utf8')
  const source = realizeSeedText(raw, seedId, workspace, home)
  const prompt = options.systemPrompt ?? 'Answer the user.'
  const events = parseSeedFixture(source.split('{{system}}').join(prompt)).events.map((event) => {
    if (event.type !== 'system/message') return event
    const content = event.data.message.content
    const first = content[0]
    if (first?.type !== 'text') return event
    return {
      ...event,
      data: {
        ...event.data,
        message: { ...event.data.message, content: [{ ...first, text: prompt }, ...content.slice(1)] },
      },
    }
  })
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(seedId),
    createdAt: options.createdAt ?? Date.UTC(2025, 0, 1),
    isSeeded: false,
    cwd: workspace,
    delegationDepth: 0,
    ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
  }
  const backend = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
  const handle = await backend.create(header)
  await handle.append(events)
  await handle.close()
}

/**
 * Boot `native-web` with the selected rows and open one browser page.
 * @param options - row selection, seed material, and browser facts.
 * @returns the running scaffold; callers must `close()` it.
 */
export async function launchNativeWeb(options: NativeWebOptions = {}): Promise<NativeWebScaffold> {
  const home = mkdtempSync(join(tmpdir(), 'rsh-native-web-'))
  const profileDir = join(home, 'profiles/native-web')
  // Goldens replace the workspace basename with `{{workspace}}`, so the name
  // must not occur inside ordinary copy such as `workspace-write`.
  const workspaceCwd = join(home, 'proj')
  const sessionRoot = join(home, 'sessions')
  mkdirSync(workspaceCwd)
  mkdirSync(sessionRoot)
  if (options.credentials !== undefined) {
    writeFileSync(credentialsDocumentPath(home),
      `version: 1\nrefs:\n${Object.entries(options.credentials).map(([ref, value]) => `  ${ref}: ${JSON.stringify(value)}\n`).join('')}`,
      { mode: 0o600 })
  }
  for (const [path, content] of Object.entries(options.workspaceFiles ?? {})) {
    const target = join(workspaceCwd, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  ensureShippedNativeProfile('native-web', home)
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const systemPrompt = options.systemPrompt ?? 'Answer the user.'
  const keep = new Set(options.keep ?? [])
  const drop = new Set(options.drop ?? [])
  const rows: NativeInstallation[] = []
  for (const row of shipped.installations) {
    if (drop.has(row.id)) continue
    if (keep.size > 0 && !keep.has(row.id)) continue
    const configured = options.configure?.(withHarnessPaths(row, {
      home, workspaceCwd, sessionRoot, systemPrompt,
    })) ?? withHarnessPaths(row, { home, workspaceCwd, sessionRoot, systemPrompt })
    if (configured === undefined) continue
    if (isInstallationRows(configured)) rows.push(...configured)
    else rows.push(configured)
  }
  rows.push(...options.extraInstallations ?? [])
  if (options.replay !== undefined) {
    if (rows.some(row => row.id === 'model')) throw new Error('native web replay owns the model row')
    rows.push({
      id: 'model',
      plugin: 'native-web-replay',
      scope: 'root',
      config: {
        file: options.replay.file,
        ...options.replay.overrideFile === undefined ? {} : { overrideFile: options.replay.overrideFile },
        ...options.replay.paceMs === undefined ? {} : { paceMs: options.replay.paceMs },
        ...options.replay.providers === undefined ? {} : { providers: options.replay.providers },
      },
    })
    writeReplayModel(profileDir)
  } else if (options.silentModel !== false && !rows.some(row => row.id === 'model')) {
    rows.push({ id: 'model', plugin: 'native-silent-model', scope: 'root' })
    writeSilentModel(profileDir, !rows.some(row => row.plugin === '@redspark/rsh-agent-preset-standing' && row.scope === 'standard'))
  }
  const clientRows = JSON.parse(readFileSync(join(profileDir, 'rsh.client.json'), 'utf8')) as {
    installations: { plugin: string }[]
  }
  const packages = new Map(globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: REPO_ROOT }).map((path) => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as { name: string }
    return [manifest.name, dirname(join(REPO_ROOT, path))] as const
  }))
  const links: string[] = []
  for (const name of new Set([...rows, ...clientRows.installations].map(row => row.plugin))) {
    if (name === 'native-silent-model' || name === 'native-web-replay') continue
    const target = packages.get(name)
    if (target === undefined) throw new Error(`missing workspace package: ${name}`)
    const link = join(profileDir, 'node_modules', name)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    links.push(link)
  }
  options.prepareProfile?.(profileDir)
  writeFileSync(join(profileDir, 'rsh.profile.json'), JSON.stringify({ ...shipped, installations: rows }))
  if (options.seed !== undefined) {
    await writeSeed(options.seed.seedId, { ...options.seed, systemPrompt: options.seed.systemPrompt ?? systemPrompt },
      workspaceCwd, sessionRoot, home)
  }
  for (const seed of options.seeds ?? []) {
    await writeSeed(seed.seedId, { ...seed, systemPrompt: seed.systemPrompt ?? systemPrompt },
      workspaceCwd, sessionRoot, home)
  }
  if (options.predecessor !== undefined) {
    const { fixture, seedId } = options.predecessor
    const realized = realizeSeedText(readFileSync(fixture, 'utf8'), seedId, workspaceCwd, home)
    const path = generationLogPath(sessionRoot, workspaceCwd, SessionId(seedId), 2, 'none')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, options.predecessor.transform?.(realized) ?? realized)
  }
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries({ ...process.env, ...options.env })
      .filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name))),
    RSH_HOME: home,
  }
  const args = [
    ...options.clockMs === undefined
      ? []
      : ['--import', pathToFileURL(writeClock(home, options.clockMs)).href],
    join(REPO_ROOT, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web',
  ]
  const child = execa(process.execPath, args, { cwd: REPO_ROOT, env, reject: false })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    if (process.env.RSH_NATIVE_HOST_STDERR !== undefined) process.stderr.write(chunk)
  })
  let browser: Browser | undefined
  try {
    const url = await announcedUrl(child, () => stderr)
    browser = await chromium.launch()
    const page = await browser.newPage({
      locale: options.page?.locale ?? 'en-US',
      timezoneId: options.page?.timezoneId ?? 'UTC',
      viewport: { width: options.page?.width ?? 1365, height: options.page?.height ?? 900 },
    })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => { pageErrors.push(error.message) })
    await page.goto(url)
    await page.waitForFunction(() => ['ready', 'failed']
      .includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    if (options.onboard !== false) {
      const zh = (options.page?.locale ?? 'en-US').toLowerCase().startsWith('zh')
      await page.getByRole('button', { name: zh ? '继续' : 'Continue', exact: true }).click()
      await page.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    }
    const scaffold: NativeWebScaffold = {
      home, profileDir, workspaceCwd, sessionRoot, url, page, browser, pageErrors,
      async rpc<T>(endpoint: string, payload: unknown = {}): Promise<RpcResult<T>> {
        const response = await page.request.post(new URL(`/api/${endpoint}`, url).href, {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({
            type: 'client-request',
            rpcId: `e2e-${endpoint}-${randomUUID()}`,
            method: endpoint,
            payload,
          }),
        })
        const body = await response.json() as { result: RpcResult<T> }
        return body.result
      },
      async close() {
        await browser?.close()
        child.kill('SIGTERM')
        await child
        if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) {
          throw new Error('unexpected Native web fixture home')
        }
        for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
        for (const link of links) unlinkSync(link)
        rmSync(home, { recursive: true })
      },
    }
    return scaffold
  } catch (error) {
    await browser?.close().catch(() => undefined)
    child.kill('SIGTERM')
    rmSync(home, { recursive: true, force: true })
    throw error
  }
}

/**
 * Wait until a restored Session leaves its attach window and exposes the
 * composer's ready controls.
 *
 * Restoring publishes durable history before it attaches to any Host turn, so
 * an aria snapshot taken as soon as the transcript renders can catch the live
 * activity row and a Stop button. The model picker is enabled only in the
 * ready state.
 * @param page - page showing one restored Native Session.
 * @param timeoutMs - maximum wait for the ready state.
 */
export async function waitForNativeComposerReady(page: Page, timeoutMs = 20_000): Promise<void> {
  const picker = page.getByRole('button', { name: /^Select model, current /u })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await picker.isEnabled().catch(() => false)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Native composer did not return to its ready state')
}

/**
 * Write a model row that replays one recording and publishes the catalog the
 * composer reads, re-exporting the shared Native replay Provider.
 * @param profileDir - profile whose `node_modules` receives the package.
 */
function writeReplayModel(profileDir: string): void {
  const dir = join(profileDir, 'node_modules/native-web-replay')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'native-web-replay',
    version: '0.0.0',
    type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: {
      native: {
        apiVersion: 1,
        entry: './native',
        targets: ['host'],
        requires: ['agentPresets'],
        optional: [],
        provides: ['model', 'modelDirectory'],
      },
    },
  }))
  const replayEntry = pathToFileURL(join(REPO_ROOT, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  writeFileSync(join(dir, 'native.mjs'), [
    `import { plugin as replay } from ${JSON.stringify(replayEntry)}`,
    '',
    'export const plugin = {',
    '  ...replay,',
    "  requires: ['agentPresets'],",
    "  provides: ['model', 'modelDirectory'],",
    '  resolve(input) {',
    '    const install = replay.resolve(input)',
    '    return (context) => {',
    '      install(context)',
    '      context.provide(\'modelDirectory\', {',
    '        providers: () => (input?.providers ?? []).map(entry => ({ id: entry.id, name: entry.id })),',
    `        resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: ${JSON.stringify(['text'])} }),`,
    '        catalog: async defaults => ({ default: defaults, routableProviders: (input?.providers ?? []).map(p => p.id),',
    '          failures: [], groups: (input?.providers ?? []).map(entry => ({ id: entry.id, name: entry.id,',
    '            models: entry.models.map(model => ({ id: model.id, name: model.id })) })) }),',
    '      })',
    '    }',
    '  },',
    '};',
    '',
  ].join('\n'))
}

/** Write the package that satisfies `model`/`modelDirectory` without a provider call. */
function writeSilentModel(profileDir: string, registerStandardPreset: boolean): void {
  const dir = join(profileDir, 'node_modules/native-silent-model')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'native-silent-model',
    version: '0.0.0',
    type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: {
      native: {
        apiVersion: 1,
        entry: './native',
        targets: ['host'],
        requires: ['agentPresets'],
        optional: [],
        provides: ['model', 'modelDirectory'],
      },
    },
  }))
  writeFileSync(join(dir, 'native.mjs'), [
    'export const plugin = {',
    '  apiVersion: 1,',
    "  name: 'native-silent-model',",
    "  targets: ['host'],",
    "  requires: ['agentPresets'],",
    "  provides: ['model', 'modelDirectory'],",
    '  resolve: () => context => {',
    ...(registerStandardPreset
      ? ["    context.own(context.require('agentPresets').register({ id: 'standard', name: 'Standard', scope: context.scope }));"]
      : []),
    "    context.provide('modelDirectory', {",
    "      providers: () => [{ id: 'mock', name: 'Local deterministic mock' }],",
    '      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '      catalog: async defaults => ({ default: defaults, routableProviders: [\'mock\'], failures: [], groups: [{',
    "        id: 'mock', name: 'Local deterministic mock', models: [{ id: 'fixture', name: 'Fixture' }] }] }),",
    '    });',
    "    context.provide('model', {",
    '      async *stream() {',
    "        throw new Error('native web e2e: a model call was issued by a scenario that seeds its history')",
    '      },',
    '    });',
    '  },',
    '};',
    '',
  ].join('\n'))
}

/** Point the durable rows at the scenario's temp world and deterministic model. */
function withHarnessPaths(row: NativeInstallation, paths: {
  readonly home: string
  readonly workspaceCwd: string
  readonly sessionRoot: string
  readonly systemPrompt: string
}): NativeInstallation {
  switch (row.id) {
    case 'app':
      return { ...row, config: { ...row.config as object, port: 0 } }
    case 'session-controller':
      return {
        ...row,
        config: {
          ...row.config as object,
          cwd: paths.workspaceCwd,
          provider: 'mock',
          model: 'fixture',
          systemPrompt: paths.systemPrompt,
          workspaceRoutes: { maxRoutes: 2, allowedRoots: [paths.workspaceCwd] },
          builtinTools: false,
        },
      }
    case 'fs':
      return { ...row, config: { cwd: paths.workspaceCwd } }
    case 'sandbox-policy':
      return { ...row, config: { mode: 'workspace-write', workspaceRoot: paths.workspaceCwd } }
    case 'credentials':
      return { ...row, config: { path: credentialsDocumentPath(paths.home) } }
    case 'storage':
      return { ...row, config: { root: paths.sessionRoot, compression: 'none' } }
    default:
      return row
  }
}

function credentialsDocumentPath(home: string): string {
  return join(home, 'credentials.json')
}

function writeClock(home: string, clockMs: number): string {
  const path = join(home, 'clock.mjs')
  writeFileSync(path, 'Date.now = () => ' + String(clockMs) + '\n')
  return path
}

function announcedUrl(child: AnnouncedProcess, stderr: () => string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('native Web did not announce its URL\n' + stderr()))
    }, 30_000)
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = /http:\/\/[^\s]+\n/u.exec(output)?.[0].trim()
      if (match !== undefined) { clearTimeout(timeout); resolve(match) }
    })
    child.stdout?.on('end', () => {
      clearTimeout(timeout)
      reject(new Error('native Web exited: ' + stderr()))
    })
  })
}
