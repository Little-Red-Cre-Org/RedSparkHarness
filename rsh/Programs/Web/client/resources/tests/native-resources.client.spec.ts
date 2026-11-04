// @vitest-environment jsdom
/**
 * Native resource model.
 *
 * The browser half provides `ctx.resources` and contributes the `resource`
 * root keyed hook; a Native client has neither a Cordis Context nor
 * `ctx.reflect`. This half provides `clientNativeResources` and contributes the
 * same root keyed hook through the shared SlotRuntime. What this suite pins is
 * that substitution: the browser half's own registry still serves addresses
 * over Native slots, and a provider still releases with its owner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@redspark/rsh-typert-protocol'
import type { RootStandardSourceContribution } from '@redspark/rsh-client-ui-slots'
import { createNativeResources, plugin } from '../src/native.ts'
import type { ResourceOpenContext, ResourceProvider } from '../src/client/contract.ts'

declare module '@redspark/rsh-client-ui-slots' {
  interface ResourceProtocolMap {
    feed: string
  }
}

const A = 'dsh-resource://feed/one'

/** The slot port the factory needs, recording what it was handed. */
function slotPort() {
  const contributions: RootStandardSourceContribution[] = []
  const withdrawn = vi.fn()
  return {
    contributions,
    withdrawn,
    provideRoot(contribution: RootStandardSourceContribution): () => void {
      contributions.push(contribution)
      return withdrawn
    },
  }
}

/** An effect runner that releases everything it owns when asked. */
function effectPort() {
  const owned: (() => void)[] = []
  return {
    run(setup: () => () => void): () => void {
      owned.push(setup())
      return () => {}
    },
    releaseAll() {
      for (const release of owned.reverse()) release()
      owned.length = 0
    },
  }
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** A provider that yields the given frames and then ends. */
function frames(...values: readonly RemoteResult<string>[]): ResourceProvider<'feed'> {
  let at = 0
  return {
    protocol: 'feed',
    open: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve(at < values.length
          ? { done: false as const, value: values[at++] as RemoteResult<string> }
          : { done: true as const, value: undefined }),
      }),
    }),
  }
}

/** A provider whose stream stays open until the open context's signal aborts. */
function held(open: (ctx: ResourceOpenContext) => void = () => {}): ResourceProvider<'feed'> {
  return {
    protocol: 'feed',
    open: (_address, ctx) => {
      open(ctx)
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<RemoteResult<string>>>((resolve) => {
            ctx.signal.addEventListener('abort', () => { resolve({ done: true, value: undefined }) }, { once: true })
          }),
        }),
      }
    },
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('native resources installation', () => {
  it('contributes the root keyed hook and withdraws it on dispose', async () => {
    const slots = slotPort()
    const effect = effectPort()
    const installation = createNativeResources(slots, setup => effect.run(setup))

    expect(slots.contributions).toHaveLength(1)
    const contribution = slots.contributions[0] as RootStandardSourceContribution
    expect(Object.keys(contribution.keyedHooks ?? {})).toEqual(['resource'])
    // The hook resolves any address, including one no provider serves.
    const source = contribution.keyedHooks?.['resource']?.(A)
    expect(source?.getSnapshot()).toMatchObject({ status: 'none' })

    await installation.dispose()
    expect(slots.withdrawn).toHaveBeenCalledOnce()
    effect.releaseAll()
  })

  it('declares the Native services it binds and provides the registry', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual(['clientSlots'])
    expect(plugin.optional).toEqual([])
    expect(plugin.provides).toEqual(['clientNativeResources'])
  })
})

describe('native resources registry', () => {
  it('opens a provider stream on subscription and publishes its frames', async () => {
    const effect = effectPort()
    const installed = createNativeResources(slotPort(), setup => effect.run(setup))
    const resources = installed.resources
    const dispose = (): Promise<void> => installed.dispose()
    // Read the address before the provider exists: an unserved protocol reports
    // `none`, and the record survives the provider arriving under it.
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'none' })
    resources.register(frames({ ok: true, value: 'v1' }))

    const seen: string[] = []
    const unsubscribe = resources.source(A).subscribe(() => {
      seen.push(resources.source(A).getSnapshot().status)
    })
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'loading' })

    await settle()
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'live', value: 'v1' })
    expect(seen).toContain('live')

    unsubscribe()
    // The last holder leaving returns the address to idle; the record stays so
    // an existing subscriber keeps a reference-stable source.
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'loading', value: undefined })
    await dispose()
    effect.releaseAll()
  })

  it('keeps the last value beside a later failure frame', async () => {
    const effect = effectPort()
    const installed = createNativeResources(slotPort(), setup => effect.run(setup))
    const resources = installed.resources
    const dispose = (): Promise<void> => installed.dispose()
    resources.register(frames(
      { ok: true, value: 'v1' },
      { ok: false, error: new RemoteError('gateway/internal', 'gone', {}) },
    ))

    const unsubscribe = resources.source(A).subscribe(() => {})
    await settle()
    expect(resources.source(A).getSnapshot()).toMatchObject({
      status: 'failed',
      value: 'v1',
      failure: { code: 'gateway/internal' },
    })
    unsubscribe()
    await dispose()
    effect.releaseAll()
  })

  it('rejects a second provider for one protocol', async () => {
    const effect = effectPort()
    const installed = createNativeResources(slotPort(), setup => effect.run(setup))
    const resources = installed.resources
    const dispose = (): Promise<void> => installed.dispose()
    resources.register(frames())
    expect(() => resources.register(frames())).toThrow(/already has a provider/)
    await dispose()
    effect.releaseAll()
  })

  it('aborts a pinned stream when the pin is released', async () => {
    const effect = effectPort()
    const installed = createNativeResources(slotPort(), setup => effect.run(setup))
    const resources = installed.resources
    const dispose = (): Promise<void> => installed.dispose()
    const opened = vi.fn()
    resources.register(held(opened))

    const pinned = new AbortController()
    resources.pin(A, pinned.signal)
    expect(opened).toHaveBeenCalledOnce()
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'loading' })

    pinned.abort()
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'loading' })
    await dispose()
    effect.releaseAll()
  })

  it('detaches a held address when its provider leaves', async () => {
    const effect = effectPort()
    const installed = createNativeResources(slotPort(), setup => effect.run(setup))
    const resources = installed.resources
    const dispose = (): Promise<void> => installed.dispose()
    resources.register(held())
    const unsubscribe = resources.source(A).subscribe(() => {})
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'loading' })

    // The provider leaving ends the stream and reports the address as unserved.
    effect.releaseAll()
    expect(resources.source(A).getSnapshot()).toMatchObject({ status: 'none' })
    unsubscribe()
    await dispose()
  })
})
