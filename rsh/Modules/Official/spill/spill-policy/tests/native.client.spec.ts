/**
 * The Native spill policy.
 *
 * The composition test proves the row loads; this file proves the decision it
 * makes, because a policy that registers and never spills is indistinguishable
 * from one that truncates until a result is actually oversized.
 */
import { describe, expect, it, vi } from 'vitest'
import { plugin } from '../src/native.ts'

/** A Native scope stub: the policy only passes it through to the registry. */
const SCOPE = {} as never

/**
 * Install the policy against a recording tool registry.
 * @param config - provider configuration.
 * @param store - spill store the policy may resolve, or undefined to compose none.
 * @returns what the policy registered, and the store's calls.
 */
interface SpillStoreStub {
  saveText(input: unknown, signal: AbortSignal): Promise<unknown>
}

/** The two policy shapes the registry accepts, captured for direct invocation. */
type ResultPolicy = (call: unknown, original: unknown, next: () => Promise<unknown>) => Promise<unknown>
type LogPolicy = (call: unknown, original: unknown, next: () => Promise<unknown>, signal: AbortSignal) => Promise<unknown>

function install(config: { maxInlineBytes?: number }, store: SpillStoreStub | undefined) {
  const registered: { result?: ResultPolicy; log?: LogPolicy } = {}
  const owned: (() => Promise<void>)[] = []
  const context = {
    scope: SCOPE,
    require: (name: string) => name === 'tools' ? {
      postResult: (policy: ResultPolicy) => { registered.result = policy; return async () => {} },
      postPtcDispatchLog: (policy: LogPolicy) => { registered.log = policy; return async () => {} },
    } : undefined,
    optional: (name: string) => name === 'spillStore' ? store : undefined,
    own: (disposer: () => Promise<void>) => { owned.push(disposer) },
  }
  const resolved = plugin.resolve(config) as unknown as (ctx: unknown) => void
  resolved(context)
  return { registered, owned }
}

const oversized = (bytes: number): string => 'x'.repeat(bytes)

describe('spill policy registration', () => {
  it('registers nothing when the cap is omitted', () => {
    const { registered } = install({}, undefined)
    expect(registered.result).toBeUndefined()
    expect(registered.log).toBeUndefined()
  })

  it('refuses a cap that would throw inside every oversized call', () => {
    // Load-time failure, not per-call: a fractional cap reaches the retainer's
    // budget assertion, which would turn successful calls into errors.
    expect(() => install({ maxInlineBytes: 1.5 }, undefined)).toThrow('non-negative integer')
    expect(() => install({ maxInlineBytes: -1 }, undefined)).toThrow('non-negative integer')
  })
})

describe('the model-facing arm', () => {
  const call = (name: string, parent?: unknown) => ({
    name, callId: 'call-1', parent, session: { header: { id: 'session-1' } }, signal: new AbortController().signal,
  })
  const accept = (content: { type: string; text: string }[]) => ({ kind: 'accept', content })

  it('keeps a result within the cap untouched', async () => {
    const { registered } = install({ maxInlineBytes: 100 }, undefined)
    const original = accept([{ type: 'text', text: 'short' }])
    const out = await registered.result!(call('bash'), original, async () => original)
    expect(out).toBe(original)
  })

  it('spills an oversized plain-text result and keeps the projection within the cap', async () => {
    const saveText = vi.fn(async () => ({ locator: '/spill/bash.txt', retrievalHint: 'Read it with the read tool' }))
    const { registered } = install({ maxInlineBytes: 200 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('bash'), original, async () => original) as { content: { text: string }[] }
    expect(saveText).toHaveBeenCalledTimes(1)
    const text = out.content.map(block => block.text).join('')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(200)
    expect(text).toContain('/spill/bash.txt')
  })

  it('leaves a nested call to the log arm', async () => {
    const saveText = vi.fn()
    const { registered } = install({ maxInlineBytes: 100 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('bash', {}), original, async () => original)
    expect(out).toBe(original)
    expect(saveText).not.toHaveBeenCalled()
  })

  it('skips read, which would otherwise spill over and over', async () => {
    const saveText = vi.fn()
    const { registered } = install({ maxInlineBytes: 100 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('read'), original, async () => original)
    expect(out).toBe(original)
    expect(saveText).not.toHaveBeenCalled()
  })

  it('keeps the content when the store fails', async () => {
    const saveText = vi.fn(async () => { throw new Error('ENOSPC') })
    const { registered } = install({ maxInlineBytes: 100 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('bash'), original, async () => original)
    expect(out).toBe(original)
  })

  it('keeps the content when no store is composed', async () => {
    const { registered } = install({ maxInlineBytes: 100 }, undefined)
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('bash'), original, async () => original)
    expect(out).toBe(original)
  })

  it('keeps the content when the notice alone would exceed the cap', async () => {
    const saveText = vi.fn(async () => ({
      locator: '/' + 'x'.repeat(500) + '/spill.txt', retrievalHint: 'y'.repeat(500),
    }))
    const { registered } = install({ maxInlineBytes: 100 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }])
    const out = await registered.result!(call('bash'), original, async () => original)
    expect(out).toBe(original)
  })

  it('leaves a result carrying a non-text block alone', async () => {
    const saveText = vi.fn()
    const { registered } = install({ maxInlineBytes: 100 }, { saveText })
    const original = accept([{ type: 'text', text: oversized(1000) }, { type: 'image', text: '' }])
    const out = await registered.result!(call('bash'), original, async () => original)
    expect(out).toBe(original)
    expect(saveText).not.toHaveBeenCalled()
  })
})

describe('the dispatch-log arm', () => {
  const call = { name: 'bash', callId: 'call-2', session: { header: { id: 'session-1' } } }
  const log = (text: string) => ({ content: [{ type: 'text', text }], isError: false })

  it('bounds an oversized log copy, including read sub-calls', async () => {
    const saveText = vi.fn(async () => ({ locator: '/spill/read.txt', retrievalHint: 'read it' }))
    const { registered } = install({ maxInlineBytes: 200 }, { saveText })
    const out = await registered.log!(
      call, undefined, async () => log(oversized(1000)), new AbortController().signal,
    ) as { isError: boolean; content: { text: string }[] }
    expect(saveText).toHaveBeenCalledTimes(1)
    expect(Buffer.byteLength(out.content[0]!.text, 'utf8')).toBeLessThanOrEqual(200)
    // The error status is the log's business, not the policy's.
    expect(out.isError).toBe(false)
  })

  it('keeps a log copy within the cap', async () => {
    const saveText = vi.fn()
    const { registered } = install({ maxInlineBytes: 200 }, { saveText })
    const original = log('short')
    const out = await registered.log!(call, undefined, async () => original, new AbortController().signal)
    expect(out).toBe(original)
    expect(saveText).not.toHaveBeenCalled()
  })
})
