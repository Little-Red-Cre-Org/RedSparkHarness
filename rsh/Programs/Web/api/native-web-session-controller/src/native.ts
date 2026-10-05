/** Authenticated browser Session operations using the selected native execution authority. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { NativeSessionFeed } from './follow.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig, type Config as TurnConfig,
  type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { NativeConnectionRequestOwner, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution/root-route'
import type { NativeAgent, NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'

type NativeSessionAdmissionId = Branded<'native-web-admission'>

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Browser Session requests and their owned cancellation. */
    nativeWebSession: NativeWebSessionService
  }
}

/** Program settings and explicit wire admission limits. */
export interface Config extends TurnConfig {
  readonly maxPendingRequests: number
  readonly maxHistoryEvents: number
  readonly maxPromptChars: number
  readonly maxFollowBufferBytes: number
  readonly maxFollowers: number
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native web session: expected an object')
  return value as Record<string, unknown>
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`native web session: ${name} must be a positive safe integer`)
  return value
}

function sessionId(value: unknown): SessionId {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new TypeError('native web session: invalid Session id')
  }
  return SessionId(value)
}

/** Resolve Program settings and resource limits before installing routes.
 * @param input - profile configuration.
 * @returns validated native Session configuration.
 */
export function resolveNativeWebSessionConfig(input: unknown): Config {
  const { maxPendingRequests, maxHistoryEvents, maxPromptChars, maxFollowBufferBytes, maxFollowers, ...turn } = object(input)
  return { ...resolveNativeHeadlessConfig(turn), maxPendingRequests: positive(maxPendingRequests, 'maxPendingRequests'),
    maxHistoryEvents: positive(maxHistoryEvents, 'maxHistoryEvents'), maxPromptChars: positive(maxPromptChars, 'maxPromptChars'), maxFollowBufferBytes: positive(maxFollowBufferBytes, 'maxFollowBufferBytes'),
    maxFollowers: positive(maxFollowers, 'maxFollowers') }
}

const endpoints = new Set(['session/list', 'session/history', 'session/create', 'session/prompt', 'session/cancel', 'session/status', 'session/start', 'session/await', 'session/model-controls', 'session/select-model', 'session/select-preset'])
const modelSelectionInput = z.strictObject({
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional(),
})

/** Optional selected authorities; no fallback catalog or composition registry is created. */
export interface NativeWebSelectionProviders {
  readonly directory?: NativeModelDirectory | undefined
  readonly models?: {
    readonly selection: NativeModelSelectionOperations
    readonly executionFor: (agent: NativeAgent) => Pick<NativeAgentExecution, 'status' | 'runMaintenance'>
  } | undefined
  readonly presets?: NativeAgentPresetOperations | undefined
}

/** Browser transport Consumer; the executor retains the sole Agent and Session writer. */
export class NativeWebSessionService {
  private readonly turns = new Map<SessionId, {
    admissionId: NativeSessionAdmissionId
    controller: AbortController
    done: Promise<unknown>
    waiting: boolean
    settled: boolean
    feed: NativeSessionFeed | undefined
    following: boolean
  }>()
  private followers = 0
  private readonly shutdown = new AbortController()
  private readonly requests: NativeConnectionRequestOwner
  private readonly controls: NativeConnectionRequestOwner
  private readonly settlements: NativeConnectionRequestOwner

  /**
   * @param executor - shared Program executor, not another Agent loop.
   * @param persistence - selected durable Session index.
   * @param active - selected exact live writer registry.
   * @param config - validated execution and wire limits.
   * @param lifetime - installation cancellation.
   * @param selections - selected catalog, model intent and standing composition authorities.
   */
  constructor(private readonly executor: NativeHeadlessApplication,
    private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations,
    private readonly config: Config, private readonly lifetime: AbortSignal,
    private readonly selections: NativeWebSelectionProviders = {}) {
    this.requests = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.controls = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.settlements = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
  }

  private async start(payload: unknown, signal: AbortSignal): Promise<{ admissionId: NativeSessionAdmissionId }> {
    signal.throwIfAborted()
    const fields = object(payload)
    for (const key of Object.keys(fields)) if (!['sessionId', 'text', 'resume', 'follow'].includes(key)) throw new Error('native web session: unexpected prompt field')
    const id = sessionId(fields.sessionId)
    if (typeof fields.text !== 'string' || fields.text.length === 0 || fields.text.length > this.config.maxPromptChars) throw new TypeError('native web session: text exceeds configured limits or is empty')
    if (fields.follow !== undefined && typeof fields.follow !== 'boolean') throw new TypeError('native web session: follow must be boolean')
    if (typeof fields.resume !== 'boolean') throw new TypeError('native web session: resume must be explicit')
    if (this.turns.has(id)) throw new Error('native web session: Session already has a pending turn')
    if (this.turns.size >= this.config.maxPendingRequests) throw new Error('native web session: turn settlement capacity reached')
    const controller = new AbortController()
    const admissionId = randomUUID() as NativeSessionAdmissionId
    const feed = fields.follow === true
      ? new NativeSessionFeed(this.config.maxFollowBufferBytes, (error) => { controller.abort(error) }) : undefined
    let admitted!: () => void
    let refused!: (error: unknown) => void
    const acknowledgement = new Promise<void>((resolve, reject) => { admitted = resolve; refused = reject })
    const execution = this.requests.run(this.lifetime, async (accepted) => {
      admitted()
      const turnSignal = AbortSignal.any([accepted, controller.signal])
      try {
        const result = await this.executor.executeRootTurn({ id, resume: fields.resume as boolean,
          message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: fields.text as string }] }),
          ...feed === undefined ? {} : { onEvent: (event) => { feed.push({ type: 'event', event }) }, onChunk: (chunk) => {
            if (chunk.type === 'block-start' && chunk.blockType === 'text') feed.push({ type: 'text-start' })
            if (chunk.type === 'text-delta') feed.push({ type: 'text', text: chunk.text })
          } } }, turnSignal)
        const failure = feed?.failure()
        if (failure !== undefined) throw failure
        return result
      } catch (error: unknown) {
        const failure = feed?.failure()
        if (failure !== undefined) {
          if (error === failure) throw failure
          throw new AggregateError([failure, error], `${failure.message}; execution failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        // Exact execution cancellation is observed after the shared writer has drained.
        if (turnSignal.aborted && error === turnSignal.reason) return { exitCode: 130 }
        throw error
      }
    })
    const done = execution.then((result) => {
      feed?.finish()
      const failure = feed?.failure()
      if (failure !== undefined) throw failure
      return result
    }, (error: unknown) => {
      feed?.finish()
      if (error instanceof Error) throw error
      throw new Error(String(error), { cause: error })
    })
    const turn = { admissionId, controller, done, waiting: false, settled: false, feed, following: false }
    this.turns.set(id, turn)
    // Keep rejected execution attached until the settlement consumer reads the same promise.
    void done.then(() => { turn.settled = true }, (error: unknown) => { turn.settled = true; refused(error) })
    try { await acknowledgement } catch (error: unknown) { this.turns.delete(id); throw error }
    return { admissionId }
  }

  /**
   * Follow the exact admitted turn without acquiring another writer or Agent.
   * @param request - authenticated Fetch route request.
   * @returns SSE response, or a failure before any stream is admitted.
   */
  async follow(request: Request): Promise<Response> {
    const fields = object(await request.json())
    for (const key of Object.keys(fields)) if (!['sessionId', 'admissionId'].includes(key)) throw new Error('native web session: unexpected follow field')
    const turn = this.turns.get(sessionId(fields.sessionId))
    if (turn === undefined || fields.admissionId !== turn.admissionId || turn.feed === undefined || turn.following) {
      return new Response('native Session follow: unavailable admission', { status: 409 })
    }
    const signal = AbortSignal.any([request.signal, this.lifetime, this.shutdown.signal])
    signal.throwIfAborted()
    if (this.followers >= this.config.maxFollowers) return new Response('native Session follow: capacity reached', { status: 429 })
    turn.following = true
    this.followers++
    return turn.feed.response(signal, () => { this.followers-- })
  }

  private async settle(payload: unknown, signal: AbortSignal): Promise<unknown> {
    const fields = object(payload)
    for (const key of Object.keys(fields)) if (!['sessionId', 'admissionId'].includes(key)) throw new Error('native web session: unexpected settlement field')
    const id = sessionId(fields.sessionId)
    const turn = this.turns.get(id)
    if (turn === undefined || fields.admissionId !== turn.admissionId || turn.waiting) throw new Error('native web session: unavailable turn settlement')
    turn.waiting = true
    try { return await this.settlements.run(signal, async (accepted) => {
      const abort = (): void => { turn.controller.abort(accepted.reason) }
      accepted.addEventListener('abort', abort, { once: true })
      try { return await turn.done } finally {
        accepted.removeEventListener('abort', abort)
        if (this.turns.get(id) === turn) this.turns.delete(id)
      }
    }) } catch (error: unknown) {
      if (this.turns.get(id) === turn) turn.waiting = false
      throw error
    }
  }

  /** Handle an authenticated decoded Connection request.
   * @param endpoint - owned Session endpoint.
   * @param payload - unknown wire fields.
   * @param signal - real carrier request cancellation.
   * @returns success after durable settlement, or an explicit failure.
   */
  async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      if (endpoint === 'session/start') return { ok: true, value: await this.start(payload, signal) }
      if (endpoint === 'session/await') return { ok: true, value: await this.settle(payload, signal) }
      if (endpoint === 'session/prompt') {
        const acknowledged = await this.start(payload, signal)
        return { ok: true, value: await this.settle({ sessionId: object(payload).sessionId, ...acknowledged }, signal) }
      }
      const admission = endpoint === 'session/cancel' || endpoint === 'session/status' ? this.controls : this.requests
      return { ok: true, value: await admission.run(signal, async (accepted) => {
        const fields = object(payload)
        const allowed = ['session/list', 'session/create', 'session/model-controls'].includes(endpoint) ? []
          : endpoint === 'session/select-model' ? ['sessionId', 'selected', 'expectedRevision']
            : endpoint === 'session/select-preset' ? ['sessionId', 'preset', 'expectedRevision']
              : endpoint === 'session/cancel' ? ['sessionId', 'admissionId'] : ['sessionId']
        for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`native web session: unexpected field ${key}`)
        if (endpoint === 'session/model-controls') return {
          catalog: this.selections.directory === undefined ? null : await this.selections.directory.catalog({
            provider: this.config.provider, model: this.config.model,
            ...this.config.reasoningEffort === undefined ? {} : { reasoningEffort: this.config.reasoningEffort },
          }, accepted),
          canSelectModel: this.selections.models !== undefined,
          presets: this.selections.presets?.list().map(({ id, name, description }) => ({ id, name,
            ...description === undefined ? {} : { description } })) ?? [],
        }
        if (endpoint === 'session/list') return (await this.persistence.list({ signal: accepted })).map(item => item.header)
        if (endpoint === 'session/create') {
          const id = SessionId(randomUUID())
          await this.executor.executeSessionOperation({ id, resume: false }, () => Promise.resolve(undefined), accepted)
          return { sessionId: id }
        }
        const id = sessionId(fields.sessionId)
        if (endpoint === 'session/select-model' || endpoint === 'session/select-preset') {
          if (this.turns.has(id)) throw new Error('native web session: selection requires an idle Session')
          const expectedRevision = fields.expectedRevision === null ? null
            : typeof fields.expectedRevision === 'number' ? SessionSeq(fields.expectedRevision)
              : (() => { throw new TypeError('native web session: invalid selection revision') })()
          if (endpoint === 'session/select-model') {
            const selection = this.selections.models
            if (selection === undefined) throw new Error('native web session: model selection is unavailable')
            const parsed = modelSelectionInput.parse(fields.selected)
            const selected = { provider: parsed.provider, model: parsed.model,
              ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort } }
            await this.executor.executeSessionOperation({ id, resume: true },
              (owner, effective) => {
                const execution = selection.executionFor(owner.agent)
                const commit = (signal: AbortSignal) => selection.selection.select(owner, { selected, expectedRevision }, signal)
                // Cold operations hold maintenance already; retained owners need idle admission.
                return execution.status === 'maintenance' ? commit(effective)
                  : execution.runMaintenance(signal => commit(AbortSignal.any([effective, signal])))
              }, accepted)
          } else {
            if (this.selections.presets === undefined) throw new Error('native web session: preset selection is unavailable')
            if (typeof fields.preset !== 'string' || fields.preset.length === 0) throw new TypeError('native web session: invalid preset')
            await this.executor.rootExecution.selectPreset({ id, preset: fields.preset, expectedRevision,
              route: this.config.rootRouteId ?? brandString<NativeRootRouteId>('root') }, accepted)
          }
          return { changed: true }
        }
        if (endpoint === 'session/history') return readNativeSessionHistory(id, {
          active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
          label: 'native web session', onCleanupFailure: (error) =>{  this.requests.recordCleanupFailure(error) },
        }, accepted)
        if (endpoint === 'session/status') {
          const exists = this.turns.has(id) || await this.persistence.stat(id, { signal: accepted }) !== undefined
          return { status: this.turns.get(id)?.settled === false ? 'running' : exists ? 'idle' : 'unknown' }
        }
        if (endpoint === 'session/cancel') {
          const turn = this.turns.get(id)
          if (turn === undefined || turn.settled || fields.admissionId !== undefined && fields.admissionId !== turn.admissionId) {
            return { cancelled: false }
          }
          turn.controller.abort({ kind: 'user' })
          await turn.done
          return { cancelled: true }
        }
        throw new Error('native web session: unsupported endpoint')
      }) }
    } catch (error: unknown) {
      return { ok: false, error: { code: 'native/session', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }

  /** Close admission, cancel turns and await accepted readers and writer settlement.
   * @returns completion including actual reader cleanup failures.
   */
  async close(): Promise<void> {
    this.shutdown.abort(new Error('native Session follow: disposed'))
    const results = await Promise.allSettled([this.requests.close(), this.controls.close(), this.settlements.close()])
    this.turns.clear()
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native web session: request cleanup failed')
  }
}

/** Native Host Session installer; the Web Host remains the selected application. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-web-session-controller', targets: ['host'],
  requires: ['hostConnection', 'fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'modelSelection', 'modelDirectory', 'agentPresets', 'workspaceRegistry', 'agentInstructions'],
  provides: ['nativeWebSession', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeWebSessionConfig(input)
    return (context) => {
      const { maxPendingRequests: _pending, maxHistoryEvents: _history, maxPromptChars: _prompt,
        maxFollowBufferBytes: _buffer, maxFollowers: _followers, ...turn } = config
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
      })
      const models = context.optional('modelSelection')
      const service = new NativeWebSessionService(executor, context.require('sessionPersistence'), context.require('activeSessions'), config, context.signal,
        { directory: context.optional('modelDirectory'), presets: context.optional('agentPresets'),
          models: models === undefined ? undefined : { selection: models, executionFor: agent => context.require('agents').execution(agent) } })
      context.own(() => service.close())
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => endpoints.has(endpoint),
        (endpoint, payload, signal) => service.handle(endpoint, payload, signal)))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.follow(request) }))
      context.provide('nativeWebSession', service)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}
