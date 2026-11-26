/** Shipped Native Web releases only feedback-authorized Session prefixes to OTLP. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@redspark/rsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb, type NativeWebScaffold } from './native-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/feedback-release', import.meta.url))
// Both routes borrow the same settled turn; this manifest references its owner.
const FIXTURE = fileURLToPath(new URL('../../../../../snapshots/web/feedback-command/session.v3.jsonl', import.meta.url))
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const RELEASE_EXPECTED = join(SNAPSHOT_DIR, 'feedback-release.expected.json')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const MAIN = '[data-slot="main"]'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MESSAGE = 'textarea[aria-label="Message"]'

interface OtlpCapture {
  resourceLogs: { scopeLogs: { logRecords: {
    attributes: { key: string; value: { stringValue?: string; intValue?: number | string } }[]
  }[] }[] }[]
}

it.skipIf(MODE === 'record')('releases only the authorized feedback prefixes on the shipped Native Web Host', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  const uploads: string[] = []
  const collector: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const raw = Buffer.concat(chunks)
      uploads.push((request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString())
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const address = collector.address()
  if (address === null || typeof address === 'string') throw new Error('collector has no port')
  const telemetryUrl = `http://127.0.0.1:${address.port}/v1/logs`

  const scaffold: NativeWebScaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    configure: (row) => {
      if (row.id === 'session-title-llm') return { ...row, disabled: true }
      if (row.id !== 'session-telemetry-otel') return row
      const config = row.config as Record<string, unknown>
      return { ...row, config: {
        ...config,
        mode: 'FEEDBACK_ONLY',
        exporter: { ...config.exporter as object, url: telemetryUrl },
        processor: { ...config.processor as object, scheduledDelayMillis: 10 },
      } }
    },
    replay: {
      file: FIXTURE,
      paceMs: 5,
      providers: [
        { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
        { id: 'feedback-mock', models: [{ id: 'feedback-mock' }] },
      ],
    },
  })
  let sessionId: string
  let authorized: readonly SessionEvent[] = []
  let releasedCount = 0
  const suffixes: string[][] = []
  let headerlessExpected: [string, number, string][] = []

  function captured(): [string | undefined, number, string | undefined][] {
    return uploads.flatMap((upload) => {
      const capture = JSON.parse(upload) as OtlpCapture
      return capture.resourceLogs.flatMap(resource => resource.scopeLogs.flatMap(scope =>
        scope.logRecords.map((record) => {
          const attribute = (key: string) => record.attributes.find(value => value.key === key)?.value
          return [attribute('session.id')?.stringValue, Number(attribute('event.seq')?.intValue),
            attribute('event.type')?.stringValue] as [string | undefined, number, string | undefined]
        })))
    })
  }

  async function historyOf(id: string): Promise<readonly SessionEvent[]> {
    const read = await scaffold.rpc<{ readonly events: readonly SessionEvent[] }>('session/history', { sessionId: id })
    if (!read.ok) throw new Error('session/history failed: ' + read.error.message)
    return read.value.events
  }

  async function expectFeedbackRelease(type: SessionEvent['type'], count: number): Promise<void> {
    const events = await historyOf(sessionId)
    const feedback = events.filter(event => event.type === type)
    expect(feedback).toHaveLength(count)
    const boundary = feedback.at(-1)!
    authorized = events.filter(event => event.seq <= boundary.seq)
    const expected = authorized.map(event => [sessionId, event.seq, event.type])
    // No teardown, flush hook, or subsequent interaction may cause this delivery.
    await expect.poll(captured, { timeout: 15_000 }).toEqual(expected)
    suffixes.push(authorized.slice(releasedCount).map(event => event.type))
    releasedCount = authorized.length
  }

  async function waitComposerReady(): Promise<void> {
    await expect.poll(async () => {
      const status = await scaffold.rpc<{ readonly status: string }>('session/status', { sessionId })
      return status.ok && status.value.status === 'idle'
    }, { timeout: 20_000 }).toBe(true)
    await expect.poll(() => scaffold.page.locator(MESSAGE).isEnabled(), { timeout: 20_000 }).toBe(true)
  }

  async function selectModel(name: string): Promise<void> {
    const { page } = scaffold
    const trigger = page.getByRole('button', { name: /^Select model, current/ })
    const options = page.locator('button[role="menuitemradio"]')
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await options.count() === 0) {
        if (await trigger.isEnabled()) await trigger.click()
        await page.waitForTimeout(100)
        continue
      }
      const option = options.filter({ hasText: name }).first()
      if (await option.count() > 0 && await option.isEnabled()) {
        await option.click()
        break
      }
      await page.waitForTimeout(100)
    }
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 20_000 }).toContain(name)
    await expect.poll(() => trigger.isEnabled(), { timeout: 20_000 }).toBe(true)
  }

  try {
    const created = await scaffold.rpc<{ readonly sessionId: string }>('session/create', {})
    if (!created.ok) throw new Error('session/create failed: ' + created.error.message)
    sessionId = created.value.sessionId
    const prompted = await scaffold.rpc<{ readonly answer: string }>('session/prompt', {
      sessionId, text: PROMPT, resume: true,
    })
    if (!prompted.ok) throw new Error('session/prompt failed: ' + prompted.error.message)
    expect(prompted.value.answer).toBe('LIGHTHOUSE')

    const { page } = scaffold
    await page.reload({ waitUntil: 'load' })
    const onboard = page.getByRole('button', { name: 'Continue', exact: true })
    if (await onboard.count() > 0) await onboard.click()
    const row = page.locator('[role="treeitem"]').filter({ hasText: 'Reply with the single word' }).first()
    await row.waitFor({ timeout: 20_000 })
    await row.click()
    await page.locator(TRANSCRIPT).getByText('LIGHTHOUSE', { exact: true }).first().waitFor({ timeout: 20_000 })
    const input = page.locator(MESSAGE)
    await input.waitFor({ timeout: 20_000 })

    const driven = await historyOf(sessionId)
    const header = JSON.stringify(driven.find(event => event.type === 'request/header'))
    expect(uploads).toEqual([])
    // Both catalog routes render the same composer without changing the request header.
    await selectModel('feedback-mock')
    await selectModel('deepseek-v4-flash')
    expect(uploads).toEqual([])
    expect(JSON.stringify((await historyOf(sessionId)).find(event => event.type === 'request/header'))).toBe(header)

    await waitComposerReady()
    await input.fill('/feedback the diff view is unreadable')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const acknowledgement = page.locator('[data-command-row]').filter({ hasText: 'Feedback recorded for session' })
    await acknowledgement.waitFor({ timeout: 20_000 })
    expect(await page.getByText(/Anonymous user: [0-9a-f-]+\.$/i).count()).toBe(1)
    await expectFeedbackRelease('feedback/record', 1)

    const snapshot = (await captureStableAria(page, MAIN, scaffold.workspaceCwd))
      .split(sessionId).join('{{sessionId}}')
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])

    // The command tail stays unreleased, and neither a provider change nor a
    // reload replays an earlier authorization.
    const afterCommand = await historyOf(sessionId)
    expect(afterCommand.at(-1)?.type).toBe('command/done')
    expect(afterCommand.at(-1)!.seq).toBeGreaterThan(authorized.at(-1)!.seq)
    await selectModel('feedback-mock')
    await selectModel('deepseek-v4-flash')
    expect(await page.locator(MESSAGE).inputValue()).toBe('')
    await page.reload({ waitUntil: 'load' })
    const reloadedRow = page.locator('[role="treeitem"]').filter({ hasText: 'Reply with the single word' }).first()
    await reloadedRow.click()
    await page.locator(TRANSCRIPT).getByText('LIGHTHOUSE', { exact: true }).first().waitFor({ timeout: 20_000 })
    expect(captured()).toHaveLength(releasedCount)

    await waitComposerReady()
    await input.fill('/feedback the second remark')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.getByText(/Feedback recorded for session/).count(), { timeout: 15_000 }).toBe(2)
    await expectFeedbackRelease('feedback/record', 2)

    // The Native transcript renders the shared rating controls, but its
    // per-message dialog never mounts (recorded in the Agent Note), so the
    // judgment goes through the Host route the dialog would submit.
    const settled = (await historyOf(sessionId))
      .filter(event => event.type === 'assistant/message').at(-1)!
    const messageId = (settled.data as { message: { id: string } }).message.id
    const listed = await scaffold.rpc<{ readonly value: { readonly items: readonly unknown[] } }>('feedback/message-list', { sessionId })
    if (!listed.ok) throw new Error('feedback/message-list failed: ' + listed.error.message)
    expect(listed.value.value.items).toEqual([])
    expect(captured()).toHaveLength(releasedCount)

    const first = await scaffold.rpc<{ readonly value: { readonly version: string } }>('feedback/message-put', {
      sessionId, messageId, rating: 'positive', note: 'Clear and complete.',
      category: 'instruction-following', ifVersion: null,
    })
    if (!first.ok) throw new Error('feedback/message-put failed: ' + first.error.message)
    await expectFeedbackRelease('feedback/message-put', 1)

    const second = await scaffold.rpc<{ readonly value: { readonly version: string } }>('feedback/message-put', {
      sessionId, messageId, rating: 'negative', note: 'Read both files before answering.',
      category: 'task-result', ifVersion: first.value.value.version,
    })
    if (!second.ok) throw new Error('feedback/message-put failed: ' + second.error.message)
    await expectFeedbackRelease('feedback/message-put', 2)

    const removed = await scaffold.rpc<unknown>('feedback/message-delete', {
      sessionId, messageId, ifVersion: second.value.value.version,
    })
    expect(removed.ok).toBe(true)
    await expectFeedbackRelease('feedback/message-delete', 1)

    const events = await historyOf(sessionId)
    expect(events.filter(event => event.type === 'feedback/record')).toMatchObject([
      { data: { text: 'the diff view is unreadable' } },
      { data: { text: 'the second remark' } },
    ])
    expect(events.filter(event => event.type === 'feedback/message-put')).toMatchObject([
      { data: { sessionId, item: { rating: 'positive', note: 'Clear and complete.', category: 'instruction-following' } } },
      { data: { sessionId, item: { rating: 'negative', note: 'Read both files before answering.', category: 'task-result' } } },
    ])
    expect(events.filter(event => event.type === 'feedback/message-delete')).toMatchObject([{ data: { sessionId } }])
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(captured()).toHaveLength(releasedCount)
    const wire = uploads.join('\n')
    for (const text of ['the diff view is unreadable', 'the second remark',
      'Clear and complete.', 'Read both files before answering.']) expect(wire).toContain(text)
    const feedback = events.flatMap<Record<string, string | undefined>>((event) => {
      switch (event.type) {
        case 'feedback/record': return [{ type: event.type, text: event.data.text }]
        case 'feedback/message-put': return [{
          type: event.type, rating: event.data.item.rating, note: event.data.item.note, category: event.data.item.category,
        }]
        case 'feedback/message-delete': return [{ type: event.type }]
        default: return []
      }
    })
    await compareOrRefreshGolden(RELEASE_EXPECTED, JSON.stringify({
      mode: 'FEEDBACK_ONLY', feedback,
      // The prefix is compared with each provider's actual canonical log above.
      // Client follow attach/detach (`session/end-seed`) is timing-owned, so the
      // pinned suffix names the Host events that submission itself released.
      laterSubmissionSuffixes: suffixes.slice(1).map(suffix =>
        suffix.filter(type => type !== 'session/end-seed')),
    }, null, 2), MODE)

    // A Session with no model request yet has no header to authorize, so its
    // command-only feedback still releases exactly its own prefix.
    const headerless = await scaffold.rpc<{ readonly sessionId: string }>('session/create', {})
    if (!headerless.ok) throw new Error('session/create failed: ' + headerless.error.message)
    const before = captured().length
    const commanded = await scaffold.rpc<unknown>('session/command', {
      sessionId: headerless.value.sessionId, line: '/feedback Feedback before any model request.',
    })
    expect(commanded.ok).toBe(true)
    const headerlessEvents = await historyOf(headerless.value.sessionId)
    expect(headerlessEvents.some(event => event.type === 'request/header')).toBe(false)
    const record = headerlessEvents.find(event => event.type === 'feedback/record')!
    headerlessExpected = headerlessEvents.filter(event => event.seq <= record.seq)
      .map(event => [headerless.value.sessionId, event.seq, event.type])
    await expect.poll(captured, { timeout: 15_000 }).toEqual([
      ...authorized.map(event => [sessionId, event.seq, event.type]), ...headerlessExpected,
    ])
    expect(captured().length).toBe(before + headerlessExpected.length)
    expect(uploads.join('\n')).toContain('Feedback before any model request.')
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
    await new Promise<void>((resolve, reject) => {
      collector.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
      collector.closeAllConnections()
    })
  }
  expect(captured()).toEqual([...authorized.map(event => [sessionId, event.seq, event.type]), ...headerlessExpected])
  await assertFixtureInventory(SNAPSHOT_DIR, ['ack.expected.md', 'feedback-release.expected.json'], 'native-web')
}, 300_000)
