/** Shipped Native buttons cancel generic and plan-review questions within one turn. */
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
const scenario = join(root, 'snapshots/web/native-question-cancel')

it.each([{ choice: 'Keep' }])('continues after generic dismissal and plan discussion through real buttons ($choice)', async ({ choice }) => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-question-cancel-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const modelRequests = join(home, 'model-requests.json')
  const cancelledWaits = join(home, 'cancelled-provider-waits.json')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, `Date.now = () => ${Date.UTC(2025, 0, 1)}\n`)
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const selected = new Set(['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution',
    'agent-presets', 'plan-mode', 'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json',
    'storage-domain', 'workspace', 'user-questions', 'tool-ask-user'])
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
  const fixture = join(profile, 'node_modules/question-cancel-fixture-model')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'question-cancel-fixture-model', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets', 'userQuestions'], optional: [], provides: ['model', 'modelDirectory'] } } }))
  writeFileSync(join(fixture, 'native.mjs'), `import { writeFileSync } from 'node:fs';
export const plugin = {
  apiVersion: 1, name: 'question-cancel-fixture-model', targets: ['host'], requires: ['agentPresets', 'userQuestions'], provides: ['model', 'modelDirectory'],
  resolve: () => context => {
    context.own(context.require('agentPresets').register({ id: 'standard', name: 'Standard', scope: context.scope }));
    const cancelled = [];
    context.own(context.require('userQuestions').registerAnswerer('button-evidence', { async ask(request, next) {
      try { return await next(); } catch (error) {
        cancelled.push({ ids: request.questions.map(question => question.id), code: error.code });
        writeFileSync(${JSON.stringify(cancelledWaits)}, JSON.stringify(cancelled)); throw error;
      }
    } }, context.scope));
    context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Local deterministic mock' }],
      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] }),
      catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [], groups: [{
        id: 'mock', name: 'Local deterministic mock', models: [{ id: 'fixture', name: 'Cancel question fixture' }] }] }) });
    const requests = [];
    context.provide('model', { async *stream(request) {
      requests.push(request.messages); writeFileSync(${JSON.stringify(modelRequests)}, JSON.stringify(requests));
      const results = request.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result');
      if (results.length > 0 && (!results[0].isError || !JSON.stringify(results[0]).includes('the user cancelled ask_user_question'))) throw new Error('missing generic cancellation result');
      if (results.length === 2 && (!results[1].isError || !JSON.stringify(results[1]).includes('The user dismissed the plan review to speak instead'))) throw new Error('missing plan discussion result');
      if (results.length < 2) {
        const plan = results.length === 1;
        const args = JSON.stringify(plan ? { plan: '# Proposed plan\\n\\nKeep the same turn alive.' }
          : { questions: [{ id: 'decision', question: 'Continue this task?', options: [{ label: ${JSON.stringify(choice)} }] },
            { id: 'route', question: 'Which route?', options: [{ label: 'Safe' }] }] });
        const id = plan ? 'plan-question' : 'question';
        const name = plan ? 'exit_plan_mode' : 'ask_user_question';
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      const text = 'Both question batches cancelled. Continued in the same turn.';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } });
  }
};\n`)
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...shipped,
    installations: [...rows, { id: 'model', plugin: 'question-cancel-fixture-model', scope: 'root' }] }))
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
    const modeSelected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/select-plan-mode')
    await page.getByRole('button', { name: 'Plan mode is off. Click to turn it on.', exact: true }).click()
    expect(await (await modeSelected).json()).toMatchObject({ result: { ok: true } })
    const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const fixturePath = join(scenario, name)
    const task = process.env.DSH_SNAPSHOT === 'refresh' ? 'Ask me, then continue after question cancellation.'
      : readFileSync(fixturePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { source: { kind: string }; content: { text: string }[] } })
        .find(event => event.type === 'user/message' && event.data?.source.kind === 'user')?.data?.content[0]?.text
    if (task === undefined) throw new Error('recorded browser Session omitted its user input')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(task)
    const started = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/start')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const start = await started
    const payload = start.request().postDataJSON() as { payload: { sessionId: string } }
    const card = page.locator('[data-question-key]')
    await card.waitFor()
    expect(await card.innerText()).toContain('Continue this task?')
    const id = await card.getAttribute('data-question-key')
    if (id === null) throw new Error('missing question presentation id')
    const evidence = process.env.DSH_QUESTION_CANCEL_EVIDENCE
    if (evidence !== undefined) {
      mkdirSync(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'native-question-pending.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 375, height: 900 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor()
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? Infinity) <= 57)
    if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'native-question-narrow.png'), fullPage: true })
    await page.setViewportSize({ width: 1365, height: 900 })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? 0) >= 279)
    const dismissed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/answer-human')
    await card.getByRole('button', { name: 'Dismiss all questions', exact: true }).click()
    const dismissal = await dismissed
    expect(dismissal.request().postDataJSON()).toMatchObject({ payload: {
      sessionId: payload.payload.sessionId, id, answer: { kind: 'cancel-questions' },
    } })
    expect(await dismissal.json()).toMatchObject({ result: { ok: true } })
    await card.waitFor({ state: 'detached' })
    const plan = page.locator('[data-plan-review-key]')
    await plan.waitFor()
    if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'native-plan-pending.png'), fullPage: true })
    await page.setViewportSize({ width: 375, height: 900 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor()
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? Infinity) <= 57)
    const narrowPlan = await plan.evaluate(element => ({ width: window.innerWidth,
      sidebarWidth: document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width,
      buttons: [...element.querySelectorAll('button')].map((button) => {
        const box = button.getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width, text: button.textContent }
      }) }))
    if (evidence !== undefined) await page.screenshot({ path: join(evidence, 'native-plan-narrow.png'), fullPage: true })
    expect(narrowPlan.buttons).toHaveLength(3)
    expect(narrowPlan.buttons.every(button => button.left >= 0 && button.right <= narrowPlan.width && button.width > 0)).toBe(true)
    await page.setViewportSize({ width: 1365, height: 900 })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('[data-slot="sidebar"]')?.parentElement?.getBoundingClientRect().width ?? 0) >= 279)
    const discussed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/answer-human')
    await plan.getByRole('button', { name: 'Chat about it', exact: true }).click()
    const discussion = await discussed
    expect(discussion.request().postDataJSON()).toMatchObject({ payload: {
      sessionId: payload.payload.sessionId, answer: { kind: 'cancel-questions' },
    } })
    expect(await discussion.json()).toMatchObject({ result: { ok: true } })
    await plan.waitFor({ state: 'detached' })
    await page.getByText('Both question batches cancelled. Continued in the same turn.', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled)
    const messages = JSON.parse(readFileSync(modelRequests, 'utf8')) as { content: { type: string; isError?: boolean; toolCallId?: string }[] }[][]
    expect(messages).toHaveLength(3)
    const toolResults = messages[2]!.flatMap(message => message.content).filter(block => block.type === 'tool-result')
    expect(toolResults).toMatchObject([{ toolCallId: 'question', isError: true }, { toolCallId: 'plan-question', isError: true }])
    expect(JSON.stringify(toolResults[0])).toContain('the user cancelled ask_user_question')
    expect(JSON.stringify(toolResults[1])).toContain('The user dismissed the plan review to speak instead')
    const providerCancellations = JSON.parse(readFileSync(cancelledWaits, 'utf8')) as { ids: string[]; code: string }[]
    expect(providerCancellations).toEqual([
      { ids: ['decision', 'route'], code: 'ASK_CANCELLED' }, { ids: ['plan-review'], code: 'ASK_CANCELLED' },
    ])
    expect(paths.filter(path => path === '/api/session/answer-human')).toHaveLength(2)
    expect(paths.filter(path => path === '/api/session/cancel')).toHaveLength(0)
    expect(await page.getByRole('alert').allTextContents()).toEqual([])
    expect(pageErrors).toEqual([])
    if (evidence !== undefined) {
      await page.screenshot({ path: join(evidence, 'native-question-continued.png'), fullPage: true })
      writeFileSync(join(evidence, 'browser-result.json'), JSON.stringify({ base: '73380d26c6376391655ae9b791f2680831d3c106',
        model: 'local deterministic mock; no credentials or paid calls', filesystem: 'shipped fs-sandbox; workspace-write',
        cancellation: 'real Dismiss all questions and Chat about it buttons; pending batch only',
        nextRequestToolResults: toolResults, providerCancellations, modelRequests: messages.length, wholeTurnCancelCalls: 0,
        narrowPlan, pageErrors, alerts: [] }, null, 2) + '\n')
    }
    const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('native Web omitted durable Session')
    const raw = readFileSync(join(sessionRoot, stored), 'utf8')
    const events = raw.trim().split('\n').slice(1).map(line => JSON.parse(line) as { type: string; data: { error?: { code: string; name: string }; active?: boolean } })
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/result')).toMatchObject([
      { data: { error: { code: 'ASK_CANCELLED' } } }, { data: { error: { name: 'Error', code: 'UNKNOWN' } } },
    ])
    expect(events.filter(event => event.type === 'plan/mode').at(-1)?.data.active).toBe(true)
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0]!, { sessionIds: [], cwd: workspace }, { identityMode: 'preserve' })
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      mkdirSync(scenario, { recursive: true })
      writeFileSync(fixturePath, normalized)
      const prompts = normalizedSystemPrompts(raw, { sessionIds: [payload.payload.sessionId], cwd: workspace })
      const schemas = normalizedToolSchemas(raw, { sessionIds: [payload.payload.sessionId], cwd: workspace })
      writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)))
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)))
    } else expect(normalized).toBe(readFileSync(fixturePath, 'utf8'))
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await child
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected browser fixture home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('fixture package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
}, 60000)
