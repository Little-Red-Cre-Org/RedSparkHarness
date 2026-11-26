/** Native Web plugin configuration: the shipped cards and the web-search fields. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/plugin-config', import.meta.url))
const SECTION_EXPECTED = join(SNAPSHOT_DIR, 'section.expected.md')
const SECRET = '{{SECRET_7kd3wpqa}}'
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('configures the web-search card and leaves the others read-only', async () => {
  const scaffold = await launchNativeWeb({
    silentModel: false,
    credentials: { DEEPSEEK_API_KEY: '{{SECRET_m2xr8vtc}}' },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-plugin-config'))
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'en')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
    expect(await dialog.getByRole('tab', { name: 'Plugin configuration', exact: true })
      .getAttribute('aria-selected')).toBe('true')

    // Every card the shipped Native composition exposes. Only the search
    // provider carries fields; the others declare that boundary instead of
    // rendering an empty form.
    const notConfigurable = dialog.getByText('Not configurable on this Host yet.', { exact: true })
    await expect.poll(() => notConfigurable.count(), { timeout: 15_000 }).toBe(3)
    const webSearch = dialog.getByRole('button', { name: 'Show settings: Web search' })
    await webSearch.waitFor({ timeout: 15_000 })
    expect(await dialog.getByLabel('Endpoint', { exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(SECTION_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
    await webSearch.click()
    const endpoint = dialog.getByLabel('Endpoint', { exact: true })
    await endpoint.waitFor({ timeout: 10_000 })
    expect(await endpoint.inputValue()).toBe('')
    const maxSearches = dialog.getByLabel('Max searches per request', { exact: true })
    expect(await maxSearches.inputValue()).toBe('5')
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    expect(await save.isDisabled()).toBe(true)

    // A staged edit is marked unsaved and stays out of the document.
    const settingsDocument = async (): Promise<string> =>
      await readFile(join(scaffold.home, 'settings.yaml'), 'utf8').catch(() => '')
    await endpoint.fill('https://search.example/v1')
    await dialog.getByText('Unsaved', { exact: true }).waitFor({ timeout: 5_000 })
    expect(await dialog.getByText('Overridden', { exact: true }).count()).toBe(1)
    expect(await settingsDocument()).not.toContain('search.example')
    await save.click()
    await expect.poll(async () => (await settingsDocument()).includes('https://search.example/v1'),
      { timeout: 10_000 }).toBe(true)
    await expect.poll(() => dialog.getByRole('button', { name: 'Show settings: Web search' }).count(),
      { timeout: 10_000 }).toBe(1)

    // The key is write-only: it lands in the credentials document under the
    // provider's reference and never in the settings file.
    await dialog.getByRole('button', { name: 'Show settings: Web search' }).click()
    await dialog.getByLabel('API key', { exact: true }).fill(SECRET)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await readFile(join(scaffold.home, 'credentials.json'), 'utf8'))
      .includes(SECRET), { timeout: 10_000 }).toBe(true)
    expect(await settingsDocument()).not.toContain(SECRET)

    // Discard drops the draft; Reset stages the composed default and saves the
    // override away.
    await dialog.getByRole('button', { name: 'Show settings: Web search' }).click()
    await maxSearches.fill('9')
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect.poll(() => maxSearches.inputValue(), { timeout: 5_000 }).toBe('5')
    await endpoint.fill('https://ignored.example/v1')
    await dialog.getByRole('button', { name: 'Reset to default', exact: true }).click()
    await expect.poll(() => endpoint.inputValue(), { timeout: 5_000 }).toBe('')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await settingsDocument()).includes('search.example'), { timeout: 10_000 })
      .toBe(false)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['section.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
