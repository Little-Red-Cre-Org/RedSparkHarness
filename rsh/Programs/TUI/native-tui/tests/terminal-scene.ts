/** Recorded human input and model responses exercised through the actual dsh terminal. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { terminalFixture } from './pty-profile.ts'

/** Replay a committed terminal scene through dsh, optionally selecting a model before cold resume.
 * @param scenario - owning committed Session scenario directory.
 * @param modelControls - exercise actual Provider selection and reasoning menus.
 * @returns completion after both real terminal processes and persistence handles close.
 */
export async function terminalScene(scenario: string, modelControls = false): Promise<void> {
  const scene = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
  const recorded = parseSessionLog(readFileSync(scene, 'utf8'))
  const tasks = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    .map(event => event.type === 'user/message' ? event.data.content.filter(block => block.type === 'text').map(block => block.text).join('') : '')
  expect(tasks).toHaveLength(3)
  const script = deriveReplayScript(recorded)
  const fixture = terminalFixture(false, script, false, modelControls)
  try {
    const terminal = fixture.launch()
    await terminal.waitFor('Ready')
    await terminal.submit(tasks[0]!)
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'started'))).toBe(true) }, { timeout: 30000 })
    await terminal.submit(tasks[1]!)
    await terminal.waitFor('1 queued')
    if (!modelControls) {
      await terminal.submit('/sessions')
      await terminal.waitFor('Terminal controls require an idle terminal')
    }
    writeFileSync(join(fixture.home, 'release'), 'release')
    await terminal.waitFor('Terminal answer 1.')
    await terminal.waitFor('visible file contents')
    await terminal.waitFor('Terminal answer 2.')
    await vi.waitFor(() => { expect(terminal.output().lastIndexOf('Ready')).toBeGreaterThan(terminal.output().lastIndexOf('Working')) }, { timeout: 30000 })
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
    if (!modelControls) {
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
    const resumed = fixture.launch(modelControls ? ['--resume', id] : [])
    if (!modelControls) {
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
    if (modelControls) {
      await resumed.waitFor('fixture/fixture-alt · high')
      await resumed.waitFor('Input: text; Context: 4096')
    }
    await resumed.submit(tasks[2]!)
    await resumed.waitFor('Terminal answer 3.')
    await resumed.submit('/exit')
    expect((await resumed.done).exitCode, resumed.output()).toBe(0)
    expect(fixture.fixtureText('request.json')).toContain('visible file contents')
    if (modelControls) expect(JSON.parse(fixture.fixtureText('config.json'))).toEqual({
      provider: 'fixture', model: 'fixture-alt', reasoningEffort: 'high',
    })
    const backend = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    try {
      const stored = await backend.list()
      expect(stored).toHaveLength(modelControls ? 1 : 2)
      if (!modelControls) {
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
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(3)
        expect(events.filter(event => event.type === 'model/selection')).toHaveLength(modelControls ? 2 : 0)
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
  const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
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
