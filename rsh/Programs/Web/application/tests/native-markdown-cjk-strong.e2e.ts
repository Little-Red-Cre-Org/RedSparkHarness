/** Native Web renders punctuation-terminated strong spans beside adjacent CJK text. */
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@redspark/rsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@redspark/rsh-session'
import type {} from '@redspark/rsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-cjk-strong', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-cjk-strong/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'markdown-cjk-strong-web-e2e'
const TITLE = 'CJK strong emphasis'
const DONE = 'CJK_STRONG_DONE'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const CASES = [
  ['**注意：**内容', '注意：', '注意：内容'],
  ['**Notice:**内容', 'Notice:', 'Notice:内容'],
  ['**事件中间件（waterfall）**实现', '事件中间件（waterfall）', '事件中间件（waterfall）实现'],
  ['**事件中间件(waterfall)**实现', '事件中间件(waterfall)', '事件中间件(waterfall)实现'],
  ['**句号。**后续', '句号。', '句号。后续'],
  ['**Period.**后续', 'Period.', 'Period.后续'],
  ['**提醒！**继续', '提醒！', '提醒！继续'],
  ['**Warning!**继续', 'Warning!', 'Warning!继续'],
] as const

/** Build one settled assistant reply covering CJK-adjacent strong punctuation boundaries. */
function markdownFixture(): string {
  const session = Session.create(SessionId('markdown-cjk-strong-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Render adjacent CJK strong emphasis.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: TITLE,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: [
          '## CJK strong emphasis',
          '',
          ...CASES.flatMap(([markdown]) => [markdown, '']),
          DONE,
        ].join('\n'),
      }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
      isSeeded: false,
      delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

it.skipIf(MODE === 'record')('renders punctuation-terminated strong spans before adjacent CJK text', async () => {
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    seed: { text: markdownFixture(), seedId: SEED_ID },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-markdown-cjk-strong'))
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: TITLE }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.locator(TRANSCRIPT).getByText(DONE, { exact: true }).waitFor({ timeout: 20_000 })
    // Restoring a Session attaches to its Host turn; a settled seed returns to
    // the ready composer instead of leaving the live activity row on screen.
    await expect.poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count(), {
      timeout: 20_000,
    }).toBe(0)

    const strong = page.locator(`${TRANSCRIPT} [class*="MarkdownText_markdown"] strong`)
    await expect.poll(() => strong.count(), { timeout: 10_000 }).toBe(CASES.length)
    expect(await strong.allTextContents()).toEqual(CASES.map(([, expected]) => expected))
    for (const [, , paragraph] of CASES) {
      expect(await page.getByText(paragraph, { exact: true }).count()).toBe(1)
    }

    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
