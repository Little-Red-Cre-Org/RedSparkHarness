/** Native Web Models settings: catalog add card, write-only key, and route fields. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/models-settings', import.meta.url))
const ADD_EXPECTED = join(SNAPSHOT_DIR, 'add.expected.md')
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'configured.expected.md')
const SECRET = 'sk-e2e-minimax'
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('adds a catalog provider and stores its key write-only', async () => {
  const scaffold = await launchNativeWeb({
    silentModel: false,
    credentials: { DEEPSEEK_API_KEY: '{{SECRET_h3xq9tbm}}' },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-models-settings'))
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'en')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Models', exact: true }).click()
    await dialog.getByText('Enter your API keys to use models from the following providers.', { exact: true })
      .waitFor({ timeout: 20_000 })
    expect(await dialog.getByRole('region', { name: 'API models', exact: true }).count()).toBe(1)
    const settingsDocument = async (): Promise<string> =>
      await readFile(join(scaffold.home, 'settings.yaml'), 'utf8').catch(() => '')

    // The add card offers the dormant adapter's installed catalog; the
    // subscription vocabulary the Cordis page carried has no Native surface.
    const add = dialog.getByRole('button', { name: 'Add provider', exact: true })
    await expect.poll(() => add.isEnabled(), { timeout: 20_000 }).toBe(true)
    await add.click()
    const pick = dialog.getByRole('combobox', { name: 'Provider', exact: true })
    await pick.waitFor({ timeout: 10_000 })
    const options = await pick.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(30)
    expect(options).toContain('anthropic')
    expect(options).toContain('minimax-cn')
    expect(options).not.toContain('openai-codex')
    await pick.selectOption('minimax-cn')
    const key = dialog.getByRole('textbox', { name: 'API key', exact: true })
    await key.waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(ADD_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)

    // An empty key saves a reference-free profile for provider-native auth.
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(async () => (await settingsDocument()).includes('minimax-cn: {}'), { timeout: 10_000 })
      .toBe(true)
    expect(await settingsDocument()).not.toContain('MINIMAX_CN_API_KEY')
    expect(await dialog.getByRole('textbox', { name: 'API key', exact: true }).count()).toBe(0)

    // A typed key lands in the credentials document under the derived
    // reference; the settings file keeps only that reference.
    const rows = dialog.getByRole('button', { name: /^Edit / })
    await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(2)
    await rows.nth(1).click()
    const editKey = dialog.getByRole('textbox', { name: 'API key', exact: true })
    await editKey.waitFor({ timeout: 10_000 })
    await editKey.fill(SECRET)
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(async () => (await settingsDocument()).includes('apiKeyEnv: MINIMAX_CN_API_KEY'),
      { timeout: 10_000 }).toBe(true)
    expect(await settingsDocument()).not.toContain(SECRET)
    await expect.poll(async () => (await readFile(join(scaffold.home, 'credentials.json'), 'utf8'))
      .includes(SECRET), { timeout: 10_000 }).toBe(true)
    expect((await page.content()).includes(SECRET)).toBe(false)

    // The customized fold merges into the stored profile beside the reference.
    await rows.nth(1).click()
    await dialog.getByText('Customized settings', { exact: true }).click()
    const baseUrl = dialog.getByLabel('Base URL', { exact: true })
    await baseUrl.waitFor({ timeout: 10_000 })
    expect(await baseUrl.getAttribute('placeholder')).toBe('Provider default')
    await baseUrl.fill('https://gateway.minimax.example/v1')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(async () => (await settingsDocument()).includes('baseURL: https://gateway.minimax.example/v1'),
      { timeout: 10_000 }).toBe(true)
    const document = await settingsDocument()
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    await expect.poll(() => dialog.getByRole('textbox', { name: 'API key', exact: true }).count(),
      { timeout: 10_000 }).toBe(0)
    // A configured key shows the replace affordance rather than the value.
    await rows.nth(1).click()
    await expect.poll(async () => dialog.getByRole('textbox', { name: 'API key', exact: true })
      .getAttribute('placeholder'), { timeout: 10_000 }).toBe('Configured — enter a new value to replace')
    expect(await dialog.getByRole('combobox', { name: 'Provider', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(CONFIGURED_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['add.expected.md', 'configured.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
