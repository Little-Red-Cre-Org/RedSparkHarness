/** Native time-context configuration and durable message scheduling. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSystemMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { NativeTimeContext, resolveNativeTimeContextConfig } from '../src/index.ts'

const BASE = Date.parse('2026-09-23T00:00:00.000Z')

function contentText(message: UserMessage | undefined): string {
  const block = message?.content[0]
  if (block?.type !== 'text') throw new Error('expected one text block')
  return block.text
}

afterEach(() => { vi.useRealTimers() })

describe('NativeTimeContext', () => {
  it('records a source-attributed UTC reading and schedules later steps from durable history', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(BASE)
    let now = BASE + 1_500
    const session = Session.create(SessionId('time-context'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'what time is it?' }],
      source: { kind: 'user', rpcId: 'request-1', clientTimeZone: 'Asia/Shanghai' } as never,
    }), { surfaceOp: 'append' })
    const context = new NativeTimeContext(resolveNativeTimeContextConfig({ timeZone: 'UTC', refreshIntervalMs: 1_000 }), () => now)
    context.seed(session, session.snapshotEvents())

    const first = context.prepare({ session, turn: 1, step: 1 })
    expect(first?.source).toMatchObject({
      kind: 'plugin', plugin: 'native-time-context', form: 'snapshot', sections: [{ name: 'native-time-context' }],
    })
    expect(contentText(first)).toBe('Time sampled while preparing turn 1, step 1: 2026-09-23T08:00:01+08:00[Asia/Shanghai]\nBrowser time zone for this request: Asia/Shanghai. Interpret otherwise-unqualified dates and times in this zone.\nElapsed since the preceding model-visible message: 1s.')
    if (first === undefined) throw new Error('missing initial native time context')
    vi.setSystemTime(now)
    context.record(session, session.append('user/message', first, { surfaceOp: 'append' }))

    now += 500
    const restored = Session.fromRestore(
      session.id, session.snapshotEvents(), { ...session.header }, session.inheritedEventCount, 'detached',
    )
    const restoredContext = new NativeTimeContext(
      resolveNativeTimeContextConfig({ timeZone: 'UTC', refreshIntervalMs: 1_000 }), () => now,
    )
    restoredContext.seed(restored, restored.snapshotEvents())
    expect(restoredContext.prepare({ session: restored, turn: 1, step: 2 })).toBeUndefined()
    now += 500
    const thirdStep = context.prepare({ session, turn: 1, step: 3 })
    expect(contentText(thirdStep)).toContain('step 3')
    expect(contentText(thirdStep)).toContain('Elapsed since the preceding step context: 1s.')
    if (thirdStep === undefined) throw new Error('missing refreshed native time context')
    vi.setSystemTime(now)
    context.record(session, session.append('user/message', thirdStep, { surfaceOp: 'append' }))
    context.record(session, session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    context.record(session, session.append('turn/start', { turn: 2 }))
    now += 500
    expect(context.prepare({ session, turn: 2, step: 1 })).toBeUndefined()
    now += 500
    expect(contentText(context.prepare({ session, turn: 2, step: 1 }))).toContain('turn 2')
  })

  it('rejects invalid static configuration before a native Host can activate it', () => {
    expect(() => resolveNativeTimeContextConfig({ timeZone: '', extra: true })).toThrow('unknown configuration field')
    expect(() => resolveNativeTimeContextConfig({ refreshIntervalMs: -1 })).toThrow('refreshIntervalMs must be a non-negative safe integer')
    expect(() => resolveNativeTimeContextConfig({ timeZone: 'not-a-zone' })).toThrow('invalid IANA timeZone')
  })

  it('uses the fallback for a mixed-zone request and excludes the system prompt from elapsed time', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(BASE)
    const session = Session.create(SessionId('time-context-mixed'))
    session.append('turn/start', { turn: 1 })
    session.append('system/message', {
      turn: 1, step: 1, message: createSystemMessage('system', 'native-headless'),
    }, { surfaceOp: 'append' })
    vi.setSystemTime(BASE + 1_000)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'local time?' }],
      source: { kind: 'user', rpcId: 'request-1', clientTimeZone: 'Asia/Shanghai' } as never,
    }), { surfaceOp: 'append' })
    const proposed = createUserMessage({
      content: [{ type: 'text', text: 'another local time?' }],
      source: { kind: 'user', rpcId: 'request-2', clientTimeZone: 'America/New_York' } as never,
    })
    const context = new NativeTimeContext(resolveNativeTimeContextConfig({ timeZone: 'UTC' }), () => BASE + 2_500)
    context.seed(session, session.snapshotEvents())

    const message = context.prepare({ session, turn: 1, step: 1, requestMessages: [proposed] })

    expect(contentText(message)).toContain('[UTC]\n')
    expect(contentText(message)).toContain('Browser time zone for this request: mixed ["America/New_York","Asia/Shanghai"]. Ask the user to clarify')
    expect(contentText(message)).toContain('Elapsed since the preceding model-visible message: 1s.')
  })

  it('reports missing browser provenance and an unavailable baseline', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(BASE)
    const session = Session.create(SessionId('time-context-missing'))
    session.append('turn/start', { turn: 1 })
    session.append('system/message', {
      turn: 1, step: 1, message: createSystemMessage('system', 'native-headless'),
    }, { surfaceOp: 'append' })
    const context = new NativeTimeContext(resolveNativeTimeContextConfig({ timeZone: 'UTC' }), () => BASE + 1_000)
    context.seed(session, session.snapshotEvents())

    const message = context.prepare({ session, turn: 1, step: 1 })

    expect(contentText(message)).toContain('Browser time zone for this request: unavailable. Ask the user to clarify')
    expect(contentText(message)).toContain('Elapsed since the preceding model-visible message: unavailable.')
  })
})
