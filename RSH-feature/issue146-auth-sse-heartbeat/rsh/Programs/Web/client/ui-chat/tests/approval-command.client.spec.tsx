// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, commandOf, fileChangeOf } from '../src/client/chat/ApprovalCommand.tsx'
import { apply as nodeApply } from '../src/index.ts'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.detail'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  return { callId, useChat } as PropsRuntime<'conversation.approval.detail'>
}

describe('commandOf', () => {
  it('accepts only a string command from valid JSON arguments', () => {
    expect(commandOf(undefined)).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":42}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
  })
})

describe('ApprovalCommand', () => {
  it.each([
    { name: 'edit', args: { file_path: 'main.ts', old_string: 'value = 1', new_string: 'value = 2' }, expected: 'main.ts\n- value = 1\n+ value = 2' },
  ])('previews the correlated $name without applying it', ({ name, args, expected }) => {
    const call = { callId: 'call-1', name, argsRaw: JSON.stringify(args) }
    const view = render(<ApprovalCommand {...props([{ kind: 'tool-call', data: { root: call } }])} />)
    expect(view.container.textContent).toBe(expected)
    expect(fileChangeOf({ ...call, argsRaw: '{' })).toBeUndefined()
    expect(fileChangeOf({ ...call, argsRaw: 'null' })).toBeUndefined()
    view.unmount()
  })

  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { callId: 'other', argsRaw: '{"command":"wrong"}' } } },
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{"command":"pnpm test"}' } } },
    ] as never)} />)

    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('omits absent, uncorrelated, and settled Tool calls', () => {
    const { container, rerender } = render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: undefined } },
      { kind: 'tool-call', data: { root: { callId: 'other', argsRaw: '{}' } } },
      {
        kind: 'tool-call',
        data: { root: { kind: 'tool-result', callId: 'call-1', argsRaw: '{"command":"ignored"}' } },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')

    rerender(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{}' } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})

describe('ui-chat package entries', () => {
  it('keeps the Host half optional', () => {
    const ctx = new Context()
    expect(() => { nodeApply(ctx) }).not.toThrow()
  })
})
