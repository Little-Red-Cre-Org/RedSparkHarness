/** Shipped Native Web steers a pending next-step message into the running turn. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { expandAssistantStream } from '@redspark/rsh-llm'
import type { SessionEvent } from '@redspark/rsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const DIR = fileURLToPath(new URL('../../../../../snapshots/web/steering', import.meta.url))
const FIXTURE = join(DIR, 'session.v3.jsonl')
const MID_EXPECTED = join(DIR, 'mid-steer.expected.md')
const SETTLED_EXPECTED = join(DIR, 'settled.expected.md')
const MODE = webSnapshotMode()
const PROMPT = 'Use the ask_user_question tool to ask me exactly one question with id "checkpoint", question "Ready to continue?", header "Checkpoint", and options labeled "Yes" and "No". After I answer, reply with one short sentence acknowledging my answer and stop.'
const STEER = 'Interjection: include the word BANANA in your final reply.'
const REPLAY_PACE_MS = 500
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MAIN = '[data-slot="main"]'
const PENDING = 'section[aria-label="Pending messages"]'

/** One Host history read, narrowed to the events this scenario inspects. */
interface History {
  readonly events: readonly SessionEvent[]
}

/** Concatenated assistant text deltas, the model-visible reply body. */
function assistantText(events: readonly SessionEvent[]): string {
  return events
    .flatMap(event => event.type === 'assistant/message' || event.type === 'assistant/attempt'
      ? expandAssistantStream(event.data.stream)
      : [])
    .map(({ chunk }) => chunk.type === 'text-delta' ? chunk.text : '')
    .join('')
}

/** Claimed user messages whose payload contains the exact scenario text. */
function claimedMessages(events: readonly SessionEvent[], text: string): SessionEvent<'user/message'>[] {
  return events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && JSON.stringify(event.data.content).includes(text))
}

it('promotes one queued message to steering and completes with the interjection logged', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT, STEER])
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    // The title request shares the positional replay cursor; the recorded scripts are the main turn's.
    configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
    replay: { file: FIXTURE, paceMs: REPLAY_PACE_MS },
  })
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

    const input = page.locator('textarea[aria-label="Message"]')
    await input.fill(PROMPT)
    await input.press('Enter')

    // Enter remains the Queue gesture while the question keeps the turn open.
    await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
    await input.fill(STEER)
    await input.press('Enter')
    const pending = page.locator(PENDING)
    const row = pending.getByRole('listitem').filter({ hasText: STEER })
    await row.getByText('Queued', { exact: true }).waitFor({ timeout: 10_000 })
    const promote = row.getByRole('button', { name: 'Interject instead' })
    await expect.poll(() => promote.isEnabled(), { timeout: 10_000 }).toBe(true)
    await promote.click({ timeout: 10_000 })

    // The Native client has no pending-steering transcript bubble; the pending
    // row tag is the Host-authoritative mirror until the loop admits it.
    await row.getByText('Interjecting', { exact: true }).waitFor({ timeout: 10_000 })
    if (MODE !== 'record') {
      await compareOrRefreshGolden(MID_EXPECTED, await captureStableAria(page, MAIN, scaffold.workspaceCwd), MODE)
    }

    const composer = page.locator('[data-question-key]')
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await expect.poll(() => pending.getByRole('listitem').count(), { timeout: 60_000 }).toBe(0)
    await expect.poll(() => page.getByText('BANANA', { exact: false }).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)

    await expect.poll(async () => {
      const polled = await scaffold.rpc<History>('session/history', { sessionId })
      if (!polled.ok) throw new Error('session/history failed: ' + polled.error.message)
      return polled.value.events.filter(event => event.type === 'turn/end').length
    }, { timeout: 60_000 }).toBe(1)
    const history = await scaffold.rpc<History>('session/history', { sessionId })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(claimedMessages(history.value.events, STEER)).toHaveLength(1)
    const turnEnds = history.value.events.filter(event => event.type === 'turn/end')
    expect(turnEnds).toHaveLength(1)
    expect((turnEnds[0]?.data as { readonly reason: { readonly kind: string } }).reason.kind).toBe('completed')
    expect(assistantText(history.value.events)).toContain('BANANA')

    await expect.poll(() => page.locator('[class*="ChatPresentation_userBubble"]').filter({ hasText: STEER }).count(),
      { timeout: 15_000 }).toBe(1)
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    await expect.poll(() => page.getByText('Running…', { exact: true }).count(), { timeout: 60_000 }).toBe(0)
    await compareOrRefreshGolden(SETTLED_EXPECTED, await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd), MODE)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 200_000)

it('steers directly with Cmd+Enter without creating a queued row', async () => {
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
    replay: { file: FIXTURE, paceMs: REPLAY_PACE_MS },
  })
  try {
    const { page } = scaffold
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')

    const input = page.locator('textarea[aria-label="Message"]')
    await input.fill(PROMPT)
    await input.press('Enter')
    await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })

    await input.fill(STEER)
    await input.press('Meta+Enter')
    const pending = page.locator(PENDING)
    const row = pending.getByRole('listitem').filter({ hasText: STEER })
    await row.getByText('Interjecting', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await pending.getByText('Queued', { exact: true }).count()).toBe(0)

    const composer = page.locator('[data-question-key]')
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await expect.poll(() => pending.getByRole('listitem').count(), { timeout: 60_000 }).toBe(0)
    await expect.poll(() => page.getByText('BANANA', { exact: false }).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)

    const history = await scaffold.rpc<History>('session/history', { sessionId })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(claimedMessages(history.value.events, STEER)).toHaveLength(1)
    await expect.poll(() => page.locator('[class*="ChatPresentation_userBubble"]').filter({ hasText: STEER }).count(),
      { timeout: 15_000 }).toBe(1)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 200_000)

it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
  await assertFixtureInventory(DIR, ['session.v3.jsonl', 'mid-steer.expected.md', 'settled.expected.md'], 'native-web')
})
