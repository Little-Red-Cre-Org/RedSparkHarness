/**
 * Shipped Native Web asks through the resident question composer, answers with an
 * option and free text, and completes with the answer logged; a cancelled
 * question settles as a cancelled Tool row.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/question-composer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const ANSWERED_EXPECTED = join(SNAPSHOT_DIR, 'answered.expected.md')
const CANCELLED_EXPECTED = join(SNAPSHOT_DIR, 'cancelled.expected.md')
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'
const MODE = webSnapshotMode()
const CANCELLED_SEED_ID = 'ask-question-cancelled-row-web-e2e'
// Pacing is per chunk; the composer stays up until answered, so the answer
// gesture needs no slow stream.
const REPLAY_PACE_MS = 15

const PROMPT = 'Use the ask_user_question tool to ask me exactly one multi-select question with id "color", question "Which color do you prefer?", header "Pick one", and two options: label "Blue" with description "A cool recessive hue that reads as calm and trustworthy in long reading sessions and dense dashboards.", and label "Green" with description "A restful mid-spectrum hue with the highest perceived brightness, easiest on the eye over long sessions." Set multi_select to true. After I answer, reply with the single word DONE and stop.'
const CUSTOM_ANSWER = 'Include accessibility notes'
// A seeded Session resumes against the profile's composed prompt, so the seed
// keeps the narrow row set whose prompt the seed's system message records.
const SEED_KEEP = ['app', 'session-controller', 'agents', 'session-execution', 'tools', 'model-execution', 'agent-presets',
  'fs', 'sandbox-policy', 'storage', 'credentials', 'settings', 'storage-hub', 'storage-json', 'storage-domain',
  'workspace', 'subprocess', 'shell-env'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Replace the successful Tool settlement and omit the answer-dependent model step. */
function cancelledFixture(fixture: string): string {
  let replaced = false
  const lines: string[] = []
  for (const line of fixture.trimEnd().split('\n')) {
    const event: unknown = JSON.parse(line)
    if (!isRecord(event)) throw new Error('question fixture event is invalid')
    if (event.type === 'session') {
      // Keep the derived session's relative-time header stable as the source
      // fixture ages.
      event.createdAt = Date.now()
      lines.push(JSON.stringify(event))
      continue
    }
    if (replaced) {
      const data = event.data
      if ((event.type === 'step/end' && isRecord(data) && data.step === 1)
        || event.type === 'turn/end') lines.push(line)
      continue
    }
    if (event.type !== 'tool/result') {
      lines.push(line)
      continue
    }
    const data = event.data
    if (!isRecord(data)) throw new Error('question fixture tool/result data is invalid')
    const message = data.message
    if (!isRecord(message) || !Array.isArray(message.content) || !isRecord(message.content[0])) {
      throw new Error('question fixture tool/result message is invalid')
    }
    message.content[0].content = [{
      type: 'text',
      text: 'Error: the user cancelled ask_user_question',
    }]
    message.content[0].isError = true
    data.error = {
      name: 'UserQuestionError',
      code: 'ASK_CANCELLED',
    }
    replaced = true
    lines.push(JSON.stringify(event))
  }
  if (!replaced) throw new Error('question fixture has no tool/result event')
  return `${lines.join('\n')}\n`
}

/** One Host history read, narrowed to the events this scenario inspects. */
interface History {
  readonly events: readonly { readonly type: string; readonly data: unknown }[]
}

/** Text blocks of the last Tool result, which carries the chosen answer. */
function lastToolResultText(events: History['events']): string {
  const results = events.filter(event => event.type === 'tool/result')
  const last = results.at(-1)?.data as { readonly message: { readonly content: readonly {
    readonly type: string
    readonly content?: readonly { readonly type: string; readonly text?: string }[]
  }[] } } | undefined
  return (last?.message.content ?? []).flatMap(block => block.type === 'tool-result' ? block.content ?? [] : [])
    .filter(item => item.type === 'text').map(item => item.text ?? '').join('')
}

it('asks through the composer, answers, and completes with the answer logged', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
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

    await expect.poll(() => page.getByRole('button', { name: 'Interject', exact: true }).count(), { timeout: 15_000 }).toBe(0)
    const input = page.locator('textarea[aria-label="Message"]')
    await input.fill(PROMPT)
    await input.press('Enter')

    // The composer takes over the input area while the tool blocks. Its
    // presence is a STABLE waiting state (not a transient): it stays until
    // answered, so a plain waitFor is race-free.
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: 30_000 })
    await expect.poll(() => composer.getByText('Which color do you prefer?').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await compareOrRefreshGolden(UI_EXPECTED,
      await captureStableAria(page, '[data-question-key]', scaffold.workspaceCwd), MODE)

    const blue = composer.getByRole('checkbox', { name: /^Blue/ })
    await blue.click()
    const custom = composer.getByRole('textbox')
    await custom.fill(CUSTOM_ANSWER)
    expect(await blue.getAttribute('aria-checked')).toBe('true')
    await custom.press('Enter')
    await page.locator(TRANSCRIPT).getByText('DONE', { exact: true }).waitFor({ timeout: 60_000 })
    await expect.poll(() => page.getByText('Running…', { exact: true }).count(), { timeout: 60_000 }).toBe(0)

    // World state: the tool result carries the chosen answer, and DONE lands.
    const history = await scaffold.rpc<History>('session/history', { sessionId })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(JSON.parse(lastToolResultText(history.value.events))).toEqual({
      answers: [{ id: 'color', selected: ['Blue'], custom: CUSTOM_ANSWER }],
    })
    // Composer gone; regular input restored.
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    await expect.poll(() => input.isEnabled(), { timeout: 10_000 }).toBe(true)
    // The Native transcript renders the ask card inline; its readable answer
    // is part of the settled golden.
    const transcript = page.locator(TRANSCRIPT)
    const ask = transcript.locator('[data-tool="ask_user_question"]').first()
    await ask.waitFor({ timeout: 15_000 })
    const toggle = ask.locator('[data-expandable]').first()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await ask.getByText('Which color do you prefer?', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await ask.getByText(CUSTOM_ANSWER, { exact: true }).count()).toBe(1)
    expect(await ask.getByText(/"answers"/).count()).toBe(0)
    await compareOrRefreshGolden(ANSWERED_EXPECTED,
      await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd), MODE)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 180_000)

it('expands to the cancellation verdict and original questions', async () => {
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'], keep: SEED_KEEP, seed: { text: cancelledFixture(await readFile(FIXTURE, 'utf8')), seedId: CANCELLED_SEED_ID },
  })
  try {
    const { page } = scaffold
    const row = page.locator('[role="treeitem"]').filter({ hasText: 'Use the ask_user_question tool' }).first()
    await row.waitFor({ timeout: 20_000 })
    await row.click()
    const transcript = page.locator(TRANSCRIPT)
    const ask = transcript.locator('[data-tool="ask_user_question"]').first()
    await ask.waitFor({ timeout: 20_000 }).catch(async (error: unknown) => {
      throw new Error(String(error) + '\nBODY ' + (await page.locator('body').innerText()).slice(0, 2000))
    })
    const toggle = ask.locator('[data-expandable]').first()
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await ask.getByText('Which color do you prefer?', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await ask.getByText(/"questions"/).count()).toBe(0)
    expect(await ask.getByText('Error: the user cancelled ask_user_question', { exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(CANCELLED_EXPECTED,
      (await captureStableAria(page, TRANSCRIPT, scaffold.workspaceCwd)).split(CANCELLED_SEED_ID).join('{{seededId}}'), MODE)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md', 'answered.expected.md', 'cancelled.expected.md'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)
