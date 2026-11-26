/** Native Web settings shell and General preferences. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/settings-chrome', import.meta.url))
const DIALOG_EXPECTED = join(SNAPSHOT_DIR, 'dialog.expected.md')
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('opens the settings shell and applies General preferences', async () => {
  const scaffold = await launchNativeWeb({
    silentModel: false,
    credentials: { DEEPSEEK_API_KEY: '{{SECRET_q2m8vftr}}' },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-settings-chrome'))
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'en')
    const trigger = page.getByRole('button', { name: 'Settings', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 15_000 })
    // General is the landing section and its rows are the Host-backed preferences.
    expect(await dialog.getByRole('button', { name: 'General', exact: true }).getAttribute('aria-current'))
      .toBe('true')
    const busy = dialog.getByRole('combobox', { name: 'Send behavior while busy', exact: true })
    await expect.poll(() => busy.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(await dialog.getByRole('combobox', { name: 'Language', exact: true }).count()).toBe(1)
    await compareOrRefreshGolden(DIALOG_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)

    // Section switching moves `aria-current` and leaves the General rows behind.
    for (const section of ['Models', 'Plugins', 'Agent presets']) {
      await dialog.getByRole('button', { name: section, exact: true }).click()
      await expect.poll(() => dialog.getByRole('heading', { name: section, exact: true }).count(), { timeout: 15_000 })
        .toBe(1)
      expect(await dialog.getByRole('button', { name: section, exact: true }).getAttribute('aria-current'))
        .toBe('true')
    }
    expect(await dialog.getByRole('button', { name: 'General', exact: true }).getAttribute('aria-current'))
      .toBeNull()
    await dialog.getByRole('button', { name: 'General', exact: true }).click()

    // Appearance: one real gesture drives the palette, the alias token, and
    // the browser theme-color metadata.
    const token = async (): Promise<{ attribute: string | null; background: string; token: string; themeColor: string | null }> =>
      await page.evaluate(() => ({
        attribute: document.body.getAttribute('data-ds-dark-theme'),
        background: getComputedStyle(document.body).backgroundColor,
        token: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
        themeColor: document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
      }))
    const light = await token()
    await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect.poll(async () => (await token()).attribute, { timeout: 5_000 }).toBe('')
    const dark = await token()
    expect(dark.token).not.toBe(light.token)
    expect(dark.themeColor).toBe(dark.background)
    expect(await dialog.getByRole('button', { name: 'Dark', exact: true }).getAttribute('aria-pressed'))
      .toBe('true')
    await dialog.getByRole('button', { name: 'Light', exact: true }).click()
    await expect.poll(async () => (await token()).attribute, { timeout: 5_000 }).toBeNull()

    // Font size steps the conversation content variable and its displayed value.
    const fontVariable = async (): Promise<string> =>
      await page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size'))
    expect(await fontVariable()).toBe('14px')
    await dialog.getByRole('button', { name: 'Increase font size', exact: true }).click()
    await expect.poll(fontVariable, { timeout: 5_000 }).toBe('15px')
    expect(await dialog.getByText('15 px', { exact: true }).count()).toBe(1)
    await dialog.getByRole('button', { name: 'Decrease font size', exact: true }).click()
    await expect.poll(fontVariable, { timeout: 5_000 }).toBe('14px')

    // Language re-derives every label from the typed dictionaries.
    await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption({ label: '中文' })
    const zhDialog = page.getByRole('dialog', { name: '设置' })
    await zhDialog.getByRole('heading', { name: '通用设置', exact: true }).waitFor({ timeout: 10_000 })
    expect(await zhDialog.getByRole('button', { name: '模型', exact: true }).count()).toBe(1)
    await zhDialog.getByRole('combobox', { name: '语言', exact: true }).selectOption({ label: 'English' })
    await dialog.getByRole('heading', { name: 'General', exact: true }).waitFor({ timeout: 10_000 })

    // Both close paths leave no dialog behind.
    await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 10_000 })
    await trigger.click()
    await dialog.waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 10_000 })

    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['dialog.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
