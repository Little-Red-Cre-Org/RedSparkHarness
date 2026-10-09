/**
 * SessionProjectionRegistry unit drive: eager apply on committed events with
 * lazy cell build (registration after events, session after registration),
 * the Object.is no-change gates (same state or raw view reference ⇒ zero
 * change-feed work), snapshot consistency (asOfSeq = last event seq; values
 * from the watermark cache), duplicate-key rejection, stateVersion validation,
 * and effect-tied removal of registrations and change listeners (HMR safety).
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { z } from 'zod'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { Session as NativeSession, SessionId as NativeSessionId } from '@deepseek-ai/dsh-session/native'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { ProjectionRegistryCore } from '../src/registry-core.ts'
import { NativeSessionProjectionRegistry, plugin as nativeProjectionPlugin } from '../src/native.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'test/marks': MarksState
    'test/count': number
    'test/stable-view': StableViewState
    'test/cut': number
  }

  interface SessionProjectionMap {
    'test/marks': { marks: string[] }
    'test/stable-view': { marks: string[] }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/mark': { marks: string[] }
  }
}

interface MarksView {
  marks: string[]
}
type MarksState = MarksView | null
interface StableViewState {
  revision: number
  value: MarksView
}
const marksViewSchema: z.ZodType<MarksView> = z.object({ marks: z.array(z.string()) })
const RESTORE_HEADER: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: SessionId('projection-restore'),
  createdAt: 0,
  isSeeded: false,
}
/** Whole-value unit: latest test/mark event wins; unrelated events return the same reference. */
const marksUnit = (): Omit<ProjectionDefinition<'test/marks', MarksState>, 'wire'>
  & { wire: NonNullable<ProjectionDefinition<'test/marks', MarksState>['wire']> } => ({
  key: 'test/marks',
  stateSchema: marksViewSchema.nullable(),
  init: () => null,
  apply: (state, event) => (event.type === 'test/mark' ? (event).data : state),
  wire: {
    viewSchema: marksViewSchema,
    view: state => state ?? { marks: [] },
  },
  stateVersion: 1,
})

/** Host-only counting unit over every event — state changes on each apply. */
const countUnit = (): ProjectionDefinition<'test/count', number> => ({
  key: 'test/count',
  stateSchema: z.number().int().nonnegative(),
  init: () => 0,
  apply: state => state + 1,
  stateVersion: 1,
})

const stableViewUnit = (
  view: (state: StableViewState) => StableViewState['value'],
) => ({
  key: 'test/stable-view',
  stateSchema: z.object({
    revision: z.number().int().nonnegative(),
    value: marksViewSchema,
  }),
  init: () => ({ revision: 0, value: { marks: [] } }),
  apply: (state, event) => {
    if (event.type === 'turn/start') return { ...state, revision: state.revision + 1 }
    if (event.type === 'test/mark') return { revision: state.revision + 1, value: event.data }
    return state
  },
  wire: {
    viewSchema: marksViewSchema,
    view,
  },
  stateVersion: 1,
}) satisfies ProjectionDefinition<'test/stable-view', StableViewState>

/** Host-only unit whose initial state proves the exact inherited cut. */
const cutUnit = (): ProjectionDefinition<'test/cut', number> => ({
  key: 'test/cut',
  stateSchema: z.number().int().nonnegative(),
  init: (_header, inheritedEventCount) => inheritedEventCount,
  apply: state => state,
  stateVersion: 1,
})

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  return { ctx, session: ctx.sessions.create() }
}

const mark = (session: Session, marks: string[]): SessionEvent =>
  session.append('test/mark', { marks })

function nativeService<K extends keyof NativeServices>(key: K, value: NativeServices[K]): NativePlugin {
  return {
    apiVersion: 1,
    name: `native-projection-test-${key}`,
    targets: ['host'],
    requires: [],
    provides: [key],
    resolve: () => (context) => {
      context.provide(key, value)
    },
  }
}

type NativeActiveSessionObserver = Parameters<NativeActiveSessionOperations['onAttached']>[0]

function nativeHost(
  active: NativeServices['activeSessions'],
  config?: unknown,
  plugins: readonly NativePlugin[] = [],
): NativeHost {
  const scope = new NativeScope()
  return new NativeHost(resolveInstallation([
    { plugin: nativeService('activeSessions', active), scope, config: undefined },
    { plugin: nativeProjectionPlugin, scope, config },
    ...plugins.map(plugin => ({ plugin, scope, config: undefined })),
  ], 'host'))
}

const STATE_SEQUENCES = [
  [0, 0, 0, 0],
  [0, 0, 0, 1],
  [0, 0, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 1, 2],
  [0, 1, 0, 0],
  [0, 1, 0, 1],
  [0, 1, 0, 2],
  [0, 1, 1, 0],
  [0, 1, 1, 1],
  [0, 1, 1, 2],
  [0, 1, 2, 0],
  [0, 1, 2, 1],
  [0, 1, 2, 2],
  [0, 1, 2, 3],
] as const

function identitySequences(length: number): number[][] {
  const sequences: number[][] = []
  const visit = (sequence: number[], highest: number): void => {
    if (sequence.length === length) {
      sequences.push(sequence)
      return
    }
    for (let value = 0; value <= highest + 1; value++) {
      visit([...sequence, value], Math.max(highest, value))
    }
  }
  visit([0], 0)
  return sequences
}

function sameIdentities(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

function sequenceName(sequence: readonly number[], prefix: string): string {
  return sequence.map(value => `${prefix}${String(value + 1)}`).join(',')
}

describe('SessionProjectionRegistry drive', () => {
  it('supplies the exact inherited cut to live, restored, and hydrated projection initialization', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(cutUnit())
    const inherited: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const session = ctx.sessions.create(SessionId('projection-cut'), {
      seed: inherited,
      inheritedEventCount: SessionLogOffset(inherited.length),
      meta: { isSeeded: true },
    })

    expect(ctx.sessionProjections.stateOf(session, 'test/cut')).toBe(inherited.length)
    const restored = ctx.sessionProjections.restore(
      {},
      inherited,
      SessionLogOffset(0),
      session.header,
      session.inheritedEventCount,
    )
    expect(restored.checkpoint['test/cut']?.val).toBe(inherited.length)
    const prepared = Session.create(
      SessionId('projection-cut-prepared'),
      inherited,
      { ...session.header, id: SessionId('projection-cut-prepared') },
      session.inheritedEventCount,
    )
    expect(ctx.sessionProjections.hydrate(
      prepared,
      {},
      inherited,
      SessionLogOffset(0),
    ).asOfSeq).toBe(1)
    expect(ctx.sessionProjections.stateOf(prepared, 'test/cut')).toBe(inherited.length)
  })

  it('drives a registered unit over committed events and snapshots the current value', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    mark(session, ['a'])
    mark(session, ['a', 'b'])
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values['test/marks']).toEqual({ marks: ['a', 'b'] })
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
  })

  it('builds the cell lazily from the full log for a unit registered after events flowed', async () => {
    const { ctx, session } = await harness()
    mark(session, ['pre-registration'])
    ctx.sessionProjections.register(marksUnit())
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['pre-registration'] })
    // The lazily-built cell then continues on the live drive path.
    mark(session, ['after'])
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['after'] })
  })

  it('serves init-derived state and asOfSeq -1 for an empty log', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.asOfSeq).toBe(-1)
    expect(snapshot.values['test/marks']).toEqual({ marks: [] })
  })

  it('reads only materialized wire cells at their lowest common cached cut', async () => {
    const core = new ProjectionRegistryCore()
    const session = NativeSession.create(NativeSessionId('projection-cached-cut'))
    const marks = marksUnit()
    const applyMarks = vi.fn(marks.apply)
    core.register({ ...marks, apply: applyMarks })
    const stable = stableViewUnit(state => state.value)
    const failure = new Error('projection apply failed')
    let failOnce = true
    const applyStable = vi.fn((state: StableViewState, event: SessionEvent) => {
      if (failOnce) {
        failOnce = false
        throw failure
      }
      return stable.apply(state, event)
    })
    core.register({ ...stable, apply: applyStable })
    const keys = ['test/marks', 'test/stable-view'] as const
    expect(core.cachedSnapshot(session, keys)).toBeUndefined()

    const event = mark(session, ['cached'])
    expect(() => {
      core.driveEvent(session, event)
    }).toThrow(failure)
    expect(core.cachedSnapshot(session, keys)).toEqual({
      asOfSeq: -1,
      values: {
        'test/marks': { marks: ['cached'] },
        'test/stable-view': { marks: [] },
      },
    })
    expect(core.cachedSnapshot(session, ['test/marks'])).toEqual({
      asOfSeq: event.seq,
      values: { 'test/marks': { marks: ['cached'] } },
    })

    const current = core.snapshot(session, keys)
    expect(current).toEqual({
      asOfSeq: event.seq,
      values: {
        'test/marks': { marks: ['cached'] },
        'test/stable-view': { marks: ['cached'] },
      },
    })
    const applyCounts = [applyMarks.mock.calls.length, applyStable.mock.calls.length]
    expect(core.hydrate(session, {}, [event], SessionLogOffset(0))).toEqual(current)
    expect([applyMarks.mock.calls.length, applyStable.mock.calls.length]).toEqual(applyCounts)

    const newer = mark(session, ['live'])
    core.driveEvent(session, newer)
    expect(core.cachedSnapshot(session, keys)).toEqual({
      asOfSeq: newer.seq,
      values: {
        'test/marks': { marks: ['live'] },
        'test/stable-view': { marks: ['live'] },
      },
    })
    expect(core.hydrate(session, {
      'test/marks': { ver: 1, seq: event.seq, val: { marks: ['cached'] } },
    }, [event], SessionLogOffset(0)).asOfSeq).toBe(event.seq)
    expect(core.cachedSnapshot(session, keys)).toEqual({
      asOfSeq: newer.seq,
      values: {
        'test/marks': { marks: ['live'] },
        'test/stable-view': { marks: ['live'] },
      },
    })

  })

  it('notifies onChanged with the validated view and the causing seq, and skips same-reference applies', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    const seen: { key: string; value: unknown; seq: SessionSeq; sessionId: string }[] = []
    ctx.sessionProjections.onChanged((changedSession, key, value, seq) => {
      seen.push({ key, value, seq, sessionId: String(changedSession.id) })
    })
    const event = mark(session, ['a'])
    // Non-matching event: apply returns the same reference — no notification.
    session.append('turn/start', { turn: 1 })
    expect(seen).toEqual([{ key: 'test/marks', value: { marks: ['a'] }, seq: event.seq, sessionId: String(session.id) }])
  })

  it('reports a throwing subscriber and continues later listeners and registered units', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(stableViewUnit(state => state.value))
    ctx.sessionProjections.register(countUnit())
    const changed: string[] = []
    const failure = new Error('subscriber failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    ctx.sessionProjections.onChanged(() => { throw failure })
    ctx.sessionProjections.onChanged((_session, key) => { changed.push(key) })

    try {
      mark(session, ['observed'])
      expect(changed).toEqual(['test/marks', 'test/stable-view'])
      expect(ctx.sessionProjections.stateOf(session, 'test/count')).toBe(1)
      expect(report).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledWith('session-projection: change listener failed for "test/marks"', failure)
      expect(report).toHaveBeenCalledWith('session-projection: change listener failed for "test/stable-view"', failure)
    } finally {
      report.mockRestore()
    }
  })

  it('does not compute a view while no change listener exists', async () => {
    const { ctx, session } = await harness()
    const view = vi.fn((state: StableViewState) => state.value)
    ctx.sessionProjections.register(stableViewUnit(view))

    session.append('turn/start', { turn: 1 })
    session.append('turn/start', { turn: 2 })

    expect(ctx.sessionProjections.stateOf(session, 'test/stable-view')?.revision).toBe(2)
    expect(view).not.toHaveBeenCalled()
  })

  it('publishes the first observed view and suppresses later same-reference views', async () => {
    const { ctx, session } = await harness()
    const view = vi.fn((state: StableViewState) => state.value)
    ctx.sessionProjections.register(stableViewUnit(view))

    const seen: unknown[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'test/stable-view') seen.push(value)
    })

    session.append('turn/start', { turn: 1 })
    session.append('turn/start', { turn: 2 })

    expect(seen).toEqual([{ marks: [] }])
    expect(view).toHaveBeenCalledTimes(2)

    mark(session, ['changed'])
    expect(seen).toEqual([{ marks: [] }, { marks: ['changed'] }])
    expect(view).toHaveBeenCalledTimes(3)
  })

  it('publishes the first view after an unobserved state change', async () => {
    const { ctx, session } = await harness()
    const view = vi.fn((state: StableViewState) => state.value)
    ctx.sessionProjections.register(stableViewUnit(view))
    const first: unknown[] = []
    const stop = ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'test/stable-view') first.push(value)
    })

    session.append('turn/start', { turn: 1 })
    stop()
    session.append('turn/start', { turn: 2 })
    expect(view).toHaveBeenCalledTimes(1)

    const resumed: unknown[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'test/stable-view') resumed.push(value)
    })
    session.append('turn/start', { turn: 3 })

    expect(first).toEqual([{ marks: [] }])
    expect(resumed).toEqual([{ marks: [] }])
    expect(view).toHaveBeenCalledTimes(2)
  })

  it('matches every four-state identity sequence across listener gaps and raw-view identities', async () => {
    const { ctx } = await harness()
    const initialState: MarksState = { marks: ['initial'] }
    const stateByEvent = new Map<string, MarksState>()
    const viewByState = new Map<MarksState, MarksView>()
    const computedViews: MarksView[] = []
    ctx.sessionProjections.register({
      key: 'test/marks',
      stateSchema: marksViewSchema.nullable(),
      init: () => initialState,
      apply: (state, event) => {
        if (event.type !== 'test/mark') return state
        const token = event.data.marks[0]
        if (token === undefined || !stateByEvent.has(token)) return state
        return stateByEvent.get(token) as MarksState
      },
      wire: {
        viewSchema: marksViewSchema,
        view: (state) => {
          const value = viewByState.get(state)
          if (value === undefined) throw new Error('test state lacks a raw view')
          computedViews.push(value)
          return value
        },
      },
      stateVersion: 1,
    })

    const failures = new Map<string, unknown>()
    let mismatchCount = 0
    let checked = 0
    for (const stateSequence of STATE_SEQUENCES) {
      const stateCount = Math.max(...stateSequence) + 1
      for (const viewSequence of identitySequences(stateCount)) {
        for (const baselineKnown of [false, true]) {
          for (let listenerMask = 0; listenerMask < 8; listenerMask++) {
            const scenario = String(checked++)
            const states = Array.from(
              { length: stateCount },
              (_, index): MarksState => ({ marks: [`state-${scenario}-${String(index)}`] }),
            )
            const views = Array.from(
              { length: Math.max(...viewSequence) + 1 },
              (): MarksView => ({ marks: [] }),
            )
            for (let index = 0; index < stateCount; index++) {
              viewByState.set(states[index] as MarksState, views[viewSequence[index] as number] as MarksView)
            }
            for (let index = 0; index < stateSequence.length; index++) {
              stateByEvent.set(`${scenario}:${String(index)}`, states[stateSequence[index] as number] as MarksState)
            }

            const session = ctx.sessions.create()
            const notifications: number[] = []
            let stop: (() => void) | undefined
            const setListening = (listening: boolean): void => {
              if (listening && stop === undefined) {
                stop = ctx.sessionProjections.onChanged((changedSession, key, _value, seq) => {
                  if (changedSession === session && key === 'test/marks') notifications.push(seq)
                })
              } else if (!listening && stop !== undefined) {
                stop()
                stop = undefined
              }
            }

            setListening(baselineKnown)
            mark(session, [`${scenario}:0`])
            computedViews.length = 0
            notifications.length = 0

            const expectedViews: MarksView[] = []
            const expectedNotifications: number[] = []
            let comparable = baselineKnown
              ? views[viewSequence[stateSequence[0] as number] as number] as MarksView
              : undefined
            for (let index = 1; index < stateSequence.length; index++) {
              const listening = (listenerMask & (1 << (index - 1))) !== 0
              setListening(listening)
              const changed = stateSequence[index] !== stateSequence[index - 1]
              if (changed) {
                if (listening) {
                  const current = views[viewSequence[stateSequence[index] as number] as number] as MarksView
                  expectedViews.push(current)
                  if (comparable === undefined || !Object.is(comparable, current)) {
                    expectedNotifications.push(index)
                  }
                  comparable = current
                } else {
                  comparable = undefined
                }
              }
              mark(session, [`${scenario}:${String(index)}`])
            }
            setListening(false)

            if (!sameIdentities(computedViews, expectedViews)
              || notifications.length !== expectedNotifications.length
              || notifications.some((seq, index) => seq !== expectedNotifications[index])) {
              mismatchCount += 1
              const stateName = sequenceName(stateSequence, 'v')
              if (!failures.has(stateName) || (baselineKnown && listenerMask === 7)) {
                failures.set(stateName, {
                  state: stateName,
                  view: stateSequence.map(value => `r${String((viewSequence[value] as number) + 1)}`).join(','),
                  baseline: baselineKnown ? 'known' : 'unknown',
                  listeners: [0, 1, 2]
                    .map(index => (listenerMask & (1 << index)) === 0 ? 'off' : 'on')
                    .join(','),
                  expectedViewCalls: expectedViews.length,
                  actualViewCalls: computedViews.length,
                  expectedNotifications,
                  actualNotifications: [...notifications],
                })
              }
            }
            computedViews.length = 0
          }
        }
      }
    }

    expect({ checked, mismatchCount, failures: [...failures.values()] }).toEqual({
      checked: 960,
      mismatchCount: 0,
      failures: [],
    })
  })

  it('drives independently per session (cells are per-session watermarks)', async () => {
    const { ctx, session } = await harness()
    const other = ctx.sessions.create()
    ctx.sessionProjections.register(marksUnit())
    mark(session, ['one'])
    mark(other, ['two'])
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['one'] })
    expect(ctx.sessionProjections.snapshot(other).values['test/marks']).toEqual({ marks: ['two'] })
  })

  it('updates host-only units without publishing them to wire listeners', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    const changedKeys: string[] = []
    ctx.sessionProjections.onChanged((_session, key) => {
      changedKeys.push(key)
    })
    session.append('turn/start', { turn: 1 })
    expect(changedKeys).toEqual([])
    expect(ctx.sessionProjections.stateOf(session, 'test/count')).toBe(1)
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({ 'test/marks': { marks: [] } })
  })

  it('shares one unit between registrants of the same key', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())

    // One definition already serves every session (cells are keyed by
    // Session), and registrants are per-session now: an agent preset mounts
    // the same tool package once per agent.
    expect(() => ctx.sessionProjections.register(marksUnit())).not.toThrow()
    mark(session, ['kept'])
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['kept'] })
  })

  it('keeps the unit until the last registrant releases it', async () => {
    const { ctx, session } = await harness()
    const first = ctx.sessionProjections.register(marksUnit())
    const second = ctx.sessionProjections.register(marksUnit())
    mark(session, ['kept'])

    first()
    first()

    // The regression this counts against: without last-release semantics, one
    // session ending strips the projection from every other live session,
    // because the first registrant owns the only disposer.
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['kept'] })
    second()
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({})

    const core = new ProjectionRegistryCore()
    const oldDispose = core.register(marksUnit())
    core.clear()
    const currentDispose = core.register(marksUnit())
    oldDispose()
    const replacement = NativeSession.create(NativeSessionId('projection-disposer-incarnation'))
    mark(replacement, ['current'])
    expect(core.snapshot(replacement).values['test/marks']).toEqual({ marks: ['current'] })
    currentDispose()
    expect(core.snapshot(replacement).values).toEqual({})

    const nativeRegistry = new NativeSessionProjectionRegistry()
    const nativeFirst = nativeRegistry.register(marksUnit())
    const nativeSecond = nativeRegistry.register(marksUnit())
    const nativeSession = NativeSession.create(NativeSessionId('projection-native-repeated-disposer'))
    nativeSession.append('test/mark', { marks: ['shared'] })
    nativeFirst()
    nativeFirst()
    expect(nativeRegistry.snapshot(nativeSession).values['test/marks']).toEqual({ marks: ['shared'] })
    nativeSecond()
    expect(nativeRegistry.snapshot(nativeSession).values).toEqual({})
  })

  it('refuses to share a key across a stateVersion change', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())

    // The one incompatibility a runtime comparison can name: the versioned
    // contract says the cached state shape differs, so the two cannot share
    // cells. Everything else about a definition is functions.
    expect(() => ctx.sessionProjections.register({ ...marksUnit(), stateVersion: 9 }))
      .toThrow(/already registered at stateVersion 1; refusing to share it with stateVersion 9/)
  })

  it('rejects a non-integer or negative stateVersion at register time', async () => {
    const { ctx } = await harness()
    expect(() => ctx.sessionProjections.register({ ...marksUnit(), stateVersion: -1 })).toThrow(/stateVersion/)
    expect(() => ctx.sessionProjections.register({ ...marksUnit(), stateVersion: 1.5 })).toThrow(/stateVersion/)
  })

  it('register() disposer removes the key (with its cells) and frees it for re-registration', async () => {
    const { ctx, session } = await harness()
    const dispose = ctx.sessionProjections.register(marksUnit())
    mark(session, ['cached'])
    dispose()
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({})
    ctx.sessionProjections.register(marksUnit())
    // Fresh registration rebuilds from the log, not from a stale cell.
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['cached'] })
  })

  it('removes registrations and change listeners when their owning fiber unloads (HMR safety)', async () => {
    const { ctx, session } = await harness()
    const notifications: string[] = []
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.sessionProjections.register(marksUnit())
      inner.sessionProjections.onChanged((_session, key) => {
        notifications.push(key)
      })
    }, { inject: ['sessionProjections'] }))
    mark(session, ['live'])
    expect(notifications).toEqual(['test/marks'])
    await fiber.dispose()
    mark(session, ['after-dispose'])
    expect(notifications).toEqual(['test/marks'])
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({})
  })

  it('snapshot serves client views and excludes host-only state', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    mark(session, ['a', 'b'])
    const values = ctx.sessionProjections.snapshot(session).values
    expect(values['test/marks']).toEqual({ marks: ['a', 'b'] })
    expect('test/count' in values).toBe(false)
    expect(ctx.sessionProjections.stateOf(session, 'test/count')).toBe(1)
    expect('test/unregistered' in values).toBe(false)
  })

  it('checkpoints every persisted unit with its stateVersion and per-cell watermark', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register({ ...countUnit(), stateVersion: 7 })
    const markEvent = mark(session, ['a'])
    const rows = ctx.sessionProjections.checkpoint(session)
    expect(rows['test/marks']).toEqual({ ver: 1, seq: markEvent.seq, val: { marks: ['a'] } })
    expect(rows['test/count']).toEqual({ ver: 7, seq: markEvent.seq, val: 1 })
    // Empty log: init-derived state at watermark -1.
    const fresh = ctx.sessions.create()
    expect(ctx.sessionProjections.checkpoint(fresh)['test/marks']).toEqual({ ver: 1, seq: -1, val: null })
  })

  it('checkpoint states are detached clones — mutating them cannot corrupt the watermark cache', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(marksUnit())
    mark(session, ['a'])
    const rows = ctx.sessionProjections.checkpoint(session)
    // Hostile (or merely careless) consumer mutates the handed-out state.
    ;(rows['test/marks']?.val as { marks: string[] }).marks.push('INJECTED')
    // The registry's authoritative cell is untouched: snapshot and a fresh
    // checkpoint both still serve the committed value.
    expect(ctx.sessionProjections.snapshot(session).values['test/marks']).toEqual({ marks: ['a'] })
    expect(ctx.sessionProjections.checkpoint(session)['test/marks']?.val).toEqual({ marks: ['a'] })

    const core = new ProjectionRegistryCore()
    core.register(marksUnit())
    const hydrated = core.hydrateWithCheckpoint(session, {
      'test/marks': { ver: 1, seq: SessionSeq(0), val: { marks: ['a'] } },
    }, [], SessionLogOffset(1))
    ;(hydrated.checkpoint['test/marks']?.val as { marks: string[] }).marks.push('INJECTED')
    expect(core.stateOf(session, 'test/marks')).toEqual({ marks: ['a'] })
  })

  it('restoreFloor anchors one below the lowest usable watermark and at 0 for missing or mismatched rows', async () => {
    const { ctx } = await harness()
    expect(ctx.sessionProjections.restoreFloor({})).toBeUndefined() // no unit registered
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    expect(ctx.sessionProjections.restoreFloor({})).toBe(0)
    // Lowest usable watermark is count's 5 → the anchored tail starts AT 5
    // (one below the first needed seq 6), so the read proves seq 5 still exists.
    expect(ctx.sessionProjections.restoreFloor({
      'test/marks': { ver: 1, seq: SessionSeq(10), val: { marks: [] } },
      'test/count': { ver: 1, seq: SessionSeq(5), val: 6 },
    })).toBe(5)
    // A version-mismatched row forces that key back to a full refold.
    expect(ctx.sessionProjections.restoreFloor({
      'test/marks': { ver: 2, seq: SessionSeq(10), val: { marks: [] } },
      'test/count': { ver: 1, seq: SessionSeq(5), val: 6 },
    })).toBe(0)
    // A fresh (-1) row still needs the whole tail from 0.
    expect(ctx.sessionProjections.restoreFloor({
      'test/marks': { ver: 1, seq: -1, val: null },
      'test/count': { ver: 1, seq: -1, val: 0 },
    })).toBe(0)
  })

  it('restore folds the tail past each usable row and refolds from init on version mismatch', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    const tail: SessionEvent[] = [
      { type: 'test/mark', seq: SessionSeq(3), time: 3, data: { marks: ['new'] } },
      { type: 'turn/end', seq: SessionSeq(4), time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(() => ctx.sessionProjections.restore({
      'test/marks': { ver: 1, seq: SessionSeq(2), val: { marks: ['old', '2'] } },
      'test/count': { ver: 1, seq: SessionSeq(2), val: 3 },
    }, [tail[1]!], SessionLogOffset(3), RESTORE_HEADER, SessionLogOffset(0)))
      .toThrow(/cannot restore across missing seq 3/)
    // marks row usable (watermark 2, tail starts at 3); count row mismatched — but
    // a mismatch with baseSeq > 0 cannot silently refold: it throws for a re-read.
    expect(() => ctx.sessionProjections.restore({
      'test/marks': { ver: 1, seq: SessionSeq(2), val: { marks: ['old'] } },
      'test/count': { ver: 99, seq: SessionSeq(2), val: 3 },
    }, tail, SessionLogOffset(3), RESTORE_HEADER, SessionLogOffset(0)))
      .toThrow(/re-read from seq 0/)
    // The full-log re-read (baseSeq 0) refolds the mismatched key from init.
    const full: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
      { type: 'test/mark', seq: SessionSeq(1), time: 1, data: { marks: ['old'] } },
      { type: 'test/mark', seq: SessionSeq(2), time: 2, data: { marks: ['old', '2'] } },
      ...tail,
    ]
    const { snapshot, checkpoint } = ctx.sessionProjections.restore({
      'test/marks': { ver: 1, seq: SessionSeq(2), val: { marks: ['old', '2'] } },
      'test/count': { ver: 99, seq: SessionSeq(2), val: 3 },
    }, full, SessionLogOffset(0), RESTORE_HEADER, SessionLogOffset(0))
    expect(snapshot.asOfSeq).toBe(4)
    expect(snapshot.values['test/marks']).toEqual({ marks: ['new'] })
    expect('test/count' in snapshot.values).toBe(false)
    // The refreshed rows sit at the served cut, ready for a durable write-back.
    expect(checkpoint['test/marks']).toEqual({ ver: 1, seq: 4, val: { marks: ['new'] } })
    expect(checkpoint['test/count']).toEqual({ ver: 1, seq: 4, val: 5 })
  })

  it('restore over a suffix folds only past each row watermark and serves an exact empty-tail cut', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    const rows = {
      'test/marks': { ver: 1, seq: SessionSeq(4), val: { marks: ['done'] } },
      'test/count': { ver: 1, seq: SessionSeq(2), val: 3 },
    }
    const tail: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(3), time: 3, data: { turn: 2 } },
      { type: 'turn/end', seq: SessionSeq(4), time: 4, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const { snapshot, checkpoint } = ctx.sessionProjections.restore(
      rows,
      tail,
      SessionLogOffset(3),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )
    expect(snapshot.asOfSeq).toBe(4)
    // marks already covers the tail (watermark 4): nothing re-applied.
    expect(snapshot.values['test/marks']).toEqual({ marks: ['done'] })
    // count folds exactly seqs 3 and 4 on top of its checkpoint, but remains host-only.
    expect(checkpoint['test/count']).toEqual({ ver: 1, seq: 4, val: 5 })
    expect('test/count' in snapshot.values).toBe(false)

    // Empty tail (checkpoint is current): the cut sits at baseSeq - 1.
    const { snapshot: current, checkpoint: currentCheckpoint } = ctx.sessionProjections.restore({
      'test/marks': { ver: 1, seq: SessionSeq(4), val: { marks: ['done'] } },
      'test/count': { ver: 1, seq: SessionSeq(4), val: 5 },
    }, [], SessionLogOffset(5), RESTORE_HEADER, SessionLogOffset(0))
    expect(current.asOfSeq).toBe(4)
    expect('test/count' in current.values).toBe(false)
    expect(currentCheckpoint['test/count']).toEqual({ ver: 1, seq: 4, val: 5 })
  })

  it('viewCheckpoint serves version-matching rows without any log and skips mismatched keys', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    const rows = {
      'test/marks': { ver: 1, seq: SessionSeq(4), val: { marks: ['stored'] } },
      'test/count': { ver: 99, seq: SessionSeq(4), val: 5 }, // mismatched: absent
    }
    const values = ctx.sessionProjections.viewCheckpoint(rows)
    expect(values['test/marks']).toEqual({ marks: ['stored'] })
    expect('test/count' in values).toBe(false)
    expect(ctx.sessionProjections.viewCheckpoint(rows, [])).toEqual({})
    expect(ctx.sessionProjections.viewCheckpoint({})).toEqual({})
  })

  it('viewCheckpoint and restore exclude host-only state while retaining its checkpoint', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())
    ctx.sessionProjections.register(countUnit())
    const rows = {
      'test/marks': { ver: 1, seq: SessionSeq(4), val: { marks: ['stored'] } },
      'test/count': { ver: 1, seq: SessionSeq(4), val: 5 },
    }
    expect(ctx.sessionProjections.viewCheckpoint(rows)).toEqual({
      'test/marks': { marks: ['stored'] },
    })

    const restored = ctx.sessionProjections.restore(
      rows,
      [],
      SessionLogOffset(5),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )
    expect(restored.snapshot.values).toEqual({
      'test/marks': { marks: ['stored'] },
    })
    expect(restored.checkpoint['test/count']).toEqual(rows['test/count'])
  })

  it('rejects version-matching rows whose state no longer matches the registered schema', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(marksUnit())
    const drifted = {
      'test/marks': { ver: 1, seq: SessionSeq(2), val: { marks: 'not-an-array' } },
    }

    expect(ctx.sessionProjections.viewCheckpoint(drifted)).toEqual({})
    expect(() => ctx.sessionProjections.restore(
      drifted,
      [],
      SessionLogOffset(3),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )).toThrow()
  })

  it('restore rejects a row claiming events past the supplied log end (shrunk log ⇒ re-read)', async () => {
    const { ctx } = await harness()
    ctx.sessionProjections.register(countUnit())
    const rows = { 'test/count': { ver: 1, seq: SessionSeq(9), val: 10 } }
    // The anchored floor sits ON the watermark, so the tail read must return
    // at least seq 9 from an intact log…
    const floor = ctx.sessionProjections.restoreFloor(rows)
    expect(floor).toBe(9)
    // …an intact log serves the anchor event and the checkpoint stands as-is.
    const anchor: SessionEvent = { type: 'turn/end', seq: SessionSeq(9), time: 9, data: { turn: 2, reason: { kind: 'completed' } } }
    const anchored = ctx.sessionProjections.restore(
      rows,
      [anchor],
      SessionLogOffset(9),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )
    expect(anchored.snapshot.values).toEqual({})
    expect(anchored.checkpoint['test/count']).toEqual({ ver: 1, seq: 9, val: 10 })
    // …while a log crash-repaired down to fewer events returns an empty tail:
    // the row overreaches the proven end and a tail read cannot fix this key.
    expect(() => ctx.sessionProjections.restore(
      rows,
      [],
      SessionLogOffset(9),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )).toThrow(/re-read from seq 0/)
    // The full re-read discards the overreaching row and refolds from init.
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(1), time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const { snapshot, checkpoint } = ctx.sessionProjections.restore(
      rows,
      events,
      SessionLogOffset(0),
      RESTORE_HEADER,
      SessionLogOffset(0),
    )
    expect(snapshot.asOfSeq).toBe(1)
    expect(snapshot.values).toEqual({})
    expect(checkpoint['test/count']).toEqual({ ver: 1, seq: 1, val: 2 })
  })

  it('fails loud when a unit view violates its own schema (async unit output is unrepresentable)', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register({
      key: 'test/marks',
      stateSchema: z.object({ marks: z.array(z.string()) }).nullable(),
      init: () => null as MarksState,
      apply: state => state,
      wire: {
        viewSchema: z.object({ marks: z.array(z.string()) }),
        // A Promise (what an accidentally-async view would return) is not the
        // declared shape: the boundary parse rejects it before it leaves.
        view: () => Promise.resolve({ marks: [] }) as never,
      },
      stateVersion: 1,
    })
    expect(() => ctx.sessionProjections.snapshot(session)).toThrow()
  })
})

describe('Native SessionProjectionRegistry lifecycle', () => {
  it('restores cuts and attaches active owners without duplicate projection work', () => {
    const registry = new NativeSessionProjectionRegistry()
    registry.register(marksUnit())
    registry.register(countUnit())

    const coldSession = NativeSession.create(NativeSessionId('projection-cold-observation'))
    const coldEvent = coldSession.append('test/mark', { marks: ['cold'] })
    const detached = registry.observe({
      header: coldSession.header,
      inheritedEventCount: coldSession.inheritedEventCount,
      checkpoint: {},
      events: [coldEvent],
      baseSeq: SessionLogOffset(0),
    })
    expect(detached.asOfSeq).toBe(coldEvent.seq)
    expect(detached.values['test/marks']).toEqual({ marks: ['cold'] })
    expect(detached.stateOf('test/count')).toBe(1)
    expect(detached.stateOf('test/cut')).toBeUndefined()
    const coldState = detached.stateOf('test/marks')
    if (coldState === null || coldState === undefined) throw new Error('missing restored projection state')
    coldState.marks.push('caller mutation')
    expect(detached.stateOf('test/marks')).toEqual({ marks: ['cold'] })

    const session = NativeSession.create(NativeSessionId('projection-resident-observation'))
    const event = session.append('test/mark', { marks: ['resident'] })
    const resident = registry.observe({
      session,
      header: session.header,
      inheritedEventCount: session.inheritedEventCount,
      checkpoint: {},
      events: [event],
      baseSeq: SessionLogOffset(0),
    })
    expect(resident.asOfSeq).toBe(event.seq)
    expect(resident.values['test/marks']).toEqual({ marks: ['resident'] })
    expect(registry.stateOf(session, 'test/count')).toBe(1)
    const residentState = resident.stateOf('test/marks')
    if (residentState === null || residentState === undefined) throw new Error('missing hydrated projection state')
    residentState.marks.push('caller mutation')
    expect(resident.stateOf('test/marks')).toEqual({ marks: ['resident'] })

    const emptySession = NativeSession.create(NativeSessionId('projection-empty-attached-cut'))
    const emptyCheckpoint = {
      'test/marks': { ver: 1, seq: -1 as const, val: { marks: ['restored'] } },
      'test/count': { ver: 1, seq: -1 as const, val: 41 },
    }
    const emptyCut = registry.hydrate(emptySession, emptyCheckpoint, [], SessionLogOffset(0))
    expect(emptyCut).toEqual({
      asOfSeq: -1,
      values: { 'test/marks': { marks: ['restored'] } },
    })
    expect(registry.hydrate(emptySession, emptyCheckpoint, [], SessionLogOffset(0))).toEqual(emptyCut)
    expect(registry.snapshot(emptySession)).toEqual(emptyCut)
    expect(registry.snapshot(emptySession, [])).toEqual({ asOfSeq: -1, values: {} })
    expect(registry.cachedSnapshot(emptySession)).toEqual(emptyCut)
    expect(registry.cachedSnapshot(emptySession, [])).toBeUndefined()
    expect(registry.viewCheckpoint({}, ['test/marks'])).toEqual({})
    expect(registry.viewCheckpoint({}, [])).toEqual({})
    let publishEmpty: ((event: SessionEvent) => void) | undefined
    const emptyOwner = {
      session: emptySession,
      onEvent(observer: (event: SessionEvent) => void) {
        publishEmpty = observer
        return () => { publishEmpty = undefined }
      },
    } as unknown as NativeActiveSessionOwner
    registry.attach(emptyOwner)
    // Attach must retain the prepared cells instead of reseeding them.
    expect(registry.stateOf(emptySession, 'test/count')).toBe(41)
    const attachedEvent = emptySession.append('test/mark', { marks: ['attached'] })
    if (publishEmpty === undefined) throw new Error('missing attached owner event observer')
    publishEmpty(attachedEvent)
    expect(registry.stateOf(emptySession, 'test/count')).toBe(42)
    publishEmpty(attachedEvent)
    expect(registry.stateOf(emptySession, 'test/count')).toBe(42)
    registry.detach(emptyOwner)

    const lateSession = NativeSession.create(NativeSessionId('projection-late-attached-history'))
    lateSession.append('turn/start', { turn: 1 })
    lateSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const lateUnit = countUnit()
    const lateInit = vi.fn((header: SessionHeader, inheritedEventCount: SessionLogOffset) =>
      lateUnit.init(header, inheritedEventCount))
    const lateApply = vi.fn((state: number, event: SessionEvent) => lateUnit.apply(state, event))
    const lateRegistry = new NativeSessionProjectionRegistry()
    lateRegistry.register({ ...lateUnit, init: lateInit, apply: lateApply })
    let publishLate: ((event: SessionEvent) => void) | undefined
    const lateOwner = {
      session: lateSession,
      onEvent(observer: (event: SessionEvent) => void) {
        publishLate = observer
        return () => { publishLate = undefined }
      },
    } as unknown as NativeActiveSessionOwner
    lateRegistry.attach(lateOwner)
    expect(lateInit).not.toHaveBeenCalled()
    expect(lateApply).not.toHaveBeenCalled()
    const lateEvent = lateSession.append('turn/start', { turn: 2 })
    if (publishLate === undefined) throw new Error('missing late owner event observer')
    publishLate(lateEvent)
    expect(lateInit).toHaveBeenCalledOnce()
    expect(lateApply).toHaveBeenCalledTimes(3)
    expect(lateRegistry.stateOf(lateSession, 'test/count')).toBe(3)
    publishLate(lateEvent)
    expect(lateApply).toHaveBeenCalledTimes(3)
    lateRegistry.detach(lateOwner)
  })

  it('attempts every owner listener release and clears projection state after a synchronous disposer failure', () => {
    const registry = new NativeSessionProjectionRegistry()
    const firstSession = NativeSession.create(NativeSessionId('projection-dispose-first'))
    const secondSession = NativeSession.create(NativeSessionId('projection-dispose-second'))
    const firstListeners = new Set<(event: SessionEvent) => void>()
    const secondListeners = new Set<(event: SessionEvent) => void>()
    const firstFailure = new Error('first owner listener removal failed')
    const releaseFirst = vi.fn(() => { throw firstFailure })
    const releaseSecond = vi.fn()
    const owner = (session: NativeSession, listeners: Set<(event: SessionEvent) => void>, release: () => void) => ({
      session,
      onEvent(observer: (event: SessionEvent) => void) {
        listeners.add(observer)
        return () => {
          listeners.delete(observer)
          release()
        }
      },
    }) as unknown as NativeActiveSessionOwner
    registry.register(marksUnit())
    registry.attach(owner(firstSession, firstListeners, releaseFirst))
    registry.attach(owner(secondSession, secondListeners, releaseSecond))

    let disposeFailure: unknown
    try {
      registry.dispose()
    } catch (failure: unknown) {
      disposeFailure = failure
    }

    expect(disposeFailure).toBeInstanceOf(AggregateError)
    if (!(disposeFailure instanceof AggregateError)) throw new Error('missing projection registry disposal aggregate')
    expect(disposeFailure.errors).toEqual([firstFailure])
    expect(releaseFirst).toHaveBeenCalledOnce()
    expect(releaseSecond).toHaveBeenCalledOnce()
    expect(firstListeners.size).toBe(0)
    expect(secondListeners.size).toBe(0)
    expect(registry.checkpoint(firstSession)).toEqual({})
    expect(registry.checkpoint(secondSession)).toEqual({})
  })
})

describe('Native session-projection configuration', () => {
  it.each([
    { name: 'null', config: null },
    { name: 'array', config: [] },
    { name: 'primitive', config: 'configured' },
    { name: 'non-empty object', config: { enabled: true } },
  ])('rejects $name configuration', ({ config }) => {
    expect(() => nativeProjectionPlugin.resolve(config)).toThrow('session-projection: configuration must be empty')
  })
})

describe('Native session-projection Provider lifecycle', () => {
  it.each([
    { name: 'installation rollback', registrationFails: true, cleanupFails: false, attachOwner: false, detachFails: false },
    { name: 'rollback with cleanup failure', registrationFails: true, cleanupFails: true, attachOwner: false, detachFails: false },
    { name: 'Host shutdown', registrationFails: false, cleanupFails: true, attachOwner: true, config: {}, detachFails: false },
    { name: 'failed owner-event removal', registrationFails: false, cleanupFails: false, attachOwner: true, config: {}, detachFails: true },
  ])('releases accepted observers during $name and preserves cleanup failures', async (options) => {
    const { registrationFails, cleanupFails, attachOwner, config, detachFails } = options
    const registrationFailure = new Error('detached observer registration failed')
    const cleanupFailure = new Error('attached observer removal failed')
    const ownerListenerFailure = new Error('active owner listener removal failed')
    const attachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    const detachedObservers = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
    const ownerEvents = new Set<(event: SessionEvent) => void>()
    const ownerSession = NativeSession.create(NativeSessionId('projection-provider-owner'))
    const releaseOwner = vi.fn(() => { throw ownerListenerFailure })
    const owner = {
      session: ownerSession,
      onEvent(observer: (event: SessionEvent) => void) {
        ownerEvents.add(observer)
        return () => {
          if (detachFails) releaseOwner()
          ownerEvents.delete(observer)
          releaseOwner()
        }
      },
    } as unknown as NativeActiveSessionOwner
    let attachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
    let detachedObserver: ((owner: NativeActiveSessionOwner) => Promise<void>) | undefined
    const removeAttached = vi.fn((): Promise<void> => {
      if (attachedObserver !== undefined) attachedObservers.delete(attachedObserver)
      if (cleanupFails) throw cleanupFailure
      return Promise.resolve()
    })
    const removeDetached = vi.fn((): Promise<void> => {
      if (detachedObserver !== undefined) detachedObservers.delete(detachedObserver)
      return Promise.resolve()
    })
    const onAttached: NativeActiveSessionOperations['onAttached'] = vi.fn((observer: NativeActiveSessionObserver) => {
      attachedObserver = observer
      attachedObservers.add(observer)
      return removeAttached
    })
    const onDetached: NativeActiveSessionOperations['onDetached'] = vi.fn((observer: NativeActiveSessionObserver) => {
      if (registrationFails) throw registrationFailure
      detachedObserver = observer
      detachedObservers.add(observer)
      return removeDetached
    })
    const active = {
      owners: () => attachOwner ? [owner] : [],
      onAttached,
      onDetached,
    } as unknown as NativeActiveSessionOperations
    const applied: number[] = []
    const projectionConsumer: NativePlugin = {
      apiVersion: 1,
      name: 'native-projection-test-consumer',
      targets: ['host'],
      requires: ['sessionProjections'],
      provides: [],
      resolve: () => (context) => {
        context.require('sessionProjections').register({
          ...countUnit(),
          apply: (state) => {
            const next = state + 1
            applied.push(next)
            return next
          },
        })
      },
    }
    const host = nativeHost(active, config, detachFails ? [projectionConsumer] : [])
    let startupFailure: unknown
    let shutdownFailure: unknown
    try {
      startupFailure = await host.start().then(() => undefined, (failure: unknown) => failure)
      if (detachFails && startupFailure === undefined) {
        if (attachedObserver === undefined || detachedObserver === undefined) throw new Error('missing active owner observers')
        const publish = (turn: number): void => {
          const event = ownerSession.append('turn/start', { turn })
          for (const listener of ownerEvents) listener(event)
        }

        expect(ownerEvents.size).toBe(1)
        await attachedObserver(owner)
        expect(ownerEvents.size).toBe(1)
        publish(1)
        expect(applied).toEqual([1])
        await expect(detachedObserver(owner)).rejects.toBe(ownerListenerFailure)
        await expect(detachedObserver(owner)).resolves.toBeUndefined()
        expect(ownerEvents.size).toBe(1)
        publish(2)
        expect(applied).toEqual([1])
        await attachedObserver(owner)
        expect(ownerEvents.size).toBe(2)
        // Reattachment folds the committed event published while the owner was detached.
        publish(3)
        expect(applied).toEqual([1, 2, 3])
      }
    } finally {
      shutdownFailure = await host.stop().then(() => undefined, (failure: unknown) => failure)
    }

    expect(removeAttached).toHaveBeenCalledOnce()
    expect(attachedObservers.size).toBe(0)
    if (registrationFails) {
      expect(removeDetached).not.toHaveBeenCalled()
      expect(detachedObservers.size).toBe(0)
      if (attachedObserver !== undefined) await attachedObserver(owner)
      expect(ownerEvents.size).toBe(0)
      expect(releaseOwner).not.toHaveBeenCalled()
      if (cleanupFails) {
        expect(startupFailure).toBeInstanceOf(AggregateError)
        if (!(startupFailure instanceof AggregateError)) throw new Error('missing activation and cleanup aggregate')
        expect(startupFailure.errors).toEqual([registrationFailure, cleanupFailure])
        expect(shutdownFailure).toBe(startupFailure)
      } else {
        expect(startupFailure).toBe(registrationFailure)
        expect(shutdownFailure).toBe(startupFailure)
      }
      return
    }

    expect(startupFailure).toBeUndefined()
    expect(removeDetached).toHaveBeenCalledOnce()
    expect(detachedObservers.size).toBe(0)
    if (detachFails) {
      expect(releaseOwner).toHaveBeenCalledTimes(2)
      expect(ownerEvents.size).toBe(2)
      const terminal = ownerSession.append('turn/start', { turn: 4 })
      for (const listener of ownerEvents) listener(terminal)
      expect(applied).toEqual([1, 2, 3])
    } else {
      expect(releaseOwner).toHaveBeenCalledOnce()
      expect(ownerEvents.size).toBe(0)
    }
    expect(shutdownFailure).toBeInstanceOf(AggregateError)
    if (!(shutdownFailure instanceof AggregateError)) throw new Error('missing Native Host cleanup aggregate')
    expect(shutdownFailure.errors).toHaveLength(1)
    const ownerResourceFailure: unknown = shutdownFailure.errors[0]
    expect(ownerResourceFailure).toBeInstanceOf(AggregateError)
    if (!(ownerResourceFailure instanceof AggregateError)) throw new Error('missing Native resource-owner aggregate')
    expect(ownerResourceFailure.errors).toHaveLength(1)
    const providerFailure: unknown = ownerResourceFailure.errors[0]
    expect(providerFailure).toBeInstanceOf(AggregateError)
    if (!(providerFailure instanceof AggregateError)) throw new Error('missing Native projection cleanup aggregate')
    if (detachFails) {
      expect(providerFailure.errors).toHaveLength(1)
      expect(providerFailure.errors[0]).toBeInstanceOf(AggregateError)
      if (!(providerFailure.errors[0] instanceof AggregateError)) throw new Error('missing active owner cleanup aggregate')
      expect(providerFailure.errors[0].errors).toEqual([ownerListenerFailure])
    } else {
      expect(providerFailure.errors).toHaveLength(2)
      expect(providerFailure.errors[0]).toBe(cleanupFailure)
      expect(providerFailure.errors[1]).toBeInstanceOf(AggregateError)
      if (!(providerFailure.errors[1] instanceof AggregateError)) throw new Error('missing active owner cleanup aggregate')
      expect(providerFailure.errors[1].errors).toEqual([ownerListenerFailure])
    }
  })
})
