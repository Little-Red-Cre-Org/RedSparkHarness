/** Native Web first-run model step stores the DeepSeek key without a reload. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFailed } from 'vitest'
import { webSnapshotMode } from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

const SECRET = '{{SECRET_ds9k2m4p}}'
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('stores the DeepSeek key and leaves the takeover for good', async () => {
  const scaffold = await launchNativeWeb({ onboard: false, silentModel: false })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-onboarding-deepseek-config'))
  try {
    const { page } = scaffold
    const overlay = page.locator('[class*="onboardingOverlay"]')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('heading', { name: 'Configure a model for RedSpark Harness', exact: true })
      .waitFor({ timeout: 20_000 })
    const provider = page.getByRole('combobox', { name: 'Model provider', exact: true })
    await provider.selectOption({ label: 'DeepSeek' })
    const key = page.getByRole('textbox', { name: 'API key', exact: true })
    await key.fill(SECRET)
    // The step is one document: an in-place write must not reload the page.
    await page.evaluate(() => { (window as unknown as { __onboarding: string }).__onboarding = 'same-document' })
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
    await overlay.waitFor({ state: 'detached', timeout: 20_000 })
    expect(await page.evaluate(() => (window as unknown as { __onboarding?: string }).__onboarding))
      .toBe('same-document')

    // The key lands in the credentials document. This route's `apiKeyEnv`
    // reference is a composition fact, so the user settings file gains no
    // override and never holds the secret.
    const settingsDocument = async (): Promise<string> =>
      await readFile(join(scaffold.home, 'settings.yaml'), 'utf8').catch(() => '')
    await expect.poll(async () => await readFile(join(scaffold.home, 'credentials.json'), 'utf8')
      .then(document => document.includes('DEEPSEEK_API_KEY')).catch(() => false),
    { timeout: 15_000 }).toBe(true)
    expect(await settingsDocument()).not.toContain(SECRET)
    expect(await settingsDocument()).not.toContain('apiKeyEnv')
    expect(await readFile(join(scaffold.home, 'credentials.json'), 'utf8')).toContain(SECRET)
    expect((await page.content()).includes(SECRET)).toBe(false)

    // A configured reload paints the application, not the takeover: the step
    // is derived from the catalog and the stored reference, not a skip flag.
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 20_000 })
    expect(await page.getByRole('heading', { name: 'Configure a model for RedSpark Harness', exact: true })
      .count()).toBe(0)
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 180_000)
