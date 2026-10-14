/** Native SDK projection of the real owner's queued-text edit and atomic Inbox move. */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { createServer, type Server } from 'node:http'
import { expect, it } from 'vitest'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, parseSessionFixtureName, redactSessionSnapshotIds, sessionFixtureName,
  sessionFixtureNames } from '@deepseek-ai/dsh-session-snapshot'
import { assertWorkspaceOutsideTemp, outsideTempWorkspaceParent } from '../../rsh/Scripts/snapshot-workspace-parent.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/inbox-moved')
const sessionId = 'sdk-native-inbox-moved'
const bootstrapTask = 'Start the Native SDK Inbox move fixture.'
const recoveryTask = 'Restore the Native SDK Inbox Session after a process restart.'
const firstReply = 'Native Inbox owner completed.'
const coldReply = 'Native Inbox Session restored.'
const targetId = 'promoted-target'
const editedText = 'edited target text'

interface CarrierRun {
  readonly finalResponse: string
  readonly events: SessionEvent[]
  readonly notifications: HarnessNotification[]
}

interface PythonCarrierOutput {
  readonly first: CarrierRun
  readonly recovery: CarrierRun
}

function complete(response: import('node:http').ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { choices: [{ delta: { role: 'assistant', content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
}

function userTasks(events: readonly SessionEvent[]): string[] {
  const publicTasks = new Set([bootstrapTask, recoveryTask])
  return events.flatMap(event => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const block = event.data.content.find(candidate => candidate.type === 'text')
    return block?.type === 'text' && publicTasks.has(block.text) ? [block.text] : []
  })
}

function inboxFacts(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter(event => event.type === 'agent/inbox/spliced' || event.type === 'agent/inbox/moved')
}

function userRequestTexts(request: Record<string, unknown>): string[] {
  if (!Array.isArray(request.messages)) throw new Error('native-sdk Inbox model request omitted messages')
  return request.messages.flatMap((candidate): string[] => {
    if (candidate === null || typeof candidate !== 'object' || !('role' in candidate) || candidate.role !== 'user'
      || !('content' in candidate)) return []
    const blocks = Array.isArray(candidate.content) ? candidate.content : [candidate.content]
    return blocks.flatMap((block): string[] => {
      if (typeof block === 'string') return [block]
      return block !== null && typeof block === 'object' && 'text' in block && typeof block.text === 'string'
        ? [block.text] : []
    })
  })
}

function sessionLog(sessions: string, selectedId: string): string {
  const files = readdirSync(sessions, { recursive: true }).map(String).filter(name =>
    basename(dirname(name)) === selectedId && parseSessionFixtureName(basename(name)) !== undefined)
  const selectedName = sessionFixtureNames(files.map(name => basename(name)))[0]
  const selectedPath = files.find(name => basename(name) === selectedName)
  if (selectedName === undefined || selectedPath === undefined) {
    throw new Error(`native-sdk Inbox snapshot has no durable Session ${selectedId}`)
  }
  return readFileSync(join(sessions, selectedPath), 'utf8')
}

it('projects real Native Inbox edits and moves through both SDKs and process-cold recovery', async () => {
  const mode = process.env.DSH_SNAPSHOT
  const existingNames = readdirSync(scenario).filter(name => parseSessionFixtureName(name) !== undefined)
  const selectedName = existingNames.length === 0 ? undefined : sessionFixtureNames(existingNames)[0]
  const selectedFixture = selectedName === undefined ? undefined : join(scenario, selectedName)
  const selectedVersion = selectedName === undefined ? undefined : parseSessionFixtureName(selectedName)?.version
  const outputName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
  const authoring = mode === 'record' || mode === 'refresh'
  if (!authoring && selectedFixture === undefined) {
    throw new Error('native-sdk Inbox replay requires its selected canonical Session JSONL')
  }
  if (authoring && selectedVersion !== undefined
    && selectedVersion >= SESSION_FORMAT_VERSION) {
    throw new Error(`native-sdk Inbox snapshot will not overwrite Session generation ${selectedName}`)
  }
  const recorded = selectedFixture === undefined ? undefined : parseSessionLog(readFileSync(selectedFixture, 'utf8'))
  const priorInputs = recorded === undefined ? [] : userTasks(recorded)
  if (recorded !== undefined && priorInputs.length !== 2) {
    throw new Error('native-sdk Inbox Session must contain the initial and process-cold user inputs')
  }
  if (recorded !== undefined && priorInputs.join('\n') !== [bootstrapTask, recoveryTask].join('\n')) {
    throw new Error('native-sdk Inbox Session must preserve its two owned public input identities and order')
  }
  const firstTask = priorInputs[0] ?? bootstrapTask
  const coldTask = priorInputs[1] ?? recoveryTask
  const modelRequests: Record<string, unknown>[] = []
  let modelResponse = 0
  let server: Server | undefined
  let baseParent: string | undefined
  let base: string | undefined
  try {
    baseParent = outsideTempWorkspaceParent()
    base = mkdtempSync(join(baseParent, 'dsh-native-sdk-inbox-moved-'))
    const home = join(base, 'home')
    const workspace = join(home, 'work')
    const sessions = join(home, 'sessions')
    const profile = join(home, 'profiles', 'native-sdk')
    const fixturePackage = join(profile, 'node_modules', 'native-sdk-inbox-owner')
    const ownerStatePath = join(home, 'inbox-owner-state.json')
    const modelPatch = join(home, 'model.patch.json')
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        modelResponse += 1
        complete(response, modelResponse === 1 ? firstReply : coldReply)
      })
    })
    server = modelServer
    await new Promise<void>((resolveListen, reject) => {
      modelServer.once('error', reject)
      modelServer.listen(0, '127.0.0.1', () => {
        modelServer.off('error', reject)
        resolveListen()
      })
    })
    const address = modelServer.address()
    if (address === null || typeof address === 'string') {
      throw new Error('native-sdk Inbox fixture has no model endpoint')
    }

    mkdirSync(workspace, { recursive: true })
    mkdirSync(profile, { recursive: true })
    mkdirSync(fixturePackage, { recursive: true })
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    const ownerUrl = new URL('./inbox-moved/owner.mjs', import.meta.url)
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-inbox-moved-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations,
      { id: 'inbox-owner-fixture', scope: 'root', plugin: 'native-sdk-inbox-owner', config: {
        sessionId, statePath: ownerStatePath,
      } },
    ] }))
    copyFileSync(fileURLToPath(ownerUrl), join(fixturePackage, 'native.mjs'))
    writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({ name: 'native-sdk-inbox-owner', version: '0.0.0',
      private: true, type: 'module', exports: { './package.json': './package.json', './native': './native.mjs' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['activeSessions'], optional: [], provides: [] } } }))
    writeFileSync(modelPatch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'Verify Native SDK Inbox projection.', maxSteps: 4 } },
      { id: 'storage', config: { root: sessions, compression: 'none' } },
      { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_INBOX_FIXTURE_KEY',
        api: 'openai-completions', baseURL: `http://127.0.0.1:${address.port}/v1`,
        models: [{ id: 'fixture-model', input: ['text'] }] } } } },
    ] }))

    let first: CarrierRun
    let recovery: CarrierRun
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      const cli = join(root, 'rsh/Programs/CLI/lib/bin.js')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`)
      if (process.platform !== 'win32') {
        const { chmodSync } = await import('node:fs')
        chmodSync(launcher, 0o700)
      }
      const result = await execa(process.env.DSH_NATIVE_SDK_PYTHON,
        [join(scenario, 'client.py'), launcher, home, workspace, modelPatch, sessionId, firstTask, coldTask], {
          env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'), NATIVE_INBOX_FIXTURE_KEY: 'fixture-key' },
          timeout: 30_000,
        })
      const projected = JSON.parse(result.stdout) as PythonCarrierOutput
      first = projected.first
      recovery = projected.recovery
    } else {
      const options = { profile: 'native-sdk' as const, dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), dshHome: home,
        patches: [modelPatch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
        env: { ...process.env, NATIVE_INBOX_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' }, requestTimeoutMs: 20_000 }
      const initial = new DeepSeekHarness(options)
      try { first = await initial.session(sessionId).run(firstTask) }
      finally { await initial.close() }
      const cold = new DeepSeekHarness(options)
      try { recovery = await cold.session(sessionId).run(coldTask) }
      finally { await cold.close() }
    }

    const ownerState = JSON.parse(readFileSync(ownerStatePath, 'utf8')) as {
      first: { edited: { kind: string }; promoted: { kind: string }; nextTurn: unknown[]; nextStep: unknown[] }
      recovery: { moveCount: number; nextTurn: Array<{ id: string }>; nextStep: Array<{ id: string }> }
    }
    expect(ownerState.first).toEqual({
      edited: { kind: 'updated' }, promoted: { kind: 'promoted' },
      nextTurn: [
        { id: 'queued-before', source: { kind: 'user' }, text: 'leave queued before' },
        { id: 'queued-after', source: { kind: 'user' }, text: 'leave queued after' },
      ],
      nextStep: [
        { id: 'step-before', source: { kind: 'user' }, text: 'keep next-step before' },
        { id: targetId, source: { kind: 'user' }, text: editedText },
      ],
    })
    expect(ownerState.recovery.moveCount).toBe(1)
    expect(ownerState.recovery.nextStep.map(message => message.id)).not.toContain(targetId)
    expect(ownerState.recovery.nextTurn.map(message => message.id)).not.toContain(targetId)
    expect(first.finalResponse).toBe(firstReply)
    expect(recovery.finalResponse).toBe(coldReply)
    expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(recovery.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(modelRequests).toHaveLength(2)
    const firstRequest = modelRequests[0]
    const coldRequest = modelRequests[1]
    if (firstRequest === undefined || coldRequest === undefined) throw new Error('native-sdk Inbox model request missing')
    const firstWire = userRequestTexts(firstRequest)
    const coldWire = userRequestTexts(coldRequest)
    expect(firstWire).toEqual(['keep next-step before', editedText, bootstrapTask])
    expect(firstWire).not.toContain('original target text')
    expect(coldWire.filter(text => text === recoveryTask)).toHaveLength(1)
    expect(coldWire.filter(text => text === editedText)).toHaveLength(1)
    expect(coldWire).not.toContain('original target text')

    const firstFacts = inboxFacts(first.events)
    const recoveryFacts = inboxFacts(recovery.events)
    const notificationFacts = (run: CarrierRun): SessionEvent[] => run.notifications
      .filter(notification => notification.method === 'session.event' && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as SessionEvent)
      .filter(event => event.type === 'agent/inbox/spliced' || event.type === 'agent/inbox/moved')
    expect(notificationFacts(first)).toEqual(firstFacts)
    expect(notificationFacts(recovery)).toEqual(recoveryFacts)
    const moved = firstFacts.filter((event): event is Extract<SessionEvent, { type: 'agent/inbox/moved' }> =>
      event.type === 'agent/inbox/moved')
    expect(moved).toHaveLength(1)
    expect(moved[0]?.data).toEqual({ messageId: targetId })
    const edit = firstFacts.find(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'
      && event.data.inserted.some(message => message.id === targetId))
    expect(edit).toMatchObject({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 2,
      removedCount: 1, outcome: 'canceled', inserted: [{ id: targetId, role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: editedText }] }] } })
    expect(recovery.events.filter(event => event.type === 'agent/inbox/moved')).toEqual([])
    expect(recovery.notifications.filter(notification => notification.method === 'session.event'
      && notification.params.sessionId === sessionId
      && (notification.params.event as SessionEvent).type === 'agent/inbox/moved')).toEqual([])

    const raw = sessionLog(sessions, sessionId)
    const persisted = parseSessionLog(raw)
    const persistedTargetMessages = persisted.filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.id === targetId)
    expect(persistedTargetMessages).toHaveLength(1)
    expect(persistedTargetMessages[0]?.data.content).toEqual([{ type: 'text', text: editedText }])
    const durableFacts = inboxFacts(persisted)
    const projectedIntervals = [...firstFacts, ...recoveryFacts]
    expect(firstFacts.map(event => event.seq)).toEqual(firstFacts.map(event => event.seq).sort((a, b) => a - b))
    expect(recoveryFacts.map(event => event.seq)).toEqual(recoveryFacts.map(event => event.seq).sort((a, b) => a - b))
    expect(projectedIntervals.map(event => event.seq)).toEqual(
      projectedIntervals.map(event => event.seq).sort((a, b) => a - b))
    expect(durableFacts).toEqual(projectedIntervals)
    const cwdAliases = [...new Set([workspace, realpathSync(workspace), realpathSync.native(workspace)]
      .flatMap(cwd => {
        const slash = cwd.replaceAll('\\', '/')
        const backslash = slash.replaceAll('/', '\\')
        return [cwd, JSON.stringify(cwd).slice(1, -1), slash, slash.replaceAll('/', '//'), backslash,
          backslash.replaceAll('\\', '\\\\')]
      }))].sort((left, right) => right.length - left.length)
    const context = { sessionIds: [sessionId], cwd: workspace, cwdAliases }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context,
      { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) {
      throw new Error('native-sdk Inbox Session omitted its prompt or tool schemas')
    }
    if (mode === 'record' || mode === 'refresh') {
      if (readdirSync(scenario).includes(outputName)) {
        throw new Error(`native-sdk Inbox snapshot will not overwrite Session generation ${outputName}`)
      }
      if (selectedVersion !== undefined && selectedVersion >= SESSION_FORMAT_VERSION) {
        throw new Error(`native-sdk Inbox snapshot cannot write older Session generation ${outputName}`)
      }
      writeFileSync(join(scenario, outputName), normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
    } else {
      expect(selectedName).toBe(outputName)
      expect(normalized).toBe(readFileSync(join(scenario, outputName), 'utf8'))
      expect(formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        .toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
        .toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
    assertWorkspaceOutsideTemp(workspace)
  } finally {
    try {
      if (server?.listening === true) {
        await new Promise<void>((resolveClose, reject) => server?.close(error => error ? reject(error) : resolveClose()))
      }
    } finally {
      if (base !== undefined && baseParent !== undefined) {
        const status = lstatSync(base)
        if (!status.isDirectory() || status.isSymbolicLink() || !basename(base).startsWith('dsh-native-sdk-inbox-moved-')
          || dirname(realpathSync(base)) !== realpathSync(baseParent) || realpathSync(base) !== resolve(base)) {
          throw new Error('native-sdk Inbox snapshot: unsafe temporary directory')
        }
        rmSync(base, { recursive: true, force: true })
      }
    }
  }
}, 90_000)
