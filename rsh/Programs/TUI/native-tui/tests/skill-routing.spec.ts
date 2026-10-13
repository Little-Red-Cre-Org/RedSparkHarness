/** Unknown human commands route to exact-scope user-invocable Native Skills. */
import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { ARCHIFY_SKILL_DIRECTORY_ENV, archifyShellEnvValues } from '../../../../Modules/Official/skill/archify/src/shared.ts'
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { terminalFixture } from './pty-profile.ts'

const answer = 'Archify route reached the model.'
const script: readonly ReplayEntry[] = [{ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: answer },
  { type: 'block-end', index: 0, block: { type: 'text', text: answer } },
  { type: 'finish', reason: { kind: 'stop' } },
] }]

it('routes a known Native Skill after real command lookup and preserves unknown-command notices', async () => {
  const fixture = terminalFixture(false, script, false, false, false, undefined, false, true)
  try {
    const terminal = fixture.launch()
    await terminal.waitFor('Ready')
    await terminal.submit('/missing')
    await terminal.waitFor('Unavailable command: /missing')
    await terminal.submit('/archify Create and deliver a workflow diagram')
    await vi.waitFor(() => { expect(existsSync(join(fixture.home, 'started')), terminal.output()).toBe(true) }, { timeout: 30_000 })
    writeFileSync(join(fixture.home, 'release'), 'release')
    await terminal.waitFor(answer)
    await terminal.submit('/exit')
    expect((await terminal.done).exitCode, terminal.output()).toBe(0)

    const request = JSON.parse(fixture.fixtureText('request.json')) as Array<{
      readonly content?: readonly { readonly type: string; readonly text?: string }[]
    }>
    const requestText = request.flatMap(message => message.content ?? [])
      .filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    expect(requestText).toContain('/archify Create and deliver a workflow diagram')
    expect(requestText).toContain('<skill_content name="archify">')
    expect(requestText).toContain(ARCHIFY_SKILL_DIRECTORY_ENV)
    expect(requestText).not.toContain(archifyShellEnvValues()[ARCHIFY_SKILL_DIRECTORY_ENV])

    const backend = new JsonlSessionBackend({ root: fixture.storage, compression: 'none' })
    try {
      const rows = await backend.list()
      expect(rows).toHaveLength(1)
      const reader = await backend.open(rows[0]!.header.id, 'read')
      try {
        const events = (await reader.read()).events
        const messages = events.filter(event => event.type === 'user/message')
        expect(messages.filter(event => event.data.source.kind === 'skill-invocation')).toHaveLength(1)
        expect(messages.filter(event => event.data.source.kind === 'archify-auto-invocation')).toHaveLength(0)
        expect(messages.filter(event => event.data.source.kind === 'user'
          && JSON.stringify(event.data.content).includes('/archify Create and deliver a workflow diagram'))).toHaveLength(1)
        expect(JSON.stringify(events)).not.toContain(archifyShellEnvValues()[ARCHIFY_SKILL_DIRECTORY_ENV])
      } finally { await reader.close() }
    } finally { await backend.close() }
  } finally { await fixture.cleanup() }
}, 45_000)
