/** Shipped Native Web delivers a requested SVG through `present` and renders the delivered-file card. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import {
  assertFixtureInventory, assertFinalWorkspaceSnapshot, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const DIR = fileURLToPath(new URL('../../../../../snapshots/web/present-svg', import.meta.url))
const FIXTURE = join(DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(DIR, 'ui.expected.md')
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()
const PROMPT = '简单画一个 SVG 表示冯诺依曼架构, 保存为 von-neumann.svg'
const FILE = 'von-neumann.svg'

/** One Host history read, narrowed to the events this scenario inspects. */
interface History {
  readonly header: { readonly id: string }
  readonly events: readonly { readonly type: string; readonly seq: number; readonly data: unknown }[]
}

it('replays the recorded turn, delivers the SVG, and renders its card', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const replayRoot = await mkdtemp(join(tmpdir(), 'rsh-native-present-svg-'))
  try {
    const override = join(replayRoot, 'replay.override.json')
    const script = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    // Recorded absolute paths must follow each isolated Session's working directory.
    const cwdToken = '{{fromRequest:Your working directory is ([^\\n]+)\\.}}'
    await writeFile(override, JSON.stringify(script).replaceAll('{{cwd}}', JSON.stringify(cwdToken).slice(1, -1)))
    const scaffold = await launchNativeWeb({
      drop: ['pi-ai'],
      // The title request shares the positional replay cursor; the recorded scripts are the main turn's.
      configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
      replay: { file: FIXTURE, overrideFile: override, paceMs: 0 },
      page: { width: 1680, height: 1000, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' },
    })
    try {
      const { page } = scaffold
      await connectNativeWorkspace(page, scaffold.workspaceCwd, 'zh')
      const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
      if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
      const sessionId = listed.value[0]?.header.id
      if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

      // The connected view is still restoring; Enter before that queues the text as steering input.
      await expect.poll(() => page.getByRole('button', { name: '插话发送', exact: true }).count(), { timeout: 15_000 }).toBe(0)
      const input = page.locator('textarea[aria-label="消息"]')
      await input.fill(PROMPT)
      await input.press('Enter')
      // Native file mutations ask the human before the first write of a Session.
      const approval = page.locator('[data-approval-key]')
      await approval.waitFor({ timeout: 30_000 })
      await approval.getByRole('button', { name: '允许一次', exact: true }).click()
      await expect.poll(() => page.locator('[data-approval-key]').count(), { timeout: 10_000 }).toBe(0)
      await expect.poll(() => page.getByText('正在执行…', { exact: true }).count(), { timeout: 60_000 }).toBe(0)

      const svg = await readFile(join(scaffold.workspaceCwd, FILE), 'utf8')
      const document = await page.evaluate((source) => {
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
        return {
          root: parsed.documentElement.localName,
          namespace: parsed.documentElement.namespaceURI,
          errors: parsed.querySelectorAll('parsererror').length,
        }
      }, svg)
      expect(document).toEqual({ root: 'svg', namespace: 'http://www.w3.org/2000/svg', errors: 0 })

      const history = await scaffold.rpc<History>('session/history', { sessionId })
      if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
      const events = history.value.events
      const declarations = events.filter(event => event.type === 'deliverables/presented')
      const delivery = declarations.find((event) => {
        const files = (event.data as { readonly files: readonly { readonly path: string }[] }).files
        return files.some(file => resolve(scaffold.workspaceCwd, file.path) === join(scaffold.workspaceCwd, FILE))
      })
      expect(delivery, 'the file request must produce a successful present declaration').toBeDefined()
      if (delivery === undefined) throw new Error('SVG was written but not delivered')
      expect(events.some(event => event.type === 'tool/call' && (event.data as { readonly name: string }).name === 'present'
        && (event.data as { readonly callId: string }).callId === (delivery.data as { readonly callId: string }).callId)).toBe(true)
      expect(events.some(event => event.type === 'assistant/message' && event.seq > delivery.seq
        && ((event.data as { readonly message: { readonly content: readonly { readonly type: string }[] } }).message.content)
          .some(block => block.type === 'text'))).toBe(true)

      // A reload makes the client list the Session the Host route created.
      await page.reload({ waitUntil: 'load' })
      const onboard = page.getByRole('button', { name: '继续', exact: true })
      if (await onboard.count() > 0) await onboard.click()
      await page.locator('[role="treeitem"]').filter({ hasText: '简单画一个 SVG' }).first().click()
      const card = page.locator('[data-presented-file]').filter({ hasText: FILE })
      await card.waitFor({ state: 'visible', timeout: 20_000 })
      expect(await card.count()).toBe(1)
      expect(await page.getByText('产物', { exact: true }).count()).toBe(0)
      // The Native card reads the serving desktop; without one both open gestures stay disabled.
      await page.getByText('此主机没有可用的桌面，无法打开文件或文件夹', { exact: true }).first().waitFor({ timeout: 15_000 })
      for (const label of [`用默认应用打开 ${FILE}`, `在文件管理器中显示 ${FILE}`]) {
        await expect.poll(() => page.getByRole('button', { name: label, exact: true }).first().isDisabled()).toBe(true)
      }
      // Selecting the settled Session briefly follows its closing frames; capture only an idle transcript.
      await expect.poll(() => page.getByText('正在执行…', { exact: true }).count(), { timeout: 15_000 }).toBe(0)
      await compareOrRefreshGolden(UI_EXPECTED,
        await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd), MODE)
      await assertFinalWorkspaceSnapshot(DIR, scaffold.workspaceCwd)
      expect(scaffold.pageErrors).toEqual([])
      await assertFixtureInventory(DIR, ['session.v3.jsonl', 'ui.expected.md', 'workspace.expected'], 'native-web')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(replayRoot, { recursive: true, force: true })
  }
}, 180_000)
