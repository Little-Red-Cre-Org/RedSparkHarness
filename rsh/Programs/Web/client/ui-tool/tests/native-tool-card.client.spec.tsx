// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { NativeToolCard } from '../src/tool-renderer.ts'
import type { RunningToolCall, ToolResultNode } from '@redspark/rsh-client-ui-conversation/tool-records'

const block: RunningToolCall = {
  callId: 'read-1', name: 'read', argsRaw: '{"file_path":"tool-card.txt"}',
  turn: 1, step: 1, time: 100, subCalls: [],
}

afterEach(cleanup)

function props(locale: 'en' | 'zh'): GenericToolCardProps {
  const row = NativeToolCard({ block, toolName: 'read', locale }) as ReactElement<{ children: [ReactElement<GenericToolCardProps>, unknown] }>
  return row.props.children[0].props
}

describe('NativeToolCard', () => {
  it('supplies feature and common translations for each locale', () => {
    const en = props('en').t
    const zh = props('zh').t
    expect(en('tool.title.read')).toBe('Read')
    expect(zh('tool.title.read')).toBe('读取')
    expect(en('unknown')).toBe('Unknown')
    expect(zh('unknown')).toBe('未知')
  })

  it('renders a nested Bash sub-call with its expandable terminal', () => {
    const bash: ToolResultNode = {
      kind: 'tool-result', seq: 11, time: 1_100, callId: 'run-1:bash',
      call: { name: 'bash', argsRaw: '{"command":"echo CODE_ROUND_OK","description":"Echo the marker"}' },
      callTime: 1_050, content: [{ type: 'text', text: 'CODE_ROUND_OK\n' }], isError: false, subCalls: [],
    }
    const parent: ToolResultNode = {
      kind: 'tool-result', seq: 12, time: 1_200, callId: 'run-1',
      call: { name: 'run_code', argsRaw: '{"description":"Run the program"}' },
      callTime: 1_000, content: [{ type: 'text', text: '{"ok":true}' }], isError: false, subCalls: [bash],
    }
    const { container } = render(<NativeToolCard block={parent} toolName="run_code" locale="en" cwd="/work" />)
    const row = container.querySelector('[data-subcalls] [data-sample="bash"]')
    expect(row).not.toBeNull()
    expect(row?.getAttribute('data-state')).toBe('ok')
    expect(row?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row!)
    expect(row?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-terminal]')).not.toBeNull()
    expect(container.querySelector('[data-terminal]')?.textContent).toContain('CODE_ROUND_OK')
  })
})
