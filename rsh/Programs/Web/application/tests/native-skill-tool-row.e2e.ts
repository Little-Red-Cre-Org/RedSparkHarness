/** Shipped Native Web renders a seeded skill call as a generic tool row. */
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
const fixture = join(root, 'snapshots/session/skill-load/session.v3.jsonl')
const seedId = 'skill-tool-row-web-e2e'
const systemPrompt = 'Answer the user.'

it('expands a seeded skill call to its name and instructions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-skill-row-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, 'Date.now = () => ' + String(Date.UTC(2025, 0, 1)) + '\n')
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  mkdirSync(sessionRoot)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(seedId),
    createdAt: Date.UTC(2025, 0, 1),
    isSeeded: false,
    cwd: workspace,
    delegationDepth: 0,
  }
  const backend = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
  const handle = await backend.create(header)
  // Resume rejects a stored system prompt that does not match the profile. The fixture stores {{system}}.
  await handle.append(parseSessionLog(readFileSync(fixture, 'utf8')).map((event) => {
    if (event.type !== 'system/message') return event
    const content = event.data.message.content
    const first = content[0]
    if (first?.type !== 'text') return event
    return {
      ...event,
      data: {
        ...event.data,
        message: { ...event.data.message, content: [{ ...first, text: systemPrompt }, ...content.slice(1)] },
      },
    }
  }))
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
        maxSteps: 3, builtinTools: false, maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100,
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
  const model = join(profile, 'node_modules/skill-row-fixture-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'skill-row-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), [
    'export const plugin = {',
    '  apiVersion: 1, name: \'skill-row-fixture-model\', targets: [\'host\'], requires: [\'agentPresets\'], provides: [\'model\', \'modelDirectory\'],',
    '  resolve: () => context => {',
    '    context.own(context.require(\'agentPresets\').register({ id: \'standard\', name: \'Standard\', scope: context.scope }));',
    '    context.provide(\'modelDirectory\', { providers: () => [{ id: \'mock\', name: \'Local deterministic mock\' }],',
    '      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '      catalog: async defaults => ({ default: defaults, routableProviders: [\'mock\'], failures: [], groups: [{',
    '        id: \'mock\', name: \'Local deterministic mock\', models: [{ id: \'fixture\', name: \'Skill row fixture\' }] }] }) });',
    '    context.provide(\'model\', { async *stream() { throw new Error(\'skill-row fixture must not call the model\') } });',
    '  },',
    '};',
    '',
  ].join('\n'))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...shipped, installations: [...rows, { id: 'model', plugin: 'skill-row-fixture-model', scope: 'root' }],
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
      const timeout = setTimeout(() => { reject(new Error('native Web did not announce its URL\n' + stderr)) }, 30000)
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
    const pageErrors: string[] = []
    page.on('pageerror', (error) => { pageErrors.push(error.message) })
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-skill-tool-row') })
    await page.goto(address)
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await page.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    const session = page.locator('[role="treeitem"][aria-selected]').filter({ hasText: 'Load the editing-cordis-compositions' })
    try {
      await session.waitFor({ timeout: 20000 })
    } catch (error) {
      throw new Error('seeded session was not listed\n' + await page.locator('body').innerText(), { cause: error })
    }
    await session.click()
    const records = page.getByLabel('Session records')
    try {
      await records.waitFor({ timeout: 15000 })
    } catch (error) {
      const details = page.locator('details')
      if (await details.count() > 0) await details.first().locator('summary').click()
      const detail = await page.locator('details pre').allInnerTexts()
      const alerts = await page.getByRole('alert').allInnerTexts()
      throw new Error('session records were not shown\n' + detail.join('\n') + '\n' + alerts.join('\n') + '\n' + stderr.slice(-4000), { cause: error })
    }
    // The Native transcript routes `skill` to the dedicated row, which names the
    // skill in its summary and discloses the instructions body.
    const row = records.locator('[data-tool="skill"]')
    try {
      await row.waitFor({ timeout: 15000 })
    } catch (error) {
      throw new Error('skill row was not rendered\n' + await records.innerText(), { cause: error })
    }
    await row.getByText('Skill', { exact: true }).waitFor()
    await row.getByText('editing-cordis-compositions', { exact: true }).waitFor()
    const disclosure = row.locator('[data-disclosure-row]')
    await expect.poll(() => disclosure.getAttribute('aria-expanded')).toBe('false')
    await disclosure.click()
    await expect.poll(() => disclosure.getAttribute('aria-expanded')).toBe('true')
    await row.getByText('Instructions', { exact: true }).waitFor()
    await row.getByText('# Editing Cordis compositions', { exact: false }).waitFor()
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
