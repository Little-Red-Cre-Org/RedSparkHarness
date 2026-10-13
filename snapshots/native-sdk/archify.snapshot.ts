/** Native SDK Archify automatic routing, manual slash invocation, and cold recovery. */
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
import { ARCHIFY_SKILL_DIRECTORY_ENV, archifyShellEnvValues } from '../../rsh/Modules/Official/skill/archify/src/shared.ts'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/archify')
const sessionId = 'sdk-native-archify'
const firstTask = 'Generate and deliver a workflow diagram for a small service.'
const manualTask = '/archify Create and deliver a workflow diagram for a small service.'

interface SnapshotEvent {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

interface CarrierRun {
  readonly events: SnapshotEvent[]
  readonly notifications: Array<{ readonly method: string; readonly params: Record<string, unknown> }>
  readonly finalResponse: string
}

interface PythonCarrierOutput { readonly first: CarrierRun; readonly recovery: CarrierRun }

function respond(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([JSON.stringify({ choices: [{ delta: { role: 'assistant', content } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }), '[DONE]']
    .map(chunk => `data: ${chunk}\n\n`).join(''))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceKind(event: SnapshotEvent): unknown {
  if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source)) return undefined
  return event.data.source.kind
}

function countKind(events: readonly SnapshotEvent[], kind: string): number {
  return events.filter(event => sourceKind(event) === kind).length
}

function sessionNotifications(run: CarrierRun): SnapshotEvent[] {
  return run.notifications.filter(item => item.method === 'session.event' && item.params.sessionId === sessionId)
    .map(item => item.params.event as SnapshotEvent)
}

function eventProjection(events: readonly SnapshotEvent[]): unknown[] {
  return events.map(({ type, seq, data }) => ({ type, seq, data }))
}

function userInput(events: readonly SnapshotEvent[], expected: string): SnapshotEvent[] {
  return events.filter(event => sourceKind(event) === 'user' && JSON.stringify(event.data).includes(expected))
}

function requestText(request: Record<string, unknown> | undefined): string {
  if (!Array.isArray(request?.messages)) return ''
  return request.messages.flatMap((message) => {
    if (!isRecord(message)) return []
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap(block => isRecord(block) && typeof block.text === 'string' ? [block.text] : [])
  }).join('\n')
}

it('projects Native Archify routing through both SDKs and cold-restores one durable Session', async () => {
  const mode = process.env.DSH_SNAPSHOT
  const fixture = join(scenario, 'session.v3.jsonl')
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const tasks = recorded?.filter(event => event.type === 'user/message' && event.data.source.kind === 'user') ?? []
  if (recorded !== undefined && tasks.length !== 2) throw new Error('native-sdk Archify Session must contain automatic and manual inputs')
  const textAt = (index: number): string | undefined => {
    const event = tasks[index]
    return event?.type === 'user/message' ? event.data.content.find(block => block.type === 'text')?.text : undefined
  }
  const initialTask = textAt(0) ?? firstTask
  const resumedTask = textAt(1) ?? manualTask
  if (recorded === undefined && mode !== 'record' && mode !== 'refresh') {
    throw new Error('native-sdk Archify replay requires its committed Session JSONL')
  }

  const acquiredHome = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-archify-'))
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
        const messages = modelRequest.messages as Array<{ readonly role?: string; readonly content?: unknown }>
        if (modelRequests.length > 2 || !messages.some(message => message.role === 'user'
          && JSON.stringify(message.content).includes(modelRequests.length === 1 ? initialTask : resumedTask))) {
          response.writeHead(500)
          response.end('unexpected native-sdk Archify fixture model input')
          return
        }
        respond(response, modelRequests.length === 1 ? 'automatic Archify route observed' : 'manual Archify route observed')
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
    if (address === null || typeof address === 'string') throw new Error('native-sdk Archify fixture has no model endpoint')

    mkdirSync(workspace, { recursive: true })
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-archify-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations,
      { id: 'request-context', plugin: '@deepseek-ai/dsh-request-context', scope: 'root' },
      { id: 'skills', plugin: '@deepseek-ai/dsh-skill', scope: 'root' },
      { id: 'tool-skill', plugin: '@deepseek-ai/dsh-tool-skill', scope: 'root' },
      { id: 'shell-env', plugin: '@deepseek-ai/dsh-shell-env', scope: 'root' },
      { id: 'archify', plugin: '@deepseek-ai/dsh-archify', scope: 'root' },
    ] }))
    writeFileSync(modelPatch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'You are a Native Archify fixture.', maxSteps: 3 } },
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
      const result = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(root, 'snapshots/native-sdk/skills/client.py'), launcher,
        home, workspace, modelPatch, sessionId, initialTask, resumedTask], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'),
          NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' }, timeout: 60_000,
      })
      const output = JSON.parse(result.stdout) as PythonCarrierOutput
      first = output.first
      recovery = output.recovery
    } else {
      const initial = new DeepSeekHarness(options)
      try { first = await initial.session(sessionId).run(initialTask) }
      finally { await initial.close() }
      const cold = new DeepSeekHarness(options)
      try { recovery = await cold.session(sessionId).run(resumedTask) }
      finally { await cold.close() }
    }

    expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(recovery.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(sessionNotifications(first)).toEqual(first.events)
    expect(sessionNotifications(recovery)).toEqual(recovery.events)
    expect(first.finalResponse).toBe('automatic Archify route observed')
    expect(recovery.finalResponse).toBe('manual Archify route observed')
    expect(userInput(first.events, initialTask)).toHaveLength(1)
    expect(userInput(recovery.events, resumedTask)).toHaveLength(1)
    expect(countKind(first.events, 'archify-auto-invocation')).toBe(1)
    expect(countKind(first.events, 'skill-invocation')).toBe(0)
    expect(countKind(recovery.events, 'archify-auto-invocation')).toBe(0)
    expect(countKind(recovery.events, 'skill-invocation')).toBe(1)
    expect(modelRequests).toHaveLength(2)
    const automaticRequest = requestText(modelRequests[0])
    const manualRequest = requestText(modelRequests[1])
    expect(automaticRequest).toContain('<skill_content name="archify">')
    expect(manualRequest).toContain('<skill_content name="archify">')
    expect(manualRequest.split('<skill_content name="archify">')).toHaveLength(3)
    const privateDirectory = archifyShellEnvValues()[ARCHIFY_SKILL_DIRECTORY_ENV]
    expect(JSON.stringify(modelRequests)).not.toContain(JSON.stringify(privateDirectory).slice(1, -1))

    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await backend.list()
      expect(stored.map(item => item.header.id)).toEqual([sessionId])
      const reader = await backend.open(sessionId, 'read')
      try {
        const durableEvents = await reader.read().then(result => result.events as SnapshotEvent[])
        const seedBoundary = durableEvents.find(event => event.type === 'session/end-seed')
        const firstEnd = first.events.at(-1)
        if (seedBoundary === undefined || firstEnd === undefined) throw new Error('native-sdk Archify Session omitted its cold-restore boundary')
        expect(durableEvents.filter(event => event.type === 'session/end-seed')).toHaveLength(1)
        expect(seedBoundary).toMatchObject({ seq: firstEnd.seq + 1, data: {} })
        expect(eventProjection(durableEvents)).toEqual(eventProjection([...first.events, seedBoundary, ...recovery.events]))
        expect(countKind(durableEvents, 'archify-auto-invocation')).toBe(1)
        expect(countKind(durableEvents, 'skill-invocation')).toBe(1)
        expect(JSON.stringify(durableEvents)).not.toContain(JSON.stringify(privateDirectory).slice(1, -1))
      } finally { await reader.close() }
      const sessionFiles = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
      if (sessionFiles.length !== 1) throw new Error('native-sdk Archify writer omitted its Session JSONL')
      raw = readFileSync(join(sessions, sessionFiles[0]!), 'utf8')
    } finally { await backend.close() }

    const header = JSON.parse(raw.split('\n', 1)[0] ?? '') as { cwd?: unknown }
    if (typeof header.cwd !== 'string') throw new Error('native-sdk Archify Session omitted its cwd')
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw,
      { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] }, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] })
    const schemas = normalizedToolSchemas(raw, { sessionIds: [sessionId], cwd: workspace, cwdAliases: [header.cwd] })
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk Archify Session omitted request headers')
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
        'native-sdk Archify fixture cleanup failed')
    }
  }
}, 90_000)
