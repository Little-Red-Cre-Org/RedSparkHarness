/**
 * Shipped Native Web replays one recorded model turn through the Host prompt
 * route and renders it, without the Cordis composition or a network key.
 */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { launchNativeWeb } from './native-scaffold.ts'

const FIXTURE = fileURLToPath(new URL('../../../../../snapshots/web/feedback-command/session.v3.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const TRANSCRIPT = '[data-slot="main"] [class*="ChatPresentation_transcript"]'

/** One Host history read, narrowed to the events this scenario inspects. */
interface History {
  readonly header: { readonly id: string }
  readonly events: readonly { readonly type: string }[]
}

it('replays a recorded turn through the Host prompt route', async () => {
  const scaffold = await launchNativeWeb({
    // The shipped provider and the replay row both provide `model`; the replay
    // row replaces the provider for this scenario.
    drop: ['pi-ai'],
    replay: { file: FIXTURE, paceMs: 0 },
  })
  try {
    const created = await scaffold.rpc<{ readonly sessionId: string }>('session/create', {})
    if (!created.ok) throw new Error('session/create failed: ' + created.error.message)
    const prompted = await scaffold.rpc<{ readonly answer: string }>('session/prompt', {
      sessionId: created.value.sessionId, text: PROMPT, resume: true,
    })
    if (!prompted.ok) throw new Error('session/prompt failed: ' + prompted.error.message)
    expect(prompted.value.answer).toBe('LIGHTHOUSE')

    const history = await scaffold.rpc<History>('session/history', { sessionId: created.value.sessionId })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(history.value.events.some(event => event.type === 'assistant/message')).toBe(true)

    // A reload makes the client list the Session the Host route created, so the
    // transcript assertion reads the shipped renderer rather than a live draft.
    await scaffold.page.reload({ waitUntil: 'load' })
    const onboard = scaffold.page.getByRole('button', { name: 'Continue', exact: true })
    if (await onboard.count() > 0) await onboard.click()
    await scaffold.page.locator('[role="treeitem"]').filter({ hasText: 'Reply with the single word' }).first().click()
    const transcript = scaffold.page.locator(TRANSCRIPT)
    await expect.poll(() => transcript.getByText('LIGHTHOUSE', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 120_000)
