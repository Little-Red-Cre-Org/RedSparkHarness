/** Native workflow Open selects a still-running child from the shared eligibility rule. */
import { existsSync, globSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFailed } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const PARENT_TASK = 'PARENT_TASK_OPEN_CHILD'
const CHILD_PROMPT = 'CHILD_PROMPT_HOLD'
const REQUIRED = ['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution',
  'agent-presets', 'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json',
  'storage-domain', 'workspace', 'prompt', 'subagents', 'workflow', 'workflow-worker', 'workflow-tool']

it('opens a running workflow child from the Native run disclosure', async () => {
  let page: Page | undefined
  onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-workflow-open') })
  const home = mkdtempSync(join(tmpdir(), 'rsh-workflow-open-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const release = join(home, 'release-child')
  const status = join(home, 'fixture-status.log')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, 'Date.now = () => ' + String(Date.UTC(2025, 0, 1)) + '\n')
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const missing = REQUIRED.filter(id => !shipped.installations.some(row => row.id === id))
  if (missing.length > 0) throw new Error('shipped native-web omitted ' + missing.join(', '))
  const rows = shipped.installations.filter(row => REQUIRED.includes(row.id)).map((row) => {
    const config = row.id === 'app' ? { ...row.config as object, port: 0 }
      : row.id === 'session-controller' ? {
        cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
        workspaceRoutes: { maxRoutes: 2, allowedRoots: [workspace] },
        maxSteps: 4, builtinTools: false, maxPendingRequests: 4, maxHistoryEvents: 500, maxPromptChars: 20000,
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
  const fixtureDir = join(profile, 'node_modules/workflow-open-fixture-model')
  mkdirSync(fixtureDir)
  const workflowArgs = JSON.stringify({
    script: "phase('Run')\nawait agent('CHILD_PROMPT_HOLD', { label: 'WF child', phase: 'Run' })\nreturn 'ok'\n",
    meta: { name: 'snapshot-flow', description: 'one child' },
  })
  writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({
    name: 'workflow-open-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  const fixtureSource = readFileSync(join(root, 'rsh/Programs/Web/application/tests/native-workflow-open.fixture.mjs'), 'utf8')
    .replaceAll('__RELEASE__', JSON.stringify(release))
    .replaceAll('__STATUS__', JSON.stringify(status))
    .replaceAll('__CHILD_PROMPT__', JSON.stringify(CHILD_PROMPT))
    .replaceAll('__ARGS__', JSON.stringify(workflowArgs))
  writeFileSync(join(fixtureDir, 'native.mjs'), fixtureSource)
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...shipped,
    installations: [...rows, { id: 'model', plugin: 'workflow-open-fixture-model', scope: 'root' }],
  }))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ ...process.env, RSH_HOME: home })
    .filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)))
  const child = execa(process.execPath, ['--import', pathToFileURL(clock).href,
    join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], { cwd: root, env, reject: false })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  let browser: Browser | undefined
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
    await current.goto(address)
    await current.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await current.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await current.getByRole('button', { name: 'Continue', exact: true }).click()
    await current.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    await connectNativeWorkspace(current, workspace)
    await current.getByRole('textbox', { name: 'Message', exact: true }).fill(PARENT_TASK)
    await current.getByRole('button', { name: 'Send', exact: true }).click()
    const open = current.locator('[data-workflow-run][data-run-status="running"]').getByRole('button', { name: 'Open WF child', exact: true })
    try {
      await open.waitFor({ timeout: 30000 })
    } catch (error) {
      const body = await current.locator('body').innerText().catch(() => '')
      throw new Error(String(error) + '\n' + readStatus(status) + '\n' + stderr.slice(-1000) + '\n' + body.slice(0, 1500))
    }
    await open.click()
    await current.waitForFunction((task) => {
      const records = document.querySelector('[aria-label="Session records"]')
      return records !== null && !(records.textContent ?? '').includes(task)
    }, PARENT_TASK, { timeout: 15000 })
    await current.getByLabel('Session records').getByText(CHILD_PROMPT, { exact: true }).waitFor()
    writeFileSync(release, 'go\n')
    const deadline = Date.now() + 20000
    while (!readStatus(status).includes('parent-done')) {
      if (Date.now() > deadline) throw new Error('parent did not finish\n' + readStatus(status) + '\n' + stderr.slice(-1000))
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } finally {
    if (!existsSync(release)) writeFileSync(release, 'go\n')
    await browser?.close()
    child.kill('SIGTERM')
    await child
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected browser fixture home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
}, 150000)

function readStatus(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : 'fixture status missing'
}
