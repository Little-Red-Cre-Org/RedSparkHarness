/** Native Agent Teams exposes its nine tools and records durable task events through a shipped profile. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { assertWorkspaceOutsideTemp, outsideTempWorkspaceParent } from '../../rsh/Scripts/snapshot-workspace-parent.ts'
import {
  captureExpectedWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizeSessionSnapshot,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  redactSessionSnapshotIds,
  sessionFixtureName,
} from '../../rsh/Tests/test-support/session-snapshot/src/index.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/agent-teams')
const fixtureOutput = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const contextProbe = pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href
const task = 'Create one shared Team task and confirm the roster.'

function currentMode(): string | undefined { return process.env.RSH_SNAPSHOT }

/** Materialize the snapshot-only model package inside the profile's module tree. */
function installFixtureModel(profileModules: string): void {
  const directory = join(profileModules, 'native-agent-teams-model')
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'native-agent-teams-model',
    version: '0.0.0',
    type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(directory, 'native.mjs'), readFileSync(join(scenario, 'fixtures/model.mjs'), 'utf8'))
}

it('records and cold-replays a Native Agent Teams turn', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running agent-teams-native.snapshot.ts')
  const mode = currentMode()
  const recorded = mode === 'record' || !existsSync(fixtureOutput)
    ? undefined
    : parseSessionLog(readFileSync(fixtureOutput, 'utf8'))
  if (recorded === undefined && mode !== 'record') {
    throw new Error('Agent Teams snapshot replay requires its committed Session JSONL')
  }
  const rootScript = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const base = mkdtempSync(join(outsideTempWorkspaceParent(), 'dsh-native-agent-teams-snapshot-'))
  const home = join(base, 'home')
  const profile = join(home, 'profiles/native-headless')
  const profileModules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const links: string[] = []
  let operationFailed = false
  let operationError: unknown
  try {
    mkdirSync(profile, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(profileModules, '@redspark'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-agent-teams-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))

    for (const [name, path] of [
      ['rsh-native-headless', 'rsh/Engine/core/native-headless'],
      ['rsh-native-agent', 'rsh/Engine/core/native-agent'],
      ['rsh-native-tools', 'rsh/Engine/core/native-tools'],
      ['rsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
      ['rsh-native-session-execution', 'rsh/Engine/core/native-session-execution'],
      ['rsh-native-prompt', 'rsh/Engine/core/native-prompt'],
      ['rsh-native-subagent', 'rsh/Engine/subagent/native-subagent'],
      ['rsh-native-sandbox-policy', 'rsh/Modules/Official/sandbox/native-sandbox-policy'],
      ['rsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
      ['rsh-session-projection', 'rsh/Engine/session/session-projection'],
      ['rsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
      ['rsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
      ['rsh-tool-fs', 'rsh/Modules/Official/fs/tool-fs'],
      ['rsh-experimental-agent-team', 'rsh/Modules/Community/experimental/agent-team'],
      ['rsh-experimental-tool-agent-team', 'rsh/Modules/Community/experimental/tool-agent-team'],
    ] as const) {
      const link = join(profileModules, '@redspark', name)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }
    installFixtureModel(profileModules)

    const composition = shippedNativeProfileComposition(home, 'native-headless')
    const selected = new Set(['app', 'agents', 'model-execution', 'session-execution', 'tools', 'prompt', 'subagents',
      'storage', 'fs', 'policy', 'file-tools', 'pi-ai', 'sandbox-policy'])
    const installations = composition.installations.map((row) => {
      if (!selected.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'fixture', model: 'fixture',
        systemPrompt: 'Create one shared Team task, list the roster, then answer DONE.', maxSteps: 4, builtinTools: false } }
      if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
      if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'danger-full-access', workspaceRoot: workspace } }
      if (row.id === 'pi-ai') {
        return { ...row, plugin: 'native-agent-teams-model',
          config: { ...(rootScript === undefined ? {} : { script: rootScript }) } }
      }
      return row
    })
    installations.push(
      { id: 'session-projection', plugin: '@redspark/rsh-session-projection', scope: 'root' },
      { id: 'agent-team', plugin: '@redspark/rsh-experimental-agent-team', scope: 'root' },
      { id: 'tool-agent-team', plugin: '@redspark/rsh-experimental-tool-agent-team', scope: 'root' },
    )
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

    assertWorkspaceOutsideTemp(base)
    const child = await execa(process.execPath, [
      '--import', contextProbe, bin, '--profile', 'native-headless', task,
    ], { env: { ...process.env, RSH_HOME: home, DEEPSEEK_API_KEY: undefined }, reject: false, timeout: 45_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toContain('DONE')

    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const stored = await storage.list()
      expect(stored).toHaveLength(1)
      const id = stored[0]?.header.id
      if (id === undefined) throw new Error('Agent Teams snapshot omitted its Session identity')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const calls = events.filter(event => event.type === 'tool/call').map(event => event.data.name)
        expect(calls).toEqual(['team_task_create', 'team_task_list'])
        expect(events.filter(event => event.type === 'team/task')).toHaveLength(1)
        const created = events.find(event => event.type === 'tool/call' && event.data.name === 'team_task_create')
        const result = events.find(event => event.type === 'tool/result' && created?.type === 'tool/call'
          && event.data.message.source.callId === created.data.callId)
        expect(result?.type).toBe('tool/result')
        if (result?.type !== 'tool/result') throw new Error('Agent Teams snapshot omitted the creation result')
        expect(JSON.stringify(result.data.message.content)).toContain('Snapshot task')
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } finally { await reader.close() }

      const currentName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const storedName = readdirSync(sessions, { recursive: true })
        .find((name): name is string => typeof name === 'string' && name.endsWith(currentName))
      if (storedName === undefined) throw new Error('Agent Teams snapshot omitted the current Session JSONL')
      raw = readFileSync(join(sessions, storedName), 'utf8')
      const context = {
        sessionIds: stored.map(item => item.header.id),
        cwd: workspace,
        cwdAliases: [JSON.stringify(workspace).slice(1, -1)],
      }
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context,
        { identityMode: 'preserve' })
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (prompts[0] === undefined || schemas[0] === undefined) {
        throw new Error('Agent Teams snapshot omitted its request header')
      }
      if (mode === 'record' || mode === 'refresh') {
        writeFileSync(fixtureOutput, normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
      } else {
        expect(normalized).toBe(readFileSync(fixtureOutput, 'utf8'))
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
    try {
      for (const link of links) {
        if (existsSync(link)) unlinkSync(link)
      }
    } catch (error) { cleanupErrors.push(error) }
    try {
      rmSync(base, { recursive: true, force: true })
    } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(operationFailed ? [operationError, ...cleanupErrors] : cleanupErrors,
        'Agent Teams snapshot fixture cleanup failed')
    }
  }
})
