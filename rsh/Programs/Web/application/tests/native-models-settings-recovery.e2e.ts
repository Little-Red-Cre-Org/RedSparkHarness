/** Native Web keeps a stored provider repairable through Settings → Models after catalog drift. */
import { writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/models-settings-recovery/stored-error.expected.md', import.meta.url))
const FAILURE = 'llm-pi-ai: provider "openrouter" model "111" needs an api; '
  + 'the installed catalog does not describe it, so set the route\'s api to the wire protocol its endpoint speaks'
const CUSTOM_FAILURE = 'llm-pi-ai: provider "acme-gateway" model "custom-model" needs an api; '
  + 'the installed catalog does not describe it, so set the route\'s api to the wire protocol its endpoint speaks'
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('keeps a drifted provider repairable beside healthy providers', async () => {
  const scaffold = await launchNativeWeb({
    page: { width: 1680, height: 1000, locale: ZH_BROWSER_LOCALE },
    silentModel: false,
    prepareProfile: (profileDir) => {
      writeFileSync(join(dirname(dirname(profileDir)), 'settings.yaml'), [
        'llm-pi-ai:', '  providers:', '    openrouter:', '      models:',
        '        - id: "111"', '    zai: {}', '    acme-gateway:',
        '      baseURL: https://gateway.example/v1', '      models:', '        - id: "custom-model"', '',
      ].join('\n'))
    },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-models-settings-recovery'))
  try {
    const { page } = scaffold
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await dialog.getByText(FAILURE, { exact: true }).waitFor({ timeout: 20_000 })

    expect(await dialog.getByRole('button', { name: '编辑 openrouter', exact: true }).count()).toBe(1)
    expect(await dialog.getByRole('button', { name: '编辑 zai', exact: true }).count()).toBe(1)
    expect(await dialog.getByRole('button', { name: '编辑 acme-gateway', exact: true }).count()).toBe(1)
    expect(await dialog.getByText(CUSTOM_FAILURE, { exact: true }).count()).toBe(1)
    expect(await dialog.getByRole('button', { name: '添加提供方', exact: true }).isEnabled()).toBe(true)
    expect(await dialog.getByRole('button', { name: '添加自定义提供方', exact: true }).isEnabled()).toBe(true)
    await compareOrRefreshGolden(EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)

    await dialog.getByRole('button', { name: '添加提供方', exact: true }).click()
    await dialog.getByLabel('提供方', { exact: true }).selectOption('minimax-cn')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByText('已保存 minimax-cn。', { exact: true }).waitFor()
    expect(await readFile(join(scaffold.home, 'settings.yaml'), 'utf8')).toContain('minimax-cn: {}')
    expect(await dialog.getByText(FAILURE, { exact: true }).count()).toBe(1)

    // The stored provider joins the page once the invalidation-triggered
    // describe lands; the editor then opens on the post-write revision.
    await expect.poll(() => dialog.getByRole('button', { name: '编辑 minimax-cn', exact: true }).count())
      .toBe(1)
    await dialog.getByRole('button', { name: '编辑 openrouter', exact: true }).click()
    await dialog.getByText('自定义设置', { exact: true }).click()
    await dialog.getByLabel('API 地址', { exact: true }).fill('https://gateway.example/v1')
    const before = await readFile(join(scaffold.home, 'settings.yaml'), 'utf8')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    // The Native editor reports the rejection once, beside the provider list.
    await expect.poll(() => dialog.getByText(FAILURE, { exact: true }).count()).toBeGreaterThanOrEqual(1)
    expect(await readFile(join(scaffold.home, 'settings.yaml'), 'utf8')).toBe(before)
    await dialog.getByRole('button', { name: '删除模型 1', exact: true }).click()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await dialog.getByText('已保存 openrouter。', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await dialog.getByText(FAILURE, { exact: true }).count()).toBe(0)
    const repaired = await readFile(join(scaffold.home, 'settings.yaml'), 'utf8')
    expect(repaired).not.toContain('111')
    expect(repaired).toContain('baseURL: https://gateway.example/v1')
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 180_000)
