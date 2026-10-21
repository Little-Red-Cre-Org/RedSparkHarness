/** Native SDK Skill catalog, tool loading, explicit invocation, and cold Session recovery. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { createServer, type ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/skills')
const sessionId = 'sdk-native-skills'
const skillBody = 'Always inspect the requested file before proposing a fix. Use the skill tool to load these instructions when relevant.'
const firstTask = '/review Apply the review skill to the requested change, then summarize its instruction.'
const coldTask = '/review Continue after restart and follow the review skill again.'
const coldAnswer = 'cold skill Session restored'

interface CarrierRun {
  readonly events: SnapshotEvent[]
  readonly notifications: Array<{ readonly method: string; readonly params: Record<string, unknown> }>
  readonly finalResponse: string
}

interface SnapshotEvent {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

interface PythonCarrierOutput {
  readonly first: CarrierRun
  readonly recovery: CarrierRun
}

function respond(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([JSON.stringify({ choices: [{ delta: { role: 'assistant', content } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }), '[DONE]']
    .map(chunk => `data: ${chunk}\n\n`).join(''))
}

function toolCall(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'load-review-skill', type: 'function',
      function: { name: 'skill', arguments: JSON.stringify({ name: 'review' }) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ].map(chunk => `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`).join(''))
}

function containsUserText(events: CarrierRun['events'], text: string): boolean {
  return events.some(event => event.type === 'user/message' && JSON.stringify(event.data).includes(text))
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageSourceKind(event: SnapshotEvent): unknown {
  if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source)) return undefined
  return event.data.source.kind
}

function isSkillToolEvent(event: SnapshotEvent): boolean {
  if (!isRecord(event.data)) return false
  if (event.type === 'tool/call') return event.data.name === 'skill'
  if (event.type !== 'tool/result' || !isRecord(event.data.message)
    || !isRecord(event.data.message.source)) return false
  return event.data.message.source.kind === 'tool' && event.data.message.source.callId === 'load-review-skill'
}

function skillFacts(events: readonly SnapshotEvent[]): SnapshotEvent[] {
  return events.filter(event => messageSourceKind(event) === 'skill-catalog'
    || messageSourceKind(event) === 'skill-invocation' || isSkillToolEvent(event))
}

function sessionNotificationEvents(run: CarrierRun): SnapshotEvent[] {
  return run.notifications.filter(notification => notification.method === 'session.event'
    && notification.params.sessionId === sessionId)
    .map(notification => notification.params.event as SnapshotEvent)
}

function durableFactProjection(events: readonly SnapshotEvent[]): unknown[] {
  return events.map(({ type, seq, data }) => ({ type, seq, data }))
}

it('projects Native Skills through both SDKs and cold-restores one durable Session', async () => {
  const mode = process.env.DSH_SNAPSHOT
  const fixture = join(scenario, 'session.v3.jsonl')
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const inputs = recorded?.filter(event => event.type === 'user/message' && event.data.source.kind === 'user') ?? []
  if (recorded !== undefined && inputs.length !== 2) throw new Error('native-sdk skills Session must contain initial and cold inputs')
  const firstInput = inputs[0]?.type === 'user/message'
    ? inputs[0].data.content.find(block => block.type === 'text') : undefined
  const recoveryInput = inputs[1]?.type === 'user/message'
    ? inputs[1].data.content.find(block => block.type === 'text') : undefined
  const task = firstInput?.type === 'text' ? firstInput.text : firstTask
  const resumedTask = recoveryInput?.type === 'text' ? recoveryInput.text : coldTask
  if (recorded === undefined && mode !== 'record' && mode !== 'refresh') {
    throw new Error('native-sdk skills replay requires its committed Session JSONL')
  }

  const acquiredHome = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-skills-'))
  const modelRequests: Array<Record<string, unknown>> = []
  let server: ReturnType<typeof createServer> | undefined
  let primaryError: unknown
  let hasPrimaryError = false
  try {
    const home = realpathSync.native(acquiredHome)
    const workspace = join(home, 'work')
    const sessions = join(home, 'sessions')
    const profile = join(home, 'profiles', 'native-sdk')
    const modelPatch = join(home, 'model.patch.json')
    const fixtureServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        const modelRequest = JSON.parse(body) as Record<string, unknown>
        modelRequests.push(modelRequest)
        const messages = modelRequest.messages as Array<{ readonly role: string; readonly content: unknown }>
        const history = JSON.stringify(messages)
        if (modelRequests.length === 1 && history.includes(task)) toolCall(response)
        else if (modelRequests.length === 2 && messages.at(-1)?.role === 'tool') respond(response, 'loaded review instructions')
        else if (modelRequests.length === 3 && history.includes(resumedTask)) respond(response, coldAnswer)
        else {
          response.writeHead(500)
          response.end('unexpected native-sdk skill fixture model input')
        }
      })
    })
    server = fixtureServer
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { fixtureServer.off('listening', onListening); reject(error) }
      const onListening = (): void => { fixtureServer.off('error', onError); resolve() }
      fixtureServer.once('error', onError)
      fixtureServer.once('listening', onListening)
      fixtureServer.listen(0, '127.0.0.1')
    })
    const address = fixtureServer.address()
    if (address === null || typeof address === 'string') throw new Error('native-sdk skills fixture has no model endpoint')

    mkdirSync(join(workspace, '.agents/skills/review'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-skills-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations,
      { id: 'request-context', plugin: '@deepseek-ai/dsh-request-context', scope: 'root' },
      { id: 'skills', plugin: '@deepseek-ai/dsh-skill', scope: 'root' },
      { id: 'skill-filesystem', plugin: '@deepseek-ai/dsh-skill-filesystem', scope: 'root',
        config: { agentsHome: home, dshHome: home, watch: false } },
      { id: 'tool-skill', plugin: '@deepseek-ai/dsh-tool-skill', scope: 'root' },
    ] }))
    writeFileSync(join(workspace, '.agents/skills/review/SKILL.md'), [
      '---', 'name: review', 'description: Inspect changes and state concrete findings.', '---', '', skillBody, '',
    ].join('\n'))
    writeFileSync(modelPatch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'You are a Native Skills fixture.', maxSteps: 3 } },
      { id: 'storage', config: { root: sessions, compression: 'none' } },
      { id: 'fs', config: { cwd: workspace } },
      { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
        baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text'] }] } } } },
    ] }))

    const options = { profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), dshHome: home,
      patches: [modelPatch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
      env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
      requestTimeoutMs: 20_000 }
    let first: CarrierRun
    let recovery: CarrierRun
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') {
        const { chmodSync } = await import('node:fs')
        chmodSync(launcher, 0o700)
      }
      const result = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(scenario, 'client.py'), launcher, home,
        workspace, modelPatch, sessionId, task, resumedTask], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'),
          NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
        timeout: 60_000,
      })
      const output = JSON.parse(result.stdout) as PythonCarrierOutput
      first = output.first
      recovery = output.recovery
    } else {
      const initial = new DeepSeekHarness(options)
      try { first = await initial.session(sessionId).run(task) }
      finally { await initial.close() }
      const cold = new DeepSeekHarness(options)
      try { recovery = await cold.session(sessionId).run(resumedTask) }
      finally { await cold.close() }
    }

    expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(recovery.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(sessionNotificationEvents(first)).toEqual(first.events)
    expect(sessionNotificationEvents(recovery)).toEqual(recovery.events)
    expect(first.finalResponse).toBe('loaded review instructions')
    expect(recovery.finalResponse).toBe(coldAnswer)
    expect(containsUserText(first.events, '<available_skills>')).toBe(true)
    expect(containsUserText(first.events, skillBody)).toBe(true)
    expect(containsUserText(recovery.events, skillBody)).toBe(true)
    expect(modelRequests).toHaveLength(3)
    const firstRequest = modelRequests[0]
    const toolRequest = modelRequests[1]
    const coldRequest = modelRequests[2]
    if (firstRequest === undefined || toolRequest === undefined || coldRequest === undefined) {
      throw new Error('native-sdk skills fixture omitted a model request')
    }
    expect(JSON.stringify(firstRequest.messages)).toContain('<available_skills>')
    expect(JSON.stringify(firstRequest.messages)).toContain(skillBody)
    expect(firstRequest.tools).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'function', function: expect.objectContaining({ name: 'skill' }),
    })]))
    const toolMessages = toolRequest.messages as Array<{ readonly content?: unknown }>
    expect(toolMessages.some(message => typeof message.content === 'string'
      && message.content.includes('<skill_content name="review">'))).toBe(true)
    expect(countOccurrences(JSON.stringify(coldRequest.messages), '<available_skills>')).toBe(1)
    expect(countOccurrences(JSON.stringify(coldRequest.messages), skillBody)).toBeGreaterThanOrEqual(3)

    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await backend.list()
      expect(stored.map(item => item.header.id)).toEqual([sessionId])
      const reader = await backend.open(sessionId, 'read')
      try {
        const durableEvents = (await reader.read()).events
        const firstSkillFacts = skillFacts(first.events)
        const recoverySkillFacts = skillFacts(recovery.events)
        const persistedSkillFacts = skillFacts(durableEvents)
        expect(firstSkillFacts.filter(event => messageSourceKind(event) === 'skill-catalog')).toHaveLength(1)
        expect(firstSkillFacts.filter(event => messageSourceKind(event) === 'skill-invocation')).toHaveLength(1)
        expect(firstSkillFacts.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(firstSkillFacts.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(recoverySkillFacts.filter(event => messageSourceKind(event) === 'skill-catalog')).toHaveLength(0)
        expect(recoverySkillFacts.filter(event => messageSourceKind(event) === 'skill-invocation')).toHaveLength(1)
        expect(recoverySkillFacts.filter(event => event.type === 'tool/call')).toHaveLength(0)
        expect(recoverySkillFacts.filter(event => event.type === 'tool/result')).toHaveLength(0)
        expect(durableFactProjection(persistedSkillFacts)).toEqual(
          durableFactProjection([...firstSkillFacts, ...recoverySkillFacts]))
      } finally { await reader.close() }
      const sessionFiles = readdirSync(sessions, { recursive: true }).map(String)
        .filter(name => name.endsWith('session.v3.jsonl'))
      if (sessionFiles.length !== 1) throw new Error('native-sdk skills writer omitted its Session JSONL')
      raw = readFileSync(join(sessions, sessionFiles[0]!), 'utf8')
    } finally { await backend.close() }

    const header = JSON.parse(raw.split('\n', 1)[0] ?? '') as { cwd?: unknown }
    if (typeof header.cwd !== 'string') throw new Error('native-sdk skills Session omitted its cwd')
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw,
      { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] }, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] })
    const schemas = normalizedToolSchemas(raw, { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] })
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk skills Session omitted its request headers')
    const promptSnapshot = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const schemaSnapshot = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    const fixtureName = `session.v${SESSION_FORMAT_VERSION}.jsonl`
    if (mode === 'record' || mode === 'refresh') {
      writeFileSync(join(scenario, fixtureName), normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), promptSnapshot)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), schemaSnapshot)
    } else {
      expect(normalized).toBe(readFileSync(join(scenario, fixtureName), 'utf8'))
      expect(promptSnapshot).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(schemaSnapshot).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
  } catch (error) {
    primaryError = error
    hasPrimaryError = true
    throw error
  } finally {
    const cleanupFailures: unknown[] = []
    if (server?.listening) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close(error => error === undefined ? resolve() : reject(error))
        })
      } catch (error) { cleanupFailures.push(error) }
    }
    try { rmSync(acquiredHome, { recursive: true, force: true }) }
    catch (error) { cleanupFailures.push(error) }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(hasPrimaryError ? [primaryError, ...cleanupFailures] : cleanupFailures,
        'native-sdk skills fixture cleanup failed')
    }
  }
}, 90_000)
