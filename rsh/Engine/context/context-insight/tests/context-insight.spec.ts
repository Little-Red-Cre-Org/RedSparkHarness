import { describe, expect, it } from 'vitest'
import {
  applyCompositionEvent, compositionStateSchema, initialCompositionState,
} from '../src/composition.ts'
import { applyRequestHistoryEvent, initialRequestHistoryState } from '../src/requests.ts'
import { applyActivityEvent, dayKey, initialActivityState } from '../src/activity.ts'
import { formatContextReport } from '../src/report.ts'

/** A minimal event carrying only what the folds read. */
function event(type: string, seq: number, time: number, data: unknown): {
  type: string
  seq: number
  time: number
  data: unknown
} {
  return { type, seq, time, data }
}

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value })

describe('composition fold', () => {
  it('counts each category apart so injections do not read as user speech', () => {
    let state = initialCompositionState()
    state = applyCompositionEvent(state, event('turn/start', 1, 1_000, { turn: 1 }))
    state = applyCompositionEvent(state, event('system/message', 2, 1_001,
      { turn: 1, step: 1, message: { content: [text('rule')] } }))
    state = applyCompositionEvent(state, event('user/message', 3, 1_002,
      { source: { kind: 'user' }, message: { content: [text('hello')] } }))
    state = applyCompositionEvent(state, event('user/message', 4, 1_003,
      { source: { kind: 'plugin' }, message: { content: [text('injected')] } }))
    state = applyCompositionEvent(state, event('user/message', 5, 1_004,
      { source: { kind: 'skill' }, message: { content: [text('skill')] } }))

    expect(state.totals.system).toBe(4)
    expect(state.totals.user).toBe(5)
    expect(state.totals.inject).toBe(8)
    expect(state.totals.skill).toBe(5)
    expect(state.injects).toBe(1)
    expect(state.skills).toBe(1)
    expect(state.turns).toBe(1)
  })

  it('counts tool schema size where the request sends it', () => {
    let state = initialCompositionState()
    state = applyCompositionEvent(state, event('request/header', 9, 2_000, {
      reason: 'initial',
      header: { config: { provider: 'deepseek', model: 'deepseek-flash' }, tools: [{ name: 'read', description: 'Read a file' }] },
    }))

    expect(state.totals.tools).toBe('read'.length + 'Read a file'.length)
    expect(state.provider).toBe('deepseek')
    expect(state.model).toBe('deepseek-flash')
    expect(state.requests).toHaveLength(1)
    expect(state.lastTotal).toBe(state.totals.tools)
  })

  it('ignores events that carry no composition and keeps the same object', () => {
    const state = initialCompositionState()
    expect(applyCompositionEvent(state, event('turn/end', 1, 1, { turn: 1 }))).toBe(state)
  })

  it('round-trips through its durable schema', () => {
    let state = initialCompositionState()
    state = applyCompositionEvent(state, event('assistant/message', 1, 5_000,
      { turn: 1, step: 1, message: { content: [text('answer')] } }))
    expect(compositionStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })
})

describe('request history fold', () => {
  it('records one row per request and tracks series boundaries', () => {
    let state = initialRequestHistoryState()
    state = applyRequestHistoryEvent(state, event('request/header', 10, 1_000,
      { reason: 'initial', header: { config: { model: 'a' }, tools: [] } }))
    state = applyRequestHistoryEvent(state, event('request/header', 20, 2_000,
      { reason: 'series', header: { config: { model: 'b' }, tools: [{}] } }))

    expect(state.rows).toHaveLength(2)
    expect(state.rows[0]?.reason).toBe('initial')
    expect(state.rows[1]?.tools).toBe(1)
    expect(state.rows[1]?.startsSeries).toBe(true)
    expect(state.lastSeriesStart).toBe(20)
  })

  it('leaves every other event alone', () => {
    const state = initialRequestHistoryState()
    expect(applyRequestHistoryEvent(state, event('tool/call', 1, 1, {}))).toBe(state)
  })
})

describe('activity fold', () => {
  it('files activity under the local calendar day', () => {
    const noon = new Date(2026, 10, 1, 12, 0, 0).getTime()
    let state = initialActivityState()
    state = applyActivityEvent(state, event('turn/start', 1, noon, { turn: 1 }))
    state = applyActivityEvent(state, event('request/header', 2, noon, { reason: 'initial', header: {} }))
    state = applyActivityEvent(state, event('tool/call', 3, noon, {}))

    const day = state.days[dayKey(noon)]
    expect(day).toMatchObject({ turns: 1, requests: 1, toolCalls: 1 })
  })

  it('splits one Session across days instead of collapsing to the last one', () => {
    const first = new Date(2026, 10, 1, 23, 0, 0).getTime()
    const second = new Date(2026, 10, 2, 1, 0, 0).getTime()
    let state = initialActivityState()
    state = applyActivityEvent(state, event('turn/start', 1, first, {}))
    state = applyActivityEvent(state, event('turn/start', 2, second, {}))

    expect(Object.keys(state.days).sort()).toEqual([dayKey(first), dayKey(second)].sort())
  })
})

describe('context report', () => {
  it('renders the composition, the totals and the recent requests', () => {
    let composition = initialCompositionState()
    composition = applyCompositionEvent(composition, event('system/message', 1, 1_000,
      { message: { content: [text('a'.repeat(400))] } }))
    composition = applyCompositionEvent(composition, event('user/message', 2, 1_001,
      { source: { kind: 'user' }, message: { content: [text('b'.repeat(100))] } }))
    composition = applyCompositionEvent(composition, event('request/header', 3, 1_002,
      { reason: 'initial', header: { config: { model: 'deepseek-flash' }, tools: [] } }))
    const requests = applyRequestHistoryEvent(initialRequestHistoryState(),
      event('request/header', 3, 1_002, { reason: 'initial', header: { config: { model: 'deepseek-flash' }, tools: [] } }))

    const report = formatContextReport({ composition, requests })

    expect(report).toContain('Context')
    expect(report).toContain('deepseek-flash')
    expect(report).toContain('System prompt')
    expect(report).toContain('Your messages')
    // 500 chars is roughly 125 tokens; the report must show that, not a raw char count alone.
    expect(report).toContain('≈ 125 tokens')
    expect(report).toContain('Growth')
  })

  it('renders an empty Session without dividing by zero', () => {
    const report = formatContextReport({
      composition: initialCompositionState(), requests: initialRequestHistoryState(),
    })
    expect(report).toContain('0 chars')
    expect(report).not.toContain('NaN')
  })
})
