/** Shipped Native Web drives `web_search` through the real DeepSeek search provider against a local endpoint. */
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { WEB_SEARCH_MAX_RESULTS } from '@redspark/rsh-tool-web'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/web-search-round', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()
const QUERIES = ['RedSpark Harness snapshot search', 'RedSpark Harness multi-query search'] as const
const PROMPT = `Use web_search once with queries ${JSON.stringify(QUERIES)}. Then reply exactly SEARCH_DONE and stop.`
const SEARCH_CREDENTIAL_REF = 'RSH_WEB_SEARCH_E2E_KEY'
const SEARCH_CREDENTIAL = 'snapshot-search-key'

/**
 * Provider results the double returns per query. The combined result exceeds
 * the shipped `searchMaxResults`, so the tool's round-robin cap and the card's
 * scroll container are both exercised. Each row carries a title, a snippet,
 * and a date, so 8 kept rows exceed the `.sources` 320px max-height.
 */
const PROVIDER_RESULT_COUNT = 6

/** One provider result's URL, by 1-based provider order. */
function resultUrl(queryIndex: number, ordinal: number): string {
  return `https://docs.example.test/search/${queryIndex + 1}/${ordinal}`
}

/** One provider result's title, by 1-based provider order. */
function resultTitle(queryIndex: number, ordinal: number): string {
  return `Snapshot Search ${queryIndex + 1} Result ${ordinal}`
}

/** One provider result's citation excerpt, by 1-based provider order. */
function resultSnippet(queryIndex: number, ordinal: number): string {
  return `Snapshot search ${queryIndex + 1} excerpt ${ordinal}: the harness replays this source list from a local endpoint.`
}

/** One provider result's `page_age`, by 1-based provider order (July 2026 days 01..12). */
function resultPageAge(ordinal: number): string {
  return `2026-07-${String(ordinal).padStart(2, '0')}`
}

/** The 1-based provider ordinals, in provider order. */
const RESULT_ORDINALS = Array.from({ length: PROVIDER_RESULT_COUNT }, (_value, index) => index + 1)

/** Sources kept after round-robin merging reaches the shipped combined cap. */
const KEPT_SOURCES = RESULT_ORDINALS.flatMap(ordinal => QUERIES.map((_query, queryIndex) => ({
  url: resultUrl(queryIndex, ordinal),
  title: resultTitle(queryIndex, ordinal),
  snippet: resultSnippet(queryIndex, ordinal),
  publishedAt: resultPageAge(ordinal),
}))).slice(0, WEB_SEARCH_MAX_RESULTS)

/** URLs omitted after the combined source cap is reached. */
const DROPPED_SOURCE_URLS = RESULT_ORDINALS.flatMap(ordinal => QUERIES.map(
  (_query, queryIndex) => resultUrl(queryIndex, ordinal),
)).slice(WEB_SEARCH_MAX_RESULTS)

interface CapturedSearchRequest {
  path: string
  apiKey: string | undefined
  body: unknown
}

/** One Host history read, narrowed to the events this scenario inspects. */
interface History {
  readonly events: readonly { readonly type: string; readonly seq: number; readonly data: unknown }[]
}

/** Start the deterministic DeepSeek Messages double used by the real provider. */
async function startSearchServer(captured: CapturedSearchRequest[]): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsedBody = JSON.parse(body) as unknown
      captured.push({
        path: request.url ?? '',
        apiKey: typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : undefined,
        body: parsedBody,
      })
      const serializedBody = JSON.stringify(parsedBody)
      const queryIndex = QUERIES.findIndex(query => serializedBody.includes(`Perform a web search for the query: ${query}`))
      if (queryIndex < 0) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'unknown fixture query' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        content: [
          {
            type: 'text',
            text: `Found ${PROVIDER_RESULT_COUNT} sources.`,
            citations: RESULT_ORDINALS.map(ordinal => ({
              type: 'web_search_result_location',
              url: resultUrl(queryIndex, ordinal),
              cited_text: resultSnippet(queryIndex, ordinal),
            })),
          },
          {
            type: 'web_search_tool_result',
            content: RESULT_ORDINALS.map(ordinal => ({
              type: 'web_search_result',
              url: resultUrl(queryIndex, ordinal),
              title: resultTitle(queryIndex, ordinal),
              page_age: resultPageAge(ordinal),
            })),
          },
        ],
      }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return { server, baseURL: `http://127.0.0.1:${address.port}` }
}

it.skipIf(MODE === 'record')('uses the real provider, persists the capped structured result, and renders the search card', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const searchRequests: CapturedSearchRequest[] = []
  const search = await startSearchServer(searchRequests)
  try {
    const scaffold = await launchNativeWeb({
      drop: ['pi-ai'],
      credentials: { [SEARCH_CREDENTIAL_REF]: SEARCH_CREDENTIAL },
      configure: (row) => {
        if (row.id === 'web-search-deepseek') return { ...row, config: { baseURL: search.baseURL, apiKeyEnv: SEARCH_CREDENTIAL_REF } }
        // The title request shares the positional replay cursor; the recorded scripts are the main turn's.
        return row.id === 'session-title-llm' ? { ...row, disabled: true } : row
      },
      replay: { file: FIXTURE, paceMs: 0 },
    })
    try {
      const { page } = scaffold
      await connectNativeWorkspace(page, scaffold.workspaceCwd)
      const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
      if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
      const sessionId = listed.value[0]?.header.id
      if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

      await expect.poll(() => page.getByRole('button', { name: 'Interject', exact: true }).count(), { timeout: 15_000 }).toBe(0)
      const input = page.locator('textarea[aria-label="Message"]')
      await input.fill(PROMPT)
      await input.press('Enter')
      await page.locator(TRANSCRIPT).getByText('SEARCH_DONE', { exact: true }).waitFor({ timeout: 90_000 })
      await expect.poll(() => page.getByText('Running…', { exact: true }).count(), { timeout: 60_000 }).toBe(0)

      const history = await scaffold.rpc<History>('session/history', { sessionId })
      if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
      const events = history.value.events

      expect(searchRequests).toHaveLength(QUERIES.length)
      for (const query of QUERIES) {
        const request = searchRequests.find(candidate => JSON.stringify(candidate.body).includes(query))
        if (request === undefined) throw new Error(`missing provider request for query: ${query}`)
        expect(request).toMatchObject({ path: '/messages', apiKey: SEARCH_CREDENTIAL })
        expect(request.body).toMatchObject({
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
          }],
        })
        const tools = (request.body as { tools?: unknown }).tools
        expect(tools).toHaveLength(1)
        expect((tools as unknown[])[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' })
      }

      const auxiliaryRequests = events.filter(event => event.type === 'web/deepseek-search-llm-request')
      expect(auxiliaryRequests).toHaveLength(QUERIES.length)
      for (const query of QUERIES) {
        const request = searchRequests.find(candidate => JSON.stringify(candidate.body).includes(query))
        const auxiliaryRequest = auxiliaryRequests.find(event =>
          JSON.stringify((event.data as { readonly body: unknown }).body).includes(query))
        if (request === undefined || auxiliaryRequest === undefined) {
          throw new Error(`missing paired provider request for query: ${query}`)
        }
        expect(auxiliaryRequest.data).toEqual({
          endpoint: `${search.baseURL}/messages`,
          apiVersion: '2023-06-01',
          body: request.body,
        })
      }

      const searchCall = events.find(event => event.type === 'tool/call' && (event.data as { readonly name: string }).name === 'web_search')
      if (searchCall === undefined) throw new Error('the replayed turn did not call web_search')
      const searchResult = events.find(event => event.type === 'tool/result'
        && (event.data as { readonly message: { readonly source: { readonly callId: string } } }).message.source.callId
          === (searchCall.data as { readonly callId: string }).callId)
      if (searchResult === undefined) throw new Error('web_search produced no durable result')
      const resultMessage = (searchResult.data as {
        readonly message: { readonly content: readonly {
          readonly isError: boolean
          readonly content: readonly { readonly type: string; readonly text?: string }[]
        }[] }
        readonly meta: unknown
      }).message
      expect(resultMessage.content[0]?.isError).toBe(false)
      const rendered = (resultMessage.content[0]?.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
      // The tool interleaves sources from both seam results before applying the
      // combined cap, so each query remains represented in model-visible output.
      for (const source of KEPT_SOURCES) {
        expect(rendered).toContain(`[${source.title}](${source.url})`)
      }
      for (const url of DROPPED_SOURCE_URLS) {
        expect(rendered).not.toContain(url)
      }
      expect(rendered).toContain(
        `(Showing the first ${WEB_SEARCH_MAX_RESULTS} sources. Refine the query for more.)`,
      )
      expect((searchResult.data as { readonly meta: unknown }).meta).toMatchObject({
        sources: KEPT_SOURCES,
        truncated: true,
      })

      const searchTool = page.locator('[data-tool="web_search"]')
      await searchTool.waitFor({ timeout: 10_000 })
      const row = searchTool.locator('[data-expandable]').first()
      await row.click()
      await expect.poll(() => row.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')

      const card = page.locator('[data-web="search"]')
      const sources = card.locator('ol')
      await sources.waitFor({ timeout: 10_000 })
      // The card draws exactly the sources the model saw after the combined cap.
      expect(await sources.locator('li').count()).toBe(WEB_SEARCH_MAX_RESULTS)
      // The list is complete in the DOM, so the card carries no expand control.
      expect(await card.locator('button').count()).toBe(0)
      await card.getByText('Source list truncated').waitFor({ timeout: 5_000 })

      const geometry = await sources.evaluate((element) => {
        const computed = getComputedStyle(element)
        return {
          maxHeight: computed.maxHeight,
          overflowY: computed.overflowY,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }
      })
      expect(geometry.maxHeight).toBe('320px')
      expect(geometry.overflowY).toBe('auto')
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight)

      // `overflow-y: auto` clips inline-start overflow with no way to scroll it
      // back, and markers are right-aligned to the content edge, so a marker wider
      // than `padding-left` silently loses its leading digits.
      const marker = await sources.evaluate((element) => {
        const probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'
        probe.textContent = '999. '
        element.append(probe)
        const widest = probe.getBoundingClientRect().width
        probe.remove()
        return { widest, paddingLeft: parseFloat(getComputedStyle(element).paddingLeft) }
      })
      expect(marker.paddingLeft).toBeGreaterThanOrEqual(marker.widest)

      await compareOrRefreshGolden(UI_EXPECTED,
        await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd), MODE)
      expect(scaffold.pageErrors).toEqual([])
      await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md'], 'native-web')
    } finally {
      await scaffold.close()
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      search.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
}, 240_000)
