/** Native Web stops asking for the official key once another provider can serve requests. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/onboarding-usable-provider', import.meta.url))
const DISMISSED_EXPECTED = join(SNAPSHOT_DIR, 'dismissed.expected.md')
const MODE = webSnapshotMode()
const SECRET = 'sk-e2e-minimax'
const ONBOARDING_TITLE = '为 RedSpark Harness 配置模型'
const MODELS_SKIP_KEY = 'dsh.native.onboarding.models'

it.skipIf(MODE === 'record')('another usable provider ends first-run onboarding', async () => {
  const scaffold = await launchNativeWeb({
    page: { width: 1440, height: 960, locale: ZH_BROWSER_LOCALE },
    onboard: false,
    // The shipped pi-ai row provides `model`; the catalog must stay its own.
    silentModel: false,
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-onboarding-usable-provider'))
  try {
    const { page } = scaffold
    const overlay = page.locator('[class*="onboardingOverlay"]')
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.getByRole('heading', { name: ONBOARDING_TITLE }).waitFor({ timeout: 20_000 })
    // The step leads with the route new Sessions use, so skipping it leaves
    // Settings → Models as the only setup surface.
    await page.getByRole('button', { name: '稍后配置', exact: true }).click()
    await overlay.waitFor({ state: 'detached', timeout: 20_000 })

    const settings = page.getByRole('dialog', { name: '设置' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByText('填入各提供方的 API 密钥即可使用其模型。', { exact: true }).waitFor({ timeout: 20_000 })
    await settings.getByRole('button', { name: '编辑 DeepSeek (deepseek)', exact: true })
      .waitFor({ timeout: 20_000 })
    // Node-only setups have no first-run setup card: the pi-ai route is a row.
    expect(await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).count()).toBe(0)

    const add = settings.getByRole('button', { name: '添加提供方', exact: true })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    const pick = settings.getByLabel('提供方', { exact: true })
    await pick.waitFor({ timeout: 10_000 })
    await pick.selectOption('minimax-cn')
    await expect.poll(
      async () => settings.getByRole('textbox', { name: 'API 密钥', exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(1)
    const dismissed = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DISMISSED_EXPECTED, dismissed, MODE)

    await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).fill(SECRET)
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 minimax-cn。', { exact: true }).waitFor({ timeout: 15_000 })

    const document = await readFile(join(scaffold.home, 'settings.yaml'), 'utf8')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    const credentials = await readFile(join(scaffold.home, 'credentials.json'), 'utf8')
    expect(credentials).toContain('MINIMAX_CN_API_KEY')
    expect(credentials).toContain(SECRET)
    expect(credentials).not.toContain('DEEPSEEK_API_KEY')

    // Clear the skip so the next boot re-derives onboarding from the model
    // catalog: the regression is that a configured route still prompts.
    await page.evaluate((key) => { localStorage.removeItem(key) }, MODELS_SKIP_KEY)
    await page.reload({ waitUntil: 'load' })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    await expect.poll(
      async () => page.getByRole('heading', { name: ONBOARDING_TITLE }).count(),
      { timeout: 20_000 },
    ).toBe(0)
    await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 20_000 })

    // The Models page agrees: DeepSeek stays a row rather than reopening its
    // setup over a user who already has somewhere to send a request.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '编辑 DeepSeek (deepseek)', exact: true })
      .waitFor({ timeout: 20_000 })
    expect(await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).count()).toBe(0)
    expect((await page.content()).includes(SECRET)).toBe(false)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['dismissed.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
