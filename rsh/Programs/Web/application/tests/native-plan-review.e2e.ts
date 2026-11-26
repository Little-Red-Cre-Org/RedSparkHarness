/** Shipped Native Web takes over its composer with the plan-review card and approves through it. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/plan-review', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const REVIEW_EXPECTED = join(SNAPSHOT_DIR, 'review.expected.md')
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const APPROVED_EXPECTED = join(SNAPSHOT_DIR, 'approved.expected.md')
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()

const TASK = 'Plan a small change: add a --greeting flag to a CLI. Do not read or write any files. '
  + 'Call exit_plan_mode with a short plan of at most five bullet points. '
  + 'Once the plan is approved, reply with the single word DONE and stop.'
const LINE = `/plan ${TASK}`

it.skipIf(MODE === 'record')('reviews the plan on the Native decision card and approves through it', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([TASK])
  const scaffold = await launchNativeWeb({ drop: ['pi-ai'], replay: { file: FIXTURE, paceMs: 0 } })
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

    const input = page.locator('textarea[aria-label="Message"]')
    // The connected view is still restoring: Enter would queue the line as steering input.
    await expect.poll(() => page.getByRole('button', { name: 'Interject', exact: true }).count(), { timeout: 15_000 }).toBe(0)
    await input.fill(LINE)
    await input.press('Enter')

    const card = page.locator('[data-plan-review-key]')
    await card.waitFor({ timeout: 60_000 })
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    expect(await card.getByText('Plan review').count()).toBeGreaterThan(0)

    const selectedRow = page.locator('[role="treeitem"][aria-selected="true"]')
    await expect.poll(() => selectedRow.locator('[data-state="warning"]').count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => selectedRow.getByText('Plan awaiting review', { exact: true }).count(),
      { timeout: 10_000 }).toBe(1)

    await compareOrRefreshGolden(REVIEW_EXPECTED,
      await captureStableAria(page, '[data-plan-review-key]', scaffold.workspaceCwd), MODE)
    await compareOrRefreshGolden(SIDEBAR_EXPECTED,
      await captureStableAria(page, '[role="treeitem"][aria-selected="true"]', scaffold.workspaceCwd), MODE)

    await card.getByRole('button', { name: 'Approve' }).click()
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => page.locator('[data-plan-review-key]').count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => selectedRow.locator('[data-state="warning"]').count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => input.isEnabled(), { timeout: 10_000 }).toBe(true)
    // The transcript's activity row leaves when the followed turn settles and the view restores.
    await expect.poll(() => page.locator('main').getByText('Running…', { exact: true }).count(),
      { timeout: 10_000 }).toBe(0)

    const history = await scaffold.rpc<{ readonly events: readonly { type: string; data: unknown }[] }>(
      'session/history', { sessionId },
    )
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(JSON.stringify(history.value.events.filter(event => event.type === 'tool/result').at(-1)))
      .toContain('Plan approved')
    await compareOrRefreshGolden(APPROVED_EXPECTED,
      await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd), MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR,
      ['session.v3.jsonl', 'review.expected.md', 'sidebar.expected.md', 'approved.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 240_000)
