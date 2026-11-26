/** Shipped Native Web switches all three standing policies before its next turn. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFailed } from 'vitest'
import { canonicalPath } from '@redspark/rsh-sandbox'
import type { SessionEvent } from '@redspark/rsh-session'
import {
  assertFinalWorkspaceSnapshot, assertFixtureInventory, fixtureUserPrompts, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/permission-policy-context', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()

const PROMPTS = [
  'Can you create or edit a normal file right now under the current policy? Answer directly in one sentence. Do not call a tool just to discover the policy.',
  'Does the DSH file sandbox currently restrict file operations? Answer directly in one sentence. Do not call tools.',
  'Reply with exactly WORKSPACE_POLICY_SEEN. Do not call tools.',
  'Create the relative path policy-neutral.txt in the current workspace containing exactly POLICY_NEUTRAL_OK, verify its contents, then report completion.',
] as const

// The composer trigger renders the localized preset name; the Menu items use
// the same label because the shipped preset name equals its id.
const PRESET_LABELS = ['Read only', 'Full access', 'Auto review'] as const
const SELECTED_PRESETS = ['read-only', 'danger-full-access', 'workspace-write'] as const
const CONTROLS = 'Model, mode, and permission controls'
const MESSAGE = 'textarea[aria-label="Message"]'

function systemPrompts(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'system/message') return []
    return [event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')]
  })
}

function runtimeContexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== '@redspark/rsh-system-prompt') return []
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

function assistantTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'assistant/message') return []
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').replaceAll('**', '')
    return text.length === 0 ? [] : [text]
  })
}

function callArgs(event: Extract<SessionEvent, { type: 'tool/call' }>): Record<string, unknown> {
  return JSON.parse(event.data.arguments) as Record<string, unknown>
}

it.skipIf(MODE === 'record')('records the current sandbox policy before each turn and executes the neutral write', async () => {
  expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual(PROMPTS)
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    // The title request shares the positional replay cursor.
    configure: row => row.id === 'session-title-llm' ? { ...row, disabled: true } : row,
    replay: { file: FIXTURE, paceMs: 0 },
  })
  try {
    const { page } = scaffold
    onTestFailed(() => saveFailureShot(page, 'web-e2e-permission-policy-context'))
    await connectNativeWorkspace(page, scaffold.workspaceCwd)
    const listed = await scaffold.rpc<readonly { readonly header: { readonly id: string; readonly cwd: string } }[]>(
      'session/list', {})
    if (!listed.ok) throw new Error('session/list failed: ' + listed.error.message)
    const selected = listed.value[0]?.header
    if (selected === undefined) throw new Error('the connected workspace produced no Session')
    const sessionId = selected.id

    async function history(): Promise<readonly SessionEvent[]> {
      const read = await scaffold.rpc<{ readonly events: readonly SessionEvent[] }>('session/history', { sessionId })
      if (!read.ok) throw new Error('session/history failed: ' + read.error.message)
      return read.value.events
    }

    async function waitForTurns(count: number): Promise<void> {
      await expect.poll(async () => (await history()).filter(event => event.type === 'turn/end').length,
        { timeout: 120_000, interval: 250 }).toBe(count)
    }

    async function selectPreset(label: string, preset: string): Promise<void> {
      const controls = page.getByRole('group', { name: CONTROLS })
      const trigger = controls.locator('button[class*="permissionTrigger"]')
      await trigger.waitFor({ timeout: 15_000 })
      await trigger.click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await expect.poll(async () => (await history()).some(event =>
        event.type === 'permission/preset' && event.data.preset === preset),
      { timeout: 20_000 }).toBe(true)
      await expect.poll(() => trigger.innerText(), { timeout: 20_000 }).toContain(label)
    }

    const input = page.locator(MESSAGE)
    await input.waitFor({ timeout: 15_000 })
    for (const [index, label] of PRESET_LABELS.entries()) {
      await selectPreset(label, SELECTED_PRESETS[index] as string)
      await input.fill(PROMPTS[index] as string)
      await input.press('Enter')
      await waitForTurns(index + 1)
    }

    // Re-enter read-only, then run the neutral write: the first attempt is
    // denied by the sandbox and the escalation waits on the shared approval
    // card, which the scenario answers exactly once.
    await selectPreset(PRESET_LABELS[0], SELECTED_PRESETS[0])
    await input.fill(PROMPTS[3])
    await input.press('Enter')
    // This turn raises two owner decisions: the mutation itself, which the
    // read-only sandbox then denies, and the escalation retry that writes it.
    // The running-turn mascot overlay covers point clicks below the
    // transcript, so answer each card through the keyboard.
    const approval = page.locator('[data-approval-key]')
    let answering = true
    let approved = 0
    const answerer = (async (): Promise<void> => {
      while (answering) {
        if (await approval.count() > 0) {
          const allow = approval.getByRole('button', { name: 'Allow once' })
          if (await allow.count() > 0 && await allow.isEnabled()) {
            await allow.focus()
            await allow.press('Enter')
            approved += 1
            await expect.poll(async () => (await history())
              .filter(event => event.type === 'native-approval/decided').length,
            { timeout: 20_000 }).toBe(approved)
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    })()
    try {
      await waitForTurns(4)
    } finally {
      answering = false
      await answerer
    }
    expect(approved).toBe(2)

    const events = await history()
    const systems = systemPrompts(events)
    expect(systems).toHaveLength(1)
    expect(systems[0]).not.toContain('Current DSH file policy:')
    expect(systems[0]).not.toContain('Approval policy:')
    expect(systems[0]).not.toContain('Approval prompts are disabled in this session')

    const contexts = runtimeContexts(events)
    expect(contexts).toHaveLength(4)
    expect(contexts[0]).toContain('Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode.')
    expect(contexts[0]).toContain('Do not refuse a required modification from this policy alone')
    expect(contexts[0]).toContain('Approval policy: ask.')
    expect(contexts[1]).toContain('Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.')
    expect(contexts[1]).toContain('Approval prompts are disabled in this session')
    expect(contexts[2]).toContain(`Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(canonicalPath(selected.cwd))}. Some platform temporary areas may also be writable.`)
    expect(contexts[2]).toContain('Approval policy: ask.')
    expect(contexts[2]).not.toContain('Approval prompts are disabled in this session')
    expect(contexts[3]).toContain('Current DSH file policy: read-only.')

    const answers = assistantTexts(events)
    expect(answers.length).toBeGreaterThanOrEqual(4)
    expect(answers[0]).toMatch(/read-only.*(?:denied|cannot modify|cannot create or edit)/i)
    expect(answers[1]).toMatch(/does not restrict.*(?:file operations|(?:write\/edit tools|write and edit tools).*one-shot bash commands)/i)
    expect(answers[2]).toBe('WORKSPACE_POLICY_SEEN')
    const calls = events.filter(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> => event.type === 'tool/call',
    )
    expect(calls.every(call => call.data.turn === 4)).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const firstCall = calls[0]
    if (firstCall === undefined) throw new Error('neutral policy task produced no tool call')
    expect(callArgs(firstCall)['sandbox_permissions']).toBeUndefined()
    expect(calls.some(call => callArgs(call)['sandbox_permissions'] !== undefined)).toBe(true)
    expect(events.some(event => event.type === 'tool/result'
      && JSON.stringify(event.data).includes('[sandbox: file access denied under read-only mode]'))).toBe(true)
    expect(events.some(event => event.type === 'native-approval/asked')).toBe(true)
    expect(await readFile(join(selected.cwd, 'policy-neutral.txt'), 'utf8')).toBe('POLICY_NEUTRAL_OK')

    await assertFinalWorkspaceSnapshot(SNAPSHOT_DIR, selected.cwd)
    expect(scaffold.pageErrors).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'workspace.expected'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 300_000)
