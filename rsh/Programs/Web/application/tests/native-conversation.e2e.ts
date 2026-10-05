/** Built native conversation records and restores a keyless Session through the shipped Client roster. */
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../../../../rsh/Programs/CLI/src/native-profile-template.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { parseSessionEvent } from '@deepseek-ai/dsh-session/event-validation'
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
  ensureShippedNativeProfile('native-web', home)
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'tool-card.txt'), 'Persisted read-card content.\n')
  const modules = join(profile, 'node_modules/@deepseek-ai')
  mkdirSync(modules, { recursive: true })
  const links: string[] = []
  for (const [name, path] of [
    ['native-web-host', 'Programs/Web/host/native-web-host'],
    ['native-web-session-controller', 'Programs/Web/api/native-web-session-controller'],
    ['credentials-local', 'Modules/Official/credentials/credentials-local'],
    ['native-agent', 'Engine/core/native-agent'],
    ['native-tools', 'Engine/core/native-tools'],
    ['native-approval', 'Modules/Official/interaction/native-approval'],
    ['agent-presets', 'Engine/preset/agent-presets'],
    ['native-model-execution', 'Engine/core/native-model-execution'],
    ['fs-local', 'Modules/Official/fs/fs-local'],
    ['session-persistence-jsonl', 'Engine/session/session-persistence-jsonl'],
  ] as const) {
    const link = join(modules, `dsh-${name}`)
    symlinkSync(join(root, 'rsh', path), link, 'junction')
    links.push(link)
  }
  const fixtureModel = join(profile, 'node_modules/native-web-fixture-model')
  mkdirSync(fixtureModel)
  writeFileSync(join(fixtureModel, 'package.json'), JSON.stringify({
    name: 'native-web-fixture-model', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['hostConnection', 'agentPresets', 'tools'], optional: [], provides: ['model', 'modelDirectory'] } },
  }))
  writeFileSync(join(fixtureModel, 'native.mjs'), `export const plugin = {
    apiVersion: 1, name: 'native-web-fixture-model', targets: ['host'], requires: ['hostConnection', 'agentPresets', 'tools'], provides: ['model', 'modelDirectory'],
    resolve: () => context => {
      for (const [id, name] of [['standard', 'Standard'], ['alternate', 'Alternate']]) context.own(context.require('agentPresets').register({ id, name, scope: context.scope }));
      context.effect(context.require('tools').register({ schema: { name: 'guarded', description: 'Guarded fixture.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } }, approval: { reason: 'Protect this action.' },
        execute: async () => ({ isError: false, content: [{ type: 'text', text: 'guarded allowed' }] }) }, context.scope));
      const reasoning = { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' };
      context.provide('modelDirectory', { providers: () => [{ id: 'mock', name: 'Fixture' }],
        resolve: async (provider, id) => ({ provider, id, name: id, reasoning, inputModalities: ['text', 'image'] }),
        catalog: async defaults => ({ default: defaults, routableProviders: ['mock'], failures: [], groups: [{ id: 'mock', name: 'Fixture',
          models: [{ id: 'fixture', name: 'Initial' }, { id: 'chosen', name: 'Chosen', reasoning }] }] }) });
      let resume; const continued = new Promise(resolve => { resume = resolve });
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-fixture/release', methods: ['POST'], requestBody: 'buffered',
        fetch: async () => { resume(); return new Response('released') } }));
      context.own(() => { resume() });
      let step = 0;
      context.provide('model', { async *stream(request) {
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
      const text = 'Native browser answer.';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      const abort = () => { resume() }; request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) resume();
      try { await continued } finally { request.signal.removeEventListener('abort', abort) }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }); } };`)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-web-snapshot', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const app = shipped.installations.find(row => row.id === 'app')
  if (app?.config === undefined) throw new Error('shipped native-web has no Host settings')
  const rows = [
    ['app', 'native-web-host', { ...app.config as object, port: 0 }],
    ['sessions', 'native-web-session-controller', { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
      maxSteps: 6, maxPendingRequests: 8, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 2, maxPendingHumanRequests: 2 }],
    ['tools', 'native-tools'], ['approval', 'native-approval'],
    ['agents', 'native-agent'], ['model-execution', 'native-model-execution'],
    ['presets', 'agent-presets', { default: 'standard' }],
    ['fs', 'fs-local', { cwd: workspace }], ['storage', 'session-persistence-jsonl', { root: sessionRoot, compression: 'none' }],
    ['credentials', 'credentials-local', { path: join(home, 'credentials.json') }],
  ] as const
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
    ...rows.map(([id, name, config]) => ({ id, plugin: `@deepseek-ai/dsh-${name}`, scope: 'root', ...config === undefined ? {} : { config } })),
    ...shipped.installations.filter(row => row.id === 'session-execution' || row.id === 'model-selection' || row.id === 'user-questions' || row.id === 'tool-ask-user' || row.id === 'attachments' || row.id === 'file-tools' || row.id === 'policy' || row.id === 'tool-todo'),
    { id: 'model', plugin: 'native-web-fixture-model', scope: 'root' },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], {
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
    const page = await browser.newPage({ locale: 'en-US' })
    page.on('pageerror', (error) => { console.error('native conversation browser:', error.message) })
    await page.goto(address)
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#root')?.getAttribute('data-native-boot-state') ?? ''))
    if (await page.locator('#root').getAttribute('data-native-boot-state') !== 'ready') {
      throw new Error(await page.locator('#root').innerText())
    }
    await page.getByRole('button', { name: 'New Session', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await page.getByRole('combobox', { name: 'Preset', exact: true }).selectOption('alternate')
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    const selectedRoute = JSON.stringify(['mock', 'chosen'])
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption(selectedRoute)
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption('high')
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    const controlsText = (await page.getByRole('group', { name: 'Model and preset', exact: true }).innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
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
    const live = page.getByRole('article', { name: 'Live assistant output', exact: true })
    await live.getByText('Native browser answer.', { exact: true }).waitFor()
    const todoPanel = page.getByRole('complementary', { name: 'Task list', exact: true })
    expect(await todoPanel.locator('[data-todo-status]').allTextContents()).toEqual([
      'Completed: Inspect the workspace', 'In progress: Report progress',
    ])
    const todoText = (await todoPanel.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const todoPath = join(scenario, 'todos.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(todoPath, todoText)
    else expect(todoText).toBe(readFileSync(todoPath, 'utf8'))
    expect(await page.getByRole('status').innerText()).toBe('Running…')
    const liveText = (await live.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    const livePath = join(scenario, 'live.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(livePath, liveText)
    else expect(liveText).toBe(readFileSync(livePath, 'utf8'))
    await page.evaluate(async () => { const response = await fetch('/api/native-fixture/release', { method: 'POST' }); if (!response.ok) throw new Error('fixture release failed') })
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    expect(await live.count()).toBe(0)
    await page.waitForFunction(() => document.querySelector('section img') !== null || document.querySelector('[role=alert]') !== null)
    expect(await page.getByRole('alert').allTextContents()).toEqual([])
    await page.locator('section img').waitFor()
    await page.waitForFunction(() => { const img = document.querySelector('section img'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 })
    const modelMessages = JSON.parse(readFileSync(join(home, 'image-request.json'), 'utf8')) as { content: { type: string; attachment?: { attachmentId: string } }[] }[]
    expect(modelMessages.some(message => message.content.some(block => block.type === 'image' && typeof block.attachment?.attachmentId === 'string'))).toBe(true)
    const transcript = (await page.locator('section').last().innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n'
    expect(transcript).toContain('Native browser answer.')
    const transcriptPath = join(scenario, 'conversation.expected.md')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(transcriptPath, transcript)
    else expect(transcript).toBe(readFileSync(transcriptPath, 'utf8'))
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
    await page.reload()
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    const selectedId = await page.getByRole('combobox', { name: 'Sessions' }).locator('option').last().getAttribute('value')
    if (selectedId === null) throw new Error('native Web omitted stored Session')
    await page.getByRole('combobox', { name: 'Sessions' }).selectOption(selectedId)
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    expect(await page.getByRole('combobox', { name: 'Model', exact: true }).inputValue()).toBe(selectedRoute)
    expect(await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).inputValue()).toBe('high')
    expect(await page.getByRole('combobox', { name: 'Preset', exact: true }).inputValue()).toBe('alternate')
    expect(await page.getByRole('combobox', { name: 'Preset', exact: true }).isDisabled()).toBe(true)
    await page.waitForFunction(() => { const img = document.querySelector('section img'); return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 })
    expect((await page.locator('section').innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n').toBe(transcript)
    await readCard.getByRole('button').click()
    expect((await readCard.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n').toBe(cardText)
    expect(await page.locator('[data-tool="guarded"][data-state="error"]').count()).toBe(1)
    expect((await todoPanel.innerText()).replace(/\r\n/gu, '\n').trimEnd() + '\n').toBe(todoText)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue without tasks.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
    expect(await todoPanel.count()).toBe(0)
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
