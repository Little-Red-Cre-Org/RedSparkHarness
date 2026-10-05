/** Recorded human input and model responses exercised through the actual dsh terminal. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { terminalFixture } from '../../rsh/Programs/TUI/native-tui/tests/pty-profile.ts'

const scenario = fileURLToPath(new URL('./interactive/', import.meta.url))
const scene = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))

it('records terminal tools and multiple inputs, then resumes the same durable Session through dsh', async () => {
  const recorded = parseSessionLog(readFileSync(scene, 'utf8'))
  const tasks = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    .map(event => event.type === 'user/message' ? event.data.content.filter(block => block.type === 'text').map(block => block.text).join('') : '')
  expect(tasks).toHaveLength(3)
  const script = deriveReplayScript(recorded)
  const fixture = terminalFixture(false, script)
  try {
    const terminal = fixture.launch()
    await terminal.waitFor('Ready')
    await terminal.submit(tasks[0]!)
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'started'))).toBe(true) }, { timeout: 30000 })
    await terminal.submit(tasks[1]!)
    await terminal.waitFor('1 queued')
    writeFileSync(join(fixture.home, 'release'), 'release')
    await terminal.waitFor('Terminal answer 1.')
    await terminal.waitFor('visible file contents')
    await terminal.waitFor('Terminal answer 2.')
    await terminal.submit('/exit')
    expect((await terminal.done).exitCode, terminal.output()).toBe(0)
    const storage = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    let id
    try { id = (await storage.list())[0]?.header.id } finally { await storage.close() }
    if (id === undefined) throw new Error('native-tui: terminal did not persist a Session')
    const resumed = fixture.launch(['--resume', id])
    await resumed.waitFor('Terminal answer 1.')
    await resumed.waitFor('Terminal answer 2.')
    await resumed.submit(tasks[2]!)
    await resumed.waitFor('Terminal answer 3.')
    await resumed.submit('/exit')
    expect((await resumed.done).exitCode, resumed.output()).toBe(0)
    expect(fixture.fixtureText('request.json')).toContain('visible file contents')
    const backend = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    try {
      expect(await backend.list()).toHaveLength(1)
      const reader = await backend.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(3)
      } finally { await reader.close() }
    } finally { await backend.close() }
    const name = readdirSync(fixture.storage, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
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
  } finally { await fixture.cleanup() }
})
