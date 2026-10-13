import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import type { GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { NativeToolCard } from '../src/tool-renderer.ts'
import type { RunningToolCall } from '@deepseek-ai/dsh-client-ui-conversation/tool-records'

const block: RunningToolCall = {
  callId: 'read-1', name: 'read', argsRaw: '{"file_path":"tool-card.txt"}',
  turn: 1, step: 1, time: 100, subCalls: [],
}

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
})
