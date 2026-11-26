/** Shipped Native Web runs one recorded prompt through the real Bash tool and transcript. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import { expandAssistantStream } from '@redspark/rsh-llm'
import type { SessionEvent } from '@redspark/rsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/fresh-round-trip', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
// The scenario's one drive prompt. Replay asserts the committed fixture
// recorded exactly it, so drive script and fixture cannot drift apart.
const PROMPT = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'
const MAIN = '[data-slot="main"]'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

it.skipIf(MODE === 'record')('drives one prompt through the real Bash tool and the settled Native transcript', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    // The title request shares the positional replay cursor.
    configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
    replay: { file: FIXTURE, paceMs: 15 },
  })
  try {
    const { page } = scaffold
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-round-trip'))
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

    const input = page.locator('textarea[aria-label="Message"]')
    await input.waitFor({ timeout: 15_000 })
    await input.fill(PROMPT)
    await input.press('Enter')

    await expect.poll(() => page.locator(TRANSCRIPT).getByText('DONE', { exact: true }).count(),
      { timeout: 90_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(async () => {
      const status = await scaffold.rpc<{ readonly status: string }>('session/status', { sessionId })
      return status.ok && status.value.status === 'idle'
    }, { timeout: 30_000 }).toBe(true)

    const history = await scaffold.rpc<{ readonly events: readonly SessionEvent[] }>('session/history', { sessionId })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    const events = history.value.events
    // World state, not self-report: the real Bash executor returned the exact
    // command output, and the turn closed cleanly.
    const bashCall = events.find(event => event.type === 'tool/call' && event.data.name === 'bash')
    if (bashCall?.type !== 'tool/call') throw new Error('the replayed turn did not call the Bash tool')
    const bashResult = events.find(event =>
      event.type === 'tool/result' && event.data.message.source.callId === bashCall.data.callId)
    if (bashResult?.type !== 'tool/result') throw new Error('the Bash tool call produced no durable result')
    expect(bashResult.data.message.content[0]?.isError).toBe(false)
    expect(bashResult.data.message.content[0]?.content.filter(block => block.type === 'text')
      .map(block => block.text).join('')).toBe('WEB_E2E_OK\n')
    const turnEnds = events.filter(event => event.type === 'turn/end')
    expect(turnEnds).toHaveLength(1)
    expect((turnEnds[0] as SessionEvent & { data: { reason: { kind: string } } }).data.reason.kind).toBe('completed')
    // Embedded stream members are the authoritative incrementality proof.
    expect(events.flatMap(event => event.type === 'assistant/message' || event.type === 'assistant/attempt'
      ? expandAssistantStream(event.data.stream)
      : []).length).toBeGreaterThan(10)

    expect(await page.getByText('WEB_E2E_OK', { exact: false }).count()).toBeGreaterThanOrEqual(1)
    // The follow stream settles after the Host turn: wait for the settled
    // composer and the retired running row before the golden.
    await expect.poll(() => page.getByRole('button', { name: 'Send', exact: true }).count(),
      { timeout: 30_000 }).toBe(1)
    await expect.poll(() => page.locator(TRANSCRIPT).getByText('Running…', { exact: true }).count(),
      { timeout: 30_000 }).toBe(0)
    const snapshot = (await captureStableAria(page, MAIN, scaffold.workspaceCwd))
      .split(sessionId).join('{{sessionId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
