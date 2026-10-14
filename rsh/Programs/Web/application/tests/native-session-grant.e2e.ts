/** Shipped Native CLI remembers one Host-approved file scope and replays its durable Session. */
import { globSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { WORKSPACE_MANIFEST_GLOBS } from '../../../../../rsh/Scripts/workspace-manifest-globs.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const scenario = join(root, 'snapshots/web/native-session-grant')

it.each([{ content: 'Approved exact operation.' }])('reuses a remembered scope through the real Native CLI and Host RPC ($content)', async ({ content }) => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-session-grant-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const modelRequests = join(home, 'model-requests.json')
  const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
  const fixturePath = join(scenario, name)
  const refresh = process.env.DSH_SNAPSHOT === 'refresh'
  const recorded = refresh ? [] : readFileSync(fixturePath, 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as {
      type: string
      data?: { content?: { text: string }[]
        message?: { content: { type: string; id?: string; name?: string; arguments?: string; text?: string }[] } }
    })
  const task = refresh ? 'Write approved.txt twice with the same content.'
    : recorded.find(event => event.type === 'user/message')?.data?.content?.[0]?.text
  if (task === undefined) throw new Error('recorded grant browser Session omitted its user input')
  const script = refresh ? [
    { type: 'tool-call', id: 'first-write', name: 'write', arguments: JSON.stringify({ file_path: 'approved.txt', content }) },
    { type: 'tool-call', id: 'second-write', name: 'write', arguments: JSON.stringify({ content, file_path: 'approved.txt' }) },
    { type: 'text', text: 'Two writes completed with one Host approval.' },
  ] : recorded.filter(event => event.type === 'assistant/message').flatMap(event => event.data?.message?.content ?? [])
  if (script.length !== 3) throw new Error('grant browser scenario requires two file calls and one final answer')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, `Date.now = () => ${Date.UTC(2025, 0, 1)}\n`)
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const selected = new Set(['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution',
    'agent-presets', 'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json',
    'storage-domain', 'workspace', 'approval', 'policy', 'file-tools'])
  const rows = shipped.installations.filter(row => selected.has(row.id)).map((row) => {
    const config = row.id === 'app' ? { ...row.config as object, port: 0 }
      : row.id === 'session-controller' ? { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
        maxSteps: 3, builtinTools: false, maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100,
        maxFollowBufferBytes: 1000000, maxFollowers: 4, maxPendingHumanRequests: 2 }
        : row.id === 'fs' ? { cwd: workspace }
          : row.id === 'sandbox-policy' ? { mode: 'workspace-write', workspaceRoot: workspace }
            : row.id === 'credentials' ? { path: join(home, 'credentials.json') }
              : row.id === 'storage' ? { root: sessionRoot, compression: 'none' } : row.config
    return { ...row,
      ...config === undefined ? {} : { config } }
  })
  const clientRows = JSON.parse(readFileSync(join(profile, 'rsh.client.json'), 'utf8')) as { installations: { plugin: string }[] }
  const packages = new Map(globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).map((path) => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8')) as { name: string }
    return [manifest.name, dirname(join(root, path))] as const
  }))
  const links: string[] = []
  for (const name of new Set([...rows, ...clientRows.installations].map(row => row.plugin))) {
    const target = packages.get(name)
    if (target === undefined) throw new Error(`missing workspace package: ${name}`)
    const link = join(profile, 'node_modules', name)
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link, 'junction')
    links.push(link)
  }
  const fixture = join(profile, 'node_modules/session-grant-fixture-model')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'session-grant-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets'], optional: [], provides: ['model', 'modelDirectory'] } } }))
  writeFileSync(join(fixture, 'native.mjs'), `import { writeFileSync } from 'node:fs';
export const plugin = {
  apiVersion: 1, name: 'session-grant-fixture-model', targets: ['host'], requires: ['agentPresets'], provides: ['model', 'modelDirectory'],
  resolve: () => context => {
    context.own(context.require('agentPresets').register({ id: 'standard', name: 'Standard', scope: context.scope }));
    context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Local deterministic mock' }],
      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] }),
      catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [], groups: [{
        id: 'mock', name: 'Local deterministic mock', models: [{ id: 'fixture', name: 'Session grant fixture' }] }] }) });
    const requests = [];
    context.provide('model', { async *stream(request) {
      requests.push(request.messages); writeFileSync(${JSON.stringify(modelRequests)}, JSON.stringify(requests));
      const calls = requests.length - 1;
      const script = ${JSON.stringify(script)};
      const next = script[calls];
      if (next === undefined) throw new Error('grant browser script exhausted');
      if (next.type === 'tool-call') {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: next.id, name: next.name, argumentsDelta: next.arguments };
        yield { type: 'block-end', index: 0, block: next };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: next.text };
      yield { type: 'block-end', index: 0, block: next };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } });
  }
};\n`)
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...shipped,
    installations: [...rows, { id: 'model', plugin: 'session-grant-fixture-model', scope: 'root' }] }))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries({ ...process.env, DSH_HOME: home })
    .filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)))
  const child = execa(process.execPath, ['--import', pathToFileURL(clock).href,
    join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], { cwd: root, env, reject: false })
  let browser: Browser | undefined
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('native Web did not announce its URL')) }, 30000)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const match = /http:\/\/[^\s]+\n/u.exec(output)?.[0].trim()
        if (match !== undefined) { clearTimeout(timeout); resolve(match) }
      })
      void child.then((result) => { clearTimeout(timeout); reject(new Error(`native Web exited: ${result.stderr}`)) })
    })
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'en-US', timezoneId: 'UTC', viewport: { width: 1365, height: 900 } })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => { pageErrors.push(error.message) })
    const paths: string[] = []
    page.on('request', (request) => { paths.push(new URL(request.url()).pathname) })
    await page.goto(address)
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    expect(await page.locator('#root').getAttribute('data-native-boot-state')).toBe('ready')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: 'RedSpark Harness', exact: true }).waitFor()
    await page.locator('[data-slot="sidebar"]').getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
    await page.waitForFunction(() => {
      const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
      return editor !== null && !editor.disabled
    })
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(task)
    const started = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/start')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const start = await started
    const payload = start.request().postDataJSON() as { payload: { sessionId: string } }
    const card = page.locator('[data-approval-key]')
    await card.waitFor()
    expect(await card.innerText()).toContain('Waiting for approval')
    const id = await card.getAttribute('data-approval-key')
    if (id === null) throw new Error('missing approval presentation id')
    const evidence = process.env.DSH_SESSION_GRANT_EVIDENCE
    if (evidence !== undefined) {
      mkdirSync(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'native-grant-pending.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 375, height: 900 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor()
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? Infinity) <= 57)
    const narrow = await card.evaluate(element => ({ width: window.innerWidth,
      sidebarWidth: document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width,
      buttons: [...element.querySelectorAll('button')].map((button) => {
        const box = button.getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width, text: button.textContent }
      }) }))
    if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'native-grant-narrow.png'), fullPage: true })
    expect(narrow.buttons).toHaveLength(3)
    expect(narrow.buttons.every(button => button.left >= 0 && button.right <= narrow.width && button.width > 0)).toBe(true)
    await page.setViewportSize({ width: 1365, height: 900 })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? 0) >= 279)
    const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/answer-human')
    await card.getByRole('button', { name: 'Allow for this session', exact: true }).click()
    const response = await answered
    expect(response.request().postDataJSON()).toMatchObject({ payload: {
      sessionId: payload.payload.sessionId, id, answer: { kind: 'approval', outcome: 'allowed-session' },
    } })
    const reply = await response.json() as { result: { ok: boolean } }
    expect(reply.result.ok).toBe(true)
    await card.waitFor({ state: 'detached' })
    await page.getByText('Two writes completed with one Host approval.', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled)
    const messages = JSON.parse(readFileSync(modelRequests, 'utf8')) as { content: { type: string; isError?: boolean; toolCallId?: string }[] }[][]
    expect(messages).toHaveLength(3)
    const results = messages[2]!.flatMap(message => message.content).filter(block => block.type === 'tool-result')
    expect(results).toMatchObject([{ toolCallId: 'first-write', isError: false }, { toolCallId: 'second-write', isError: false }])
    expect(readFileSync(join(workspace, 'approved.txt'), 'utf8')).toBe(content)
    expect(paths.filter(path => path === '/api/session/answer-human')).toHaveLength(1)
    expect(await page.getByRole('alert').allTextContents()).toEqual([])
    expect(pageErrors).toEqual([])
    if (evidence !== undefined) {
      await page.screenshot({ path: join(evidence, 'native-grant-completed.png'), fullPage: true })
      writeFileSync(join(evidence, 'browser-result.json'), JSON.stringify({ base: '73380d26c6376391655ae9b791f2680831d3c106',
        model: 'local deterministic mock; no credentials or paid calls',
        filesystem: 'shipped fs-sandbox; workspace-write; identity-preserving confinement',
        approval: 'real Allow for this session button; authenticated session/answer-human RPC, allowed-session',
        narrow,
        modelRequests: messages.length, humanAnswers: 1, toolResults: results, actualFile: readFileSync(join(workspace, 'approved.txt'), 'utf8'),
        pageErrors, alerts: [] }, null, 2) + '\n')
    }
    const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('native Web omitted durable Session')
    const raw = readFileSync(join(sessionRoot, stored), 'utf8')
    const events = raw.trim().split('\n').slice(1).map(line => JSON.parse(line) as {
      type: string
      data: { error?: { code: string }; sessionGrant?: { sessionId: string; scopeKey: string } }
    })
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    const decisions = events.filter(event => event.type === 'native-approval/decided')
    expect(decisions).toMatchObject([{ data: { outcome: 'allowed-once', sessionGrant: { sessionId: payload.payload.sessionId } } },
      { data: { outcome: 'allowed-once' } }])
    expect(decisions[0]?.data.sessionGrant?.scopeKey).toMatch(/^[a-f0-9]{64}$/u)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(2)
    expect(events.filter(event => event.type === 'tool/result').every(event => event.data.error === undefined)).toBe(true)
    expect(decisions[1]?.data).not.toHaveProperty('sessionGrant')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0]!, { sessionIds: [], cwd: workspace }, { identityMode: 'preserve' })
    expect(redactSessionSnapshotIds([normalized])[0]).toBe(normalized)
    if (refresh) {
      mkdirSync(scenario, { recursive: true })
      writeFileSync(fixturePath, normalized)
      const prompts = normalizedSystemPrompts(raw, { sessionIds: [payload.payload.sessionId], cwd: workspace })
      const schemas = normalizedToolSchemas(raw, { sessionIds: [payload.payload.sessionId], cwd: workspace })
      writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)))
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)))
    } else expect(normalized).toBe(readFileSync(fixturePath, 'utf8'))
    expect(readFileSync(join(workspace, 'approved.txt'), 'utf8')).toBe(readFileSync(join(scenario, 'workspace.expected/approved.txt'), 'utf8'))
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await child
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected browser fixture home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
})
