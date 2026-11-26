/** Shipped Native Web hides Open In under SSH after the Host returns an empty catalog. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/open-in-app-ssh', import.meta.url))
const SEED = fileURLToPath(new URL('../../../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const SEED_ID = 'open-in-app-ssh-web-e2e'
const MODE = webSnapshotMode()

const KEEP = ['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution', 'agent-presets',
  'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json', 'storage-domain',
  'workspace', 'open-in-app', 'subprocess', 'shell-env'] as const

it.skipIf(MODE === 'record')('hides a remembered app after the real Host returns an empty catalog', async () => {
  const scaffold = await launchNativeWeb({
    keep: KEEP,
    env: { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' },
    seed: { fixture: SEED, seedId: SEED_ID },
  })
  try {
    const { page } = scaffold
    await page.addInitScript(() => {
      localStorage.setItem('dsh.open-in-app.choice', JSON.stringify('vscode'))
    })
    const [response] = await Promise.all([
      page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/open-in-app/apps'),
      page.reload({ waitUntil: 'load' }),
    ])
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ apps: [] })
    const session = page.locator('[role="treeitem"]').filter({ hasText: 'Use the read tool twice' }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.getByText('DONE', { exact: true }).first().waitFor({ timeout: 20_000 })
    expect(await page.getByRole('button', { name: /^Open workspace in / }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Choose an app to open in', exact: true }).count()).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('dsh.open-in-app.choice'))).toBe('"vscode"')
    const snapshot = (await captureStableAria(page, 'header', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'header.expected.md'), snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['header.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
