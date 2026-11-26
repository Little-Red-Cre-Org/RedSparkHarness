/** Native Web links a complete HTTP URL in inline code and leaves other code inert. */
import { createServer, type Server } from 'node:http'
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-inline-code-links', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-inline-code-links/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'markdown-inline-code-links-web-e2e'
const TITLE = 'Inline code links'
const DONE = 'INLINE_CODE_LINK_DONE'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

/** Start the loopback preview page the inline code names. */
async function startPreview(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Preview</title><p>Preview</p>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('preview origin did not expose an IP socket')
  return { server, url: `http://127.0.0.1:${String(address.port)}/?demo=1` }
}

/** Stop the preview origin after the browser releases it. */
async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })
}

/** Build a settled assistant reply with linkable URL code and inert code controls. */
function markdownFixture(linkUrl: string): string {
  const session = Session.create(SessionId('markdown-inline-code-links-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show the local preview URL.' }],
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
          '## Inline code links',
          '',
          `Preview: \`${linkUrl}\``,
          '',
          `Standard: [Open preview](${linkUrl})`,
          '',
          `Command: \`curl ${linkUrl}\``,
          '',
          'Unsafe: `javascript:alert(1)`',
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

it.skipIf(MODE === 'record')('opens a complete HTTP URL from inline code and leaves other code inert', async () => {
  const preview = await startPreview()
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    seed: { text: markdownFixture(preview.url), seedId: SEED_ID },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-markdown-inline-code-links'))
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: TITLE }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.locator(TRANSCRIPT).getByText(DONE, { exact: true }).waitFor({ timeout: 20_000 })
    await expect.poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count(), {
      timeout: 20_000,
    }).toBe(0)

    const inlineCodeLink = page.locator(`${TRANSCRIPT} [class*="MarkdownText_markdown"] code a`)
    await expect.poll(() => inlineCodeLink.count(), { timeout: 10_000 }).toBe(1)
    const linkUrl = preview.url
    expect(await inlineCodeLink.getAttribute('href')).toBe(linkUrl)
    expect(await inlineCodeLink.getAttribute('target')).toBe('_blank')
    expect(await inlineCodeLink.getAttribute('rel')).toBe('noopener noreferrer')
    await inlineCodeLink.focus()
    expect(await inlineCodeLink.evaluate(element => document.activeElement === element)).toBe(true)

    const popupPromise = page.waitForEvent('popup')
    await inlineCodeLink.click()
    const popup = await popupPromise
    await popup.waitForURL(linkUrl, { timeout: 15_000 })
    expect(popup.url()).toBe(linkUrl)
    await popup.close()

    expect(await page.getByText(`curl ${linkUrl}`, { exact: true }).locator('a').count()).toBe(0)
    expect(await page.getByText('javascript:alert(1)', { exact: true }).locator('a').count()).toBe(0)
    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
      .split(linkUrl).join('{{linkUrl}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
    await stopServer(preview.server)
  }
}, 120_000)
