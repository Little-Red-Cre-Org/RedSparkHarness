/** Shipped Native Web replays one turn, then records /feedback through the Host command route. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('renders the /feedback acknowledgement through the Native command route', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const scaffold = await launchNativeWeb({ drop: ['pi-ai'], replay: { file: FIXTURE, paceMs: 0 } })
  try {
    const created = await scaffold.rpc<{ readonly sessionId: string }>('session/create', {})
    if (!created.ok) throw new Error('session/create failed: ' + created.error.message)
    const prompted = await scaffold.rpc<{ readonly answer: string }>('session/prompt', {
      sessionId: created.value.sessionId, text: PROMPT, resume: true,
    })
    if (!prompted.ok) throw new Error('session/prompt failed: ' + prompted.error.message)
    expect(prompted.value.answer).toBe('LIGHTHOUSE')

    const { page } = scaffold
    await page.reload({ waitUntil: 'load' })
    const onboard = page.getByRole('button', { name: 'Continue', exact: true })
    if (await onboard.count() > 0) await onboard.click()
    const row = page.locator('[role="treeitem"]').filter({ hasText: 'Reply with the single word' }).first()
    await row.waitFor({ timeout: 20_000 })
    await row.click()
    const transcript = page.locator(TRANSCRIPT)
    await transcript.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Send' }).waitFor({ timeout: 20_000 })

    const input = page.locator('textarea[aria-label="Message"]')
    await input.fill('/feedback the diff view is unreadable')
    await input.press('Enter')
    const acknowledgement = page.locator('[data-command-row]').filter({ hasText: 'Feedback recorded for session' })
    await acknowledgement.waitFor({ timeout: 15_000 })
    await expect.poll(() => acknowledgement.innerText(), { timeout: 10_000 }).toContain('feedback')
    expect(await page.getByText(/Anonymous user: [0-9a-f-]+\.$/i).count()).toBe(1)
    await expect.poll(() => input.inputValue(), { timeout: 10_000 }).toBe('')
    await expect.poll(() => page.getByRole('button', { name: 'Add image', exact: true }).isEnabled(),
      { timeout: 10_000 }).toBe(true)

    const snapshot = (await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd))
      .split(created.value.sessionId).join('{{sessionId}}')
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ack.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
