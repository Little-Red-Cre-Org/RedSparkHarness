/** Recorded human input and model responses exercised through the actual dsh terminal. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, vi } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { terminalFixture } from './pty-profile.ts'

type SnapshotRecord = Record<string, unknown>
type TerminalSceneOptions = { modelControls?: boolean; presets?: boolean; taskScheduler?: boolean }
type SavedTask = {
  id: string
  ownerSessionId: string
  title: string
  prompt: string
  at: string
  state: string
  nativeRoute: string
  workspace: string
  provider: string
  model: string
  nativeConfiguration: Record<string, unknown>
}

function isRecord(value: unknown): value is SnapshotRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Stabilize only task IDs published by successful task_schedule create/list results in this owned replay. */
function normalizeScheduledTaskIds(raw: string, cwd: string): string {
  const records = raw.split(/\r?\n/).filter(line => line.trim() !== '').map(line => JSON.parse(line) as SnapshotRecord)
  const sessionId = records[0]?.id
  if (typeof sessionId !== 'string') return raw
  const calls = new Map<string, string>()
  const ids = new Map<string, string>()
  let next = 1
  const normalizeTask = (value: unknown): void => {
    if (!isRecord(value) || typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
      || value.ownerSessionId !== sessionId || typeof value.title !== 'string' || typeof value.prompt !== 'string'
      || typeof value.nativeRoute !== 'string' || !['active', 'paused', 'deleted'].includes(String(value.state))) return
    if (!ids.has(value.id)) ids.set(value.id, `{{id:${next++}}}`)
    value.id = ids.get(value.id)!
    if (value.workspace === cwd) value.workspace = '{{cwd}}'
    if (isRecord(value.nativeConfiguration) && value.nativeConfiguration.cwd === cwd) value.nativeConfiguration.cwd = '{{cwd}}'
  }
  for (const record of records) {
    if (record.type === 'tool/call' && isRecord(record.data) && typeof record.data.callId === 'string'
      && record.data.name === 'task_schedule' && typeof record.data.arguments === 'string') {
      const args = JSON.parse(record.data.arguments) as SnapshotRecord
      if (typeof args.action === 'string') calls.set(record.data.callId, args.action)
    }
    if (record.type !== 'tool/result' || !isRecord(record.data) || !isRecord(record.data.message)
      || !isRecord(record.data.message.source) || typeof record.data.message.source.callId !== 'string'
      || record.data.message.source.kind !== 'tool'
      || (calls.get(record.data.message.source.callId) !== 'create' && calls.get(record.data.message.source.callId) !== 'list')
      || !Array.isArray(record.data.message.content)) continue
    const callId = record.data.message.source.callId
    for (const block of record.data.message.content) {
      if (!isRecord(block) || block.type !== 'tool-result' || block.toolCallId !== callId
        || block.isError !== false || !Array.isArray(block.content)) continue
      for (const item of block.content) {
        if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') continue
        const result: unknown = JSON.parse(item.text)
        if (calls.get(record.data.message.source.callId) === 'create') normalizeTask(result)
        else if (Array.isArray(result)) for (const task of result) normalizeTask(task)
        item.text = JSON.stringify(result)
      }
    }
  }
  const replacements = [...ids].sort(([left], [right]) => right.length - left.length)
  const serialized = records.map(record => JSON.stringify(record)).join('\n') + (raw.endsWith('\n') ? '\n' : '')
  return replacements.reduce((output, [id, token]) => output.split(id).join(token), serialized)
}

/** Replay a committed terminal scene through dsh with its declared native controls.
 * @param scenario - owning committed Session scenario directory.
 * @param options - independently select model controls, presets, and scheduled tasks.
 * @returns completion after both real terminal processes and persistence handles close.
 */
export async function terminalScene(scenario: string, options: TerminalSceneOptions = {}): Promise<void> {
  const { modelControls = false, presets = false, taskScheduler = false } = options
  const scene = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
  const recorded = parseSessionLog(readFileSync(scene, 'utf8'))
  const tasks = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    .map(event => event.type === 'user/message' ? event.data.content.filter(block => block.type === 'text').map(block => block.text).join('') : '')
  expect(tasks).toHaveLength(3)
  const script = deriveReplayScript(recorded)
  const fixture = terminalFixture(false, script, false, modelControls, false, presets, taskScheduler)
  const resumesSession = modelControls || presets || taskScheduler
  let scheduledTaskId: string | undefined
  try {
    const terminal = fixture.launch()
    await terminal.waitFor('Ready')
    if (presets) {
      await terminal.submit('/sessions')
      await terminal.waitFor('Select Session')
      await terminal.submit('/mode')
      await terminal.waitFor('Enter a displayed number.')
      terminal.write('\x1b')
      await terminal.submit('/mode')
      await terminal.waitFor('2. alternate (alternate)')
      await terminal.submit('2')
      await terminal.waitFor('Agent preset saved.')
    }
    await terminal.submit(tasks[0]!)
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'started'))).toBe(true) }, { timeout: 30000 })
    await terminal.submit(tasks[1]!)
    await terminal.waitFor('1 queued')
    if (!resumesSession) {
      await terminal.submit('/sessions')
      await terminal.waitFor('Terminal controls require an idle terminal')
    }
    writeFileSync(join(fixture.home, 'release'), 'release')
    await terminal.waitFor('Terminal answer 1.')
    await terminal.waitFor('visible file contents')
    await terminal.waitFor('Terminal answer 2.')
    await vi.waitFor(() => { expect(terminal.output().lastIndexOf('Ready')).toBeGreaterThan(terminal.output().lastIndexOf('Working')) }, { timeout: 30000 })
    if (presets) {
      await terminal.submit('/mode')
      await terminal.waitFor('An Agent preset can only be selected before the first turn.')
    }
    if (modelControls) {
      await terminal.submit('/model')
      await terminal.waitFor('2. Fixture Provider / fixture-alt')
      let accepted = terminal.output().length
      await terminal.submit('2')
      await terminal.waitFor('Model choice saved for the next turn.', accepted)
      await terminal.submit('/reasoning')
      await terminal.waitFor('2. High')
      accepted = terminal.output().length
      await terminal.submit('2')
      await terminal.waitFor('Model choice saved for the next turn.', accepted)
      await terminal.waitFor('fixture/fixture-alt · high')
    }
    if (!modelControls && !presets && !taskScheduler) {
      const start = terminal.output().length
      terminal.write('\x1b[5~')
      await terminal.waitFor('Page Up / Page Down to scroll', start)
      const bottom = terminal.output().length
      terminal.write('\x1b[6~')
      await terminal.waitFor('Terminal answer 2.', bottom)
    }
    await terminal.submit('/exit')
    expect((await terminal.done).exitCode, terminal.output()).toBe(0)
    const storage = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    let id
    try { id = (await storage.list())[0]?.header.id } finally { await storage.close() }
    if (id === undefined) throw new Error('native-tui: terminal did not persist a Session')
    const resumed = fixture.launch(resumesSession ? ['--resume', id] : [])
    if (!resumesSession) {
      await resumed.waitFor('Ready')
      await resumed.submit('/sessions')
      await resumed.waitFor('Select Session')
      const entries = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
      let choices
      try { choices = (await entries.list()).filter(row => row.header.cwd === fixture.workspace) }
      finally { await entries.close() }
      const index = choices.findIndex(row => row.header.id === id)
      expect(index).toBeGreaterThanOrEqual(0)
      await resumed.submit(String(index + 1))
      await resumed.waitFor('Session restored.')
    }
    await resumed.waitFor('Terminal answer 1.')
    await resumed.waitFor('Terminal answer 2.')
    if (presets) {
      await resumed.submit('/mode')
      await resumed.waitFor('An Agent preset can only be selected before the first turn.')
    }
    if (modelControls) {
      await resumed.waitFor('fixture/fixture-alt · high')
      await resumed.waitFor('Input: text; Context: 4096')
    }
    await resumed.submit(tasks[2]!)
    await resumed.waitFor('Terminal answer 3.')
    await resumed.submit('/exit')
    expect((await resumed.done).exitCode, resumed.output()).toBe(0)
    if (taskScheduler) {
      const database = new DatabaseSync(join(fixture.home, 'profiles/native-tui/task-scheduler.sqlite'), { readOnly: true })
      let savedTask: SavedTask | undefined
      try {
        const rows = database.prepare('SELECT body FROM tasks').all() as { body: string }[]
        expect(rows).toHaveLength(1)
        savedTask = JSON.parse(rows[0]!.body) as typeof savedTask
      } finally { database.close() }
      expect(savedTask).toMatchObject({ ownerSessionId: id, title: 'Review project', prompt: 'Check the project status.',
        at: '2099-01-01T00:00:00.000Z', state: 'active', nativeRoute: 'root', workspace: fixture.workspace,
        provider: 'fixture', model: 'fixture', nativeConfiguration: { cwd: fixture.workspace, provider: 'fixture',
          model: 'fixture', systemPrompt: 'You are a helpful coding assistant.', maxSteps: 3, builtinTools: true } })
      if (savedTask === undefined) throw new Error('native-tui: task_schedule did not persist its task')
      scheduledTaskId = savedTask.id
      const restart = fixture.launch(['--resume', id])
      await restart.waitFor('Ready')
      await restart.submit('/exit')
      expect((await restart.done).exitCode, restart.output()).toBe(0)
      const reopened = new DatabaseSync(join(fixture.home, 'profiles/native-tui/task-scheduler.sqlite'), { readOnly: true })
      try { expect(JSON.parse(reopened.prepare('SELECT body FROM tasks').get()?.['body'] as string)).toMatchObject({ id: savedTask.id, state: 'active' }) }
      finally { reopened.close() }
    }
    expect(fixture.fixtureText('request.json')).toContain('visible file contents')
    if (modelControls) expect(JSON.parse(fixture.fixtureText('config.json'))).toEqual({
      provider: 'fixture', model: 'fixture-alt', reasoningEffort: 'high',
    })
    const backend = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    try {
      const stored = await backend.list()
      expect(stored).toHaveLength(resumesSession ? 1 : 2)
      if (!resumesSession) {
        const fresh = stored.find(row => row.header.id !== id)
        if (fresh === undefined) throw new Error('terminal browser fixture did not create its fresh Session')
        const untouched = await backend.open(fresh.header.id, 'read')
        try {
          expect((await untouched.read()).events.filter(event =>
            event.type === 'user/message' || event.type === 'request/header' || event.type === 'turn/start')).toHaveLength(0)
        } finally { await untouched.close() }
      }
      const reader = await backend.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(taskScheduler ? 3 : 1)
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(3)
        expect(events.filter(event => event.type === 'model/selection')).toHaveLength(modelControls ? 2 : 0)
        if (taskScheduler) {
          const scheduledCalls = []
          for (const event of events) if (event.type === 'tool/call' && event.data.name === 'task_schedule') scheduledCalls.push(event)
          const actions = scheduledCalls.map((event) => {
            const args: unknown = JSON.parse(event.data.arguments)
            if (!isRecord(args) || typeof args.action !== 'string') throw new Error('native-tui: malformed recorded scheduler arguments')
            return args.action
          })
          expect(actions).toEqual(['create', 'list'])
          const scheduledResults = JSON.stringify(events.filter(event => event.type === 'tool/result'
            && JSON.stringify(event).includes('fixture-task-')))
          if (scheduledTaskId === undefined) throw new Error('native-tui: missing task ID from the real scheduler store')
          expect(scheduledResults.split(scheduledTaskId)).toHaveLength(3)
        }
        if (presets) {
          expect(events.filter(event => event.type === 'agent-preset/selected')).toHaveLength(1)
          expect(JSON.stringify(events)).toContain('alternate')
        }
      } finally { await reader.close() }
    } finally { await backend.close() }
    verifyTerminalSession(fixture, scenario, id)
  } finally { await fixture.cleanup() }
}

/** Compare an actual terminal Session and its model input sidecars with its owned recording.
 * @param fixture - settled dsh fixture with closed terminal processes.
 * @param scenario - owning committed scenario directory.
 * @param id - optional exact persisted Session; absent selects the fixture's only generation.
 */
export function verifyTerminalSession(fixture: ReturnType<typeof terminalFixture>, scenario: string, id?: string): void {
  const scene = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
  const name = readdirSync(fixture.storage, { recursive: true }).find(
    name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION))
      && (id === undefined || (JSON.parse(readFileSync(join(fixture.storage, String(name)), 'utf8').split('\n')[0]!) as { id: unknown }).id === id),
  )
  if (name === undefined) throw new Error('native-tui: missing physical Session')
  const raw = readFileSync(join(fixture.storage, String(name)), 'utf8')
  const context = { sessionIds: [], cwd: fixture.workspace }
  const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([normalizeScheduledTaskIds(raw, fixture.workspace)])[0] ?? raw, context, { identityMode: 'preserve' })
  const prompts = normalizedSystemPrompts(raw, context)
  const schemas = normalizedToolSchemas(raw, context)
  if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-tui: missing model request headers')
  const outputs = [[scene, normalized], [join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1))],
    [join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1))]] as const
  for (const [path, contents] of outputs) {
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(path, contents)
    else expect(contents).toBe(readFileSync(path, 'utf8'))
  }
}
