/** Shipped Native Web folds a seeded Schedule log into the catalog and sidebar marker. */
import { globSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
const fixture = join(root, 'snapshots/web/schedule-catalog/session.v3.jsonl')
const seedId = 'schedule-catalog-web-e2e'
const systemPrompt = 'Answer the user.'
const catalogNow = Date.parse('2099-08-25T12:00:00.000Z')
const title = 'Active schedule catalog'
const activeScheduleLabel = 'Has active scheduled task'
const promptFragments = ['Review overdue deployment', 'Join release review', 'Check exact cadence'] as const
const reminderIds = ['catalog-after', 'catalog-at', 'catalog-every'] as const

/** Substitute the Web seed placeholders without the Cordis scaffold. */
function realize(text: string, id: string, cwd: string): string {
  return text.split(/\r?\n/).map(line => line.trim() === '' ? line : JSON.stringify(JSON.parse(line,
    (_key, value: unknown) => typeof value === 'string'
      ? value.split('{{session:1}}').join(id)
        .replace(/\{\{message:([1-9]\d*)\}\}/gu, (_token, ordinal: string) => `${id}-message-${ordinal}`)
        .split('{{cwd}}').join(cwd)
      : value))).join('\n')
}

it('shows a seeded reminder and removes it after the attached owner deletes it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-schedule-catalog-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, 'Date.now = () => ' + String(catalogNow) + '\n')
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
        maxSteps: 3, builtinTools: false, maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 1000,
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
  const model = join(profile, 'node_modules/schedule-catalog-fixture-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'schedule-catalog-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets', 'activeSessions'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), [
    'export const plugin = {',
    '  apiVersion: 1, name: \'schedule-catalog-fixture-model\', targets: [\'host\'], requires: [\'agentPresets\', \'activeSessions\'],',
    '  provides: [\'model\', \'modelDirectory\'],',
    '  resolve: () => context => {',
    '    context.own(context.require(\'agentPresets\').register({ id: \'standard\', name: \'Standard\', scope: context.scope }));',
    '    context.provide(\'modelDirectory\', { providers: () => [{ id: \'mock\', name: \'Local deterministic mock\' }],',
    '      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '      catalog: async defaults => ({ default: defaults, routableProviders: [\'mock\'], failures: [], groups: [{',
    '        id: \'mock\', name: \'Local deterministic mock\', models: [{ id: \'fixture\', name: \'Schedule catalog fixture\' }] }] }) });',
    '    context.provide(\'model\', { async *stream() {',
    '      const owner = context.require(\'activeSessions\').owners()',
    '        .find(candidate => candidate.invocation === \'root\' && candidate.writerAvailable);',
    '      if (owner === undefined) throw new Error(\'schedule-catalog fixture: no attached root owner\');',
    '      for (const id of ' + JSON.stringify(reminderIds) + ') {',
    '        owner.append(\'schedule/change\', { version: 1, operation: \'delete\', id });',
    '      }',
    '      await owner.flush();',
    '      yield { type: \'block-start\', index: 0, blockType: \'text\' };',
    '      yield { type: \'block-end\', index: 0, block: { type: \'text\', text: \'Removed the reminders.\' } };',
    '      yield { type: \'finish\', reason: { kind: \'stop\' } };',
    '    } });',
    '  },',
    '};',
    '',
  ].join('\n'))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...shipped, installations: [...rows, { id: 'model', plugin: 'schedule-catalog-fixture-model', scope: 'root' }],
  }))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ ...process.env, RSH_HOME: home })
    .filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)))
  const child = execa(process.execPath, ['--import', pathToFileURL(clock).href,
    join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], { cwd: root, env, reject: false })
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
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-schedule-catalog') })
    await current.goto(address)
    await current.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await current.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await current.getByRole('button', { name: 'Continue', exact: true }).click()
    await current.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    const session = current.locator('[role="treeitem"][aria-selected]').filter({ hasText: title })
    try {
      await session.waitFor({ timeout: 20000 })
    } catch (error) {
      throw new Error('seeded Session was not listed\n' + await current.locator('body').innerText(), { cause: error })
    }
    expect(await session.getByRole('img', { name: activeScheduleLabel }).count()).toBe(1)
    await session.click()
    const records = current.getByLabel('Session records')
    try {
      await records.waitFor({ timeout: 15000 })
    } catch (error) {
      throw new Error('Session records were not shown\n' + stderr.slice(-4000), { cause: error })
    }
    const trigger = current.getByRole('button', { name: '3 reminders' })
    try {
      await trigger.waitFor({ timeout: 15000 })
    } catch (error) {
      throw new Error('Schedule catalog trigger was not rendered\n' + await records.innerText(), { cause: error })
    }
    await trigger.click()
    const catalog = current.getByRole('list', { name: 'Active reminders' })
    await catalog.waitFor({ timeout: 10000 })
    expect(await catalog.getByRole('listitem').count()).toBe(3)
    for (const prompt of promptFragments) {
      await expect.poll(() => catalog.getByRole('listitem').filter({ hasText: prompt }).count()).toBe(1)
    }
    await current.getByRole('textbox', { name: 'Message', exact: true }).fill('Remove the reminders.')
    await current.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => current.getByRole('button', { name: /^\d+ reminders?$/u }).count(), {
      timeout: 20000,
    }).toBe(0)
    expect(await current.getByRole('list', { name: 'Active reminders' }).count()).toBe(0)
    await expect.poll(() => session.getByRole('img', { name: activeScheduleLabel }).count(), {
      timeout: 20000,
    }).toBe(0)
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
