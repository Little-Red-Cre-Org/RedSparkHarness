/** Shipped native UI renders a Host-cancelled question and records its durable result. */
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

it.each([{ choice: 'Keep' }])('continues after cancelling one question through the real Host RPC ($choice)', async ({ choice }) => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-question-cancel-browser-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const modelRequests = join(home, 'model-requests.json')
  const clock = join(home, 'clock.mjs')
  writeFileSync(clock, `Date.now = () => ${Date.UTC(2025, 0, 1)}\n`)
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const selected = new Set(['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution',
    'agent-presets', 'fs', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json', 'storage-domain', 'workspace', 'user-questions', 'tool-ask-user'])
  const rows = shipped.installations.filter(row => selected.has(row.id)).map((row) => {
    const config = row.id === 'app' ? { ...row.config as object, port: 0 }
      : row.id === 'session-controller' ? { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
        maxSteps: 3, builtinTools: false, maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100,
        maxFollowBufferBytes: 1000000, maxFollowers: 4, maxPendingHumanRequests: 2 }
        : row.id === 'fs' ? { cwd: workspace }
          : row.id === 'credentials' ? { path: join(home, 'credentials.json') }
            : row.id === 'storage' ? { root: sessionRoot, compression: 'none' } : row.config
    return { ...row, plugin: row.id === 'fs' ? '@deepseek-ai/dsh-fs-local' : row.plugin,
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
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'question-cancel-fixture-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agentPresets'], optional: [], provides: ['model', 'modelDirectory'] } } }))
  writeFileSync(join(fixture, 'native.mjs'), `import { writeFileSync } from 'node:fs';
export const plugin = {
  apiVersion: 1, name: 'question-cancel-fixture-model', targets: ['host'], requires: ['agentPresets'], provides: ['model', 'modelDirectory'],
  resolve: () => context => {
    context.own(context.require('agentPresets').register({ id: 'standard', name: 'Standard', scope: context.scope }));
    context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Local deterministic mock' }],
      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] }),
      catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [], groups: [{
        id: 'mock', name: 'Local deterministic mock', models: [{ id: 'fixture', name: 'Cancel question fixture' }] }] }) });
    const requests = [];
    context.provide('model', { async *stream(request) {
      requests.push(request.messages); writeFileSync(${JSON.stringify(modelRequests)}, JSON.stringify(requests));
      const result = request.messages.flatMap(message => message.content).find(block => block.type === 'tool-result');
      if (!result) {
        const args = JSON.stringify({ questions: [{ id: 'decision', question: 'Continue this task?', options: [{ label: ${JSON.stringify(choice)} }] }] });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: 'question', name: 'ask_user_question', argumentsDelta: args };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'question', name: 'ask_user_question', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      if (!result.isError || !JSON.stringify(result).includes('the user cancelled ask_user_question')) throw new Error('missing cancellation tool result');
      const text = 'Question cancelled. Continued in the same turn.';
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
    const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const fixturePath = join(scenario, name)
    const task = process.env.DSH_SNAPSHOT === 'refresh' ? 'Ask me, then continue after question cancellation.'
      : readFileSync(fixturePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { content: { text: string }[] } })
        .find(event => event.type === 'user/message')?.data?.content[0]?.text
    if (task === undefined) throw new Error('recorded browser Session omitted its user input')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(task)
    const started = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/start')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const start = await started
    const payload = start.request().postDataJSON() as { payload: { sessionId: string } }
    const accepted = await start.json() as { result: { value: { admissionId: string } } }
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
    const reply = await page.evaluate(async ({ sessionId, admissionId, id }) => {
      const response = await fetch('/api/session/answer-human', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'question-cancel-evidence', method: 'session/answer-human',
          payload: { sessionId, admissionId, id, answer: { kind: 'cancel-questions' } } }) })
      return response.json() as Promise<{ result: { ok: boolean } }>
    }, { sessionId: payload.payload.sessionId, admissionId: accepted.result.value.admissionId, id })
    expect(reply.result.ok).toBe(true)
    await card.waitFor({ state: 'detached' })
    await page.getByText('Question cancelled. Continued in the same turn.', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.disabled)
    const messages = JSON.parse(readFileSync(modelRequests, 'utf8')) as { content: { type: string; isError?: boolean; toolCallId?: string }[] }[][]
    expect(messages).toHaveLength(2)
    const toolResult = messages[1]!.flatMap(message => message.content).find(block => block.type === 'tool-result')
    expect(toolResult).toMatchObject({ toolCallId: 'question', isError: true })
    expect(JSON.stringify(toolResult)).toContain('the user cancelled ask_user_question')
    expect(paths.filter(path => path === '/api/session/cancel')).toHaveLength(0)
    expect(await page.getByRole('alert').allTextContents()).toEqual([])
    expect(pageErrors).toEqual([])
    if (evidence !== undefined) {
      await page.screenshot({ path: join(evidence, 'native-question-continued.png'), fullPage: true })
      writeFileSync(join(evidence, 'browser-result.json'), JSON.stringify({ base: 'fea8345c629886d8470645603a7f3b5f80649523',
        model: 'local deterministic mock; no paid calls', cancellation: 'real authenticated session/answer-human Host RPC; UI button unchanged',
        nextRequestToolResult: toolResult, modelRequests: messages.length, wholeTurnCancelCalls: 0, pageErrors, alerts: [] }, null, 2) + '\n')
    }
    const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('native Web omitted durable Session')
    const raw = readFileSync(join(sessionRoot, stored), 'utf8')
    const events = raw.trim().split('\n').slice(1).map(line => JSON.parse(line) as { type: string; data: { error?: { code: string } } })
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/result')).toMatchObject([{ data: { error: { code: 'ASK_CANCELLED' } } }])
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
