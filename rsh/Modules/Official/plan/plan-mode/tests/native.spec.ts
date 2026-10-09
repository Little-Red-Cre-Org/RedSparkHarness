/** Native plan mode through the selected headless Program, the command registry, the question broker, and the durable log. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionsPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { NativeHeadlessApplication, plugin as applicationPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { plugin as commandsPlugin, type NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { plugin as questionsPlugin, UserQuestionError } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as brokerPlugin } from '@deepseek-ai/dsh-user-question-broker/native'
import type { NativeQuestionBroker } from '@deepseek-ai/dsh-user-questions/broker'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { EXIT_APPROVED_TEXT, REVIEW_DISMISSED_MESSAGE } from '../src/common.ts'
import { plugin, type NativePlanMode } from '../src/native.ts'
import { PlanModeSelections, type PlanSessionView } from '../src/selection.ts'

const SECTION = 'Plan-mode guidance for the fixture.'
const PLAN = '# Ship the cache\n\n1. Inspect.\n2. Change.'

vi.setConfig({ testTimeout: 15_000 })

/** Compose native plan mode with the shipped headless Providers, the command registry, and a human question broker. */
async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], dismissAt?: number,
  barrier?: { readonly entered: () => void; readonly wait: () => Promise<void> }, extra: readonly NativePlugin[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-plan-'))
  const scope = new NativeScope()
  const model = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let commands: NativeCommandOperations | undefined
  let broker: NativeQuestionBroker | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let planMode: NativePlanMode | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let asks = 0
  const capture: NativePlugin = {
    apiVersion: 1, name: 'plan-test-capture', targets: ['host'],
    requires: ['application', 'commands', 'userQuestionBroker', 'sessionPersistence', 'planMode', 'activeSessions'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      commands = context.require('commands')
      broker = context.require('userQuestionBroker')
      storage = context.require('sessionPersistence')
      planMode = context.require('planMode')
      activeSessions = context.require('activeSessions')
    },
  }
  const modelProvider: NativePlugin = {
    apiVersion: 1, name: 'plan-test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', model) },
  }
  // The broker never cancels; a human dismissal reaches the tool as ASK_CANCELLED from the answerer chain.
  const dismisser: NativePlugin = {
    apiVersion: 1, name: 'plan-test-dismiss', targets: ['host'], requires: ['userQuestions'], provides: [],
    resolve: () => (context) => {
      context.effect(context.require('userQuestions').registerAnswerer('dismiss', {
        ask: async (_request, next) => {
          asks += 1
          if (asks === dismissAt) throw new UserQuestionError('the human dismissed the review', 'ASK_CANCELLED')
          return await next()
        },
      }, context.scope))
    },
  }
  const admissionBarrierPlugin: NativePlugin = {
    apiVersion: 1, name: 'plan-test-admission-barrier', targets: ['host'], requires: ['activeSessions'], provides: [],
    resolve: () => (context) => {
      const sessions = context.require('activeSessions')
      const releases = new Map<NativeActiveSessionOwner, () => Promise<void>>()
      context.effect(sessions.onAttached(async (owner) => {
        let paused = false
        releases.set(owner, owner.beforeStep(async (_step, next) => {
          const decision = await next()
          if (!paused) {
            paused = true
            barrier?.entered()
            await barrier?.wait()
          }
          return decision
        }, 700))
      }))
      context.effect(sessions.onDetached(async (owner) => {
        await releases.get(owner)?.()
        releases.delete(owner)
      }))
      context.own(async () => {
        await Promise.all([...releases.values()].map(release => release()))
        releases.clear()
      })
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: sessionsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: persistencePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: commandsPlugin, scope, config: undefined }, { plugin: questionsPlugin, scope, config: undefined },
    { plugin: dismisser, scope, config: undefined }, { plugin: brokerPlugin, scope, config: undefined },
    { plugin, scope, config: { section: SECTION } },
    ...(barrier === undefined ? [] : [{ plugin: admissionBarrierPlugin, scope, config: undefined }]),
    ...extra.map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: modelProvider, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    { plugin: applicationPlugin, scope, config: { cwd: root, provider: 'mock', model: 'fixture', systemPrompt: 'Help.', maxSteps: 6 } },
  ], 'host'))
  await host.start()
  if (app === undefined || commands === undefined || broker === undefined || storage === undefined || planMode === undefined
    || activeSessions === undefined) {
    throw new Error('missing plan composition')
  }
  const application = app
  const registry = commands
  const persistence = storage
  const sessions = activeSessions
  return {
    model, broker, planMode,
    /** Dispatch one slash command to the running root owner, as the TUI does mid-turn. */
    async running(line: string) {
      const owner = sessions.owners()[0]
      if (owner === undefined) throw new Error('missing running owner')
      const outcome = await registry.dispatch({
        agent: owner.agent, session: owner.session, line, attachments: [], signal: new AbortController().signal,
      })
      return outcome?.result
    },
    /** Run slash commands inside one owned Session operation, as the TUI does. */
    commands: (id: SessionId, resume: boolean, lines: readonly string[]) => application.executeSessionOperation({ id, resume },
      async (owner, signal) => {
        const results = []
        for (const line of lines) {
          const outcome = await registry.dispatch({ agent: owner.agent, session: owner.session, line, attachments: [], signal })
          results.push(outcome?.result)
        }
        return results
      }, new AbortController().signal),
    /** Read the plan-mode states while the Session's owner is attached, between turns. */
    inspect: (id: SessionId) => application.executeSessionOperation({ id, resume: true },
      () => Promise.resolve(planMode?.states() ?? []), new AbortController().signal),
    turn: (id: SessionId, resume: boolean, text: string) => application.executeTurn({
      id, resume, message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    }, new AbortController().signal),
    async events(id: SessionId): Promise<readonly SessionEvent[]> {
      const reader = await persistence.open(id, 'read')
      try { return (await reader.read()).events } finally { await reader.close() }
    },
    async close() { await host.stop(); await rm(root, { recursive: true, force: true }) },
  }
}

/** Text of every user-role message in one model request. */
function userTexts(request: GenerateOptions | undefined): string[] {
  return (request?.messages ?? []).filter(message => message.role === 'user').map(message =>
    message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''))
}

function planModes(events: readonly SessionEvent[]): boolean[] {
  return events.flatMap(event => event.type === 'plan/mode' ? [event.data.active] : [])
}

/** Whether one event is a durable plan-mode notice in history. */
function isPlanNotice(event: SessionEvent): boolean {
  return event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === 'plan-mode'
}

it('commits idle /plan selections, withdraws a stale notice, and admits exactly one guidance notice before the next prompt', async () => {
  const state = await fixture([textResponse('planning'), textResponse('back to work')])
  const id = SessionId('native-plan-command')
  try {
    const selected = await state.commands(id, false, ['/plan', '/plan off', '/plan', '/plan'])
    expect(selected.map(result => [result?.kind, result?.text])).toEqual([
      ['success', 'Plan mode on. Use /plan off to leave.'],
      ['success', 'Plan mode off.'],
      ['success', 'Plan mode on. Use /plan off to leave.'],
      ['success', 'Entering plan mode (applies from the next step). Use /plan off to leave.'],
    ])
    expect(planModes(await state.events(id))).toEqual([true, false, true])

    await state.turn(id, true, 'Design the cache change')
    const entered = userTexts(state.model.requests[0])
    expect(entered).toEqual([`The user switched this session to plan mode.\n\n${SECTION}`, 'Design the cache change'])
    expect(state.planMode.states()).toEqual([])

    expect((await state.commands(id, true, ['/plan off', '/plan off'])).map(result => result?.text))
      .toEqual(['Plan mode off.', 'Plan mode is already inactive.'])
    await state.turn(id, true, 'Implement it')
    const left = userTexts(state.model.requests[1])
    expect(left.slice(-2)).toEqual(['The user switched this session back to the default mode.', 'Implement it'])
    expect(left.filter(text => text.includes(SECTION))).toHaveLength(1)

    const events = await state.events(id)
    expect(planModes(events)).toEqual([true, false, true, false])
    const notices = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(notices.map(event => event.type === 'user/message' && event.data.source)).toEqual([
      expect.objectContaining({ kind: 'plugin', plugin: 'plan-mode', form: 'notice' }),
      expect.objectContaining({ kind: 'plugin', plugin: 'plan-mode', form: 'notice' }),
    ])
  } finally { await state.close() }
})

it('reviews exit_plan_mode through the human channel: rejects, keeps planning, survives dismissal, then exits silently', async () => {
  const state = await fixture([
    toolCallResponse('no-heading', 'exit_plan_mode', { plan: 'Just do it' }),
    toolCallResponse('keep', 'exit_plan_mode', { plan: PLAN }),
    toolCallResponse('dismiss', 'exit_plan_mode', { plan: PLAN }),
    toolCallResponse('approve', 'exit_plan_mode', { plan: PLAN }),
    textResponse('implementing'),
  ], 2)
  const answers = [['Keep planning'], ['Approve']]
  const presented: unknown[] = []
  state.broker.onRequest((question) => {
    presented.push(question.request.questions)
    state.broker.answer(question.id, question.request.agent, { answers: [{ id: 'plan-review', selected: answers.shift() }] })
  })
  const id = SessionId('native-plan-exit')
  try {
    await state.commands(id, false, ['/plan'])
    await state.turn(id, true, 'Plan the cache change')
    expect(state.model.requests).toHaveLength(5)
    expect(state.model.requests[0]?.tools?.map(tool => tool.name)).toContain('exit_plan_mode')
    expect(presented).toHaveLength(2)
    expect(JSON.stringify(presented[0])).toContain('Ship the cache')
    const events = await state.events(id)
    const results = events.flatMap(event => event.type === 'tool/result' ? [JSON.stringify(event.data)] : [])
    expect(results).toHaveLength(4)
    expect(results[0]).toContain('starting with a # heading')
    expect(results[1]).toContain('The user chose to keep planning')
    expect(results[2]).toContain(REVIEW_DISMISSED_MESSAGE.trim())
    expect(results[3]).toContain(EXIT_APPROVED_TEXT)
    expect(planModes(events)).toEqual([true, false])
    const last = userTexts(state.model.requests[4])
    expect(last.some(text => text.includes('back to the default mode'))).toBe(false)
  } finally { await state.close() }
})

it('refuses exit_plan_mode outside plan mode without asking the human', async () => {
  const state = await fixture([toolCallResponse('outside', 'exit_plan_mode', { plan: PLAN }), textResponse('ok')])
  const asked = vi.fn()
  state.broker.onRequest(asked)
  const id = SessionId('native-plan-inactive')
  try {
    await state.turn(id, false, 'Just answer')
    const results = (await state.events(id)).flatMap(event => event.type === 'tool/result' ? [JSON.stringify(event.data)] : [])
    expect(results).toEqual([expect.stringContaining('only available in plan mode')])
    expect(asked).not.toHaveBeenCalled()
  } finally { await state.close() }
})

it('queues a mid-turn /plan until the next accepted step and admits its notice there', async () => {
  const state = await fixture([toolCallResponse('probe', 'exit_plan_mode', { plan: PLAN }), textResponse('planning now')])
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const original = state.model.stream.bind(state.model)
  let paused = false
  vi.spyOn(state.model, 'stream').mockImplementation(async function* (options) {
    if (!paused) {
      paused = true
      entered.resolve(undefined)
      await resume.promise
    }
    yield* original(options)
  })
  const id = SessionId('native-plan-mid-turn')
  try {
    const run = state.turn(id, false, 'Start implementing')
    await entered.promise
    expect(await state.running('/plan')).toEqual({
      kind: 'success', text: 'Entering plan mode (applies from the next step). Use /plan off to leave.',
    })
    expect(state.planMode.states()).toEqual([expect.objectContaining({ active: false, pending: true })])
    resume.resolve(undefined)
    await run
    const events = await state.events(id)
    // The first step's tool ran before the boundary, so the exit was still unavailable.
    expect(events.flatMap(event => event.type === 'tool/result' ? [JSON.stringify(event.data)] : []))
      .toEqual([expect.stringContaining('only available in plan mode')])
    const mode = events.findIndex(event => event.type === 'plan/mode')
    const secondStep = events.findLastIndex(event => event.type === 'step/start')
    expect(planModes(events)).toEqual([true])
    // The mode commits inside the step that delivers the guidance, only after the notice is durable.
    expect(mode).toBeGreaterThan(secondStep)
    expect(mode).toBeGreaterThan(events.findIndex(isPlanNotice))
    expect(mode).toBeLessThan(events.findLastIndex(event => event.type === 'step/end'))
    expect(userTexts(state.model.requests[0])).toEqual(['Start implementing'])
    expect(userTexts(state.model.requests[1]).at(-1)).toBe(`The user switched this session to plan mode.\n\n${SECTION}`)
  } finally { await state.close() }
})

it('does not apply a plan selection queued after the candidate snapshot until its notice is admitted', async () => {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const state = await fixture([
    toolCallResponse('probe', 'exit_plan_mode', { plan: PLAN }), textResponse('planning now'),
  ], undefined, { entered: () => { entered.resolve(undefined) }, wait: () => resume.promise })
  const id = SessionId('native-plan-late-selection')
  try {
    const run = state.turn(id, false, 'Start implementing')
    await entered.promise
    expect((await state.running('/plan'))?.kind).toBe('success')
    resume.resolve(undefined)
    await run

    const events = await state.events(id)
    expect(planModes(events)).toEqual([true])
    const firstResult = events.findIndex(event => event.type === 'tool/result')
    const mode = events.findIndex(event => event.type === 'plan/mode')
    const secondStep = events.findLastIndex(event => event.type === 'step/start')
    expect(mode).toBeGreaterThan(firstResult)
    expect(mode).toBeGreaterThan(secondStep)
    expect(mode).toBeGreaterThan(events.findIndex(isPlanNotice))
    expect(userTexts(state.model.requests[0])).toEqual(['Start implementing'])
    expect(userTexts(state.model.requests[1])).toContain(`The user switched this session to plan mode.\n\n${SECTION}`)
  } finally {
    resume.resolve(undefined)
    await state.close()
  }
})

it('keeps a narrated selection pending when its admitted notice is rejected before it is durable, then delivers and commits it at a later step', async () => {
  let rejected = 0
  // Inner admission hook: lets the plan notice through admission, then rejects
  // it in the Program's final commit check, after the plan hook has returned.
  const rejector: NativePlugin = {
    apiVersion: 1, name: 'plan-test-notice-rejector', targets: ['host'], requires: ['activeSessions'], provides: [],
    resolve: () => (context) => {
      const sessions = context.require('activeSessions')
      const releases = new Map<NativeActiveSessionOwner, () => Promise<void>>()
      context.effect(sessions.onAttached(async (owner) => {
        releases.set(owner, owner.beforeStep(async (step, next) => {
          const decision = await next()
          const notice = decision.kind === 'enter'
            ? decision.messages.find(message => message.source.kind === 'plugin' && message.source.plugin === 'plan-mode')
            : undefined
          if (notice !== undefined && rejected === 0) {
            rejected += 1
            step.registerCommitCheck(() => [notice.id])
          }
          return decision
        }, 700))
      }))
      context.effect(sessions.onDetached(async (owner) => {
        await releases.get(owner)?.()
        releases.delete(owner)
      }))
      context.own(async () => {
        await Promise.all([...releases.values()].map(release => release()))
        releases.clear()
      })
    },
  }
  const state = await fixture([toolCallResponse('probe', 'exit_plan_mode', { plan: PLAN }), textResponse('planning now')],
    undefined, undefined, [rejector])
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const original = state.model.stream.bind(state.model)
  let paused = false
  vi.spyOn(state.model, 'stream').mockImplementation(async function* (options) {
    if (!paused) {
      paused = true
      entered.resolve(undefined)
      await resume.promise
    }
    yield* original(options)
  })
  const id = SessionId('native-plan-rejected-notice')
  const guidance = `The user switched this session to plan mode.\n\n${SECTION}`
  try {
    const run = state.turn(id, false, 'Start implementing')
    await entered.promise
    expect((await state.running('/plan'))?.kind).toBe('success')
    resume.resolve(undefined)
    await run

    // The notice was admitted in memory at step 2 and then rejected: nothing
    // reached history, so the mode is not committed and the selection survives.
    expect(rejected).toBe(1)
    const failed = await state.events(id)
    expect(failed.some(isPlanNotice)).toBe(false)
    expect(planModes(failed)).toEqual([])
    expect(state.model.requests).toHaveLength(1)
    expect(await state.inspect(id)).toEqual([expect.objectContaining({ active: false, pending: true })])

    await state.turn(id, true, 'Keep going')
    expect(state.model.requests).toHaveLength(2)
    expect(userTexts(state.model.requests[1]).slice(-2)).toEqual([guidance, 'Keep going'])
    const events = await state.events(id)
    const notice = events.findIndex(isPlanNotice)
    const mode = events.findIndex(event => event.type === 'plan/mode')
    expect(events.filter(isPlanNotice)).toHaveLength(1)
    expect(planModes(events)).toEqual([true])
    // Only the durable notice commits the mode, inside the step that delivered it.
    expect(mode).toBeGreaterThan(notice)
    expect(notice).toBeGreaterThan(events.findLastIndex(event => event.type === 'step/start'))
    expect((await state.inspect(id)).map(entry => [entry.active, entry.pending])).toEqual([[true, undefined]])
  } finally {
    resume.resolve(undefined)
    await state.close()
  }
})

it('commits a narrated selection through the shared core only for the announced mode, after a successful append', () => {
  let logged = false
  let told: boolean | undefined = false
  let failAppend = true
  const appended: boolean[] = []
  const view: PlanSessionView = {
    loggedActive: () => logged,
    toldActive: () => told,
    hasOpenTurn: () => true,
    appendMode: (active) => {
      if (failAppend) throw new Error('writer closed')
      appended.push(active)
      logged = active
    },
  }
  const selections = new PlanModeSelections<string>(new Map(), active => `mode ${String(active)}`)
  expect(selections.awaitsNarration('s', view)).toBe(false)
  expect(selections.commitNarrated('s', view, true)).toBe(false)

  selections.approveExit('s')
  expect(selections.awaitsNarration('s', view)).toBe(false)
  expect(selections.commitNarrated('s', view, false)).toBe(false)
  expect(selections.pending('s')).toEqual({ active: false, narrate: false })

  expect(selections.select('s', view, true).outcome).toBe('queued')
  expect(selections.awaitsNarration('s', view)).toBe(true)
  expect(selections.commitNarrated('s', view, false)).toBe(false)
  expect(() => selections.commitNarrated('s', view, true)).toThrow('writer closed')
  expect(selections.pending('s')).toEqual({ active: true, narrate: true })

  failAppend = false
  told = true
  expect(selections.awaitsNarration('s', view)).toBe(false)
  expect(selections.commitNarrated('s', view, true)).toBe(true)
  expect(appended).toEqual([true])
  expect(selections.pending('s')).toBeUndefined()

  // A narrated selection that already matches the logged mode clears without another append.
  expect(selections.select('s', view, false).outcome).toBe('queued')
  logged = false
  expect(selections.commitNarrated('s', view, false)).toBe(true)
  expect(appended).toEqual([true])
})
