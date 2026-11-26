/** Shipped Native Web cancels a hung stream and reports provider failures through the durable turn. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry, type ReplayOverrideDoc } from '@redspark/rsh-llm-replay'
import type { SessionEvent } from '@redspark/rsh-session'
import { assertFixtureInventory, fixtureUserPrompts, webSnapshotMode } from './scaffold.ts'
import { launchNativeWeb, type NativeWebScaffold } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/live-interactions', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const RUNNING_DRAFT = 'Queue this follow-up while the current turn is running.'
const AUTH_PROVIDER_MESSAGE = 'Authentication Fails, Your api key: sk-preview-secret is invalid'
const MESSAGE = 'textarea[aria-label="Message"]'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

interface Harness {
  readonly scaffold: NativeWebScaffold
  readonly sessionId: string
  readonly sidecarDir: string | undefined
}

async function boot(override?: (sidecarHome: string) => ReplayOverrideDoc | readonly ReplayEntry[],
  retry?: { readonly maxRetries: number }): Promise<Harness> {
  const sidecarDir = override === undefined ? undefined : await mkdtemp(join(tmpdir(), 'rsh-native-live-'))
  let overridePath: string | undefined
  if (override !== undefined) {
    overridePath = join(sidecarDir!, 'replay.override.json')
    await writeFile(overridePath, JSON.stringify(override(sidecarDir!)))
  }
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
    replay: {
      file: FIXTURE,
      paceMs: 1,
      ...(overridePath === undefined ? {} : { overrideFile: overridePath }),
      ...(retry === undefined ? {} : { providers: [{
        id: 'mock', models: [{ id: 'fixture' }],
        retryPolicy: { mode: 'normal', maxRetries: retry.maxRetries, retryableCodes: ['SERVER'],
          backoff: { initialDelayMs: 25, maxDelayMs: 50, jitterRatio: 0 } },
      }] }),
    },
  })
  try {
    await connectNativeWorkspace(scaffold.page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string } }[]>('session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const sessionId = listed.value[0]?.header.id
    if (sessionId === undefined) throw new Error('the connected workspace produced no Session')
    return { scaffold, sessionId, sidecarDir }
  } catch (error) {
    await scaffold.close()
    if (sidecarDir !== undefined) await rm(sidecarDir, { recursive: true, force: true })
    throw error
  }
}

async function close(harness: Harness | undefined): Promise<void> {
  await harness?.scaffold.close()
  if (harness?.sidecarDir !== undefined) await rm(harness.sidecarDir, { recursive: true, force: true })
}

async function history(harness: Harness): Promise<readonly SessionEvent[]> {
  const read = await harness.scaffold.rpc<{ readonly events: readonly SessionEvent[] }>(
    'session/history', { sessionId: harness.sessionId })
  if (!read.ok) throw new Error('session/history failed: ' + read.error.message)
  return read.value.events
}

async function send(harness: Harness, text: string): Promise<void> {
  const input = harness.scaffold.page.locator(MESSAGE)
  await input.waitFor({ timeout: 15_000 })
  await input.fill(text)
  await input.press('Enter')
}

async function settled(harness: Harness): Promise<readonly SessionEvent[]> {
  await expect.poll(async () => {
    const status = await harness.scaffold.rpc<{ readonly status: string }>(
      'session/status', { sessionId: harness.sessionId })
    return status.ok && status.value.status === 'idle'
  }, { timeout: 90_000 }).toBe(true)
  return history(harness)
}

function turnEnds(events: readonly SessionEvent[]): string[] {
  return events.filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
    .map(event => event.data.reason.kind)
}

it.skipIf(MODE === 'record')('cancels a hung stream and keeps its frozen partial', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
  let marker = ''
  const harness = await boot((sidecarHome) => {
    marker = join(sidecarHome, '.hang-ready')
    return { patches: [{ at: 0, entry: { kind: 'hang', readyFile: marker } }] }
  })
  try {
    const { page } = harness.scaffold
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-cancel'))
    await send(harness, PROMPT)
    // The marker is the synchronization: the stream is provably parked inside
    // the hang after delivering its partial prefix.
    await expect.poll(() => existsSync(marker), { timeout: 30_000 }).toBe(true)
    await page.locator(TRANSCRIPT).getByText('partial', { exact: true }).waitFor({ timeout: 30_000 })

    // A second message queues while the turn is open.
    await send(harness, RUNNING_DRAFT)
    const row = page.locator('section[aria-label="Pending messages"]').getByRole('listitem')
      .filter({ hasText: RUNNING_DRAFT })
    await row.waitFor({ timeout: 15_000 })
    await row.getByText('Queued', { exact: true }).waitFor({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    const events = await settled(harness)
    expect(turnEnds(events).at(-1)).toBe('aborted')
    await expect.poll(() => page.locator(MESSAGE).isEnabled(), { timeout: 20_000 }).toBe(true)
    // The abandoned prefix stays in the durable stream; the Native client
    // retires the live row instead of freezing it on screen.
    expect(JSON.stringify(events)).toContain('partial')
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(0)
    expect(harness.scaffold.pageErrors).toEqual([])
  } finally {
    await close(harness)
  }
}, 180_000)

it.skipIf(MODE === 'record')('settles an AUTH failure without retrying and keeps the key out of the page', async () => {
  const harness = await boot(() => ({
    patches: [{ at: 0, entry: { kind: 'throw', chunks: [], message: AUTH_PROVIDER_MESSAGE, code: 'AUTH' } }],
  }))
  try {
    const { page } = harness.scaffold
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-error-auth'))
    await send(harness, PROMPT)
    const events = await settled(harness)
    expect(turnEnds(events).at(-1)).toBe('error')
    expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(0)
    expect(await page.locator(MESSAGE).isEnabled()).toBe(true)
    expect(await page.locator('body').innerText()).not.toContain('sk-preview-secret')
  } finally {
    await close(harness)
  }
}, 180_000)

it.skipIf(MODE === 'record')('recovers a transient SERVER failure through llm-retry', async () => {
  const derived = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
  expect(derived).toHaveLength(1)
  const harness = await boot(() => [
    { kind: 'throw', chunks: [], message: 'upstream 503', code: 'SERVER' },
    derived[0]!,
  ])
  try {
    const { page } = harness.scaffold
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-retry'))
    await send(harness, PROMPT)
    const events = await settled(harness)
    expect(turnEnds(events).at(-1)).toBe('completed')
    expect(events.filter(event => event.type === 'llm/retry').length).toBeGreaterThanOrEqual(1)
    await expect.poll(() => page.locator(TRANSCRIPT).getByText('event sourcing', { exact: false }).count(),
      { timeout: 20_000 }).toBeGreaterThan(0)
  } finally {
    await close(harness)
  }
}, 180_000)

it.skipIf(MODE === 'record')('surfaces the terminal turn error after transient retries exhaust', async () => {
  const failure: ReplayEntry = { kind: 'throw', chunks: [], message: 'upstream 503', code: 'SERVER' }
  const harness = await boot(() => [failure, failure, failure], { maxRetries: 2 })
  try {
    onTestFailed(() => saveFailureShot(harness.scaffold.page, 'web-e2e-native-retry-exhausted'))
    await send(harness, PROMPT)
    const events = await settled(harness)
    expect(turnEnds(events).at(-1)).toBe('error')
    expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(2)
    expect(await harness.scaffold.page.locator(MESSAGE).isEnabled()).toBe(true)
  } finally {
    await close(harness)
  }
}, 180_000)

it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
  await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl'], 'native-web')
})
