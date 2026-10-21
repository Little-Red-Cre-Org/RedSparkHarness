/** Keyless file proposals through the shipped Host, composer approval and filesystem. */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import { launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('./fixtures/ide-file-approval.json', import.meta.url))

it.skipIf(webSnapshotMode() === 'record').each(['allowed-once', 'rejected'] as const)(
  'file proposal %s follows the recorded approval before mutation', async (outcome) => {
    const scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride: fixture, compareReplaySession: false, paceMs: 5 })
    const events: SessionEvent[] = []
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { events.push(event) })
    let browser: Browser | undefined
    try {
      browser = await chromium.launch()
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.locator('[aria-label^="Access mode"]').click()
      await page.getByRole('menuitem', { name: 'Read Only' }).click()
      await page.locator('[aria-label="Access mode, current: Read Only"]').waitFor()
      const settled = scaffold.whenTurnSettled()
      const input = page.locator('[data-composer-input]').first()
      await input.fill('Propose main.ts with const value = 2; and await my decision.')
      await input.press('Enter')
      const panel = page.locator('[data-approval-key]')
      await panel.waitFor({ timeout: 15_000 })
      expect(await panel.locator('[data-approval-scroll]').textContent()).toContain('main.ts\n+ const value = 2;')
      const target = join(scaffold.workspaceCwd, 'workspace', 'main.ts')
      expect(existsSync(target)).toBe(false)
      await panel.getByRole('button', { name: outcome === 'allowed-once' ? 'Allow once' : 'Reject', exact: true }).click()
      await settled
      expect(events.filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual([outcome])
      expect(existsSync(target)).toBe(outcome === 'allowed-once')
      if (outcome === 'allowed-once') expect(await readFile(target, 'utf8')).toBe('const value = 2;\n')
      expect(events.filter(event => event.type === 'tool/result').at(-1)?.data.message.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool-result', isError: outcome === 'rejected' }),
      ]))
      expect(await panel.count()).toBe(0)
    } finally {
      try { await browser?.close() } finally { await scaffold.close() }
    }
  },
)
