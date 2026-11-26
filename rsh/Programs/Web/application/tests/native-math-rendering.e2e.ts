/** Native Web renders every supported Markdown math delimiter without KaTeX errors. */
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/math-rendering', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/math-rendering/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'math-rendering-web-e2e'
const TITLE = 'Math rendering'
const DONE = 'MATH_RENDERING_DONE'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

/** Build a settled assistant reply that exercises every supported math delimiter. */
function mathFixture(): string {
  const session = Session.create(SessionId('math-rendering-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Render this mathematical proof.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: TITLE,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: [
          '## Math rendering',
          '',
          'Inline dollar $\\theta$ and backslash \\(\\frac{1}{5}\\).',
          '',
          '\\[\\frac{\\pi}{4} < \\theta < \\frac{\\pi}{2}\\]',
          '',
          '$$\\theta \\in \\left(\\frac{\\pi}{4}, \\frac{\\pi}{2}\\right). \\tag{1}$$',
          '',
          '| Symbol | Value |',
          '| --- | --- |',
          '| $\\theta$ | \\(\\frac{1}{5}\\) |',
          '',
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

it.skipIf(MODE === 'record')('renders the settled reply without KaTeX errors', async () => {
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    seed: { text: mathFixture(), seedId: SEED_ID },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-math-rendering'))
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: TITLE }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.locator(TRANSCRIPT).getByText(DONE, { exact: true }).waitFor({ timeout: 20_000 })
    await expect.poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count(), {
      timeout: 20_000,
    }).toBe(0)

    await expect.poll(() => page.locator('.katex').count(), { timeout: 10_000 }).toBe(6)
    await expect.poll(() => page.locator('.katex-display').count(), { timeout: 10_000 }).toBe(2)
    expect(await page.locator('.katex-error').count()).toBe(0)

    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
