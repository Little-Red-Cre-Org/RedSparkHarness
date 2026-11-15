/** Shipped Native Web renders the recorded declared files and opens them on the Host. */
import { chmodSync, globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFailed } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { saveFailureShot } from './support.ts'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION, SessionId, type SessionHeader } from '@redspark/rsh-session/native'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = join(root, 'snapshots/web/present/session.v3.jsonl')
const seedId = 'present-native-web-e2e'
const systemPrompt = 'Answer the user.'
const title = 'Use one run_code program to'

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

it('shows the recorded declared files and opens them through the Native Host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-present-native-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const bin = join(home, 'bin')
  const opened = join(home, 'opened.jsonl')
  writeFileSync(opened, '')
  mkdirSync(bin)
  for (const name of ['open', 'xdg-open']) {
    const script = join(bin, name)
    writeFileSync(script, `#!${process.execPath}
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(opened)}, JSON.stringify(process.argv.slice(2)) + '\\n')
`, { mode: 0o700 })
    chmodSync(script, 0o700)
  }
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  mkdirSync(sessionRoot)
  writeFileSync(join(workspace, 'report.txt'), 'DELIVERED_REPORT\n')
  writeFileSync(join(workspace, '说明.txt'), 'DELIVERED_NOTE\n')
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(seedId),
    createdAt: Date.UTC(2026, 7, 25),
    isSeeded: false,
    cwd: workspace,
    delegationDepth: 0,
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
  const model = join(profile, 'node_modules/present-fixture-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'present-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets', 'activeSessions'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), [
    'export const plugin = {',
    '  apiVersion: 1, name: \'present-fixture-model\', targets: [\'host\'], requires: [\'agentPresets\', \'activeSessions\'],',
    '  provides: [\'model\', \'modelDirectory\'],',
    '  resolve: () => context => {',
    '    context.own(context.require(\'agentPresets\').register({ id: \'ptc\', name: \'PTC\', scope: context.scope }));',
    '    context.provide(\'modelDirectory\', { providers: () => [{ id: \'mock\', name: \'Local deterministic mock\' }],',
    '      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '      catalog: async defaults => ({ default: defaults, routableProviders: [\'mock\'], failures: [], groups: [{',
    '        id: \'mock\', name: \'Local deterministic mock\', models: [{ id: \'fixture\', name: \'Present fixture\' }] }] }) });',
    '    context.provide(\'model\', { async *stream() {',
    '      yield { type: \'block-start\', index: 0, blockType: \'text\' };',
    '      yield { type: \'block-end\', index: 0, block: { type: \'text\', text: \'Present fixture reply.\' } };',
    '      yield { type: \'finish\', reason: { kind: \'stop\' } };',
    '    } });',
    '  },',
    '};',
    '',
  ].join('\n'))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...shipped, installations: [...rows, { id: 'model', plugin: 'present-fixture-model', scope: 'root' }],
  }))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ ...process.env, RSH_HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ''}`, DISPLAY: process.env.DISPLAY ?? ':0' })
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
    page = await browser.newPage({ locale: 'en-US', timezoneId: 'Asia/Shanghai', viewport: { width: 1365, height: 900 } })
    const current = page
    const pageErrors: string[] = []
    current.on('pageerror', (error) => { pageErrors.push(error.message) })
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-present') })
    await current.goto(address)
    await current.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await current.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await current.getByRole('button', { name: 'Continue', exact: true }).click()
    await current.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    const session = current.locator('[role="treeitem"][aria-selected]').filter({ hasText: title })
    await session.waitFor({ timeout: 20000 })
    await session.click()
    await current.waitForTimeout(1_000)
    const records = current.getByLabel('Session records')
    try {
      await records.waitFor({ timeout: 20000 })
    } catch (error) {
      throw new Error('Session records were not shown\n' + stderr.slice(-4000)
        + '\n' + JSON.stringify(pageErrors) + '\n' + await current.locator('body').innerText(), { cause: error })
    }
    const row = current.locator('[data-presented-files-row]')
    try {
      await row.waitFor({ timeout: 20000 })
    } catch (error) {
      throw new Error('declared-file row was not rendered\n' + stderr.slice(-4000)
        + '\n' + JSON.stringify(pageErrors) + '\n' + await records.innerText(), { cause: error })
    }
    expect(await row.locator('[data-presented-file]').count()).toBe(2)
    await expect.poll(() => row.getByText('report.txt', { exact: true }).count()).toBe(1)
    await expect.poll(() => row.getByText('说明.txt', { exact: true }).count()).toBe(1)
    await expect.poll(() => row.getByText('delivered report', { exact: true }).count()).toBe(1)
    const open = row.getByRole('button', { name: 'Open report.txt in default app', exact: true })
    await open.waitFor({ timeout: 10000 })
    await open.click()
    await expect.poll(() => readFileSync(opened, 'utf8').includes('report.txt'), { timeout: 15000 }).toBe(true)
    const reveal = row.getByRole('button', { name: 'Show 说明.txt in file manager', exact: true })
    await reveal.click()
    await expect.poll(() => readFileSync(opened, 'utf8').includes(workspace), { timeout: 15000 }).toBe(true)
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
