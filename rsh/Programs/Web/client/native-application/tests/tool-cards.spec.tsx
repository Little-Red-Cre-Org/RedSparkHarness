// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@redspark/rsh-session/types'
import type { RunningToolCall, ToolResultNode } from '@redspark/rsh-client-ui-tool/native'
import { ToolCard, toolCardRecords } from '../src/tool-cards.tsx'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq: SessionSeq(seq), time: 1_700_000_000_000 + seq, type, data } as unknown as SessionEvent
}

const call = (callId = 'call-1') => event(1, 'tool/call', {
  turn: 1, step: 1, callId, name: 'read', arguments: '{"file_path":"tool-card.txt"}',
})

const result = (callId = 'call-1', over: Record<string, unknown> = {}, seq = 2) => event(seq, 'tool/result', {
  turn: 1, step: 1,
  message: {
    id: 'message-1', role: 'user', source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', toolCallId: callId, isError: true, content: [{ type: 'text', text: 'failed' }] }],
  },
  error: { name: 'Error', code: 'READ_FAILED' },
  meta: { path: 'tool-card.txt' },
  ...over,
})

describe('native Tool card projection', () => {
  it('pairs durable call and result facts under the call sequence', () => {
    const record = toolCardRecords([
      event(0, 'assistant/message', {}), call(),
      event(2, 'tool/ptc-dispatch-start', {
        rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'call-1:ptc:1',
        name: 'read', arguments: { path: 'child.txt' },
      }),
      event(3, 'tool/ptc-dispatch', {
        rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'call-1:ptc:1',
        name: 'read', arguments: { path: 'child.txt' }, isError: false, content: [{ type: 'text', text: 'child' }],
      }),
      result('call-1', {}, 4),
    ])[0]!
    expect(record).toMatchObject({
      seq: 1,
      block: {
        kind: 'tool-result', callId: 'call-1', call: { name: 'read', argsRaw: '{"file_path":"tool-card.txt"}' },
        callTime: 1_700_000_000_001, content: [{ type: 'text', text: 'failed' }], isError: true,
        error: { name: 'Error', code: 'READ_FAILED' }, meta: { path: 'tool-card.txt' },
        subCalls: [{ kind: 'tool-result', callId: 'call-1:ptc:1', call: { name: 'read', argsRaw: '{"path":"child.txt"}' },
          callTime: 1_700_000_000_002, content: [{ type: 'text', text: 'child' }], isError: false }],
      },
    })
  })

  it('keeps an in-flight call and uses its name for the card', () => {
    const record = toolCardRecords([call()])[0]!
    expect(record.block).toMatchObject({ callId: 'call-1', name: 'read', turn: 1, step: 1, subCalls: [] })
    expect(ToolCard({ block: record.block, locale: 'en' }).props).toMatchObject({ toolName: 'read', locale: 'en' })
  })

  it('keeps result-only window history and uses its call id as the title key', () => {
    const record = toolCardRecords([result('windowed', { error: undefined, meta: undefined })])[0]!
    expect(record).toMatchObject({ seq: 2, block: { kind: 'tool-result', callId: 'windowed', call: null, callTime: null } })
    expect(ToolCard({ block: record.block, locale: 'zh' }).props).toMatchObject({ toolName: 'windowed', locale: 'zh' })
  })
})

afterEach(cleanup)

function skillResult(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 3_000, callId: 'call-skill',
    call: { name: 'skill', argsRaw: '{"name":"dsh-manage-issues"}' },
    callTime: 2_000,
    content: [{ type: 'text', text: '<skill_content name="dsh-manage-issues">\nFollow the issue workflow.\n</skill_content>' }],
    isError: false, subCalls: [], ...over,
  }
}

const skillRunning = (): RunningToolCall => ({
  callId: 'call-skill', name: 'skill', argsRaw: '{"name":"dsh-manage-issues"}',
  turn: 1, step: 1, time: 2_000, subCalls: [],
})

it.each(['ok', 'error', 'running', 'stopped'] as const)('renders the dedicated skill row (%s)', (state) => {
  const block = state === 'running'
    ? skillRunning()
    : state === 'error'
      ? skillResult({
        content: [{ type: 'text', text: 'SkillError: missing resource\nCheck SKILL.md.' }],
        isError: true,
        error: { name: 'SkillError', code: 'missing' },
      })
      : state === 'stopped'
        ? skillResult({ error: { name: 'InterruptedError', code: 'interrupted' } })
        : skillResult()
  const view = render(<ToolCard block={block} locale="en" />)
  const row = view.container.querySelector('[data-tool="skill"]')
  expect(row).not.toBeNull()
  expect(row?.getAttribute('data-state')).toBe(state === 'running' ? 'running' : state)
  if (state !== 'error') expect(view.container.textContent).toContain('dsh-manage-issues')
  if (state === 'running') {
    expect(view.container.textContent).toContain('Loading skill')
    expect(row?.querySelector('[role="button"]')).toBeNull()
    return
  }
  if (state === 'stopped') {
    expect(view.container.textContent).toContain('Skill load stopped')
    return
  }
  const summary = state === 'error' ? 'SkillError: missing resource' : 'dsh-manage-issues'
  const button = screen.getByRole('button', { name: state === 'error' ? `Skill load failedSkill${summary}` : `Skill${summary}` })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  const output = view.container.querySelector('pre')
  expect(output?.textContent).toBe(state === 'error'
    ? 'SkillError: missing resource\nCheck SKILL.md.'
    : '<skill_content name="dsh-manage-issues">\nFollow the issue workflow.\n</skill_content>')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(view.container.querySelector('pre')).toBeNull()
})
