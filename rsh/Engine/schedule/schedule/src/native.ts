/** Native scheduled reminders owned by each exact live root Session. */

import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { MessageId } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import {
  decideDueSchedules,
  foldScheduleEvents,
  renderEveryReminderBatchFraming,
  renderReminderFraming,
  ScheduleLogError,
} from './domain.ts'
import type { FoldedSchedules, ScheduleDueDecision } from './domain.ts'
import { createSchedule, deleteSchedule, listSchedules } from './operations.ts'
import type { ScheduleOperationOwner, ScheduleCreateArgs } from './operations.ts'
import { runScheduleTransaction } from './transaction.ts'
import type { ScheduleChange } from './types.ts'

/** Largest delay that Node timers represent without clamping. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

const ViewSchema: JsonSchemaNode = {
  oneOf: [
    { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', const: 'after' }, prompt: { type: 'string' },
      afterSeconds: { type: 'integer' }, scheduledAt: { type: 'string' }, state: { type: 'string', enum: ['scheduled', 'overdue'] },
      deliveryMode: { type: 'string', const: 'session-local' } },
    required: ['id', 'kind', 'prompt', 'afterSeconds', 'scheduledAt', 'state', 'deliveryMode'], additionalProperties: false },
    { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', const: 'at' }, prompt: { type: 'string' },
      scheduledAt: { type: 'string' }, state: { type: 'string', enum: ['scheduled', 'overdue'] },
      deliveryMode: { type: 'string', const: 'session-local' } },
    required: ['id', 'kind', 'prompt', 'scheduledAt', 'state', 'deliveryMode'], additionalProperties: false },
    { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', const: 'every' }, prompt: { type: 'string' },
      everySeconds: { type: 'integer' }, scheduledAt: { type: 'string' }, state: { type: 'string', enum: ['scheduled', 'overdue'] },
      deliveryMode: { type: 'string', const: 'session-local' } },
    required: ['id', 'kind', 'prompt', 'everySeconds', 'scheduledAt', 'state', 'deliveryMode'], additionalProperties: false },
  ],
}

const BasicErrors = ['invalid_prompt', 'invalid_selector', 'invalid_rule', 'invalid_time_zone', 'not_future',
  'time_out_of_range', 'frequency_too_high', 'corrupt_schedule_log', 'internal_error'] as const
const ErrorSchemas: JsonSchemaNode[] = [
  ...BasicErrors.map((code): JsonSchemaNode => ({ type: 'object', properties: {
    code: { type: 'string', const: code }, message: { type: 'string' },
  }, required: ['code', 'message'], additionalProperties: false })),
  { type: 'object', properties: { code: { type: 'string', const: 'persistence_uncertain' }, message: { type: 'string' },
    operation: { type: 'string', enum: ['create', 'list', 'delete'] }, id: { type: 'string' } },
  required: ['code', 'message', 'operation'], additionalProperties: false },
]
const CreateOutput: JsonSchemaNode = { oneOf: [ViewSchema, ...ErrorSchemas] }
const ListOutput: JsonSchemaNode = { oneOf: [{ type: 'array', items: ViewSchema }, ...ErrorSchemas] }
const DeleteOutput: JsonSchemaNode = { oneOf: [
  { type: 'object', properties: { id: { type: 'string' }, deleted: { type: 'boolean', const: true } },
    required: ['id', 'deleted'], additionalProperties: false },
  { type: 'object', properties: { id: { type: 'string' }, deleted: { type: 'boolean', const: false },
    code: { type: 'string', const: 'schedule_not_found' } }, required: ['id', 'deleted', 'code'], additionalProperties: false },
  ...ErrorSchemas,
] }

const CREATE_DESCRIPTION = 'Create one reminder in the current session. Supply a non-empty prompt and exactly one selector: '
  + 'a positive safe-integer after_seconds delay, at as a strict offset date-time or local date/time object, or safe-integer '
  + 'every_seconds of at least 300. Fixed-rate reminders stay creation-aligned, skip missed occurrences, and batch one latest '
  + 'occurrence per overdue rule. Delivery is session-local: the reminder runs on time only while this session is live and '
  + 'otherwise becomes overdue until the session is resumed.'
const LIST_DESCRIPTION = 'List every active reminder in the current session in creation order, including its exact id, UTC target, '
  + 'scheduled or overdue state, and session-local delivery mode.'
const DELETE_DESCRIPTION = 'Delete one active reminder in the current session by the exact id returned by schedule_create or '
  + 'schedule_list. Unknown or already-finished ids return deleted false.'

/** Render the same canonical JSON value exposed by the Cordis tool. */
function renderValue(_call: NativeToolExecution, value: JsonValue) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false }
}

function ownerCallError(owner: OwnerState, call: NativeToolExecution) {
  return call.agent === owner.owner.agent && call.session === owner.owner.session
    ? undefined
    : { code: 'internal_error' as const, message: 'The schedule operation failed.' }
}

function createTool(owner: OwnerState): NativeValueToolContribution {
  return {
    schema: { name: 'schedule_create', description: CREATE_DESCRIPTION, parameters: {
      type: 'object', properties: {
        prompt: { type: 'string' }, after_seconds: { type: 'integer' },
        at: { oneOf: [
          { type: 'string' },
          { type: 'object', properties: { date: { type: 'string' }, time: { type: 'string' }, time_zone: { type: 'string' } },
            required: ['date', 'time', 'time_zone'], additionalProperties: false },
        ] },
        every_seconds: { type: 'integer' },
      }, required: ['prompt'], additionalProperties: false,
    } },
    output: { schema: CreateOutput, render: renderValue },
    execute: async (call) => {
      const failure = ownerCallError(owner, call)
      return failure ?? await createSchedule(owner.operations, call.arguments as ScheduleCreateArgs, call.signal)
    },
  }
}

function listTool(owner: OwnerState): NativeValueToolContribution {
  return {
    schema: { name: 'schedule_list', description: LIST_DESCRIPTION, parameters: {
      type: 'object', properties: {}, additionalProperties: false,
    } },
    output: { schema: ListOutput, render: renderValue },
    execute: async (call) => {
      const failure = ownerCallError(owner, call)
      return failure ?? await listSchedules(owner.operations, call.signal)
    },
  }
}

function deleteTool(owner: OwnerState): NativeValueToolContribution {
  return {
    schema: { name: 'schedule_delete', description: DELETE_DESCRIPTION, parameters: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
    } },
    output: { schema: DeleteOutput, render: renderValue },
    execute: async (call) => {
      const failure = ownerCallError(owner, call)
      return failure ?? await deleteSchedule(owner.operations, (call.arguments as { readonly id: string }).id, call.signal)
    },
  }
}

interface OwnerState {
  readonly owner: NativeActiveSessionOwner
  readonly operations: ScheduleOperationOwner
  readonly controller: AbortController
  readonly removers: Array<() => Promise<void>>
  stopEvents: (() => void) | undefined
  stopIdle: (() => Promise<void>) | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  run: Promise<void> | undefined
  requested: boolean
  ownerIdlePending: boolean
  processingOwner: boolean
  maintenancePending: boolean
  stopping: boolean
  faulted: boolean
  deliveryId: MessageId | undefined
  releaseBackground: (() => void) | undefined
  hasActiveSchedules: boolean
}

/** Lifecycle and timer projection for the package's exact attached root owners. */
class NativeScheduleService {
  private readonly states = new Map<NativeAgent, OwnerState>()
  private disposed = false

  constructor(
    private readonly sessions: NativeActiveSessionOperations,
    private readonly context: NativeContext,
    private readonly warn: (message: string) => void,
  ) {}

  /** Attach tools and a live projection before this Session can admit its first model turn. */
  async attach(owner: NativeActiveSessionOwner): Promise<void> {
    if (this.disposed || !this.isRoot(owner) || this.states.has(owner.agent)) return
    const state = this.makeState(owner)
    this.states.set(owner.agent, state)
    try {
      for (const contribution of [createTool, listTool, deleteTool]) {
        state.removers.push(this.context.effect(this.context.require('tools').registerValueTool(contribution(state), owner.agent.scope)))
      }
      state.stopEvents = owner.onEvent((event) => {
        if (event.type === 'schedule/change') this.requestDrive(state)
      })
      state.stopIdle = owner.onIdle(async () => {
        if (state.maintenancePending) return
        if (state.deliveryId !== undefined && !this.hasQueuedDelivery(state, state.deliveryId)) state.deliveryId = undefined
        await this.driveAtIdle(state)
      })
      this.requestDrive(state)
    } catch (failure: unknown) {
      await this.detach(owner)
      throw failure
    }
  }

  /** Close one exact owner's scheduler before its sole writer is released. */
  async detach(owner: NativeActiveSessionOwner): Promise<void> {
    const state = this.states.get(owner.agent)
    if (state === undefined || state.owner !== owner) return
    this.states.delete(owner.agent)
    state.stopping = true
    state.controller.abort(new Error('schedule: active owner detached'))
    this.clearTimer(state)
    state.stopEvents?.()
    state.stopEvents = undefined
    await state.stopIdle?.()
    state.stopIdle = undefined
    await Promise.all(state.removers.splice(0).map(remove => remove()))
    await state.run
    state.releaseBackground?.()
    state.releaseBackground = undefined
  }

  /** Drain every root runtime during plugin removal. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.states.values()].map(state => this.detach(state.owner)))
  }

  private makeState(owner: NativeActiveSessionOwner): OwnerState {
    const state = {
      owner,
      operations: undefined as unknown as ScheduleOperationOwner,
      controller: new AbortController(),
      removers: [],
      stopEvents: undefined,
      stopIdle: undefined,
      timer: undefined,
      run: undefined,
      requested: false,
      ownerIdlePending: false,
      processingOwner: false,
      maintenancePending: false,
      stopping: false,
      faulted: false,
      deliveryId: undefined,
      releaseBackground: undefined,
      hasActiveSchedules: false,
    } satisfies OwnerState
    state.operations = {
      key: owner.agent,
      inheritedEventCount: owner.inheritedEventCount,
      isCurrent: () => this.isCurrent(state),
      flush: () => owner.flush(),
      readEvents: () => owner.readCommittedEvents(),
      append: (change) => { owner.append('schedule/change', change) },
      onDurableChange: () => this.requestDrive(state),
    }
    return state
  }

  private isRoot(owner: NativeActiveSessionOwner): boolean {
    const root = owner.rootOperations
    return owner.invocation === 'root' && root !== undefined && root.agent === owner.agent
      && root.sessionId === owner.session.id && !root.signal.aborted
  }

  private isCurrent(state: OwnerState): boolean {
    if (this.disposed || state.stopping || state.controller.signal.aborted || !state.owner.writerAvailable
      || !this.isRoot(state.owner)) return false
    try { return this.sessions.owner(state.owner.agent, state.owner.session) === state.owner }
    catch { return false }
  }

  private requestDrive(state: OwnerState): void {
    if (state.stopping || state.faulted || !this.isCurrent(state)) return
    this.clearTimer(state)
    state.requested = true
    if (state.ownerIdlePending || state.processingOwner) return
    if (state.run !== undefined) return
    const run = this.runRequested(state)
    state.run = run
    void run.then(() => this.retire(state, run), (error) => {
      if (this.isCurrent(state)) this.warn(`schedule: native runtime failed: ${this.renderThrown(error)}`)
      state.faulted = true
      this.retire(state, run)
    })
  }

  private async runRequested(state: OwnerState): Promise<void> {
    while (state.requested && !state.stopping && !state.faulted && this.isCurrent(state)) {
      state.requested = false
      await runScheduleTransaction(state.owner.agent, () => this.driveOnce(state))
    }
  }

  private retire(state: OwnerState, run: Promise<void>): void {
    if (state.run !== run) return
    state.run = undefined
    if (state.requested && !state.stopping && !state.faulted) this.requestDrive(state)
  }

  private async driveOnce(state: OwnerState): Promise<void> {
    const { owner } = state
    this.clearTimer(state)
    if (!this.isCurrent(state)) return
    let folded: FoldedSchedules
    try {
      await owner.flush()
      folded = foldScheduleEvents(await owner.readCommittedEvents(), SessionLogOffset(owner.inheritedEventCount))
    } catch (failure: unknown) {
      if (this.isCurrent(state)) this.warn(`schedule: native preflight failed: ${this.renderThrown(failure)}`)
      if (failure instanceof ScheduleLogError) state.faulted = true
      this.refreshBackground(state)
      return
    }
    this.refreshBackground(state, folded)
    if (!this.isCurrent(state)) return
    const now = Date.now()
    const decision = this.decide(state, folded, now)
    if (decision === undefined) return
    if (decision.kind === 'wait') {
      if (decision.target !== undefined && folded.active.length > 0) this.arm(state, decision.target, now)
      return
    }

    const root = owner.rootOperations
    if (root === undefined) return
    let maintenance: Promise<boolean>
    state.maintenancePending = true
    try {
      maintenance = root.runIdle((active, signal) => active === owner && this.isCurrent(state)
        ? this.processOwner(state, active, signal)
        : Promise.resolve(false), AbortSignal.any([root.signal, state.controller.signal]))
    } catch {
      state.maintenancePending = false
      if (this.isCurrent(state)) return
      return
    }
    let dispatched: boolean
    try { dispatched = await maintenance }
    catch (failure: unknown) {
      if (this.isCurrent(state)) this.warn(`schedule: native idle dispatch failed: ${this.renderThrown(failure)}`)
      return
    } finally {
      state.maintenancePending = false
    }
    if (dispatched && this.isCurrent(state)) this.requestDrive(state)
  }

  /** Use the terminal hook's still-owned writer after any queued maintenance attempt has settled. */
  private async driveAtIdle(state: OwnerState): Promise<void> {
    state.ownerIdlePending = true
    try {
      const pending = state.run
      if (pending !== undefined) {
        try { await pending } catch { return }
      }
      const rootOperations = state.owner.rootOperations
      if (rootOperations === undefined || !this.isCurrent(state)) return
      await runScheduleTransaction(state.owner.agent, async () => {
        if (!this.isCurrent(state)) return
        state.processingOwner = true
        try {
          let dispatched: boolean
          do {
            state.requested = false
            dispatched = await this.processOwner(state, state.owner, AbortSignal.any([
              rootOperations.signal, state.controller.signal,
            ]))
          } while ((dispatched || state.requested) && this.isCurrent(state))
        } finally {
          state.processingOwner = false
        }
      })
    } finally {
      state.ownerIdlePending = false
    }
  }

  /** Fold committed Schedule history and dispatch due work through the exact live owner. */
  private async processOwner(state: OwnerState, owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<boolean> {
    this.clearTimer(state)
    if (!this.isCurrent(state)) return false
    let folded: FoldedSchedules
    try {
      await owner.flush()
      folded = foldScheduleEvents(await owner.readCommittedEvents(), SessionLogOffset(owner.inheritedEventCount))
    } catch (failure: unknown) {
      if (this.isCurrent(state)) this.warn(`schedule: native idle preflight failed: ${this.renderThrown(failure)}`)
      if (failure instanceof ScheduleLogError) state.faulted = true
      this.refreshBackground(state)
      return false
    }
    this.refreshBackground(state, folded)
    if (!this.isCurrent(state)) return false
    const selected = this.decide(state, folded, Date.now())
    if (selected === undefined || selected.kind === 'wait') {
      if (selected?.kind === 'wait' && selected.target !== undefined && folded.active.length > 0) {
        this.arm(state, selected.target, Date.now())
      }
      return false
    }
    const text = selected.kind === 'one-shot'
      ? renderReminderFraming(selected.record)
      : renderEveryReminderBatchFraming(selected.reminders)
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'schedule' },
    })
    let id: MessageId
    try {
      id = await owner.enqueue(message, 'next-turn', true, signal)
      state.deliveryId = id
    } catch (failure: unknown) {
      this.warn(`schedule: native reminder enqueue failed: ${this.renderThrown(failure)}`)
      return false
    }
    try {
      const changes: ScheduleChange[] = selected.kind === 'one-shot'
        ? [{ version: 1, operation: 'dispatch', id: selected.record.id }]
        : selected.reminders.map(reminder => ({ version: 1, operation: 'dispatch', id: reminder.record.id,
          acceptedAt: selected.acceptedAt }))
      owner.appendBatch(changes.map(data => ({ type: 'schedule/change' as const, data })))
    } catch (failure: unknown) {
      state.faulted = true
      this.warn(`schedule: native dispatch append failed: ${this.renderThrown(failure)}`)
      return false
    }
    try {
      await owner.flush()
    } catch (failure: unknown) {
      this.warn(`schedule: native dispatch barrier failed: ${this.renderThrown(failure)}`)
      return false
    }
    return true
  }

  private decide(state: OwnerState, folded: FoldedSchedules, now: number): ScheduleDueDecision | undefined {
    try { return decideDueSchedules(folded, now) }
    catch (failure: unknown) {
      this.warn(`schedule: native due decision failed: ${this.renderThrown(failure)}`)
      state.faulted = true
      return undefined
    }
  }

  private arm(state: OwnerState, target: number, now: number): void {
    state.timer = setTimeout(() => {
      state.timer = undefined
      this.requestDrive(state)
    }, Math.min(target - now, MAX_TIMER_DELAY_MS))
  }

  private clearTimer(state: OwnerState): void {
    if (state.timer === undefined) return
    clearTimeout(state.timer)
    state.timer = undefined
  }

  private hasQueuedDelivery(state: OwnerState, id: MessageId): boolean {
    return state.owner.messages('next-turn').some(message => message.id === id)
      || state.owner.messages('next-step').some(message => message.id === id)
  }

  private refreshBackground(state: OwnerState, folded?: FoldedSchedules): void {
    if (folded !== undefined) state.hasActiveSchedules = folded.active.length > 0
    const needed = state.hasActiveSchedules === true || state.deliveryId !== undefined
    if (needed && state.releaseBackground === undefined && this.isCurrent(state)) {
      state.releaseBackground = state.owner.retainBackground()
    } else if (!needed && state.releaseBackground !== undefined) {
      state.releaseBackground()
      state.releaseBackground = undefined
    }
  }

  private renderThrown(value: unknown): string {
    return value instanceof Error ? value.message : String(value)
  }
}

/** Native Session-local Schedule Consumer; the selected profile must opt in to load it. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-schedule',
  targets: ['host'],
  requires: ['activeSessions', 'tools'],
  provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('schedule: native configuration must be empty')
    }
    return async (context) => {
      const service = new NativeScheduleService(context.require('activeSessions'), context,
        (message) => { console.warn(message) })
      context.own(() => service.dispose())
      context.effect(context.require('activeSessions').onAttached(owner => service.attach(owner)))
      context.effect(context.require('activeSessions').onDetached(owner => service.detach(owner)))
      for (const owner of context.require('activeSessions').owners()) await service.attach(owner)
    }
  },
}
