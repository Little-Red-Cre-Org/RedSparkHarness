/** Native Web keeps the blank New Session seat beside every established Session. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/workspace-new-session-folding', import.meta.url))
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const SEED = fileURLToPath(new URL('../../../../../snapshots/web/message-feedback-protocol/session.v3.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const EXISTING_SESSION_COUNT = 6

it.skipIf(MODE === 'record')('keeps the blank New Session seat beside every established Session', async () => {
  const scaffold = await launchNativeWeb({
    // The shipped pi-ai route serves the catalog; a silent model would answer
    // the onboarding model step with a fixture instead of a usable route.
    silentModel: false,
    credentials: { DEEPSEEK_API_KEY: 'native-scenario-key' },
    seeds: Array.from({ length: EXISTING_SESSION_COUNT }, (_, index) => ({
      fixture: SEED,
      seedId: `workspace-new-session-folding-${String(index + 1).padStart(2, '0')}`,
    })),
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-workspace-new-session-folding'))
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'en')
    const sidebar = page.getByRole('tree', { name: 'Workspaces' })
    // The workspace group is a row of its own, so the list holds it, the
    // blank seat, and every seeded Session in one flat order.
    await expect.poll(() => sidebar.getByRole('treeitem').count(), { timeout: 15_000 })
      .toBe(EXISTING_SESSION_COUNT + 2)
    expect(await sidebar.getByText('New Session', { exact: true }).count()).toBe(1)
    // Native has no fold control: every established Session stays listed.
    expect(await page.getByRole('button', { name: /Show .* more sessions/ }).count()).toBe(0)
    await compareOrRefreshGolden(
      SIDEBAR_EXPECTED,
      await captureStableAria(page, '[role="tree"][aria-label="Workspaces"]', scaffold.workspaceCwd,
        { normalizeAge: true }),
      MODE,
    )
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['sidebar.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
