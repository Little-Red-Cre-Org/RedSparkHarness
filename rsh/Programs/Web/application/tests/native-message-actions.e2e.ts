/** Shipped Native Web renders settled message actions and forks through Host session routes. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, parseSeedFixture, renderSeedFixture,
  webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb, type NativeWebScaffold } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/message-actions', import.meta.url))
const SEED = fileURLToPath(new URL('../../../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const FORK_EXPECTED = join(SNAPSHOT_DIR, 'fork.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'message-actions-web-e2e'
const KEEP = ['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution', 'agent-presets',
  'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json', 'storage-domain',
  'workspace', 'subprocess', 'shell-env'] as const
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

const MID_TURN_TEXT = 'I will read both files before answering.'
const SECOND_PROMPT = 'Now give the final answer.'

/** One settled Session list row as the Host reports it. */
interface SessionListRow { readonly header: { readonly parentSession?: string } }
/** One Session event as this scenario reads it from the Host. */
interface HistoryEvent {
  readonly seq: number
  readonly type: string
  readonly data?: { readonly message?: { readonly content?: readonly { readonly type: string; readonly text?: string }[] } }
}
/** One Session history read as the Host reports it. */
interface SessionHistory { readonly events: readonly HistoryEvent[] }

/**
 * Every text block carried by a message event.
 * @param events - Session events in log order.
 * @returns the text blocks, ignoring non-message events.
 */
function messageTexts(events: readonly HistoryEvent[]): readonly string[] {
  return events.flatMap(event => (event.data?.message?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text ?? ''))
}

/**
 * Adapt the borrowed recording into response -> tools -> interrupted Think,
 * followed by one ordinary completed response.
 * @param raw - Recorded seeded-history JSONL.
 * @returns a contiguous, closed two-turn fixture.
 */
function completedTailFixture(raw: string): string {
  const decoded = parseSeedFixture(raw)
  const stepTwoStart = decoded.events.findIndex(event =>
    event.type === 'step/start' && event.data.turn === 1 && event.data.step === 2)
  if (stepTwoStart < 0) throw new Error('borrowed fixture has no step-two start')
  const kept = decoded.events.slice(0, stepTwoStart + 1).map((event) => {
    if (event.type !== 'assistant/message' || event.data.turn !== 1 || event.data.step !== 1) return event
    const finish = event.data.stream.findIndex(record =>
      record.type === 'chunk' && record.chunk.type === 'finish')
    if (finish < 0) throw new Error('borrowed step-one Assistant message has no finish record')
    const finishRecord = event.data.stream[finish]!
    if (finishRecord.type !== 'chunk') throw new Error('borrowed step-one finish is not a chunk record')
    const streamTime = finishRecord.time
    return {
      ...event,
      data: {
        ...event.data,
        message: {
          ...event.data.message,
          content: [...event.data.message.content, { type: 'text' as const, text: MID_TURN_TEXT }],
        },
        stream: [
          ...event.data.stream.slice(0, finish),
          { type: 'chunk' as const, time: streamTime, chunk: { type: 'block-start' as const, index: 3, blockType: 'text' as const } },
          { type: 'text-chunks' as const, time0: streamTime, index: 3, dt: [], texts: [MID_TURN_TEXT] },
          {
            type: 'chunk' as const,
            time: streamTime,
            chunk: { type: 'block-end' as const, index: 3, block: { type: 'text' as const, text: MID_TURN_TEXT } },
          },
          ...event.data.stream.slice(finish),
        ],
      },
    }
  })
  const inheritedHeader = kept.findLast(event => event.type === 'request/header')
  if (inheritedHeader?.type !== 'request/header') throw new Error('borrowed recording has no request header')
  let seq = (kept.at(-1)?.seq ?? -1) + 1
  let time = (kept.at(-1)?.time ?? -1) + 1
  const at = (event: Record<string, unknown>): Record<string, unknown> => ({ ...event, seq: seq++, time: time++ })
  const tail = [
    at({
      type: 'assistant/attempt',
      data: {
        turn: 1,
        step: 2,
        stream: [
          { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
          { type: 'reasoning-chunks', time0: time, index: 0, dt: [], texts: ['This path was interrupted.'] },
          { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'This path was interrupted.' } } },
          { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
        ],
      },
    }),
    at({ type: 'step/end', data: { turn: 1, step: 2 } }),
    at({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }),
    at({ type: 'turn/start', data: { turn: 2 } }),
    at({
      type: 'user/message',
      data: { content: [{ type: 'text', text: SECOND_PROMPT }], source: { kind: 'user' }, role: 'user', id: '{{message:98}}' },
      surfaceOp: 'append',
    }),
    at({ type: 'step/start', data: { turn: 2, step: 1 } }),
    at({ type: 'request/header', data: { header: inheritedHeader.data.header, reason: 'resume' } }),
    at({
      type: 'assistant/message',
      data: {
        turn: 2,
        step: 1,
        message: {
          role: 'assistant',
          id: '{{message:99}}',
          content: [{ type: 'text', text: 'DONE' }],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        },
        stream: [
          { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
          { type: 'text-chunks', time0: time, index: 0, dt: [], texts: ['DONE'] },
          { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'DONE' } } },
          { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
        ],
      },
      surfaceOp: 'append',
    }),
    at({ type: 'step/end', data: { turn: 2, step: 1 } }),
    at({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }),
  ]
  return renderSeedFixture(decoded.headerLine,
    [...kept, ...tail] as unknown as readonly ({ readonly seq: number; readonly time: number } & object)[])
}

let raw: string

beforeAll(async () => { raw = completedTailFixture(await readFile(SEED, 'utf8')) }, 60_000)

async function openScenario(label: string): Promise<NativeWebScaffold> {
  const scaffold = await launchNativeWeb({ keep: KEEP, seed: { text: raw, seedId: SEED_ID } })
  onTestFailed(() => saveFailureShot(scaffold.page, label))
  const session = scaffold.page.locator('[role="treeitem"]').filter({ hasText: 'Use the read tool twice' }).first()
  await session.waitFor({ timeout: 20_000 })
  await session.click()
  await scaffold.page.locator(TRANSCRIPT).getByText('DONE', { exact: true }).waitFor({ timeout: 20_000 })
  return scaffold
}

it.skipIf(MODE === 'record')('renders settled actions on completed messages only', async () => {
  const scaffold = await openScenario('web-e2e-message-actions')
  try {
    const { page } = scaffold
    const main = page.locator(TRANSCRIPT)
    await expect.poll(
      () => main.getByText(MID_TURN_TEXT, { exact: true }).count(),
      { timeout: 20_000 },
    ).toBe(1)
    const copyButtons = main.getByRole('button', { name: 'Copy' })
    await expect.poll(() => copyButtons.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await copyButtons.first().focus()
    await expect.poll(
      () => main.locator('[data-chat-message-action-row]').count(),
      { timeout: 10_000 },
    ).toBe(2)
    await expect.poll(
      () => main.getByRole('button', { name: 'Good response' }).count(),
      { timeout: 10_000 },
    ).toBe(2)
    expect(await page.getByRole('button', { name: 'Edit' }).count()).toBe(0)
    const snapshot = (await captureStableAria(page, '[data-slot="main"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 120_000)

it.skipIf(MODE === 'record')('forks the settled turn through the Host session route', async () => {
  const scaffold = await openScenario('web-e2e-message-fork')
  try {
    const { page } = scaffold
    const history = await scaffold.rpc<SessionHistory>('session/history', { sessionId: SEED_ID })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    const settled = history.value.events.find(event => event.type === 'assistant/message')
    if (settled === undefined) throw new Error('seeded history has no settled assistant message')
    const forked = await scaffold.rpc<{ readonly sessionId: string }>('session/fork', {
      sessionId: SEED_ID, atSeq: settled.seq,
    })
    expect(forked.ok).toBe(true)
    const unavailable = await scaffold.rpc<{ readonly sessionId: string }>('session/fork', {
      sessionId: SEED_ID, atSeq: settled.seq + 1000,
    })
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'session/fork-unavailable' } })
    await expect.poll(async () => {
      const listed = await scaffold.rpc<SessionListRow[]>('session/list', {})
      if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
      return listed.value.filter(row => row.header.parentSession !== undefined).length
    }, { timeout: 20_000 }).toBe(1)
    if (!forked.ok) throw new Error('session/fork failed: ' + forked.error.message)
    const child = await scaffold.rpc<SessionHistory>('session/history', { sessionId: forked.value.sessionId })
    if (!child.ok) throw new Error('child session/history failed: ' + child.error.message)
    expect(messageTexts(child.value.events)).not.toContain(SECOND_PROMPT)
    expect(messageTexts(child.value.events)).not.toContain('DONE')
    await expect.poll(() => page.locator('[role="treeitem"]').count(), { timeout: 15_000 }).toBe(4)
    await page.locator('[role="treeitem"]').last().click()
    await expect.poll(
      () => page.locator('[role="treeitem"]').evaluateAll(rows =>
        rows.findIndex(row => row.getAttribute('aria-selected') === 'true')),
      { timeout: 15_000 },
    ).toBe(3)
    await expect.poll(
      () => page.locator(TRANSCRIPT).getByText('DONE', { exact: true }).count(),
      { timeout: 15_000 },
    ).toBe(0)
    const tree = await captureStableAria(page, '[data-slot="sidebar"] [role="tree"]', scaffold.workspaceCwd,
      { normalizeAge: true })
    await compareOrRefreshGolden(FORK_EXPECTED, tree, MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['fork.expected.md', 'ui.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
