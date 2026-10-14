/** Built native conversation records and restores a keyless Session through the shipped Client roster. */
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { parseSessionEvent } from '@deepseek-ai/dsh-session/event-validation'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const scenario = join(root, 'snapshots/web/native-conversation')

it('creates, submits and restores the built native conversation through the shipped Client roster', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-web-profile-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const fixedSessionClock = join(home, 'fixed-session-clock.mjs')
  const fixedSessionTime = Date.UTC(2025, 0, 1)
  writeFileSync(fixedSessionClock, `Date.now = () => ${fixedSessionTime}\n`)
  const readStoredSessionRows = () => {
    const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('native Web omitted Session JSONL')
    return readFileSync(join(sessionRoot, stored), 'utf8').trim().split('\n').slice(1)
      .map((line, index) => parseSessionEvent(JSON.parse(line), index))
  }
  const readStoredSessionId = () => {
    const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('native Web omitted Session JSONL')
    const header = JSON.parse(readFileSync(join(sessionRoot, stored), 'utf8').split('\n', 1)[0] ?? 'null') as { id?: unknown }
    if (typeof header.id !== 'string') throw new Error('native Web Session header omitted its id')
    return header.id
  }
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'tool-card.txt'), 'Persisted read-card content.\n')
  const modules = join(profile, 'node_modules/@deepseek-ai')
  mkdirSync(modules, { recursive: true })
  const links: string[] = []
  for (const [name, path] of [
    ['native-web-host', 'Programs/Web/host/native-web-host'],
    ['native-web-session-controller', 'Programs/Web/api/native-web-session-controller'],
    ['settings-file', 'Modules/Official/settings/settings-file'],
    ['storage', 'Core/storage/storage'],
    ['storage-json', 'Core/storage/storage-json'],
    ['storage-domain', 'Core/storage/storage-domain'],
    ['workspace', 'Modules/Official/workspace/workspace'],
    ['session-title', 'Engine/session/session-title'],
    ['session-title-first-prompt-llm', 'Engine/session/session-title-first-prompt-llm'],
    ['credentials-local', 'Modules/Official/credentials/credentials-local'],
    ['native-agent', 'Engine/core/native-agent'],
    ['native-tools', 'Engine/core/native-tools'],
    ['native-approval', 'Modules/Official/interaction/native-approval'],
    ['agent-presets', 'Engine/preset/agent-presets'],
    ['native-model-execution', 'Engine/core/native-model-execution'],
    ['fs-local', 'Modules/Official/fs/fs-local'],
    ['session-persistence-jsonl', 'Engine/session/session-persistence-jsonl'],
    ['client-native-application', 'Programs/Web/client/native-application'],
    ['client-ui-renderer', 'Programs/Web/client/ui-renderer'],
    ['client-connection', 'Programs/Web/client/connection'],
    ['client-native-session', 'Programs/Web/client/native-session'],
    ['client-locale', 'Programs/Web/client/locale'],
    ['client-ui-theme', 'Programs/Web/client/ui-theme'],
    ['client-ui-session', 'Programs/Web/client/ui-session'],
    ['client-ui-layout', 'Programs/Web/client/ui-layout'],
    ['client-ui-sidebar', 'Programs/Web/client/ui-sidebar'],
    ['client-ui-sidebar-right', 'Programs/Web/client/ui-sidebar-right'],
  ] as const) {
    const link = join(modules, `dsh-${name}`)
    symlinkSync(join(root, 'rsh', path), link, 'junction')
    links.push(link)
  }
  const fixtureModel = join(profile, 'node_modules/native-web-fixture-model')
  mkdirSync(fixtureModel)
  writeFileSync(join(fixtureModel, 'package.json'), JSON.stringify({
    name: 'native-web-fixture-model', version: '1.0.0', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['hostConnection', 'agentPresets', 'tools'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(fixtureModel, 'native.mjs'), `export const plugin = {
    apiVersion: 1, name: 'native-web-fixture-model', targets: ['host'], requires: ['hostConnection', 'agentPresets', 'tools'], provides: ['model', 'modelDirectory'],
    resolve: () => context => {
      for (const [id, name] of [['standard', 'Standard'], ['alternate', 'Alternate']]) context.own(context.require('agentPresets').register({ id, name, scope: context.scope }));
      context.effect(context.require('tools').register({ schema: { name: 'guarded', description: 'Guarded fixture.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } }, approval: { reason: 'Protect this action.' },
        execute: async () => ({ isError: false, content: [{ type: 'text', text: 'guarded allowed' }] }) }, context.scope));
      const reasoning = { efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' };
      context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Fixture' }],
        resolve: async (provider, id) => ({ provider, id, name: id, reasoning, inputModalities: ['text', 'image'] }),
        catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [], groups: [{ id: 'mock', name: 'Fixture',
          models: [{ id: 'fixture', name: 'Initial' }, { id: 'chosen', name: 'Chosen', reasoning }] }] }) });
      let resume; const continued = new Promise(resolve => { resume = resolve });
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/release', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { resume(); return new Response('released') } }));
      let activeTitleResume; const activeTitleReleased = new Promise(resolve => { activeTitleResume = resolve });
      let activeTitleStart; const activeTitleObserved = new Promise(resolve => { activeTitleStart = resolve });
      let idleTitleResume; const idleTitleReleased = new Promise(resolve => { idleTitleResume = resolve });
      let idleTitleStart; const idleTitleObserved = new Promise(resolve => { idleTitleStart = resolve });
      let secondAnswerStart; const secondAnswerObserved = new Promise(resolve => { secondAnswerStart = resolve });
      let secondAnswerResume; const secondAnswerReleased = new Promise(resolve => { secondAnswerResume = resolve });
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/active-title-started', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { await activeTitleObserved; return new Response('started') } }));
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/active-title-release', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { activeTitleResume(); return new Response('released') } }));
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/idle-title-started', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { await idleTitleObserved; return new Response('started') } }));
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/idle-title-release', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { idleTitleResume(); return new Response('released') } }));
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/second-answer-started', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { await secondAnswerObserved; return new Response('started') } }));
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/second-answer-release', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { secondAnswerResume(); return new Response('released') } }));
      context.own(() => { resume(); activeTitleResume(); idleTitleResume(); secondAnswerResume() });
      let step = 0; let answerCount = 0; let titleCount = 0;
      const model = { async *stream(request) {
      if (request.purpose === 'session-title') {
        if (titleCount++ === 0) {
          activeTitleStart();
          await activeTitleReleased;
        } else {
          idleTitleStart();
          await idleTitleReleased;
        }
        const title = 'Native browser session';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: title };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: title } };
        yield { type: 'finish', reason: { kind: 'stop' } }; return;
      }
      const { writeFileSync } = await import('node:fs');
      writeFileSync(${JSON.stringify(join(home, 'image-request.json'))}, JSON.stringify(request.messages));
      if (step < 5) {
        const current = step++;
        const name = current < 2 ? 'guarded' : current === 2 ? 'ask_user_question' : current === 3 ? 'todo_write' : 'read';
        const args = current < 2 ? {} : current === 2 ? { questions: [{ id: 'mode', question: 'Choose mode', options: [{ label: 'One' }, { label: 'Two' }] }] }
          : current === 3 ? { todos: [{ content: 'Inspect the workspace', status: 'completed' }, { content: 'Report progress', status: 'in_progress' }] }
          : { file_path: 'tool-card.txt' };
        const id = 'human-' + current;
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      const reasoning = 'I will inspect the result.\\nThen I will summarize it.';
      yield { type: 'block-start', index: 0, blockType: 'reasoning' };
      yield { type: 'reasoning-delta', index: 0, text: reasoning };
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } };
      const text = 'Native browser answer.';
      yield { type: 'block-start', index: 1, blockType: 'text' };
      yield { type: 'text-delta', index: 1, text };
      if (answerCount++ === 0) {
        const abort = () => { resume() }; request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) resume();
        try { await continued } finally { request.signal.removeEventListener('abort', abort) }
      } else {
        const abort = () => { secondAnswerResume() }; request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) secondAnswerResume();
        secondAnswerStart();
        try { await secondAnswerReleased } finally { request.signal.removeEventListener('abort', abort) }
      }
      yield { type: 'block-end', index: 1, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } };
      context.provide('model', model);
    } };`)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-web-snapshot', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const app = shipped.installations.find(row => row.id === 'app')
  if (app?.config === undefined) throw new Error('shipped native-web has no Host settings')
  const rows = [
    ['app', 'native-web-host', { ...app.config as object, port: 0 }],
    ['sessions', 'native-web-session-controller', { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
      workspaceRoutes: { maxRoutes: 2, allowedRoots: [workspace] },
      maxSteps: 6, maxPendingRequests: 8, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 3, maxPendingHumanRequests: 2 }],
    ['tools', 'native-tools'], ['approval', 'native-approval'],
    ['agents', 'native-agent'], ['model-execution', 'native-model-execution'],
    ['presets', 'agent-presets', { default: 'standard' }],
    ['fs', 'fs-local', { cwd: workspace }], ['storage', 'session-persistence-jsonl', { root: sessionRoot, compression: 'none' }],
    ['credentials', 'credentials-local', { path: join(home, 'credentials.json') }],
  ] as const
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
    ...rows.map(([id, name, config]) => ({ id, plugin: `@deepseek-ai/dsh-${name}`, scope: 'root', ...config === undefined ? {} : { config } })),
    ...shipped.installations.filter(row => row.id === 'session-execution' || row.id === 'model-selection' || row.id === 'storage-hub' || row.id === 'storage-json' || row.id === 'storage-domain' || row.id === 'workspace' || row.id === 'user-questions' || row.id === 'tool-ask-user' || row.id === 'attachments' || row.id === 'file-tools' || row.id === 'policy' || row.id === 'tool-todo' || row.id === 'session-title' || row.id === 'session-title-llm' || row.id === 'settings'),
    { id: 'model', plugin: 'native-web-fixture-model', scope: 'root' },
  ] }))
  const child = execa(process.execPath, [
    '--import', pathToFileURL(fixedSessionClock).href, join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web',
  ], {
    cwd: root, env: { ...process.env, DSH_HOME: home }, reject: false,
  })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('native Web did not announce its URL')) }, 30_000)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const url = /http:\/\/[^\s]+\n/.exec(output)?.[0].trim()
        if (url !== undefined) { clearTimeout(timeout); resolve(url) }
      })
      void child.then((result) => { clearTimeout(timeout); reject(new Error(`native Web exited: ${result.stderr}`)) })
    })
    const fixture = process.env.DSH_SNAPSHOT === 'refresh' ? undefined
      : readFileSync(join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION)), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type?: string; data?: { content?: { type: string; text?: string }[] } })
    const text = fixture === undefined ? 'Native browser input.'
      : fixture.find(event => event.type === 'user/message')?.data?.content?.find(block => block.type === 'text')?.text
    if (text === undefined) throw new Error('recorded browser Session has no human input')
    const page = await browser.newPage({ locale: 'en-US', timezoneId: 'UTC' })
    const waitForComposerReady = () => page.waitForFunction(() => {
      const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
      return editor !== null && !editor.disabled
    })
    const rpcMethods = new Set<string>()
    const rpcPaths = new Set<string>()
    const rpcCalls: { pathname: string; method?: string; payload?: Record<string, unknown> }[] = []
    const followResponses: { admissionId: string; response: import('playwright').Response }[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (!pathname.startsWith('/api/')) return
      rpcPaths.add(pathname)
      if (request.method() !== 'POST') return
      const body = request.postDataJSON() as { method?: unknown; payload?: unknown } | null
      if (typeof body?.method === 'string') {
        rpcMethods.add(body.method)
        const payload = typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
          ? body.payload as Record<string, unknown> : undefined
        rpcCalls.push({ pathname, method: body.method, ...(payload === undefined ? {} : { payload }) })
      }
    })
    page.on('response', (response) => {
      if (new URL(response.url()).pathname !== '/api/native-session/follow') return
      const body = response.request().postDataJSON() as { admissionId?: unknown } | null
      if (typeof body?.admissionId === 'string') followResponses.push({ admissionId: body.admissionId, response })
    })
    await page.goto(address)
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    if (await page.locator('#root').getAttribute('data-native-boot-state') !== 'ready') {
      throw new Error(await page.locator('#root').innerText())
    }
    expect(await page.locator('#root').evaluate(rootElement => (rootElement as HTMLElement).inert)).toBe(true)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('[class*="onboardingOverlay"]').waitFor({ state: 'detached' })
    await page.locator('#root h1').waitFor({ timeout: 15_000 })
    expect(await page.locator('#root h1').innerText()).toBe('RedSpark Harness')
    expect([...rpcMethods]).toEqual(expect.arrayContaining([
      'models/providers', 'models/configurable-providers', 'settings/describe',
    ]))
    const sidebar = page.locator('[data-slot="sidebar"]')
    // The brand button shares this accessible name; keep the visible creation action in the sidebar path.
    await sidebar.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
    await waitForComposerReady()
    await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('alternate')
    await waitForComposerReady()
    await page.getByRole('button', { name: 'Select model, current Initial', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Model\b/u }).click()
    await page.getByRole('menuitemradio', { name: 'Chosen', exact: true }).click()
    await waitForComposerReady()
    await page.getByRole('button', { name: 'Select model, current Chosen, reasoning effort Medium', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Effort\b/u }).click()
    await page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
    await waitForComposerReady()
    const modelPickerLabel = await page.getByRole('button', { name: 'Select model, current Chosen, reasoning effort High', exact: true }).getAttribute('aria-label')
    if (modelPickerLabel === null) throw new Error('model picker omitted its accessible current selection')
    const controlsText = `${modelPickerLabel}\n${(await page.getByRole('group', { name: 'Model, mode, and permission controls', exact: true }).innerText()).replace(/\r\n/gu, '\n').trimEnd()}\n`
    const controlsPath = join(scenario, 'controls.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(controlsPath, controlsText)
    else expect(controlsText).toBe(readFileSync(controlsPath, 'utf8'))
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
    await page.getByLabel('Add images', { exact: true }).setInputFiles(join(scenario, 'image.png'))
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const humanCards: string[] = []
    const approvalCard = page.getByRole('region', { name: 'Tool approval', exact: true })
    await page.getByRole('button', { name: 'Allow once', exact: true }).waitFor()
    humanCards.push(await approvalCard.innerText())
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await page.getByRole('button', { name: 'Reject', exact: true }).waitFor()
    humanCards.push(await approvalCard.innerText())
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    const questions = page.getByRole('form', { name: 'Pending questions', exact: true })
    await questions.waitFor()
    humanCards.push(await questions.innerText())
    await questions.getByRole('radio', { name: 'Two', exact: true }).check()
    await questions.getByRole('button', { name: 'Submit answer', exact: true }).click()
    const humanText = humanCards.join('\n\n').replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const humanPath = join(scenario, 'human.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(humanPath, humanText)
    else expect(humanText).toBe(readFileSync(humanPath, 'utf8'))
    const live = page.locator('[data-streaming="true"]')
    await live.getByText('Native browser answer.', { exact: true }).waitFor()
    const todoPanel = page.getByRole('complementary', { name: 'Task list', exact: true })
    expect(await todoPanel.locator('[data-todo-status]').allTextContents()).toEqual([
      'Completed: Inspect the workspace', 'In progress: Report progress',
    ])
    const todoText = (await todoPanel.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const todoPath = join(scenario, 'todos.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(todoPath, todoText)
    else expect(todoText).toBe(readFileSync(todoPath, 'utf8'))
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    const liveText = (await live.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const livePath = join(scenario, 'live.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(livePath, liveText)
    else expect(liveText).toBe(readFileSync(livePath, 'utf8'))
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/release', { method: 'POST' }); if (!response.ok) throw new Error('fixture release failed') })
    await waitForComposerReady()
    expect(await live.count()).toBe(0)
    const workspaceTree = sidebar.getByRole('tree', { name: 'Workspaces', exact: true })
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/active-title-started', { method: 'POST' }); if (!response.ok) throw new Error('active title fixture did not start') })
    expect(await workspaceTree.getByRole('treeitem').filter({ hasText: 'Native browser session' }).count()).toBe(0)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Second prompt after first title started.')
    const secondPromptStarted = page.waitForResponse((response) => {
      return response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/session/start'
    })
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await secondPromptStarted
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/second-answer-started', { method: 'POST' }); if (!response.ok) throw new Error('second answer fixture did not start') })
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/active-title-release', { method: 'POST' }); if (!response.ok) throw new Error('active title fixture release failed') })
    await workspaceTree.getByRole('treeitem').filter({ hasText: 'Native browser session' }).waitFor()
    const activeTitleRows = readStoredSessionRows()
    expect(activeTitleRows.some(row => row.type === 'session/title' && row.data.title === 'Native browser session')).toBe(true)
    expect(activeTitleRows.some(row => row.type === 'turn/start' && row.data.turn === 2)).toBe(true)
    expect(activeTitleRows.some(row => row.type === 'turn/end' && row.data.turn === 2)).toBe(false)
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/second-answer-release', { method: 'POST' }); if (!response.ok) throw new Error('second answer fixture release failed') })
    expect(await workspaceTree.getByRole('treeitem').filter({ hasText: 'Native browser session' }).count()).toBe(1)
    await page.getByLabel('Session records').getByText('Second prompt after first title started.', { exact: true }).waitFor()
    let sessionRow = workspaceTree.getByRole('treeitem').filter({ hasText: 'Native browser session' })
    await sessionRow.waitFor()
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/second-answer-release', { method: 'POST' }); if (!response.ok) throw new Error('second answer fixture release failed') })
    await waitForComposerReady()
    const secondTurnRows = readStoredSessionRows()
    const secondTurnEnd = secondTurnRows.findLast((row): row is Extract<ReturnType<typeof readStoredSessionRows>[number], { type: 'turn/end' }> =>
      row.type === 'turn/end' && row.data.turn === 2)
    const secondTurnAnswers = secondTurnRows.filter(row => row.type === 'assistant/message' && row.data.turn === 2
      && row.data.message.content.some(block => block.type === 'text' && block.text === 'Native browser answer.'))
    const cancelCalls = rpcCalls.filter(call => call.pathname === '/api/session/cancel')
    if (secondTurnEnd?.data.reason.kind !== 'completed' || secondTurnAnswers.length !== 1 || cancelCalls.length > 0) {
      throw new Error(`second turn did not complete cleanly: ${JSON.stringify({
        turnEnd: secondTurnEnd,
        assistantAnswers: secondTurnAnswers.length,
        cancelCalls,
        alerts: await page.getByRole('alert').allTextContents(),
      })}`)
    }
    await sessionRow.getByRole('button', { name: 'Session actions for Native browser session', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await page.getByRole('textbox', { name: 'Session title', exact: true }).fill('Pinned browser title')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    sessionRow = workspaceTree.getByRole('treeitem').filter({ hasText: 'Pinned browser title' })
    await sessionRow.waitFor()
    await page.getByRole('button', { name: 'Session details', exact: true }).click()
    const details = page.getByRole('complementary', { name: 'Session details', exact: true })
    await details.waitFor()
    expect(await details.innerText()).toContain(workspace)
    await page.getByRole('button', { name: 'Close details', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('section img') !== null || document.querySelector('[role=alert]') !== null)
    expect(await page.getByRole('alert').allTextContents()).toEqual([])
    await page.locator('section img').waitFor()
    await page.waitForFunction(() => { const img = document.querySelector('section img'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 })
    const modelMessages = JSON.parse(readFileSync(join(home, 'image-request.json'), 'utf8')) as { content: { type: string; attachment?: { attachmentId: string } }[] }[]
    expect(modelMessages.some(message => message.content.some(block => block.type === 'image' && typeof block.attachment?.attachmentId === 'string'))).toBe(true)
    const transcript = (await page.locator('section').last().innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    expect(transcript).toContain('Native browser answer.')
    const conversationHeader = page.locator('main > header')
    expect(await conversationHeader.getByText('Pinned browser title', { exact: true }).count()).toBe(1)
    expect(await conversationHeader.getByText('Chat', { exact: true }).count()).toBe(1)
    const turnIds = await page.locator('[data-chat-turn]').evaluateAll(nodes =>
      new Set(nodes.map(node => (node as HTMLElement).dataset.chatTurn)).size)
    expect(turnIds).toBeGreaterThan(1)
    const reasoningDisclosure = page.locator('[data-variant="think"] [data-disclosure-row]').first()
    expect(await reasoningDisclosure.getAttribute('aria-expanded')).toBe('false')
    expect(transcript).toContain('I will inspect the result.')
    expect(transcript).not.toContain('Then I will summarize it.')
    const actionRow = page.locator('[data-chat-message-action-row]')
      .filter({ has: page.getByRole('button', { name: 'Copy', exact: true }) }).first()
    const copyButton = actionRow.getByRole('button', { name: 'Copy', exact: true })
    await copyButton.waitFor({ state: 'visible' })
    expect(await copyButton.count()).toBe(1)
    expect(await actionRow.getByLabel('28 tokens').count()).toBe(1)
    expect(await actionRow.getByLabel('Duration').count()).toBe(1)
    expect(await actionRow.getByLabel('Time').count()).toBe(1)
    const transcriptPath = join(scenario, 'conversation.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(transcriptPath, transcript)
    else expect(transcript).toBe(readFileSync(transcriptPath, 'utf8'))
    await reasoningDisclosure.click()
    await page.getByText('Then I will summarize it.', { exact: false }).waitFor()
    const readCard = page.locator('[data-tool="read"]')
    expect(await readCard.getAttribute('data-state')).toBe('ok')
    expect(await page.locator('[data-tool="guarded"][data-state="error"]').count()).toBe(1)
    expect(await readCard.getByRole('button').count()).toBe(1)
    await readCard.getByRole('button').click()
    expect(await readCard.innerText()).toContain('Persisted read-card content.')
    const cardText = (await readCard.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const cardPath = join(scenario, 'tool-card.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(cardPath, cardText)
    else expect(cardText).toBe(readFileSync(cardPath, 'utf8'))

    const cursorBeforeIdleTitle = readStoredSessionRows().at(-1)?.seq
    if (cursorBeforeIdleTitle === undefined) throw new Error('native Web Session has no durable cursor before idle title')
    const callsBeforeIdleTitle = rpcCalls.length
    const idleTitleSessionId = readStoredSessionId()
    const startIdleTitleRequest = async () => page.evaluate(({ sessionId, rpcId }) => {
      type Outcome = { ok: true } | { ok: false; error: string }
      const target = window as Window & { __nativeIdleTitleRequest?: Promise<Outcome> }
      target.__nativeIdleTitleRequest = (async (): Promise<Outcome> => {
        const response = await fetch('/api/session/refresh-title', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: 'session/refresh-title', payload: { sessionId } }) })
        if (!response.ok) throw new Error(`Host title refresh failed with HTTP ${response.status}`)
        const envelope: unknown = await response.json()
        if (typeof envelope !== 'object' || envelope === null || !('result' in envelope)) {
          throw new Error('Host title refresh returned an invalid response')
        }
        const result = envelope.result
        if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
          const detail = typeof result === 'object' && result !== null && 'error' in result ? result.error : undefined
          const message = typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string'
            ? detail.message : 'Host title refresh failed'
          throw new Error(message)
        }
        return { ok: true }
      })().catch((error: unknown) => ({ ok: false, error: String(error) }))
    }, { sessionId: idleTitleSessionId, rpcId: randomUUID() })
    const releaseIdleTitleFixture = async () => page.evaluate(async () => {
      const response = await fetch('/api/native-fixture/idle-title-release', { method: 'POST' })
      if (!response.ok) throw new Error('idle title fixture release failed')
    })
    const settleIdleTitleRequest = async () => page.evaluate(async () => {
      const target = window as Window & { __nativeIdleTitleRequest?: Promise<{ ok: true } | { ok: false; error: string }> }
      const request = target.__nativeIdleTitleRequest
      if (request === undefined) throw new Error('idle title RPC was not started')
      const outcome = await request
      delete target.__nativeIdleTitleRequest
      return outcome
    })
    let idleTitleRequestPending = false
    let idleTitleReleased = false
    let idleTitleFailure: unknown
    try {
      await startIdleTitleRequest()
      idleTitleRequestPending = true
      await page.evaluate(async () => {
        const response = await fetch('/api/native-fixture/idle-title-started', { method: 'POST' })
        if (!response.ok) throw new Error('idle title fixture did not start')
      })
      await releaseIdleTitleFixture()
      idleTitleReleased = true
      const outcome = await settleIdleTitleRequest()
      idleTitleRequestPending = false
      if (!outcome.ok) throw new Error(outcome.error)
    } catch (error) {
      idleTitleFailure = error
    } finally {
      if (idleTitleRequestPending) {
        try {
          if (!idleTitleReleased) await releaseIdleTitleFixture()
          const outcome = await settleIdleTitleRequest()
          if (!outcome.ok) throw new Error(outcome.error)
        } catch (cleanupError) {
          idleTitleFailure = idleTitleFailure === undefined
            ? cleanupError
            : new AggregateError([idleTitleFailure, cleanupError], 'idle title request and cleanup both failed')
        }
      }
    }
    if (idleTitleFailure !== undefined) throw idleTitleFailure
    await workspaceTree.getByRole('treeitem').filter({ hasText: 'Native browser session' }).waitFor()
    const idleTitleRows = readStoredSessionRows()
    const idleTitle = idleTitleRows.findLast(row => row.type === 'session/title' && row.data.title === 'Native browser session')
    const idleTitleIndex = idleTitleRows.findLastIndex(row => row.type === 'session/title' && row.data.title === 'Native browser session')
    const secondTurnEndIndex = idleTitleRows.findLastIndex(row => row.type === 'turn/end' && row.data.turn === 2)
    if (idleTitle === undefined) throw new Error('idle title was not durably recorded')
    expect(idleTitle.seq).toBeGreaterThan(cursorBeforeIdleTitle)
    expect(idleTitleIndex).toBeGreaterThan(secondTurnEndIndex)
    expect(rpcCalls.slice(callsBeforeIdleTitle).map(call => call.method)).toEqual(['session/refresh-title'])

    const continuationStarted = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/session/start')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue without tasks.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const continuationStartResponse = await continuationStarted
    const continuationStartRequest = continuationStartResponse.request().postDataJSON() as {
      payload?: { sessionId?: unknown; lastSeq?: unknown }
    }
    const continuationStartEnvelope = await continuationStartResponse.json() as {
      result?: { ok?: boolean; value?: { admissionId?: unknown } }
    }
    const continuationAdmissionId = continuationStartEnvelope.result?.value?.admissionId
    if (continuationStartEnvelope.result?.ok !== true || typeof continuationAdmissionId !== 'string') {
      throw new Error('next Session admission omitted its accepted identity')
    }
    expect(continuationStartRequest.payload?.lastSeq).toBe(cursorBeforeIdleTitle)
    const continuedTurn = page.locator('[data-chat-turn]').filter({ hasText: 'Continue without tasks.' })
    await continuedTurn.getByText('Native browser answer.', { exact: true }).waitFor()
    await waitForComposerReady()
    const continuedRows = readStoredSessionRows()
    const continuationIndex = continuedRows.findIndex(row => row.type === 'user/message'
      && row.data.content.some(block => block.type === 'text' && block.text === 'Continue without tasks.'))
    const continuationUserRows = continuedRows.filter(row => row.type === 'user/message'
      && row.data.content.some(block => block.type === 'text' && block.text === 'Continue without tasks.'))
    const continuationAnswers = continuedRows.slice(continuationIndex + 1).filter(row => row.type === 'assistant/message'
      && row.data.turn === 3 && row.data.message.content.some(block => block.type === 'text' && block.text === 'Native browser answer.'))
    const continuationEnd = continuedRows.findLast((row): row is Extract<SessionEvent, { type: 'turn/end' }> =>
      row.type === 'turn/end' && row.data.turn === 3)
    expect(continuationUserRows).toHaveLength(1)
    expect(continuationAnswers).toHaveLength(1)
    expect(continuationEnd?.data.reason.kind).toBe('completed')
    expect(rpcCalls.filter(call => call.pathname === '/api/session/cancel')).toHaveLength(0)

    const followResponse = followResponses.findLast(item => item.admissionId === continuationAdmissionId)?.response
    if (followResponse === undefined) throw new Error('next Session admission has no captured follow stream')
    const followFrames = (await followResponse.text()).split(/\r?\n/u).filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)) as {
        type: string
        sessionId?: string
        fromSeq?: number
        throughSeq?: number
        event?: ReturnType<typeof parseSessionEvent>
      })
    const baseline = followFrames.find((frame): frame is typeof frame & { type: 'baseline'; sessionId: string; fromSeq: number; throughSeq: number } =>
      frame.type === 'baseline' && typeof frame.sessionId === 'string' && typeof frame.fromSeq === 'number' && typeof frame.throughSeq === 'number')
    if (baseline === undefined) throw new Error('next Session follow stream omitted its history baseline')
    expect(baseline.sessionId).toBe(continuationStartRequest.payload?.sessionId)
    expect(baseline.fromSeq).toBe(cursorBeforeIdleTitle)
    expect(baseline.throughSeq).toBeGreaterThan(idleTitle.seq)
    const baselineEvents = followFrames.filter((frame): frame is typeof frame & { type: 'event'; event: ReturnType<typeof parseSessionEvent> } =>
      frame.type === 'event' && frame.event !== undefined && frame.event.seq <= baseline.throughSeq).map(frame => frame.event)
    const durableBaselineSuffix = continuedRows.filter(row => row.seq > baseline.fromSeq && row.seq <= baseline.throughSeq)
    expect(baselineEvents).toEqual(durableBaselineSuffix)

    const transcriptAfterContinuation = (await page.locator('section').last().innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    await page.reload()
    await sidebar.getByRole('tree', { name: 'Workspaces', exact: true })
      .getByRole('treeitem').filter({ hasText: 'Native browser session' }).click()
    await waitForComposerReady()
    expect(await page.getByRole('button', { name: 'Select model, current Chosen, reasoning effort High', exact: true }).count()).toBe(1)
    expect(await page.getByRole('combobox', { name: 'Mode', exact: true }).inputValue()).toBe('alternate')
    expect(await page.getByRole('combobox', { name: 'Mode', exact: true }).isDisabled()).toBe(true)
    const restoredRows = readStoredSessionRows()
    const latestTurnEnd = restoredRows.findLastIndex(row => row.type === 'turn/end')
    expect(latestTurnEnd).toBeGreaterThanOrEqual(0)
    expect(restoredRows.slice(latestTurnEnd + 1).some(row => row.type === 'session/end-seed')).toBe(true)
    await page.waitForFunction(() => { const img = document.querySelector('section img'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 })
    await reasoningDisclosure.click()
    await page.getByText('Then I will summarize it.', { exact: false }).waitFor()
    await readCard.getByRole('button').click()
    expect((await readCard.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n').toBe(cardText)
    expect((await page.locator('section').last().innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n').toBe(transcriptAfterContinuation)
    expect(await page.locator('[data-tool="guarded"][data-state="error"]').count()).toBe(1)
    expect(await todoPanel.count()).toBe(0)
    const darkBefore = await page.locator('body').getAttribute('data-ds-dark-theme')
    await page.getByRole('button', { name: 'Switch language', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN')
    await page.getByRole('button', { name: '切换主题', exact: true }).click()
    const darkAfter = await page.locator('body').getAttribute('data-ds-dark-theme')
    expect(darkAfter !== null).not.toBe(darkBefore !== null)
    expect([...rpcMethods]).toEqual(expect.arrayContaining(['directories/list', 'session/history', 'session/rename-title', 'session/refresh-title']))
    expect([...rpcPaths]).toContain('/api/native-session/list-follow')
    console.log(`native browser RPC methods: ${[...rpcMethods].sort().join(', ')}`)
    const storage = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
    {
      const entries = await storage.list()
      expect(entries).toHaveLength(1)
      const id = entries[0]!.header.id
      const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
      if (typeof stored !== 'string') throw new Error('native Web omitted Session JSONL')
      const raw = readFileSync(join(sessionRoot, stored), 'utf8')
      const imageRefs = raw.trim().split('\n').slice(1).map(line => JSON.parse(line) as { type?: unknown; seq: number })
        .filter(event => event.type === 'user/message').map(event => parseSessionEvent(event, event.seq))
        .flatMap(event => event.type === 'user/message' ? event.data.content : []).filter(block => block.type === 'image')
        .map(block => block.attachment)
      expect(imageRefs).toHaveLength(1)
      expect(modelMessages.flatMap(message => message.content).filter(block => block.type === 'image').map(block => block.attachment)).toEqual(imageRefs)
      const context = { sessionIds: [id], cwd: workspace }
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, { ...context, sessionIds: [] }, { identityMode: 'preserve' })
      if (normalized === undefined) throw new Error('missing normalized Session')
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (process.env.DSH_SNAPSHOT === 'refresh') {
        mkdirSync(scenario, { recursive: true })
        writeFileSync(join(scenario, name), normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)))
      } else expect(normalized).toBe(readFileSync(join(scenario, name), 'utf8'))
    }
    // Restore the recorded workflow through the real Host history RPC; no model request is made.
    const workflowId = 'native-workflow-history' as SessionId
    const workflowInput = readFileSync(join(root, 'snapshots/session/workflow-run/session.v3.jsonl'), 'utf8')
      .replaceAll('{{session:1}}', workflowId).replaceAll('{{session:2}}', 'native-workflow-child')
      .replaceAll('{{workflow:1}}', 'native-workflow-run').replaceAll('{{cwd}}', workspace)
      .replaceAll('{{system}}', 'Answer the user.')
    const workflowRows = workflowInput.trim().split('\n').slice(1).map(line => JSON.parse(line) as { type: string })
      .map((row, seq) => parseSessionEvent({ ...row, seq, time: seq }, seq))
    workflowRows.push(parseSessionEvent({ type: 'session/title', seq: workflowRows.length, time: 1,
      data: { title: 'Native workflow history', messageSeqs: [], source: { kind: 'user' } } }, workflowRows.length))
    const handle = await storage.create({ version: SESSION_FORMAT_VERSION, id: workflowId, createdAt: 1,
      cwd: workspace, isSeeded: false })
    try {
      await handle.append(workflowRows)
      await handle.flush()
    } finally { await handle.close() }
    await page.reload()
    await page.waitForFunction(() => document.querySelector('#root')?.getAttribute('data-native-boot-state') === 'ready')
    await page.getByRole('button', { name: '切换语言', exact: true }).click()
    await page.getByRole('treeitem').filter({ hasText: 'Native workflow history' }).click()
    const workflow = page.locator('[data-workflow-run]')
    await workflow.waitFor()
    expect(await workflow.count()).toBe(1)
    expect(await workflow.getAttribute('data-run-status')).toBe('completed')
    await workflow.locator('[data-disclosure-row]').first().click()
    await workflow.locator('[data-disclosure-row]').nth(1).click()
    expect(await workflow.locator('[data-member-status="completed"]').count()).toBe(1)
    expect(await workflow.getByRole('button', { name: /^Open / }).count()).toBe(0)
    expect(await page.locator('[data-tool="workflow"]').count()).toBe(1)
    const workflowEvidence = process.env.DSH_NATIVE_WORKFLOW_EVIDENCE
    if (workflowEvidence !== undefined) {
      mkdirSync(workflowEvidence, { recursive: true })
      await page.screenshot({ path: join(workflowEvidence, 'native-workflow-history.png'), fullPage: true })
    }
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
    await child
    // Check every junction before unlinking; never recurse into a linked workspace.
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected snapshot home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('snapshot package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
})
