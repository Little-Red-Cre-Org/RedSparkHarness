/** Real human responses, approval decisions and denied filesystem effects through the dsh terminal. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { parseSessionLog, deriveReplayScript } from '@deepseek-ai/dsh-llm-replay'
import { captureWorkspaceSnapshot, captureExpectedWorkspaceSnapshot } from '@deepseek-ai/dsh-session-snapshot'
import { terminalFixture } from '../../rsh/Programs/TUI/native-tui/tests/pty-profile.ts'
import { verifyTerminalSession } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('records terminal answers and one-shot allow/deny decisions, then restores the same Session', async () => {
  const scenario = fileURLToPath(new URL('./human-interaction/', import.meta.url))
  const events = parseSessionLog(readFileSync(join(scenario, 'session.v3.jsonl'), 'utf8'))
  const input = events.find(event => event.type === 'user/message')
  if (input?.type !== 'user/message') throw new Error('missing recorded human task')
  const text = input.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
  const fixture = terminalFixture(false, deriveReplayScript(events), false, false, true)
  try {
    const terminal = fixture.launch()
    await terminal.waitFor('Ready')
    await terminal.submit(text)
    // The existing fixture holds the first model call to expose admitted input before replay.
    writeFileSync(join(fixture.home, 'release'), 'release')
    await terminal.waitFor('Choose the requested options')
    await terminal.submit('1,2')
    await terminal.waitFor('Describe the approved task')
    await terminal.submit('terminal human answer')
    await terminal.waitFor('Tool approval')
    const approval = terminal.output().length
    await terminal.submit('/allow')
    await terminal.waitFor('create: allowed.data')
    await terminal.waitFor('Writing a file changes the selected workspace.', approval)
    await terminal.submit('/deny')
    await terminal.waitFor('Human controls complete.')
    await terminal.submit('/exit')
    expect((await terminal.done).exitCode, terminal.output()).toBe(0)
    expect(readFileSync(join(fixture.workspace, 'allowed.data'), 'utf8')).toBe('approved contents')
    expect(existsSync(join(fixture.workspace, 'forbidden.data'))).toBe(false)
    expect(await captureWorkspaceSnapshot(fixture.workspace))
      .toEqual(await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))
    expect(fixture.fixtureText('request.json')).toContain('terminal human answer')
    const backend = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    let id
    try {
      const sessions = await backend.list()
      expect(sessions).toHaveLength(1)
      id = sessions[0]?.header.id
      if (id === undefined) throw new Error('missing terminal Session')
      const reader = await backend.open(id, 'read')
      try {
        const recorded = (await reader.read()).events
        expect(recorded.filter(event => event.type === 'native-approval/asked')).toHaveLength(2)
        expect(recorded.flatMap(event => event.type === 'native-approval/decided' ? [event.data.outcome] : []))
          .toEqual(['allowed-once', 'rejected'])
        expect(recorded.filter(event => event.type === 'tool/result')).toHaveLength(3)
      } finally { await reader.close() }
    } finally { await backend.close() }
    const resumed = fixture.launch(['--resume', id])
    await resumed.waitFor('Human controls complete.')
    await resumed.submit('/exit')
    expect((await resumed.done).exitCode, resumed.output()).toBe(0)
    verifyTerminalSession(fixture, scenario)
  } finally { await fixture.cleanup() }
  const cancelled = terminalFixture(false, deriveReplayScript(events), false, false, true)
  try {
    const terminal = cancelled.launch()
    await terminal.waitFor('Ready')
    await terminal.submit(text)
    writeFileSync(join(cancelled.home, 'release'), 'release')
    await terminal.waitFor('Choose the requested options')
    const draft = 'draft kept after cancellation'
    const entered = terminal.output().length
    terminal.write(draft)
    await terminal.waitFor(draft, entered)
    const stopped = terminal.output().length
    terminal.write('\x1b')
    await terminal.waitFor('Ready', stopped)
    expect(terminal.output().slice(stopped)).toContain(draft)
    expect(terminal.output()).not.toContain('No pending human request.')
    terminal.write('\r')
    await terminal.waitFor('Tool approval', stopped)
    await terminal.submit('/exit')
    expect((await terminal.done).exitCode, terminal.output()).toBe(0)
    const backend = new JsonlSessionBackend({ root: cancelled.storage, compression: 'none' })
    try {
      const id = (await backend.list())[0]?.header.id
      if (id === undefined) throw new Error('missing cancelled terminal Session')
      const reader = await backend.open(id, 'read')
      try {
        const recorded = (await reader.read()).events
        expect(recorded.flatMap(event => event.type === 'user/message'
          ? [event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')] : []))
          .toEqual([text, draft])
        expect(recorded.flatMap(event => event.type === 'native-approval/decided' ? [event.data.outcome] : []))
          .toEqual(['cancelled'])
      } finally { await reader.close() }
    } finally { await backend.close() }
  } finally { await cancelled.cleanup() }
})
