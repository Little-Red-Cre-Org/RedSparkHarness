/** Shipped Native Web runs Minimal through the recorded replay and one persistent shell. */
import { globSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFailed } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'
import { loadReplayScript, type ReplayEntry } from '@redspark/rsh-llm-replay'
import { sessionFixtureName } from '@redspark/rsh-session-snapshot'
import { SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = join(root, 'snapshots/web/minimal-preset/session.v3.jsonl')
const prompt = "Use the bash tool to run exactly: printf 'MINIMAL_BASH_CARD_OK\\n'. Then reply exactly MINIMAL_PRESET_REQUEST_OK and stop."
const fixedPrompt = 'You are a helpful software engineer assistant.'

interface SessionRow { type: string; data?: Record<string, unknown>; agentPreset?: string }

/** One replayed bash call with the same chunk fields the fixture derives. */
function bashCall(id: string, command: string): ReplayEntry {
  const args = JSON.stringify({ command })
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

/** One replayed text reply. */
function textCall(text: string): ReplayEntry {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

function sessionFile(sessionRoot: string): string {
  const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
  const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
  if (typeof stored !== 'string') throw new Error('native Web omitted Session JSONL')
  return join(sessionRoot, stored)
}

function sessionRows(sessionRoot: string): SessionRow[] {
  return readFileSync(sessionFile(sessionRoot), 'utf8').trim().split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as SessionRow)
}

function toolResultText(row: SessionRow): string {
  const message = row.data?.message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  const toolResult = Array.isArray(content) ? content[0] as { content?: unknown } : undefined
  const block = Array.isArray(toolResult?.content) ? toolResult.content[0] as { text?: unknown } : undefined
  return typeof block?.text === 'string' ? block.text : ''
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
    return editor !== null && !editor.disabled
  })
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function settle(page: Page, marker: string): Promise<void> {
  const done = page.getByText(marker, { exact: true })
  const allow = page.getByRole('button', { name: 'Allow once', exact: true })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await done.count() > 0) return
    if (await allow.count() > 0) await allow.first().click()
    await page.waitForTimeout(200)
  }
  throw new Error('turn did not settle\n' + await page.locator('body').innerText())
}

it.skipIf(process.platform === 'win32')('replays Minimal on shipped native-web and keeps one persistent shell', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-native-minimal-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const override = join(home, 'replay.override.json')
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  mkdirSync(sessionRoot)
  const derived = loadReplayScript({ file: fixture })
  writeFileSync(override, JSON.stringify([
    ...derived,
    bashCall('minimal-persist-setup', 'mkdir -p persistent-state && cd persistent-state && export RSH_MINIMAL_STATE=PERSISTED'),
    bashCall('minimal-persist-read', 'printf \'%s:%s\\n\' "$RSH_MINIMAL_STATE" "$PWD"'),
    textCall('PERSISTED_TURN_OK'),
  ]))
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const installations = shipped.installations.map((row) => {
    if (row.id === 'session-title-llm') return { ...row, disabled: true }
    if (row.id === 'pi-ai') return {
      id: 'pi-ai', plugin: 'native-web-minimal-replay', scope: row.scope,
      config: {
        file: fixture, overrideFile: override,
        providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128000 }] }],
      },
    }
    if (row.id === 'app') return { ...row, config: { ...row.config as object, port: 0, clientReload: 'startup', projectDir: profile } }
    if (row.id === 'session-controller') return {
      ...row,
      config: {
        ...row.config as object,
        cwd: workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
        workspaceRoutes: { maxRoutes: 8, allowedRoots: [workspace] },
      },
    }
    if (row.id === 'agent-presets') return { ...row, config: { ...row.config as object, default: 'minimal' } }
    if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'workspace-write', workspaceRoot: workspace } }
    if (row.id === 'storage') return { ...row, config: { root: sessionRoot, compression: 'none' } }
    if (row.id === 'credentials') return { ...row, config: { path: join(home, 'credentials.json') } }
    return row
  })
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...shipped, installations }))
  const clientRows = JSON.parse(readFileSync(join(profile, 'rsh.client.json'), 'utf8')) as { installations: { plugin: string }[] }
  const packages = new Map(globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name: string }
    return [manifest.name, dirname(join(root, path))] as const
  }))
  const links: string[] = []
  for (const name of new Set([...installations, ...clientRows.installations].map(row => row.plugin))) {
    if (name === 'native-web-minimal-replay') continue
    const target = packages.get(name)
    if (target === undefined) throw new Error('missing workspace package: ' + name)
    const link = join(profile, 'node_modules', name)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    links.push(link)
  }
  const replayDir = join(profile, 'node_modules/native-web-minimal-replay')
  mkdirSync(replayDir)
  const replayEntry = pathToFileURL(join(root, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  writeFileSync(join(replayDir, 'package.json'), JSON.stringify({
    name: 'native-web-minimal-replay', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(replayDir, 'native.mjs'), [
    `import { plugin as replay } from ${JSON.stringify(replayEntry)}`,
    'export const plugin = {',
    '  apiVersion: 1, name: \'native-web-minimal-replay\', targets: [\'host\'], requires: [], optional: [], provides: [\'model\', \'modelDirectory\'],',
    '  resolve(input) {',
    '    const install = replay.resolve(input)',
    '    return (context) => {',
    '      install(context)',
    '      context.provide(\'modelDirectory\', {',
    '        providers: () => [{ id: \'deepseek-official\', name: \'DeepSeek\' }],',
    '        resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: [\'text\'] }),',
    '        catalog: async defaults => ({ default: defaults, routableProviders: [\'deepseek-official\'], failures: [], groups: [{',
    '          id: \'deepseek-official\', name: \'DeepSeek\', models: [{ id: \'deepseek-v4-flash\', name: \'DeepSeek-V4-Flash\' }] }] }),',
    '      })',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({
    ...process.env,
    RSH_HOME: home,
    RSH_TELEMETRY_DISABLED: '1',
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
  }).filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'],
    { cwd: root, env, reject: false })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('native Web did not announce its URL\n' + stderr.slice(-4000))) }, 60000)
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
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'native-minimal-preset') })
    await page.goto(address)
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await page.locator('#root').getAttribute('data-native-boot-state'), stderr.slice(-2000)).toBe('ready')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    await connectNativeWorkspace(page, workspace)
    const mode = page.getByRole('button', { name: /^Mode:/ })
    await mode.waitFor({ timeout: 15000 })
    if (!((await mode.getAttribute('aria-label')) ?? '').includes('Minimal')) {
      await mode.click()
      await page.getByRole('menuitem', { name: 'Minimal', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Mode: Minimal', exact: true }).waitFor()
    await sendPrompt(page, prompt)
    await settle(page, 'MINIMAL_PRESET_REQUEST_OK')
    const row = page.locator('[data-sample="bash"], [data-tool="bash"]').filter({ visible: true }).last()
    await row.waitFor({ timeout: 15000 })
    const disclosure = row.locator('[data-disclosure-row]')
    if (await disclosure.count() > 0 && await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click()
    await row.getByText('MINIMAL_BASH_CARD_OK', { exact: false }).waitFor()
    const first = sessionRows(sessionRoot)
    const header = JSON.parse(readFileSync(sessionFile(sessionRoot), 'utf8').split('\n', 1)[0] ?? '{}') as { agentPreset?: string }
    const system = first.find(event => event.type === 'system/message')
    const systemText = ((system?.data?.message as { content?: { text?: string }[] } | undefined)?.content ?? [])
      .map(block => block.text ?? '').join('')
    const request = first.find(event => event.type === 'request/header')
    const tools = ((request?.data?.header as { tools?: { name: string; description?: string }[] } | undefined)?.tools ?? [])
    expect(header.agentPreset).toBe('minimal')
    expect(systemText).toBe(fixedPrompt)
    expect(tools.map(tool => tool.name)).toEqual(['bash'])
    expect(tools[0]?.description).toContain('State is persistent')
    expect(first.some(event => event.type === 'user/message'
      && (event.data?.source as { plugin?: string } | undefined)?.plugin === '@redspark/rsh-system-prompt')).toBe(false)
    expect(first.some(event => event.type.startsWith('compaction'))).toBe(false)
    expect(first.filter(event => event.type === 'tool/result').map(toolResultText).join('\n')).toContain('MINIMAL_BASH_CARD_OK')
    await sendPrompt(page, 'Report the persisted shell state.')
    await settle(page, 'PERSISTED_TURN_OK')
    const persisted = sessionRows(sessionRoot).filter(event => event.type === 'tool/result').map(toolResultText).join('\n')
    expect(persisted).toContain('PERSISTED:')
    expect(persisted).toContain(join(workspace, 'persistent-state'))
    expect(pageErrors).toEqual([])
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await child
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected browser fixture home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true, force: true })
  }
}, 180000)
