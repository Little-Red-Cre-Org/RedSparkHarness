/** Native Web loads absolute HTTP(S) Markdown images and keeps every other destination as authored text. */
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
import { launchNativeWeb, waitForNativeComposerReady } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-images', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-images/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'markdown-images-web-e2e'
const TITLE = 'Markdown image policy'
const DONE = 'REMOTE_IMAGE_DONE'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const REMOTE_ALT = 'Remote test image'
const LOCAL_ALT = 'Local test image'
const WORKSPACE_ALT = 'Workspace test image'
const OUTSIDE_ALT = 'Outside workspace image'
const OVERSIZED_ALT = 'Oversized image'
const MISSING_ALT = 'Missing image'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

interface ImageOrigin {
  readonly server: Server
  readonly url: string
  readonly requests: Array<{ readonly path: string | undefined; readonly referer: string | undefined }>
}

/** Start the deterministic remote image origin used by this browser scenario. */
async function startImageOrigin(): Promise<ImageOrigin> {
  const requests: ImageOrigin['requests'] = []
  const server = createServer((request, response) => {
    requests.push({ path: request.url, referer: request.headers.referer })
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': PNG.length,
      'content-type': 'image/png',
    })
    response.end(PNG)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('image origin did not expose an IP socket')
  return { server, url: `http://127.0.0.1:${String(address.port)}/image.png`, requests }
}

/** Stop one image origin after the browser and host release their requests. */
async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })
}

/** Build one closed, invariant-checked session fixture with remote and local image Markdown. */
function markdownImageFixture(remoteUrl: string): string {
  const session = Session.create(SessionId('markdown-image-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show the Markdown image policy.' }],
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
          '## Markdown images',
          '',
          `![${REMOTE_ALT}](${remoteUrl})`,
          '',
          `![${LOCAL_ALT}](./local-image.png)`,
          '',
          `![${WORKSPACE_ALT}]({{cwd}}/valid.png)`,
          '',
          `![${OVERSIZED_ALT}]({{cwd}}/oversized.png)`,
          '',
          `![${OUTSIDE_ALT}](/tmp/outside.png)`,
          '',
          `![${MISSING_ALT}]({{cwd}}/missing.png)`,
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

it.skipIf(MODE === 'record')('loads absolute images and shows authored text for local destinations', async () => {
  const imageOrigin = await startImageOrigin()
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    seed: { text: markdownImageFixture(imageOrigin.url), seedId: SEED_ID },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-markdown-images'))
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: TITLE }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.locator(TRANSCRIPT).getByText(DONE, { exact: true }).waitFor({ timeout: 20_000 })
    await waitForNativeComposerReady(page)

    const image = page.getByRole('img', { name: REMOTE_ALT })
    await image.waitFor({ timeout: 10_000 })
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth), {
      timeout: 10_000,
    }).toBeGreaterThan(0)
    expect(await image.evaluate(element => ({
      decoding: element.getAttribute('decoding'),
      loading: element.getAttribute('loading'),
      referrerPolicy: element.getAttribute('referrerpolicy'),
    }))).toEqual({ decoding: 'async', loading: 'lazy', referrerPolicy: 'no-referrer' })
    expect(imageOrigin.requests).toEqual([{ path: '/image.png', referer: undefined }])

    for (const alt of [LOCAL_ALT, WORKSPACE_ALT, OVERSIZED_ALT, OUTSIDE_ALT, MISSING_ALT]) {
      await expect.poll(() => page.getByRole('img', { name: alt }).count(), { timeout: 10_000 }).toBe(0)
      expect(await page.getByText(alt, { exact: true }).count()).toBe(1)
    }
    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
      .split(imageOrigin.url).join('{{imageUrl}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
    await stopServer(imageOrigin.server)
  }
}, 120_000)
