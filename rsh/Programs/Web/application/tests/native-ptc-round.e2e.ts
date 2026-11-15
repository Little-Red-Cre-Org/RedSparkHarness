/** Shipped Native Web renders a recorded PTC round with its nested sub-calls. */
import { globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFailed } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { expandOwningTurnProcess, saveFailureShot } from './support.ts'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@redspark/rsh-session/native'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = join(root, 'snapshots/web/ptc-round/session.v3.jsonl')
const seedId = 'ptc-round-native-web-e2e'
const systemPrompt = 'Answer the user.'
const title = 'Using ONE run_code program'

/** Substitute the Web seed placeholders and the recorded system prompt. */
function realize(text: string, id: string, cwd: string): string {
  return text.split(/\r?\n/).map(line => line.trim() === '' ? line : JSON.stringify(JSON.parse(line,
    (_key, value: unknown) => typeof value === 'string'
      ? value.split('{{session:1}}').join(id)
        .replace(/\{\{message:([1-9]\d*)\}\}/gu, (_token, ordinal: string) => `${id}-message-${ordinal}`)
        .split('{{cwd}}').join(cwd)
        .split('{{system}}').join(systemPrompt)
      : value))).join('\n')
}

it('renders the recorded run_code parent and nested Bash terminal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-ptc-round-native-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  mkdirSync(sessionRoot)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(seedId),
    createdAt: Date.UTC(2026, 7, 25),
    isSeeded: false,
    cwd: workspace,
    delegationDepth: 0,
    agentPreset: 'ptc',
  }
  const backend = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
  const handle = await backend.create(header)
  await handle.append(parseSessionLog(realize(readFileSync(fixture, 'utf8'), seedId, workspace)))
  await handle.close()
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const selected = new Set(['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution',
    'agent-presets', 'plan-mode', 'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json',
    'storage-domain', 'workspace'])
  const rows = shipped.installations.filter(row => selected.has(row.id)).map((row) => {
    const config = row.id === 'app' ? { ...row.config as object, port: 0 }
      : row.id === 'session-controller' ? {
        cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt,
        workspaceRoutes: { maxRoutes: 2, allowedRoots: [workspace] },
        maxSteps: 3, builtinTools: false, maxPendingRequests: 2, maxHistoryEvents: 200, maxPromptChars: 1000,
        maxFollowBufferBytes: 1000000, maxFollowers: 4, maxPendingHumanRequests: 2,
      }
        : row.id === 'fs' ? { cwd: workspace }
          : row.id === 'sandbox-policy' ? { mode: 'workspace-write', workspaceRoot: workspace }
            : row.id === 'credentials' ? { path: join(home, 'credentials.json') }
              : row.id === 'storage' ? { root: sessionRoot, compression: 'none' } : row.config
    return { ...row, ...config === undefined ? {} : { config } }
  })
  const clientRows = JSON.parse(readFileSync(join(profile, 'rsh.client.json'), 'utf8')) as { installations: { plugin: string }[] }
  const packages = new Map(globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name: string }
    return [manifest.name, dirname(join(root, path))] as const
  }))
  const links: string[] = []
  for (const name of new Set([...rows, ...clientRows.installations].map(row => row.plugin))) {
    const target = packages.get(name)
    if (target === undefined) throw new Error('missing workspace package: ' + name)
    const link = join(profile, 'node_modules', name)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    links.push(link)
  }
  const model = join(profile, 'node_modules/ptc-round-fixture-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'ptc-round-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), [
    'export const plugin = {',
    '  apiVersion: 1, name: \'ptc-round-fixture-model\', targets: [\'host\'], requires: [\'agentPresets\'], provides: [\'model\', \'modelDirectory\'],',
    '  resolve: () => context => {',
    '    context.own(context.require(\'agentPresets\').register({ id: \'ptc\', name: \'PTC\', scope: context.scope }));',
    '    context.provide(\'modelDirectory\', { providers: () => [{ id: \'mock\', name: \'Local deterministic mock\' }],',
    '      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '      catalog: async defaults => ({ default: defaults, routableProviders: [\'mock\'], failures: [], groups: [{',
    '        id: \'mock\', name: \'Local deterministic mock\', models: [{ id: \'fixture\', name: \'PTC round fixture\' }] }] }) });',
    '    context.provide(\'model\', { async *stream() { throw new Error(\'ptc-round fixture must not call the model\') } });',
    '  },',
    '};',
    '',
  ].join('\n'))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...shipped, installations: [...rows, { id: 'model', plugin: 'ptc-round-fixture-model', scope: 'root' }],
  }))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ ...process.env, RSH_HOME: home })
    .filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'],
    { cwd: root, env, reject: false })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('native Web did not announce its URL\n' + stderr.slice(-2000))) }, 30000)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const match = /http:\/\/[^\s]+\n/u.exec(output)?.[0].trim()
        if (match !== undefined) { clearTimeout(timeout); resolve(match) }
      })
      void child.then((result) => { clearTimeout(timeout); reject(new Error('native Web exited: ' + result.stderr)) })
    })
    browser = await chromium.launch()
    page = await browser.newPage({ locale: 'en-US', timezoneId: 'UTC', viewport: { width: 1365, height: 900 } })
    const current = page
    const pageErrors: string[] = []
    current.on('pageerror', (error) => { pageErrors.push(error.message) })
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-ptc-round') })
    await current.goto(address)
    await current.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await current.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await current.getByRole('button', { name: 'Continue', exact: true }).click()
    await current.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    const session = current.locator('[role="treeitem"][aria-selected]').filter({ hasText: title })
    await session.waitFor({ timeout: 20000 })
    await session.click()
    await current.getByText('DONE', { exact: true }).first().waitFor({ timeout: 20000 })
    const codeRow = current.locator('[data-variant="code"]').first()
    await expandOwningTurnProcess(current, codeRow)
    await codeRow.waitFor({ timeout: 10000 })
    const nest = current.locator('[data-subcalls]').first()
    await nest.waitFor({ timeout: 10000 })
    expect(await nest.locator('[data-sample="bash"]').count()).toBeGreaterThanOrEqual(1)
    expect(await nest.locator('[data-state="error"]').count()).toBeGreaterThanOrEqual(1)
    const bash = nest.locator('[data-sample="bash"]').first()
    await expect.poll(() => bash.getAttribute('data-state')).toBe('ok')
    await expect.poll(() => bash.getAttribute('aria-expanded')).toBe('false')
    await bash.click()
    await expect.poll(() => bash.getAttribute('aria-expanded')).toBe('true')
    const terminal = bash.locator('xpath=..').locator('[data-terminal]')
    await terminal.waitFor()
    await terminal.getByText('echo CODE_ROUND_OK', { exact: true }).waitFor()
    await terminal.getByText('CODE_ROUND_OK', { exact: true }).waitFor()
    await expect.poll(() => terminal.locator('[data-state]').getAttribute('data-state')).toBe('done')
    expect(pageErrors).toEqual([])
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await child
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected browser fixture home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
}, 120000)
