/** Authenticated browser Session operations using the selected native execution authority. */
import { randomUUID } from 'node:crypto'
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
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'

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
  const { maxPendingRequests, maxHistoryEvents, maxPromptChars, ...turn } = object(input)
  return { ...resolveNativeHeadlessConfig(turn), maxPendingRequests: positive(maxPendingRequests, 'maxPendingRequests'),
    maxHistoryEvents: positive(maxHistoryEvents, 'maxHistoryEvents'), maxPromptChars: positive(maxPromptChars, 'maxPromptChars') }
}

const endpoints = new Set(['session/list', 'session/history', 'session/create', 'session/prompt', 'session/cancel', 'session/status'])

/** Browser transport Consumer; the executor retains the sole Agent and Session writer. */
export class NativeWebSessionService {
  private readonly turns = new Map<SessionId, { controller: AbortController; done: Promise<unknown> }>()
  private readonly requests: NativeConnectionRequestOwner
  private readonly controls: NativeConnectionRequestOwner

  /**
   * @param executor - shared Program executor, not another Agent loop.
   * @param persistence - selected durable Session index.
   * @param active - selected exact live writer registry.
   * @param config - validated execution and wire limits.
   * @param lifetime - installation cancellation.
   */
  constructor(private readonly executor: NativeHeadlessApplication,
    private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations,
    private readonly config: Config, lifetime: AbortSignal) {
    this.requests = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.controls = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
  }

  /** Handle an authenticated decoded Connection request.
   * @param endpoint - owned Session endpoint.
   * @param payload - unknown wire fields.
   * @param signal - real carrier request cancellation.
   * @returns success after durable settlement, or an explicit failure.
   */
  async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      const admission = endpoint === 'session/cancel' || endpoint === 'session/status' ? this.controls : this.requests
      return { ok: true, value: await admission.run(signal, async (accepted) => {
        const fields = object(payload)
        const allowed = endpoint === 'session/prompt' ? ['sessionId', 'text', 'resume']
          : endpoint === 'session/list' || endpoint === 'session/create' ? [] : ['sessionId']
        for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`native web session: unexpected field ${key}`)
        if (endpoint === 'session/list') return (await this.persistence.list({ signal: accepted })).map(item => item.header)
        if (endpoint === 'session/create') {
          const id = SessionId(randomUUID())
          await this.executor.executeSessionOperation({ id, resume: false }, () => Promise.resolve(undefined), accepted)
          return { sessionId: id }
        }
        const id = sessionId(fields.sessionId)
        if (endpoint === 'session/history') return readNativeSessionHistory(id, {
          active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
          label: 'native web session', onCleanupFailure: (error) =>{  this.requests.recordCleanupFailure(error) },
        }, accepted)
        if (endpoint === 'session/status') {
          const exists = this.turns.has(id) || await this.persistence.stat(id, { signal: accepted }) !== undefined
          return { status: this.turns.has(id) ? 'running' : exists ? 'idle' : 'unknown' }
        }
        if (endpoint === 'session/cancel') {
          const turn = this.turns.get(id)
          if (turn === undefined) return { cancelled: false }
          turn.controller.abort({ kind: 'user' })
          await turn.done
          return { cancelled: true }
        }
        if (endpoint !== 'session/prompt') throw new Error('native web session: unsupported endpoint')
        if (typeof fields.text !== 'string' || fields.text.length === 0 || fields.text.length > this.config.maxPromptChars) {
          throw new TypeError('native web session: text exceeds configured limits or is empty')
        }
        if (typeof fields.resume !== 'boolean') throw new TypeError('native web session: resume must be explicit')
        if (this.turns.has(id)) throw new Error('native web session: Session already has a pending turn')
        const controller = new AbortController()
        const turnSignal = AbortSignal.any([accepted, controller.signal])
        const done = Promise.resolve().then(async () => {
          try {
            return await this.executor.executeRootTurn({ id, resume: fields.resume as boolean,
              message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: fields.text as string }] }) }, turnSignal)
          } catch (error: unknown) {
            // The executor rejects its exact cancellation reason only after its writer has drained.
            if (turnSignal.aborted && error === turnSignal.reason) return { exitCode: 130 }
            throw error
          }
        })
        const turn = { controller, done }
        this.turns.set(id, turn)
        try { return await done } finally { if (this.turns.get(id) === turn) this.turns.delete(id) }
      }) }
    } catch (error: unknown) {
      return { ok: false, error: { code: 'native/session', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }

  /** Close admission, cancel turns and await accepted readers and writer settlement.
   * @returns completion including actual reader cleanup failures.
   */
  async close(): Promise<void> {
    const results = await Promise.allSettled([this.requests.close(), this.controls.close()])
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native web session: request cleanup failed')
  }
}

/** Native Host Session installer; the Web Host remains the selected application. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-web-session-controller', targets: ['host'],
  requires: ['hostConnection', 'fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentPresets', 'workspaceRegistry'],
  provides: ['nativeWebSession', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeWebSessionConfig(input)
    return (context) => {
      const { maxPendingRequests: _pending, maxHistoryEvents: _history, maxPromptChars: _prompt, ...turn } = config
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
      })
      const service = new NativeWebSessionService(executor, context.require('sessionPersistence'), context.require('activeSessions'), config, context.signal)
      context.own(() => service.close())
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => endpoints.has(endpoint),
        (endpoint, payload, signal) => service.handle(endpoint, payload, signal)))
      context.provide('nativeWebSession', service)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}
