/**
 * Keyless Native browser regression for pwsh UI parity with bash: a seeded Session
 * whose pwsh call/result is presented from the logged args/result content renders
 * the terminal card layout with the parsed exit-status pill. The seed is authored,
 * not recorded: no event references the workspace, and the Native composition swaps
 * its bash rows for the pwsh twins through `configure`, so the lane replays on any
 * host with a usable `pwsh`.
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { resolvePwshPath } from '@redspark/rsh-pwsh-local'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/pwsh-terminal', import.meta.url))
const SEED = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const TERMINAL_EXPECTED = join(SNAPSHOT_DIR, 'terminal-card.expected.md')
const PROMPT = 'Run a PowerShell command that fails, then stop.'
const SEED_ID = 'pwsh-terminal-web-e2e'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()

// The Native composition must boot the pwsh executor, so the lane self-skips on a
// host without a usable `pwsh`. The probe follows the executor's own resolution
// (Program Files installs on Windows are found even when bare `pwsh` is not on PATH).
const HAS_PWSH = MODE === 'record' ? false : spawnSync(
  resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'],
  { encoding: 'utf8' },
).status === 0

it.skipIf(MODE === 'record' || !HAS_PWSH)('renders the seeded pwsh call as a terminal card with the parsed exit pill', async () => {
  const fixture = await readFile(SEED, 'utf8')
  expect(fixtureUserPrompts(fixture), 'seed fixture must carry the single drive prompt').toEqual([PROMPT])
  const scaffold = await launchNativeWeb({
    seed: { fixture: SEED, seedId: SEED_ID },
    configure: (row) => {
      if (row.id === 'bash-tool') return { ...row, plugin: '@redspark/rsh-tool-pwsh' }
      if (row.id === 'bash') return { ...row, plugin: '@redspark/rsh-pwsh-local' }
      return row
    },
  })
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: PROMPT }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    const transcript = page.locator(TRANSCRIPT)
    // The terminal card lives in the expanded body of the settled pwsh row.
    const row = transcript.locator('[data-tool="pwsh"]').first()
    await row.waitFor({ timeout: 20_000 })
    const toggle = row.locator('[data-expandable]').first()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    const card = transcript.locator('[data-terminal]').first()
    await card.waitFor({ timeout: 15_000 })
    // The parsed exit pill replaces the `[exit code: 1]` marker in the output
    // body — the terminal presentation, not the generic fence.
    const text = await card.textContent()
    expect(text).toContain('exit code 1')
    expect(text).toContain('Get-Item : Cannot find path')
    expect(text).not.toContain('[exit code: 1]')
    const snapshot = (await captureStableAria(page, '[data-terminal]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(TERMINAL_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'terminal-card.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
