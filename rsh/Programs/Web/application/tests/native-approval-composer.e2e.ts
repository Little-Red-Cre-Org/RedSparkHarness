/** Shipped Native Web caps a pending approval's command text and answers through the shared card. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/approval-composer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

const TOKENS = Array.from({ length: 220 }, (_, index) => `tok${((index + 1) * 7919 % 99991).toString(36)}`).join(' ')
const PROMPT = `Write a file named notes.txt in the workspace containing exactly this text on one line: ${TOKENS}. Use one bash command with the literal text inline. Then reply with the single word DONE and stop.`

it.skipIf(MODE === 'record')('keeps a capped approval reachable and answers it through the shared card', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    replay: { file: FIXTURE, paceMs: 0 },
    // The recorded command only asks for approval when the Session starts
    // read-only; the write it performs is what the approval unlocks.
    configure: row => row.id === 'sandbox-policy'
      ? { ...row, config: { ...row.config as object, mode: 'read-only' } }
      : row,
  })
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')
    const input = page.locator('textarea[aria-label="Message"]')
    await input.waitFor({ timeout: 10_000 })
    const composerCap = await input.evaluate(el => Number.parseFloat(getComputedStyle(el).maxHeight))
    expect(composerCap).toBeGreaterThan(0)
    await input.fill(PROMPT)
    await input.press('Enter')

    const panel = page.locator('[data-approval-key]')
    await panel.waitFor({ timeout: 60_000 })
    const scroll = panel.locator('[data-approval-scroll]')
    await expect.poll(() => scroll.getByText(/tok/).count(), { timeout: 15_000 }).toBeGreaterThan(0)
    const snapshot = await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    const original = page.viewportSize() ?? { width: 1365, height: 900 }
    for (const height of [900, 700]) {
      await page.setViewportSize({ width: 900, height })
      const geometry = await panel.evaluate((root) => {
        const region = root.querySelector<HTMLElement>('[data-approval-scroll]')
        const card = region?.parentElement ?? null
        const buttons = [...root.querySelectorAll<HTMLElement>('button')]
        const rows = buttons.map(button => button.getBoundingClientRect())
        return {
          buttons: buttons.length,
          capped: region === null ? 0 : region.clientHeight,
          scrolls: region === null ? false : region.scrollHeight > region.clientHeight,
          cardBottom: card === null ? Number.NaN : card.getBoundingClientRect().bottom,
          actionsTop: Math.min(...rows.map(rect => rect.top)),
          actionsBottom: Math.max(...rows.map(rect => rect.bottom)),
          viewport: window.innerHeight,
        }
      })
      expect(geometry.buttons).toBeGreaterThanOrEqual(2)
      expect(geometry.capped).toBeCloseTo(composerCap, 0)
      expect(geometry.scrolls).toBe(true)
      expect(geometry.actionsTop).toBeGreaterThan(0)
      expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.viewport)
      expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.cardBottom)
    }
    await page.setViewportSize(original)

    await panel.getByRole('button', { name: 'Allow once' }).click()
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
    expect(await page.locator('[data-approval-key]').count()).toBe(0)
    expect(await readFile(join(scaffold.workspaceCwd, 'notes.txt'), 'utf8')).toContain(TOKENS.slice(0, 64))

    const history = await scaffold.rpc<{ readonly events: readonly { type: string; data: unknown }[] }>(
      'session/history', { sessionId },
    )
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(JSON.stringify(history.value.events.filter(event => event.type === 'native-approval/decided').at(-1)))
      .toContain('allowed-once')
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md', 'workspace.expected'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
