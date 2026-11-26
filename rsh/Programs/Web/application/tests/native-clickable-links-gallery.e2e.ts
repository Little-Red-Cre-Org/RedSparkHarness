/** Native Web renders every clickable link and artifact form of one settled turn. */
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@redspark/rsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@redspark/rsh-session'
import type { JsonValue } from '@redspark/rsh-util-values'
import type {} from '@redspark/rsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb, waitForNativeComposerReady } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/clickable-links-gallery', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/clickable-links-gallery/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'clickable-links-gallery-web-e2e'
const TITLE = 'Clickable links gallery'
const DONE = 'LINK_GALLERY_DONE'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

const GUIDE_URL = 'https://docs.example.test/guide'
const API_URL = 'https://docs.example.test/api'
const RELEASES_URL = 'https://docs.example.test/releases'
const MAILTO_URL = 'mailto:owner@example.test'
const SOURCE_URL = 'https://docs.example.test/links'
const INERT_SOURCE_URL = 'ftp://mirror.example.test/spec'
const FETCH_URL = 'https://docs.example.test/tokens'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** One-part text content for a built message. */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** A settled root tool call: its call event arguments plus result content/meta. */
interface GalleryCall {
  name: string
  args: Record<string, unknown>
  result: string
  meta?: JsonValue
  isError?: true
}

/** The five successful writes; rsh/Docs/press.md and src/tokens.css join via other tools. */
const WRITES = ['site/report.html', 'a/style.css', 'b/style.css', 'site/index.html', 'site/app.js']

/** The gallery turn's tool calls, in surface order. */
const CALLS: GalleryCall[] = [
  ...WRITES.map(path => ({
    name: 'write',
    args: { file_path: path, content: `content of ${path}\n` },
    result: `Created ${path}`,
  })),
  {
    name: 'edit',
    args: {
      file_path: 'src/tokens.css',
      old_string: '--inline-code: #EBEEF2;',
      new_string: '--inline-code: #F5F5F5;',
    },
    result: 'Edited src/tokens.css',
    meta: {
      diffs: [{
        path: 'src/tokens.css',
        oldText: '--inline-code: #EBEEF2;\n',
        newText: '--inline-code: #F5F5F5;\n',
      }],
    },
  },
  {
    name: 'str_replace_editor',
    args: { command: 'create', path: 'rsh/Docs/press.md', file_text: '# Press kit\n' },
    result: 'Created rsh/Docs/press.md',
    meta: { diffs: [{ path: 'rsh/Docs/press.md', oldText: null, newText: '# Press kit\n' }] },
  },
  {
    name: 'write',
    args: { file_path: 'c/broken.css', content: 'nope\n' },
    result: 'permission denied: c/broken.css',
    isError: true,
  },
  {
    name: 'read',
    args: { file_path: 'rsh/Docs/guide.md' },
    // The read card validates the model-facing envelope, not just the meta:
    // without <path>/<type>/<content> the row falls back to the generic card.
    result: [
      '<path>rsh/Docs/guide.md</path>',
      '<type>file</type>',
      '<content>',
      ...Array.from({ length: 12 }, (_, index) =>
        index === 0 ? '# Link style guide' : `guide line ${String(index + 1)}`),
      '</content>',
    ].join('\n'),
    meta: {
      path: 'rsh/Docs/guide.md',
      offset: 1,
      lines: Array.from({ length: 12 }, (_, index) => ({
        number: index + 1,
        text: index === 0 ? '# Link style guide' : `guide line ${String(index + 1)}`,
      })),
      totalLines: 12,
    },
  },
  {
    name: 'grep',
    args: { pattern: 'linkColor' },
    result: 'nine matches across three files',
    meta: {
      shape: 'matches',
      files: ['a/style.css', 'b/style.css', 'src/tokens.css'].map(path => ({
        path,
        matches: [3, 7, 11].map(lineNumber => ({ lineNumber, line: '  color: var(--linkColor);' })),
      })),
      truncated: false,
      total: 9,
    },
  },
  {
    name: 'glob',
    args: { pattern: '**/*.css' },
    result: 'a/style.css\nb/style.css\nsrc/tokens.css',
    meta: { shape: 'paths', paths: ['a/style.css', 'b/style.css', 'src/tokens.css'], truncated: false, total: 3 },
  },
  {
    name: 'bash',
    args: { command: 'ls site', description: 'List the built site' },
    result: 'report.html\nindex.html\napp.js\n',
  },
  {
    name: 'bash',
    args: { command: 'pnpm run lint', description: 'Run the lint gate', workdir: 'site' },
    result: 'style.css: unexpected hex literal\n[exit code: 1]',
  },
  {
    name: 'web_search',
    args: { queries: ['clickable link styles', 'produced files ui'] },
    result: 'Two sources found.',
    meta: {
      truncated: false,
      answer: `Unify links per [the guide](${GUIDE_URL}).`,
      sources: [
        { url: SOURCE_URL, title: 'Link styles reference', snippet: 'One cursor token, one focus ring.' },
        { url: INERT_SOURCE_URL, title: 'Mirror spec (non-http)', snippet: 'A non-http source renders inert.' },
      ],
    },
  },
  {
    name: 'web_fetch',
    args: { url: FETCH_URL },
    result: 'Design token reference page.',
    meta: { url: FETCH_URL, statusCode: 200, truncated: false },
  },
  {
    name: 'design_tokens_sync',
    args: { source: 'design-platform.css', dryRun: false },
    result: '{"synced":true,"tokens":12}',
  },
]

/** Start the deterministic remote image origin the prose embeds. */
async function startImageOrigin(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
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
  return { server, url: `http://127.0.0.1:${String(address.port)}/image.png` }
}

/** Stop one image origin after the browser and host release their requests. */
async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })
}

/**
 * Build the settled gallery turn: every call above plus a link-dense closing prose.
 * @param imageUrl - absolute image the prose embeds, as the Native renderer requires.
 */
function galleryFixture(imageUrl: string): string {
  const session = Session.create(SessionId('clickable-links-gallery-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: text('Assemble the link gallery: write the report and styles, inspect the sources, and summarize.'),
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: TITLE,
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const calls = CALLS.map((call, index) => ({
    ...call,
    callId: ToolCallId(`gallery-${String(index)}`),
    argsJson: JSON.stringify(call.args),
  }))
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({
        type: 'tool-call' as const,
        id: call.callId,
        name: call.name,
        arguments: call.argsJson,
      })),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: call.callId,
      name: call.name,
      arguments: call.argsJson,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: text(call.result),
        isError: call.isError === true,
      }),
      ...(call.meta === undefined ? {} : { meta: call.meta }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: text([
        '## Link gallery',
        '',
        `Docs: [style guide](${GUIDE_URL}) and \`${API_URL}\`; see [the release notes][rel], `
        + `contact [the maintainer](${MAILTO_URL}), and check the fine print[^1].`,
        '',
        `Inert contrasts: \`curl ${API_URL}\`, \`javascript:alert(1)\`, and \`pnpm run build\`.`,
        '',
        'Wrote `report.html` plus two `style.css` copies; `notes.md` untouched.',
        '',
        `![Token preview](${imageUrl})`,
        '',
        '```css',
        '--inline-code: #F5F5F5;',
        '```',
        '',
        DONE,
        '',
        `[rel]: ${RELEASES_URL}`,
        '',
        '[^1]: Footnote references stay inert superscripts.',
      ].join('\n')),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
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

it.skipIf(MODE === 'record')('renders every clickable link and artifact form of the settled turn', async () => {
  const imageOrigin = await startImageOrigin()
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    seed: { text: galleryFixture(imageOrigin.url), seedId: SEED_ID },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-clickable-links-gallery'))
  try {
    const { page } = scaffold
    const session = page.locator('[role="treeitem"]').filter({ hasText: TITLE }).first()
    await session.waitFor({ timeout: 20_000 })
    await session.click()
    await page.locator(TRANSCRIPT).getByText(DONE, { exact: true }).waitFor({ timeout: 20_000 })
    await waitForNativeComposerReady(page)

    // Markdown prose: plain, reference-style, and mailto links plus the
    // inline-code URL are anchors; the URL-with-flags code, the javascript:
    // destination, and plain command code stay inert.
    const markdown = page.locator(`${TRANSCRIPT} [class*="markdown"]`)
    await expect.poll(() => markdown.locator(`a[href="${GUIDE_URL}"]`).count(), { timeout: 10_000 }).toBe(1)
    expect(await markdown.locator(`a[href="${RELEASES_URL}"]`).count()).toBe(1)
    expect(await markdown.locator(`a[href="${MAILTO_URL}"]`).count()).toBe(1)
    const inlineCodeLink = markdown.locator(`code a[href="${API_URL}"]`)
    expect(await inlineCodeLink.count()).toBe(1)
    expect(await inlineCodeLink.getAttribute('target')).toBe('_blank')
    expect(await page.getByText(`curl ${API_URL}`, { exact: true }).locator('a').count()).toBe(0)
    expect(await page.getByText('javascript:alert(1)', { exact: true }).locator('a').count()).toBe(0)
    const image = page.getByRole('img', { name: 'Token preview' })
    await image.waitFor({ timeout: 10_000 })
    expect(await image.getAttribute('src')).toBe(imageOrigin.url)

    // The Native page carries no file-mention vocabulary, no write-derived
    // produced-file chips, and no Host file opener: those Cordis surfaces stay
    // absent rather than degrading into dead links.
    expect(await markdown.locator('code button').count()).toBe(0)
    expect(await page.locator(TRANSCRIPT).getByText('Files changed', { exact: true }).count()).toBe(0)
    expect(await page.locator(TRANSCRIPT).locator('button[aria-label^="Open "]').count()).toBe(0)
    expect(await page.locator(TRANSCRIPT).locator('button[class*="fileLink"]').count()).toBe(0)

    // Expanded cards. The Native transcript lists every call inline, so each
    // row opens on its own. Rows expand via a right-edge click: the row center
    // can land on a nested control.
    for (const row of [
      /^Search clickable link styles/,
      /^Read https:\/\/docs\.example\.test\/tokens/,
      /^Read rsh\/Docs\/guide\.md/,
      /^Edit src\/tokens\.css/,
      /^Search linkColor/,
      /Run the lint gate|pnpm run lint/,
    ]) {
      const toggle = page.getByRole('button', { name: row }).first()
      await toggle.waitFor({ timeout: 10_000 })
      const box = await toggle.boundingBox()
      await toggle.click(box === null ? {} : { position: { x: box.width - 8, y: box.height / 2 } })
    }
    // Both generic rows (the unclassified str_replace_editor and the unknown
    // design_tokens_sync) expand to their IN/OUT surfaces.
    const genericRows = page.getByRole('button', { name: /^Tool call/ })
    for (let index = 0; index < await genericRows.count(); index += 1) {
      const toggle = genericRows.nth(index)
      const box = await toggle.boundingBox()
      await toggle.click(box === null ? {} : { position: { x: box.width - 8, y: box.height / 2 } })
    }
    const sourceLink = page.locator(`${TRANSCRIPT} a[href="${SOURCE_URL}"]`)
    await expect.poll(() => sourceLink.count(), { timeout: 10_000 }).toBe(1)
    expect(await page.locator(`${TRANSCRIPT} a[href^="ftp:"]`).count()).toBe(0)
    expect(await page.locator(`${TRANSCRIPT} a[href="${FETCH_URL}"]`).count()).toBe(1)
    expect(await page.locator(`${TRANSCRIPT} a[href="${GUIDE_URL}"]`).count()).toBe(2)

    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
      .split(imageOrigin.url).join('{{imageUrl}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'], 'native-web')

    // The link language itself — ARIA records none of it, so pin the computed
    // styles on the surfaces the Native page renders. The hue is the brand
    // theme's `--dsw-alias-link`, read from the page instead of pinned: the
    // Native application ships the RedSpark palette, not the DeepSeek blue.
    const LINK_COLOR = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--dsw-alias-link)'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    expect(LINK_COLOR).not.toBe('')
    const styleOf = async (target: ReturnType<Page['locator']>, property: string): Promise<string> =>
      target.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property)
    const guideLink = page.locator(`${TRANSCRIPT} a[href="${GUIDE_URL}"]`).first()
    for (const [name, link] of [
      ['markdown anchor', guideLink],
      ['search source', sourceLink.first()],
      ['fetch url', page.locator(`${TRANSCRIPT} a[href="${FETCH_URL}"]`).first()],
    ] as const) {
      expect.soft(await styleOf(link, 'color'), `${name} color`).toBe(LINK_COLOR)
      expect.soft(await styleOf(link, 'font-weight'), `${name} weight`).toBe('500')
      expect.soft(await styleOf(link, 'text-decoration-line'), `${name} at rest`).toBe('none')
      expect.soft(await link.locator('svg').count(), `${name} glyph`).toBe(1)
    }
    await guideLink.hover()
    expect(await styleOf(guideLink, 'text-decoration-line')).toBe('underline')
    expect(await styleOf(guideLink, 'text-decoration-style')).toBe('dotted')
    expect(await styleOf(guideLink, 'text-underline-offset')).toBe('3px')
  } finally {
    await scaffold.close()
    await stopServer(imageOrigin.server)
  }
}, 180_000)
