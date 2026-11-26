/** Native Web offers exactly the reasoning efforts a declared route advertises. */
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/declared-reasoning', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

it.skipIf(MODE === 'record')('offers exactly the declared levels and records the picked one', async () => {
  const scaffold = await launchNativeWeb({
    page: { width: 1680, height: 1000, locale: ZH_BROWSER_LOCALE },
    // The shipped pi-ai row serves the declared route; a silent catalog would
    // make the picker describe a fixture instead of this document.
    silentModel: false,
    prepareProfile: (profileDir) => {
      // Key = selectable level, value = the wire spelling dispatch sends
      // (`max: ultra` renames; the valueless `off` means supported, send
      // nothing). The route configures no deployment default, so the pane
      // leads with the provider-default entry.
      writeFileSync(join(dirname(dirname(profileDir)), 'settings.yaml'), [
        'llm-pi-ai:',
        '  providers:',
        '    acme-gateway:',
        '      displayName: Acme Gateway',
        '      api: openai-completions',
        '      baseURL: https://gateway.acme.example/v1',
        '      models:',
        '        - id: acme-think',
        '          name: Acme Think',
        '          reasoningEfforts:',
        '            "off": null',
        '            high: high',
        '            max: ultra',
        'agent-default-model:',
        '  provider: acme-gateway',
        '  model: acme-think',
        '',
      ].join('\n'))
    },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-declared-reasoning'))
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'zh')
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 20_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /^推理等级/ }).click()

    // Minimal, low, medium, and xhigh were not declared and must not be offered.
    const levels = page.getByRole('menuitemradio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'High', 'Max'])
    await compareOrRefreshGolden(UI_EXPECTED,
      await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), MODE)

    await page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('选择模型，当前 Acme Think，推理等级 High')
    // Native keeps the route in the Session log; it mounts no settings-backed
    // Agent default, so the declared provider document stays untouched.
    const logs = globSync(join(scaffold.sessionRoot, '**', '*.jsonl'))
    expect(logs).toHaveLength(1)
    const events = readFileSync(logs[0] as string, 'utf8')
    expect(events).toContain('"type":"model/selection"')
    expect(events).toContain('"reasoningEffort":"high"')
    expect(await readFile(join(scaffold.home, 'settings.yaml'), 'utf8'))
      .toContain('model: acme-think')
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 180_000)
