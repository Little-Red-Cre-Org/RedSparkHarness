/** Native SDK projections and process-cold recovery for external child operation facts. */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { createServer, type ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { DeepSeekHarness, type NativeExternalOperationSessionEvent } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { serializeNativeExternalJson } from '@deepseek-ai/dsh-native-subagent'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { assertWorkspaceOutsideTemp, outsideTempWorkspaceParent } from '../../rsh/Scripts/snapshot-workspace-parent.ts'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, formatSystemPromptSnapshot,
  formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas, normalizeSessionSnapshot,
  parseSessionFixtureName, redactSessionSnapshotIds, sessionFixtureName, sessionFixtureNames }
  from '../../rsh/Tests/test-support/session-snapshot/src/index.ts'
import { normalizeWorkspacePaths } from '../native-headless/external-operation/fixtures/workspace-paths.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/external-operation')
const sessionId = SessionId('sdk-native-external-operation')
const task = 'Delegate one filesystem change to an external child and report completion.'
const recoveryTask = 'Continue after an external SDK process restart.'
const kinds = ['model-request', 'model-failure', 'model-request', 'model-response', 'tool-call', 'tool-result',
  'tool-settlement', 'model-request', 'model-response']

interface CarrierRun {
  events: Array<{ type: string; data: unknown }>
  notifications: Array<{ method: string; params: Record<string, unknown> }>
  finalResponse: string
}

interface PythonCarrierOutput {
  first: CarrierRun
  recovery: CarrierRun
}

function completion(response: ServerResponse, chunks: Record<string, unknown>[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''))
}

function recordedChildOutput(events: ReturnType<typeof parseSessionLog>): unknown[] {
  const call = events.find(event => event.type === 'tool/call' && event.data.name === 'subagent')
  if (call?.type !== 'tool/call') throw new Error('native-sdk external-operation fixture omitted its delegation call')
  const result = events.find(event => event.type === 'tool/result' && event.data.message.source.callId === call.data.callId)
  if (result?.type !== 'tool/result') throw new Error('native-sdk external-operation fixture omitted its delegation result')
  const block = result.data.message.content.find(item => item.type === 'tool-result' && item.toolCallId === call.data.callId)
  if (block?.type !== 'tool-result') throw new Error('native-sdk external-operation fixture omitted its delegated output')
  return block.content
}

function recordedUserInputs(events: ReturnType<typeof parseSessionLog>): string[] {
  return events.flatMap(event => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const text = event.data.content.find(block => block.type === 'text')
    return text?.type === 'text' ? [text.text] : []
  })
}

function normalizeRecordedSessionPaths(raw: string): string {
  const header = JSON.parse(raw.split('\n', 1)[0] ?? '') as { cwd?: unknown }
  if (typeof header.cwd !== 'string') throw new Error('native-sdk external-operation fixture omitted its workspace cwd')
  const slashCwd = header.cwd.replaceAll('\\', '/')
  const backslashCwd = slashCwd.replaceAll('/', '\\')
  const aliases = [...new Set([slashCwd, backslashCwd, slashCwd.replaceAll('/', '//'),
    backslashCwd.replaceAll('\\', '\\\\')])]
  return normalizeSessionSnapshot(raw, { sessionIds: [sessionId], cwd: header.cwd, cwdAliases: aliases },
    { identityMode: 'preserve' }).replace(/\{\{cwd\}\}[\\/]{2,}/gu, '{{cwd}}/')
}

function normalizeExternalRequestBodies(raw: string, cwdAliases: readonly string[]): string {
  return raw.split('\n').map(line => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    if (record.type === 'subagent/external-operation' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if (data.kind === 'model-request' && typeof data.requestBody === 'string') {
        const normalized = cwdAliases.reduce((request, cwd) => normalizeWorkspacePaths(request, cwd),
          JSON.parse(data.requestBody))
        data.requestBody = serializeNativeExternalJson(normalized).replace(/\{\{cwd\}\}[\\/]{2,}/gu, '{{cwd}}/')
      }
    }
    return JSON.stringify(record)
  }).join('\n')
}

it('projects external child facts through both SDKs and cold-restores the native Session', async () => {
  const mode = process.env.DSH_SNAPSHOT
  const fixtureNames = readdirSync(scenario).filter(name => parseSessionFixtureName(name) !== undefined)
  const selectedName = fixtureNames.length === 0 ? undefined : sessionFixtureNames(fixtureNames)[0]
  const fixture = selectedName === undefined ? undefined : join(scenario, selectedName)
  const recorded = mode === 'record' || fixture === undefined ? undefined
    : parseSessionLog(normalizeRecordedSessionPaths(readFileSync(fixture, 'utf8')))
  if (recorded === undefined && mode !== 'record' && mode !== 'refresh') {
    throw new Error('native-sdk external-operation replay requires its committed Session JSONL')
  }
  const priorInputs = recorded === undefined ? [] : recordedUserInputs(recorded)
  if (recorded !== undefined && priorInputs.length !== 2) {
    throw new Error('native-sdk external-operation Session must contain its delegation and cold-recovery inputs')
  }
  const firstTask = priorInputs[0] ?? task
  const coldTask = priorInputs[1] ?? recoveryTask
  const priorOperations = recorded?.filter((event): event is NativeExternalOperationSessionEvent =>
    event.type === 'subagent/external-operation') ?? []
  if (recorded !== undefined && priorOperations.length !== kinds.length) {
    throw new Error('native-sdk external-operation Session omitted a recorded operation fact')
  }

  const baseParent = outsideTempWorkspaceParent()
  const base = mkdtempSync(join(baseParent, 'dsh-native-sdk-external-operation-'))
  const home = join(base, 'home')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'native-sdk')
  const profileModules = join(profile, 'node_modules')
  const processIdsPath = join(home, 'runtime-process-ids.txt')
  const driverStartsPath = join(home, 'external-driver-starts.jsonl')
  const modelPatch = join(home, 'model.patch.json')
  const externalPatch = join(home, 'external-operation.patch.json')
  const externalPackage = join(profileModules, 'native-sdk-external-operation-driver')
  const links: string[] = []
  const modelRequests: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const modelRequest = JSON.parse(body) as Record<string, unknown>
      modelRequests.push(modelRequest)
      const messages = modelRequest.messages as Array<{ role: string; content: unknown }>
      const last = messages.at(-1)
      if (last?.role === 'user' && last.content === firstTask) {
        completion(response, [
          { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'sdk-external-child',
            type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ description: 'external SDK child',
              prompt: 'Create one file using the write tool, then report the result.' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ])
      } else if (last?.role === 'user' && last.content === coldTask) {
        completion(response, [
          { choices: [{ delta: { role: 'assistant', content: 'cold SDK Session restored' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ])
      } else if (last?.role === 'tool') {
        completion(response, [
          { choices: [{ delta: { role: 'assistant', content: 'external child completed' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ])
      } else {
        response.writeHead(500)
        response.end('unexpected fixture model input')
      }
    })
  })

  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-sdk external-operation fixture has no model endpoint')

  try {
    mkdirSync(workspace, { recursive: true })
    mkdirSync(profile, { recursive: true })
    mkdirSync(join(profileModules, '@deepseek-ai'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-external-operation-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    const driverConfig = {
      processIdPath: processIdsPath,
      startLogPath: driverStartsPath,
      ...(priorOperations.length === 0 ? {} : {
        operationScript: priorOperations.map(event => event.data), childOutput: recordedChildOutput(recorded ?? []),
      }),
    }
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations,
      { id: 'external-driver', scope: 'root', plugin: 'native-sdk-external-operation-driver', config: driverConfig, disabled: true },
      { id: 'policy', scope: 'root', plugin: '@deepseek-ai/dsh-fs-observation-policy', disabled: true },
      { id: 'file-tools', scope: 'root', plugin: '@deepseek-ai/dsh-tool-fs', disabled: true },
    ] }))

    for (const [name, path] of [
      ['dsh-native-subagent', 'rsh/Engine/subagent/native-subagent'],
      ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
      ['dsh-tool-fs', 'rsh/Modules/Official/fs/tool-fs'],
    ] as const) {
      const link = join(profileModules, '@deepseek-ai', name)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }

    mkdirSync(externalPackage, { recursive: true })
    copyFileSync(join(root, 'snapshots/native-headless/external-operation/fixtures/driver.mjs'), join(externalPackage, 'driver.mjs'))
    copyFileSync(join(root, 'snapshots/native-headless/external-operation/fixtures/workspace-paths.mjs'),
      join(externalPackage, 'workspace-paths.mjs'))
    writeFileSync(join(externalPackage, 'native.mjs'), [
      "import { appendFileSync } from 'node:fs'",
      "import { plugin as driver } from './driver.mjs'",
      'export const plugin = { ...driver, resolve(input) {',
      '  const activate = driver.resolve(input)',
      '  return context => {',
      '    appendFileSync(input.processIdPath, `${process.pid}\\n`)',
      '    return activate({ provide(name, service) {',
      '      if (name !== \'externalSubagentDriver\') return context.provide(name, service)',
      '      const start = service.start',
      '      return context.provide(name, { ...service, start(...args) {',
      '        appendFileSync(input.startLogPath, JSON.stringify({ pid: process.pid }) + \'\\n\')',
      '        return Reflect.apply(start, service, args)',
      '      } })',
      '    } })',
      '  }',
      '} }',
      '',
    ].join('\n'))
    writeFileSync(join(externalPackage, 'package.json'), JSON.stringify({ name: 'native-sdk-external-operation-driver', type: 'module',
      exports: { './package.json': './package.json', './native': './native.mjs' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [],
        provides: ['externalSubagentDriver'] } } }))

    writeFileSync(modelPatch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'Delegate one file creation to the external child.', maxSteps: 3 } },
      { id: 'storage', config: { root: sessions, compression: 'none' } },
      { id: 'fs', config: { cwd: workspace } },
      { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
        baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text'] }] } } } },
    ] }))
    writeFileSync(externalPatch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { systemPrompt: 'Delegate one file creation to the external child.', maxSteps: 3 } },
      { id: 'subagent-tool', config: { toolName: 'subagent', maxDepth: 1 } },
      { id: 'subagents', config: { providerName: 'external-fixture' } },
      { id: 'workflow-worker', config: { subagentProvider: 'external-fixture' } },
      { id: 'ralph-tool', disabled: true },
      { id: 'external-driver', config: driverConfig, disabled: false },
      { id: 'policy', disabled: false },
      { id: 'file-tools', disabled: false },
    ] }))
    const options = { profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), dshHome: home,
      patches: [modelPatch, externalPatch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
      env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' }, requestTimeoutMs: 20_000 }
    const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
    writeFileSync(launcher, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
    if (process.platform !== 'win32') {
      const { chmodSync } = await import('node:fs')
      chmodSync(launcher, 0o700)
    }

    let first: CarrierRun
    let recovery: CarrierRun
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const result = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(scenario, 'client.py'), launcher, home,
        workspace, modelPatch, externalPatch, sessionId, firstTask, coldTask], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'), NATIVE_SDK_FIXTURE_KEY: 'fixture-key' },
        timeout: 60_000,
      })
      const output = JSON.parse(result.stdout) as PythonCarrierOutput
      first = output.first
      recovery = output.recovery
    } else {
      const initial = new DeepSeekHarness(options)
      try { first = await initial.session(sessionId).run(firstTask) }
      finally { await initial.close() }
      const cold = new DeepSeekHarness(options)
      try { recovery = await cold.session(sessionId).run(coldTask) }
      finally { await cold.close() }
    }

    const processIds = readFileSync(processIdsPath, 'utf8').trim().split(/\r?\n/u).map(Number)
    expect(processIds).toHaveLength(2)
    expect(processIds.every(Number.isSafeInteger)).toBe(true)
    expect(new Set(processIds).size).toBe(2)
    const driverStarts = readFileSync(driverStartsPath, 'utf8').trim().split(/\r?\n/u)
      .map(line => JSON.parse(line) as { pid: number })
    expect(driverStarts).toEqual([{ pid: processIds[0] }])
    expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(recovery.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(first.finalResponse).toBe('external child completed')
    expect(recovery.finalResponse).toBe('cold SDK Session restored')

    const firstOperations = first.events.filter((event): event is NativeExternalOperationSessionEvent =>
      event.type === 'subagent/external-operation')
    const notifications = first.notifications.filter(notification => notification.method === 'session.event'
      && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as { type: string; data: unknown })
      .filter(event => event.type === 'subagent/external-operation')
    expect(firstOperations).toHaveLength(kinds.length)
    expect(firstOperations.map(event => event.data.kind)).toEqual(kinds)
    expect(firstOperations).toEqual(notifications)
    expect(recovery.events.filter(event => event.type === 'subagent/external-operation')).toEqual([])

    expect(modelRequests).toHaveLength(3)
    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await backend.list()
      expect(stored.map(item => item.header.id)).toEqual([sessionId])
      const reader = await backend.open(sessionId, 'read')
      try {
        const persisted = (await reader.read()).events
        const persistedOperations = persisted.filter((event): event is NativeExternalOperationSessionEvent =>
          event.type === 'subagent/external-operation')
        expect(persistedOperations).toEqual(firstOperations)
        expect(persisted.filter(event => event.type === 'user/message'
          && event.data.source.kind === 'user')).toHaveLength(2)
      } finally { await reader.close() }
      const sessionFiles = readdirSync(sessions, { recursive: true }).map(String).filter(name =>
        basename(dirname(name)) === sessionId && parseSessionFixtureName(basename(name)) !== undefined)
      const storedName = sessionFixtureNames(sessionFiles.map(name => basename(name)))[0]
      const storedPath = sessionFiles.find(name => basename(name) === storedName)
      if (storedName === undefined || storedPath === undefined) {
        throw new Error('native-sdk external-operation writer omitted its Session JSONL')
      }
      raw = readFileSync(join(sessions, storedPath), 'utf8')
    } finally { await backend.close() }

    const cwdAliases = [...new Set([workspace, realpathSync(workspace), realpathSync.native(workspace)]
      .flatMap(cwd => {
        const slash = cwd.replaceAll('\\', '/')
        const backslash = slash.replaceAll('/', '\\')
        return [cwd, JSON.stringify(cwd).slice(1, -1), slash, slash.replaceAll('/', '//'), backslash,
          backslash.replaceAll('\\', '\\\\')]
      }))].sort((left, right) => right.length - left.length)
    const context = { sessionIds: [sessionId], cwd: workspace, cwdAliases }
    const embedded = normalizeExternalRequestBodies(raw, cwdAliases)
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([embedded])[0] ?? embedded, context,
      { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) {
      throw new Error('native-sdk external-operation Session omitted its prompt or tool schemas')
    }
    const outputName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    if (mode === 'record' || mode === 'refresh') {
      writeFileSync(join(scenario, outputName), normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
    } else {
      expect(normalized).toBe(readFileSync(join(scenario, outputName), 'utf8'))
      expect(formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        .toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
        .toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
    assertWorkspaceOutsideTemp(base)
    expect(await captureWorkspaceSnapshot(workspace)).toEqual(
      await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    const status = lstatSync(base)
    if (!status.isDirectory() || status.isSymbolicLink() || !basename(base).startsWith('dsh-native-sdk-external-operation-')
      || dirname(realpathSync(base)) !== realpathSync(baseParent) || realpathSync(base) !== resolve(base)) {
      throw new Error('native-sdk external-operation: unsafe temporary directory')
    }
    for (const link of links) unlinkSync(link)
    rmSync(base, { recursive: true, force: true })
  }
}, 90_000)
