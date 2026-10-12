/** A bounded Claude Code child records its opaque product result in the real parent Session. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { assertWorkspaceOutsideTemp, outsideTempWorkspaceParent } from '../../rsh/Scripts/snapshot-workspace-parent.ts'
import {
  captureExpectedWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  normalizeSessionSnapshot,
  redactSessionSnapshotIds,
  sessionFixtureName,
  sessionFixtureNames,
} from '../../rsh/Tests/test-support/session-snapshot/src/index.ts'
import { startMessagesFixture } from '../../rsh/Modules/Official/subagent/subagent-claude-code/tests/messages-fixture.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/claude-code')
const fixtureOutput = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const contextProbe = pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href
const task = 'Ask the bounded Claude Code child for one short answer and report it.'
const childAnswer = 'Claude Code fixture answer.'
const fakeApiKey = 'snapshot-only-anthropic-key'

function currentMode(): string | undefined { return process.env.DSH_SNAPSHOT }

function installFixturePackage(profileModules: string, packageName: string, source: string): void {
  const directory = join(profileModules, packageName)
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: packageName,
    type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(directory, 'native.mjs'), source)
}

it('records and cold-replays a Claude Code child through the Native parent Session', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running claude-code.snapshot.ts')
  const mode = currentMode()
  const fixtureNames = readdirSync(scenario).filter(name => name.startsWith('session') && name.endsWith('.jsonl'))
  const selectedFixture = fixtureNames.length === 0 ? undefined : sessionFixtureNames(fixtureNames)[0]
  const fixture = selectedFixture === undefined ? fixtureOutput : join(scenario, selectedFixture)
  const recorded = mode === 'record' || !existsSync(fixture) ? undefined : parseSessionLog(readFileSync(fixture, 'utf8'))
  if (recorded === undefined && mode !== 'record') {
    throw new Error('Claude Code snapshot replay requires its committed Session JSONL')
  }
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const recordedTask = initial?.type === 'user/message' ? initial.data.content[0] : undefined
  if (recorded !== undefined && recordedTask?.type !== 'text') {
    throw new Error('Claude Code snapshot omitted its canonical user task')
  }
  const replayTask = recordedTask?.type === 'text' ? recordedTask.text : task
  const rootScript = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const base = mkdtempSync(join(outsideTempWorkspaceParent(), 'dsh-native-claude-code-snapshot-'))
  const home = join(base, 'home')
  const profile = join(home, 'profiles/native-headless')
  const profileModules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const links: string[] = []
  let messages: Awaited<ReturnType<typeof startMessagesFixture>> | undefined
  let operationFailed = false
  let operationError: unknown
  try {
    messages = await startMessagesFixture({ kind: 'complete', text: childAnswer })
    mkdirSync(profile, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(profileModules, '@deepseek-ai'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-claude-code-profile', private: true,
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
      ['dsh-credentials-local', 'rsh/Modules/Official/credentials/credentials-local'],
      ['dsh-native-sandbox-policy', 'rsh/Modules/Official/sandbox/native-sandbox-policy'],
      ['dsh-subprocess-local', 'rsh/Core/subprocess/subprocess-local'],
      ['dsh-sandbox-local', 'rsh/Modules/Official/sandbox/sandbox-local'],
      ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
      ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
      ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
      ['dsh-tool-fs', 'rsh/Modules/Official/fs/tool-fs'],
      ['dsh-subagent-claude-code', 'rsh/Modules/Official/subagent/subagent-claude-code'],
    ] as const) {
      const link = join(profileModules, '@deepseek-ai', name)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }
    installFixturePackage(profileModules, 'native-claude-parent-model',
      readFileSync(join(scenario, 'fixtures/model.mjs'), 'utf8'))

    const composition = shippedNativeProfileComposition(home, 'native-headless')
    const selected = new Set(['app', 'agents', 'model-execution', 'session-execution', 'tools', 'prompt', 'subagents', 'storage',
      'fs', 'policy', 'file-tools', 'pi-ai', 'credentials', 'sandbox-policy', 'subprocess', 'sandbox'])
    const installations = composition.installations.map(row => {
      if (!selected.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'fixture', model: 'fixture',
        systemPrompt: 'Delegate one bounded task to Claude Code and report its final answer.', maxSteps: 3, builtinTools: false } }
      if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'workspace-write', workspaceRoot: workspace } }
      if (row.id === 'session-execution') return row
      if (row.id === 'subagents') return { ...row, config: { providerName: 'claude-code' } }
      if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
      if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
      if (row.id === 'pi-ai') return { ...row, plugin: 'native-claude-parent-model',
        config: { ...(rootScript === undefined ? {} : { script: rootScript }) } }
      return row
    })
    const subagentIndex = installations.findIndex(row => row.id === 'subagents')
    if (subagentIndex < 0) throw new Error('native-headless template omitted NativeSubagent')
    installations.splice(subagentIndex, 0, {
      id: 'claude-code-driver',
      plugin: '@deepseek-ai/dsh-subagent-claude-code',
      scope: 'root',
      config: { name: 'claude-code', model: 'claude-code-snapshot-fixture', apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrl: messages.baseUrl },
    })
    installations.push({ id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: 'root',
      config: { toolName: 'subagent', maxDepth: 1 } })
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

    assertWorkspaceOutsideTemp(base)
    const child = await execa(process.execPath, [
      '--import', contextProbe, bin, '--profile', 'native-headless', replayTask,
    ], { env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: undefined, ANTHROPIC_API_KEY: fakeApiKey,
      ANTHROPIC_AUTH_TOKEN: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined }, reject: false, timeout: 45_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toBe('done')
    await messages.requestStarted
    expect(messages.requests).toHaveLength(1)
    expect(messages.requests[0]?.body.model).toBe('claude-code-snapshot-fixture')
    expect(messages.requests[0]?.headers['x-api-key']).toBe(fakeApiKey)

    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await storage.list()
      expect(stored).toHaveLength(1)
      const id = stored[0]?.header.id
      if (id === undefined) throw new Error('Claude Code snapshot omitted its parent Session identity')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const started = events.find(event => event.type === 'subagent/external-start')
        const ended = events.find(event => event.type === 'subagent/external-end')
        const parentCall = events.find(event => event.type === 'tool/call' && event.data.name === 'subagent')
        const parentResult = events.find(event => event.type === 'tool/result'
          && parentCall?.type === 'tool/call' && event.data.message.source.callId === parentCall.data.callId)
        expect(events.filter(event => event.type === 'subagent/external-operation')).toHaveLength(0)
        expect(started?.type).toBe('subagent/external-start')
        expect(ended?.type).toBe('subagent/external-end')
        expect(parentCall?.type).toBe('tool/call')
        expect(parentResult?.type).toBe('tool/result')
        if (started?.type !== 'subagent/external-start' || ended?.type !== 'subagent/external-end'
          || parentCall?.type !== 'tool/call' || parentResult?.type !== 'tool/result') {
          throw new Error('Claude Code Session omitted parent delegation or child lifecycle')
        }
        expect(started.data.provider).toBe('claude-code')
        expect(started.data.remoteId.length).toBeGreaterThan(0)
        expect(ended.data).toMatchObject({ id: started.data.id, provider: 'claude-code',
          remoteId: started.data.remoteId, stopReason: 'completed' })
        expect(parentResult.seq).toBeGreaterThan(ended.seq)
        expect(JSON.stringify(parentResult.data.message.content)).toContain(childAnswer)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } finally { await reader.close() }

      const currentName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const storedName = readdirSync(sessions, { recursive: true })
        .find((name): name is string => typeof name === 'string' && name.endsWith(currentName))
      if (storedName === undefined) throw new Error('Claude Code parent writer omitted the current Session JSONL')
      raw = readFileSync(join(sessions, storedName), 'utf8')
      const context = { sessionIds: stored.map(item => item.header.id), cwd: workspace }
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context,
        { identityMode: 'preserve' })
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (prompts[0] === undefined || schemas[0] === undefined) {
        throw new Error('Claude Code parent Session omitted its request header')
      }
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
  } catch (error) {
    operationFailed = true
    operationError = error
    throw error
  } finally {
    const cleanupErrors: unknown[] = []
    if (messages !== undefined) {
      try { await messages.close() } catch (error) { cleanupErrors.push(error) }
    }
    try {
      for (const link of links) {
        if (existsSync(link)) unlinkSync(link)
      }
    } catch (error) { cleanupErrors.push(error) }
    try {
      rmSync(base, { recursive: true, force: true })
      if (lstatSync(base, { throwIfNoEntry: false }) !== undefined) throw new Error('Claude Code snapshot temp directory remained')
    } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(operationFailed ? [operationError, ...cleanupErrors] : cleanupErrors,
        'Claude Code snapshot fixture cleanup failed')
    }
  }
})
