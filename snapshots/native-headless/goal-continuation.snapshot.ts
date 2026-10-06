/** Shipped native headless Goal tools and continuation through the built dsh entry. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName,
} from '@deepseek-ai/dsh-session-snapshot'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const scenario = join(root, 'snapshots/native-headless/goal-continuation')
const snapshotPath = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))

function normalizeGoalTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGoalTimestamps)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, ['createdAt', 'updatedAt', 'clearedAt'].includes(key) && typeof item === 'number' ? 0 : normalizeGoalTimestamps(item),
  ]))
  return value
}

function goalModel(): string {
  return `import { appendFileSync } from 'node:fs'
function currentSource(messages) {
  return [...messages].reverse().map(message => message.source).find(source => source?.kind === 'user' || source?.kind === 'goal')
}
function currentGoal(messages) {
  for (const message of [...messages].reverse()) for (const block of [...message.content].reverse()) {
    if (block.type !== 'tool-result') continue
    for (const item of [...block.content].reverse()) {
      if (item.type !== 'text') continue
      try {
        const value = JSON.parse(item.text)
        if (value.goal && typeof value.goal.id === 'string') return value.goal
      } catch {}
    }
  }
  return undefined
}
function call(name, args) {
  const value = { type: 'tool-call', id: 'goal-' + name, name, arguments: JSON.stringify(args) }
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: value }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}
function text(value) {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: value },
    { type: 'block-end', index: 0, block: { type: 'text', text: value } }, { type: 'finish', reason: { kind: 'stop' } }]
}
export const plugin = {
  apiVersion: 1, name: 'native-goal-model', targets: ['host'], requires: [], provides: ['model'],
  resolve(input) {
    if (typeof input.audit !== 'string' || !['block', 'resume'].includes(input.mode)) throw new Error('goal snapshot: invalid fixture config')
    return context => context.provide('model', { async *stream(request) {
      appendFileSync(input.audit, JSON.stringify({ mode: input.mode, messages: request.messages, tools: request.tools }) + '\\n')
      const source = currentSource(request.messages)
      const goal = currentGoal(request.messages)
      let chunks
      if (input.mode === 'block' && source?.kind === 'user' && goal === undefined) {
        chunks = call('create_goal', { objective: 'Complete and report the bounded native Goal.', max_goal_rounds: 4 })
      } else if (input.mode === 'resume' && source?.kind === 'user' && goal?.phase === 'blocked') {
        chunks = call('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'resume' })
      } else if (input.mode === 'block' && source?.kind === 'goal' && goal?.phase === 'active') {
        chunks = call('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'blocked',
          blocked_reason: 'A human decision is needed before continuing.' })
      } else if (input.mode === 'resume' && source?.kind === 'goal' && goal?.phase === 'active') {
        chunks = call('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' })
      } else chunks = text(input.mode === 'block' ? 'Goal is blocked and awaiting a human resume.' : 'Goal complete.')
      for (const chunk of chunks) yield chunk
    } })
  },
}
`
}

it('records shipped native Goal creation, cold restore, explicit resume, and completion through dsh', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running goal-continuation.snapshot.ts')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-goal-'))
  const profileDir = join(home, 'profiles/native-headless')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'model-requests.jsonl')
  const patchPath = join(home, 'goal.patch.json')
  const modules = join(profileDir, 'node_modules/native-goal-model')
  const packageModules = join(profileDir, 'node_modules/@deepseek-ai')
  const workspace = join(home, 'work')
  const links: string[] = []
  mkdirSync(workspace, { recursive: true })
  try {
    ensureShippedNativeProfile('native-headless', home)
    mkdirSync(packageModules, { recursive: true })
    for (const [name, path] of [
      ['native-headless', 'rsh/Engine/core/native-headless'], ['native-agent', 'rsh/Engine/core/native-agent'],
      ['native-session-execution', 'rsh/Engine/core/native-session-execution'], ['goal', 'rsh/Engine/goal/goal'],
      ['goal-round-driver', 'rsh/Engine/goal/goal-round-driver'], ['native-tools', 'rsh/Engine/core/native-tools'],
      ['native-prompt', 'rsh/Engine/core/native-prompt'], ['tool-goal', 'rsh/Engine/goal/tool-goal'],
      ['native-model-execution', 'rsh/Engine/core/native-model-execution'],
      ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'], ['fs-local', 'rsh/Modules/Official/fs/fs-local'],
    ] as const) {
      const link = join(packageModules, `dsh-${name}`)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }
    const shipped = shippedNativeProfileComposition(home, 'native-headless')
    const goalRows = shipped.installations.filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))
    expect(goalRows.map(row => row.plugin)).toEqual([
      '@deepseek-ai/dsh-goal', '@deepseek-ai/dsh-goal-round-driver', '@deepseek-ai/dsh-tool-goal',
    ])
    const selectedIds = new Set(['app', 'agents', 'session-execution', 'goal', 'goal-round-driver', 'tools', 'prompt',
      'tool-goal', 'model-execution', 'storage'])
    const installations = shipped.installations.filter(row => selectedIds.has(row.id)).map(row => {
      if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'fixture', model: 'goal',
        systemPrompt: 'Follow the user objective and use Goal controls when needed.', maxSteps: 6 } }
      if (row.id === 'tool-goal') return { ...row, config: { blockedAfterConsecutiveRounds: 1 } }
      if (row.id === 'tools') return { ...row, config: { mode: 'native' } }
      if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
      return row
    })
    installations.push({ id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root', config: { cwd: workspace } })
    installations.push({ id: 'model', plugin: 'native-goal-model', scope: 'root', config: { audit, mode: 'block' } })
    writeFileSync(join(profileDir, 'rsh.profile.json'), JSON.stringify({ ...shipped, installations }, null, 2))
    mkdirSync(modules, { recursive: true })
    writeFileSync(join(modules, 'package.json'), JSON.stringify({ name: 'native-goal-model', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
    }))
    writeFileSync(join(modules, 'native.mjs'), goalModel())

    const invoke = (args: string[]) => execa(process.execPath, [bin, '--profile', 'native-headless', '--patch', patchPath, ...args], {
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, reject: false, timeout: 30_000,
    })
    const writeMode = (mode: 'block' | 'resume') => writeFileSync(patchPath, JSON.stringify({ formatVersion: 1,
      installations: [{ id: 'model', config: { audit, mode } }] }))
    writeMode('block')
    const first = await invoke(['Create a Goal and continue until a blocker needs my decision.'])
    expect(first.exitCode, first.stderr).toBe(0)
    expect(first.stdout).toContain('Goal is blocked')

    const id = await (async () => {
      const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
      try {
        const id = (await storage.list())[0]?.header.id
        if (id === undefined) throw new Error('Goal snapshot did not persist a Session')
        expect(id).not.toBe('')
        return id
      } finally { await storage.close() }
    })()
    writeMode('resume')
    const second = await invoke(['--resume', id, 'Please explicitly resume the blocked Goal.'])
    expect(second.exitCode, second.stderr).toBe(0)
    expect(second.stdout).toContain('Goal complete')

    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const reader = await backend.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'goal/change').map(event => event.data.operation))
          .toEqual(['create', 'block', 'resume', 'complete'])
        const goalSources = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
          ? [event.data.source] : [])
        expect(goalSources)
          .toEqual([
            expect.objectContaining({ kind: 'goal', round: 1 }),
            expect.objectContaining({ kind: 'goal', round: 2 }),
          ])
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(4)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } finally { await reader.close() }
    } finally { await backend.close() }

    const requests = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      mode: string
      messages: { source?: { kind?: string }; content: { type: string; text?: string }[] }[]
      tools: { name: string }[]
    })
    expect(requests).toHaveLength(8)
    expect(requests[0]?.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['get_goal', 'create_goal', 'update_goal']))
    expect(JSON.stringify(requests[2]?.messages)).toContain('Round: 1/4')
    expect(JSON.stringify(requests[4]?.messages)).toContain('disarmed')
    expect(requests[4]?.messages.at(-1)?.content.some(block => block.type === 'text' && block.text?.includes('explicitly resume'))).toBe(true)
    expect(JSON.stringify(requests[6]?.messages)).toContain('Round: 2/4')

    const filename = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const physical = readdirSync(sessions, { recursive: true }).find((name): name is string =>
      typeof name === 'string' && name.endsWith(filename))
    if (physical === undefined) throw new Error('Goal snapshot did not write the current Session generation')
    const raw = readFileSync(join(sessions, physical), 'utf8')
    const redacted = redactSessionSnapshotIds([raw])[0] ?? raw
    const normalized = normalizeGoalTimestamps(normalizeSessionSnapshot(redacted, { sessionIds: [], cwd: workspace },
      { identityMode: 'preserve' })) as string
    const promptRows = normalizedSystemPrompts(raw, { sessionIds: [], cwd: workspace })
    const schemaRows = normalizedToolSchemas(raw, { sessionIds: [], cwd: workspace })
    if (promptRows[0] === undefined || schemaRows[0] === undefined) throw new Error('Goal profile omitted its model request header')
    const prompt = formatSystemPromptSnapshot(promptRows[0], promptRows.slice(1))
    const schemas = formatToolSchemasSnapshot(schemaRows[0], schemaRows.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      mkdirSync(scenario, { recursive: true })
      writeFileSync(snapshotPath, normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), schemas)
    } else {
      expect(normalized).toBe(readFileSync(snapshotPath, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(schemas).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    for (const link of links.reverse()) rmSync(link, { force: true })
    rmSync(home, { recursive: true, force: true })
  }
}, 60_000)
