/** A captured external child records its model, tool and filesystem work in the real parent Session. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type { NativeExternalJsonValue } from '@deepseek-ai/dsh-native-subagent'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { assertWorkspaceOutsideTemp } from '../../rsh/Scripts/snapshot-workspace-parent.ts'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, formatSystemPromptSnapshot,
  formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas, normalizeSessionSnapshot,
  redactSessionSnapshotIds, sessionFixtureName, sessionFixtureNames } from '../../rsh/Tests/test-support/session-snapshot/src/index.ts'
import { serializeNativeExternalJson } from '../../rsh/Engine/subagent/native-subagent/src/index.ts'
import { normalizeWorkspacePaths } from './external-operation/fixtures/workspace-paths.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/external-operation')
const fixtureOutput = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const contextProbe = pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href
const task = 'Delegate one filesystem change to an external child and report completion.'

function currentMode(): string | undefined { return process.env.DSH_SNAPSHOT }

function recordedChildOutput(events: ReturnType<typeof parseSessionLog>): unknown[] {
  const call = events.find(event => event.type === 'tool/call' && event.data.name === 'subagent')
  if (call?.type !== 'tool/call') throw new Error('external-operation fixture omitted the parent delegation call')
  const result = events.find(event => event.type === 'tool/result' && event.data.message.source.callId === call.data.callId)
  if (result?.type !== 'tool/result') throw new Error('external-operation fixture omitted the parent delegation result')
  const block = result.data.message.content.find(item => item.type === 'tool-result' && item.toolCallId === call.data.callId)
  if (block?.type !== 'tool-result') throw new Error('external-operation fixture omitted the delegated result content')
  return block.content
}

function plainText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') throw new Error('external-operation fixture expected text-only tool output')
    return block.text
  }).join('\n')
}

function responseInputs(messages: readonly { readonly content: readonly { readonly type: string; readonly text?: string }[] }[]) {
  return messages.map(message => ({ role: 'user', content: message.content.map(block => {
    if (block.type !== 'text' || block.text === undefined) throw new Error('external-operation cold replay expected text-only context')
    return { type: 'input_text', text: block.text }
  }) }))
}

function normalizeEmbeddedExternalRequestBodies(raw: string, cwd: string): string {
  return raw.split('\n').map(line => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    if (record.type === 'subagent/external-operation' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if (data.kind === 'model-request' && typeof data.requestBody === 'string') {
        const requestBody = JSON.parse(data.requestBody) as NativeExternalJsonValue
        data.requestBody = serializeNativeExternalJson(normalizeWorkspacePaths(requestBody, cwd))
      }
    }
    return JSON.stringify(record)
  }).join('\n')
}

function installFixturePackage(profileModules: string, packageName: string, source: string, provides: string[]): void {
  const directory = join(profileModules, packageName)
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: packageName, version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides } },
  }))
  copyFileSync(source, join(directory, 'native.mjs'))
}

it('records and cold-replays external child model, filesystem and settlement facts through dsh', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running native external-operation snapshot')
  const mode = currentMode()
  const fixtureNames = readdirSync(scenario).filter(name => name.startsWith('session') && name.endsWith('.jsonl'))
  const selectedFixture = fixtureNames.length === 0 ? undefined : sessionFixtureNames(fixtureNames)[0]
  const fixture = selectedFixture === undefined ? fixtureOutput : join(scenario, selectedFixture)
  const recorded = mode === 'record' || !existsSync(fixture) ? undefined : parseSessionLog(readFileSync(fixture, 'utf8'))
  if (recorded === undefined && mode !== 'record') {
    throw new Error('native external-operation replay requires its committed Session JSONL')
  }
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const recordedTask = initial?.type === 'user/message' ? initial.data.content[0] : undefined
  if (recorded !== undefined && recordedTask?.type !== 'text') {
    throw new Error('native external-operation fixture omitted its canonical user task')
  }
  const replayTask = recordedTask?.type === 'text' ? recordedTask.text : task
  const rootScript = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const operationScript = recorded?.flatMap(event => event.type === 'subagent/external-operation' ? [event.data] : [])
  const childOutput = recorded === undefined ? undefined : recordedChildOutput(recorded)
  const base = mkdtempSync(join(homedir(), '.dsh-native-external-operation-'))
  const home = join(base, 'home')
  const profile = join(home, 'profiles/native-headless')
  const profileModules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const links: string[] = []
  try {
    mkdirSync(home)
    mkdirSync(profile, { recursive: true })
    mkdirSync(workspace)
    mkdirSync(join(profileModules, '@deepseek-ai'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-external-operation-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))

    for (const [name, path] of [
      ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
      ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
      ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
      ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
      ['dsh-native-session-execution', 'rsh/Engine/core/native-session-execution'],
      ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
      ['dsh-native-subagent', 'rsh/Engine/subagent/native-subagent'],
      ['dsh-tool-subagent', 'rsh/Engine/subagent/tool-subagent'],
      ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
      ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
      ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
      ['dsh-tool-fs', 'rsh/Modules/Official/fs/tool-fs'],
    ] as const) {
      const link = join(profileModules, '@deepseek-ai', name)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }

    installFixturePackage(profileModules, 'native-external-operation-model',
      join(scenario, 'fixtures/model.mjs'), ['model'])
    installFixturePackage(profileModules, 'native-external-operation-driver',
      join(scenario, 'fixtures/driver.mjs'), ['externalSubagentDriver'])
    copyFileSync(join(scenario, 'fixtures/workspace-paths.mjs'),
      join(profileModules, 'native-external-operation-driver/workspace-paths.mjs'))

    const composition = shippedNativeProfileComposition(home, 'native-headless')
    const selected = new Set(['app', 'agents', 'model-execution', 'session-execution', 'tools', 'prompt', 'subagents', 'storage',
      'fs', 'policy', 'file-tools', 'pi-ai'])
    const installations = composition.installations.map(row => {
      if (!selected.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'fixture', model: 'fixture',
        systemPrompt: 'Delegate one file creation to the external child.', maxSteps: 3, builtinTools: false } }
      if (row.id === 'session-execution') return row
      if (row.id === 'subagents') return { ...row, config: { providerName: 'external-fixture' } }
      if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
      if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
      if (row.id === 'pi-ai') return { ...row, plugin: 'native-external-operation-model',
        config: { ...(rootScript === undefined ? {} : { script: rootScript }) } }
      return row
    })
    const subagentIndex = installations.findIndex(row => row.id === 'subagents')
    if (subagentIndex < 0) throw new Error('native-headless template omitted NativeSubagent')
    installations.splice(subagentIndex, 0, { id: 'external-driver', plugin: 'native-external-operation-driver', scope: 'root',
      config: { ...(operationScript === undefined ? {} : { operationScript }), ...(childOutput === undefined ? {} : { childOutput }) } })
    installations.push({ id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: 'root',
      config: { toolName: 'subagent', maxDepth: 1 } })
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

    assertWorkspaceOutsideTemp(base)
    const child = await execa(process.execPath, [
      '--import', contextProbe, bin, '--profile', 'native-headless', replayTask,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 45_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toBe('done')
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe('written by the external child\n')

    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await storage.list()
      expect(stored).toHaveLength(1)
      const id = stored[0]?.header.id
      if (id === undefined) throw new Error('external-operation cold Session omitted its identity')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const operations = events.filter(event => event.type === 'subagent/external-operation')
        expect(operations.map(event => event.data.kind)).toEqual([
          'model-request', 'model-failure', 'model-request', 'model-response', 'tool-call', 'tool-result',
          'tool-settlement', 'model-request', 'model-response',
        ])
        const requests = operations.filter(event => event.type === 'subagent/external-operation' && event.data.kind === 'model-request')
        const failure = operations.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'model-failure')
        const response = operations.find(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-response' && event.data.sequence === 2)
        const finalResponse = operations.find(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-response' && event.data.sequence === 3)
        const call = operations.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-call')
        const result = operations.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-result')
        const settlement = operations.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-settlement')
        if (requests.length !== 3 || requests[0]?.type !== 'subagent/external-operation' || requests[0].data.kind !== 'model-request'
          || requests[1]?.type !== 'subagent/external-operation' || requests[1].data.kind !== 'model-request'
          || requests[2]?.type !== 'subagent/external-operation' || requests[2].data.kind !== 'model-request'
          || failure?.type !== 'subagent/external-operation' || failure.data.kind !== 'model-failure'
          || response?.type !== 'subagent/external-operation' || response.data.kind !== 'model-response'
          || finalResponse?.type !== 'subagent/external-operation' || finalResponse.data.kind !== 'model-response'
          || call?.type !== 'subagent/external-operation' || call.data.kind !== 'tool-call'
          || result?.type !== 'subagent/external-operation' || result.data.kind !== 'tool-result'
          || settlement?.type !== 'subagent/external-operation' || settlement.data.kind !== 'tool-settlement') {
          throw new Error('external-operation cold Session omitted an attempt or tool fact')
        }
        expect(requests.map(event => event.type === 'subagent/external-operation' && event.data.kind === 'model-request'
          ? event.data.sequence : undefined)).toEqual([1, 2, 3])
        expect(failure.data).toMatchObject({ sequence: 1, failure: { kind: 'transport' } })
        expect(response.data.sequence).toBe(2)
        expect(finalResponse.data.sequence).toBe(3)
        expect(requests[1].data.requestBody).toBe(requests[0].data.requestBody)
        expect(call.data).toMatchObject({ modelSequence: 2, name: 'write', arguments: {
          file_path: 'created.txt', content: 'written by the external child\n',
        } })
        expect(response.data.toolCalls).toEqual([{ callId: call.data.callId, name: call.data.name, arguments: call.data.arguments }])
        expect(result.data).toMatchObject({ modelSequence: 2, callId: call.data.callId, name: 'write' })
        expect(settlement.data).toMatchObject({ modelSequence: 2, callId: call.data.callId, concludesTurn: false })
        expect(plainText(result.data.result.content)).toContain('<type>file</type>')
        expect(plainText(result.data.result.content)).toContain('Created file')

        const started = events.find(event => event.type === 'subagent/external-start')
        const ended = events.find(event => event.type === 'subagent/external-end')
        const parentCall = events.find(event => event.type === 'tool/call' && event.data.name === 'subagent')
        const parentResult = events.find(event => event.type === 'tool/result'
          && parentCall?.type === 'tool/call' && event.data.message.source.callId === parentCall.data.callId)
        if (started?.type !== 'subagent/external-start' || ended?.type !== 'subagent/external-end'
          || parentCall?.type !== 'tool/call' || parentResult?.type !== 'tool/result') {
          throw new Error('external-operation cold Session omitted parent or child lifecycle')
        }
        expect(started.data.id).toBe(ended.data.id)
        expect(ended.data.stopReason).toBe('completed')
        expect(operations.every(event => event.data.id === started.data.id
          && event.data.parentSessionId === id && event.data.rootSessionId === id
          && event.data.parentEpoch === started.data.parentEpoch && event.data.rootEpoch === started.data.rootEpoch)).toBe(true)
        expect(parentCall.seq).toBeLessThan(started.seq)
        expect(started.seq).toBeLessThan(operations[0]!.seq)
        expect(operations.at(-1)!.seq).toBeLessThan(ended.seq)
        expect(ended.seq).toBeLessThan(parentResult.seq)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })

        const initialBody = JSON.parse(requests[0].data.requestBody) as Record<string, unknown>
        const completion = JSON.parse(response.data.completed) as { response?: { id?: unknown } }
        if (typeof completion.response?.id !== 'string') throw new Error('external-operation response omitted its id')
        const contexts = [...result.data.result.additionalContexts ?? [], ...settlement.data.settlementContexts]
        const reconstructedBody = serializeNativeExternalJson({ ...initialBody,
          previous_response_id: completion.response.id,
          input: [{ type: 'function_call_output', call_id: call.data.callId,
            output: plainText(result.data.result.content) }, ...responseInputs(contexts)],
        })
        expect(requests[2].data.requestBody).toBe(reconstructedBody)
        const final = JSON.parse(finalResponse.data.completed) as { response?: { output?: unknown[] } }
        expect(final.response?.output).toEqual([])
      } finally { await reader.close() }

      const storedName = readdirSync(sessions, { recursive: true })
        .find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
      if (storedName === undefined) throw new Error('external-operation writer omitted current Session JSONL')
      raw = readFileSync(join(sessions, String(storedName)), 'utf8')
      const context = { sessionIds: stored.map(item => item.header.id), cwd: workspace }
      const embeddedPaths = normalizeEmbeddedExternalRequestBodies(raw, workspace)
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([embeddedPaths])[0] ?? embeddedPaths, context,
        { identityMode: 'preserve' })
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('external-operation Session omitted its request header')
      if (mode === 'record' || mode === 'refresh') {
        writeFileSync(fixtureOutput, normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
      } else {
        expect(normalized).toBe(readFileSync(fixture, 'utf8'))
        expect(formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
          .toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
        expect(formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
          .toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
      }
    } finally { await storage.close() }
    expect(await captureWorkspaceSnapshot(workspace)).toEqual(
      await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))
  } finally {
    const status = lstatSync(base)
    if (!status.isDirectory() || status.isSymbolicLink() || !basename(base).startsWith('.dsh-native-external-operation-')
      || dirname(realpathSync(base)) !== realpathSync(homedir()) || realpathSync(base) !== resolve(base)) {
      throw new Error('external-operation: unsafe temporary base')
    }
    for (const link of links) unlinkSync(link)
    rmSync(base, { recursive: true, force: true })
  }
}, 60_000)
