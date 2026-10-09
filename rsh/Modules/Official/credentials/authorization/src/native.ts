/**
 * Native authorization Definition and Provider: plugin-owned flows obtain a
 * credential through one neutral conversation of notices, prompts, answers and
 * cancellation, and commit it through the selected `credentials` Provider.
 *
 * Unlike the Cordis service, a native attempt is never orphaned: cancelling it,
 * removing its flow, or disposing the Provider aborts the flow's signal and
 * settles only after `run()` and the credential writes it admitted have
 * finished. The key stays claimed until then.
 *
 * @module @deepseek-ai/dsh-authorization/native
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeContext, NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { CredentialKey, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { AuthorizationDeclinedError, AuthorizationError } from './errors.ts'
import type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationFlow, AuthorizationFrame, AuthorizationOutcome,
  AuthorizationPrompt, AuthorizationPromptId, AuthorizationPromptView, AuthorizationSettlement,
} from './types.ts'

export { AuthorizationDeclinedError, AuthorizationError } from './errors.ts'
export type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationFlow, AuthorizationFrame, AuthorizationMethod,
  AuthorizationNotice, AuthorizationOutcome, AuthorizationPrompt, AuthorizationPromptId, AuthorizationPromptOption,
  AuthorizationPromptView, AuthorizationSession, AuthorizationSettlement, AuthorizationStatus,
} from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { authorization: NativeAuthorization }
  interface NativeEvents {
    /**
     * One attempt has fully drained and released its key.
     * @mode parallel
     * @param key - the credential record the attempt was authorizing.
     * @param settlement - how it ended, including `failed`.
     */
    'authorization/settled': { mode: 'parallel'; args: [key: CredentialKey, settlement: AuthorizationSettlement]; result: void }
  }
}

/** One request to start authorizing a key. */
export interface NativeAuthorizationRequest {
  /** The credential record to authorize; a flow must be registered for it. */
  readonly key: CredentialKey
  /** One of the flow's method ids; defaults to its first. */
  readonly method?: string
  /** Withdraws the whole attempt, like `cancel()`. */
  readonly signal?: AbortSignal
}

/** One running attempt, driven by a surface through its frames and commands. */
export interface NativeAuthorizationAttempt {
  readonly id: AuthorizationAttemptId
  readonly key: CredentialKey
  readonly method: string
  /**
   * The conversation so far, then live frames, ending after `settled`.
   * Each call replays from the first frame, so a reconnecting surface rebuilds
   * its view; aborting `signal` ends only this iteration.
   * @param signal - ends this iteration early.
   */
  frames(signal?: AbortSignal): AsyncIterable<AuthorizationFrame>
  /**
   * Answer an open prompt.
   * @param promptId - from a `prompt` frame.
   * @param value - typed text, or the chosen option's id.
   * @throws {AuthorizationError} code `PROMPT_NOT_FOUND` when the prompt is closed or unknown.
   */
  answer(promptId: AuthorizationPromptId, value: string): void
  /**
   * Decline an open prompt; the flow sees `AuthorizationDeclinedError` and the
   * attempt settles `cancelled` if the flow then fails.
   * @param promptId - from a `prompt` frame.
   * @throws {AuthorizationError} code `PROMPT_NOT_FOUND` when the prompt is closed or unknown.
   */
  decline(promptId: AuthorizationPromptId): void
  /**
   * Withdraw the attempt.
   * @returns after the flow and its admitted credential writes have settled and the key is released.
   */
  cancel(): Promise<void>
  /**
   * Settles with the attempt, after the drain `cancel()` describes.
   * Resolves `authorized` or `cancelled`; rejects with the flow's failure
   * (`AuthorizationError` code `NOT_COMMITTED` when it committed nothing).
   */
  readonly outcome: Promise<AuthorizationOutcome>
}

/** The `authorization` native service. */
export interface NativeAuthorization {
  /**
   * Offer a flow for one key.
   * @param flow - the key it writes, its label, methods and runner.
   * @returns removal that refuses new attempts, cancels the running one and
   *   resolves after it has drained.
   * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is claimed.
   */
  registerFlow(flow: AuthorizationFlow): () => Promise<void>
  /** @returns every registered flow, in registration order. */
  list(): readonly AuthorizationEntry[]
  /**
   * @param key - credential record address.
   * @returns the registered flow's entry, or undefined.
   */
  describe(key: CredentialKey): AuthorizationEntry | undefined
  /**
   * Start one attempt; at most one runs per key.
   * @param request - key, optional method and signal.
   * @returns the running attempt.
   * @throws {AuthorizationError} synchronously with code `NO_FLOW`,
   *   `UNKNOWN_METHOD`, `ALREADY_IN_FLIGHT` or `DISPOSED`.
   */
  begin(request: NativeAuthorizationRequest): NativeAuthorizationAttempt
  /**
   * @param key - credential record address.
   * @returns the attempt currently holding the key, so a second surface can watch or drive it.
   */
  current(key: CredentialKey): NativeAuthorizationAttempt | undefined
  /**
   * Withdraw the attempt for a key, if any.
   * @param key - credential record address.
   * @returns after that attempt has drained; immediately when none runs.
   */
  cancel(key: CredentialKey): Promise<void>
}

interface PendingPrompt {
  readonly finish: (value?: string, error?: unknown) => void
}

interface AttemptState {
  readonly id: AuthorizationAttemptId
  readonly key: CredentialKey
  readonly method: string
  readonly flow: AuthorizationFlow
  readonly controller: AbortController
  readonly frames: AuthorizationFrame[]
  readonly prompts: Map<AuthorizationPromptId, PendingPrompt>
  readonly readers: Set<() => void>
  readonly outcome: PromiseWithResolvers<AuthorizationOutcome>
  readonly completion: PromiseWithResolvers<void>
  attempt: NativeAuthorizationAttempt
  observedCommit: boolean
  observedDecline: boolean
  detachRequest?: () => void
}

/** Native Provider for the shared authorization conversation. */
export class NativeAuthorizationProvider implements NativeAuthorization {
  private readonly flows = new Map<CredentialKey, AuthorizationFlow>()
  private readonly running = new Map<CredentialKey, AttemptState>()
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * @param scope - event visibility root.
   * @param credentials - provider that stores records produced by flows.
   * @param context - Native Host event and registration context.
   */
  constructor(
    private readonly scope: NativeScope,
    private readonly credentials: NativeCredentials,
    private readonly context: Pick<NativeContext, 'events'>,
  ) {}

  /** @returns every flow, in registration order. */
  list(): readonly AuthorizationEntry[] {
    return [...this.flows.values()].map(flow => this.entry(flow))
  }

  /**
   * @param key - credential record address.
   * @returns the registered flow, or undefined.
   */
  describe(key: CredentialKey): AuthorizationEntry | undefined {
    const flow = this.flows.get(key)
    return flow === undefined ? undefined : this.entry(flow)
  }

  /**
   * Offer one flow for a credential key.
   * @param flow - the key, human-facing label, methods and runner.
   * @returns removal that cancels and drains its current attempt.
   * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
   */
  registerFlow(flow: AuthorizationFlow): () => Promise<void> {
    if (this.disposed) throw new AuthorizationError('authorization is disposed', 'DISPOSED')
    if (this.flows.has(flow.key)) {
      throw new AuthorizationError(`an authorization flow for "${flow.key}" is already registered`, 'DUPLICATE_FLOW')
    }
    this.flows.set(flow.key, flow)
    let removal: Promise<void> | undefined
    return () => {
      if (removal !== undefined) return removal
      if (this.flows.get(flow.key) === flow) this.flows.delete(flow.key)
      const attempt = this.running.get(flow.key)
      return removal = attempt?.flow === flow ? attempt.attempt.cancel() : Promise.resolve()
    }
  }

  /**
   * Start one attempt; at most one runs per key.
   * @param request - key, optional method and cancellation signal.
   * @returns the attempt handle.
   * @throws {AuthorizationError} codes `NO_FLOW`, `UNKNOWN_METHOD`, `ALREADY_IN_FLIGHT` or `DISPOSED`.
   */
  begin(request: NativeAuthorizationRequest): NativeAuthorizationAttempt {
    if (this.disposed) throw new AuthorizationError('authorization is disposed', 'DISPOSED')
    const flow = this.flows.get(request.key)
    if (flow === undefined) throw new AuthorizationError(`no authorization flow is registered for "${request.key}"`, 'NO_FLOW')
    const method = request.method ?? flow.methods[0].id
    if (!flow.methods.some(candidate => candidate.id === method)) {
      throw new AuthorizationError(`authorization flow for "${request.key}" offers no method "${method}"`, 'UNKNOWN_METHOD')
    }
    if (this.running.has(request.key)) {
      throw new AuthorizationError(`an authorization attempt for "${request.key}" is already running`, 'ALREADY_IN_FLIGHT')
    }

    const state = this.createAttempt(flow, method)
    this.running.set(request.key, state)
    const alreadyAborted = request.signal?.aborted === true
    if (alreadyAborted) state.controller.abort(request.signal?.reason)
    else if (request.signal !== undefined) {
      const withdraw = (): void => { state.controller.abort(request.signal?.reason) }
      request.signal.addEventListener('abort', withdraw, { once: true })
      state.detachRequest = () => request.signal?.removeEventListener('abort', withdraw)
    }
    void this.drain(state, alreadyAborted)
    return state.attempt
  }

  /**
   * @param key - credential record address.
   * @returns the attempt holding the key, or undefined.
   */
  current(key: CredentialKey): NativeAuthorizationAttempt | undefined {
    return this.running.get(key)?.attempt
  }

  /**
   * Withdraw the attempt holding a key.
   * @param key - credential record address.
   * @returns after its runner and admitted writes drain.
   */
  cancel(key: CredentialKey): Promise<void> {
    return this.running.get(key)?.attempt.cancel() ?? Promise.resolve()
  }

  /** Close admission, cancel attempts and wait for their full drain. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.flows.clear()
    const attempts = [...this.running.values()]
    return this.disposal = Promise.all(attempts.map(state => state.attempt.cancel())).then(() => undefined)
  }

  /**
   * Record commits only while the matching attempt owns the key.
   * @param key - committed record address.
   */
  recordUpdated(key: CredentialKey): void {
    const state = this.running.get(key)
    if (state !== undefined) state.observedCommit = true
  }

  private entry(flow: AuthorizationFlow): AuthorizationEntry {
    return { key: flow.key, label: flow.label, methods: flow.methods, inFlight: this.running.has(flow.key) }
  }

  private createAttempt(flow: AuthorizationFlow, method: string): AttemptState {
    const outcome = Promise.withResolvers<AuthorizationOutcome>()
    // Surfaces may follow the frames alone; a failure is still delivered to any `outcome` reader.
    outcome.promise.catch(() => {})
    const completion = Promise.withResolvers<void>()
    const state = {
      id: brandString<AuthorizationAttemptId>(globalThis.crypto.randomUUID()),
      key: flow.key,
      method,
      flow,
      controller: new AbortController(),
      frames: [],
      prompts: new Map<AuthorizationPromptId, PendingPrompt>(),
      readers: new Set<() => void>(),
      outcome,
      completion,
      observedCommit: false,
      observedDecline: false,
      attempt: undefined,
    } as unknown as AttemptState

    const attempt: NativeAuthorizationAttempt = {
      id: state.id,
      key: state.key,
      method: state.method,
      frames: signal => this.frames(state, signal),
      answer: (promptId, value) => this.finishPrompt(state, promptId, value),
      decline: promptId => this.declinePrompt(state, promptId),
      cancel: () => {
        if (!state.controller.signal.aborted) state.controller.abort()
        return completion.promise
      },
      outcome: outcome.promise,
    }
    state.attempt = attempt
    return state as AttemptState
  }

  private async *frames(state: AttemptState, signal?: AbortSignal): AsyncIterable<AuthorizationFrame> {
    let index = 0
    while (true) {
      if (signal?.aborted) return
      if (index < state.frames.length) {
        yield state.frames[index++] as AuthorizationFrame
        continue
      }
      if (state.frames.at(-1)?.type === 'settled' || signal?.aborted) return
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          state.readers.delete(wake)
          signal?.removeEventListener('abort', wake)
          resolve()
        }
        state.readers.add(wake)
        signal?.addEventListener('abort', wake, { once: true })
        if (signal?.aborted) wake()
      })
    }
  }

  private push(state: AttemptState, frame: AuthorizationFrame): void {
    if (state.frames.at(-1)?.type === 'settled') return
    state.frames.push(frame)
    for (const wake of [...state.readers]) wake()
  }

  private prompt(state: AttemptState, prompt: AuthorizationPrompt): Promise<string> {
    if (state.frames.at(-1)?.type === 'settled') {
      return Promise.reject(new AuthorizationError('authorization attempt has settled', 'PROMPT_NOT_FOUND'))
    }
    if (state.controller.signal.aborted) return Promise.reject(state.controller.signal.reason)
    const promptId = brandString<AuthorizationPromptId>(globalThis.crypto.randomUUID())
    const view: AuthorizationPromptView = prompt.kind === 'select'
      ? { kind: prompt.kind, message: prompt.message, options: prompt.options }
      : { kind: prompt.kind, message: prompt.message, ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder } }
    this.push(state, { type: 'prompt', promptId, prompt: view })
    return new Promise<string>((resolve, reject) => {
      const detach: (() => void)[] = []
      const finish = (value?: string, error?: unknown): void => {
        if (!state.prompts.has(promptId)) return
        state.prompts.delete(promptId)
        for (const remove of detach) remove()
        this.push(state, { type: 'prompt-closed', promptId })
        if (error === undefined) resolve(value as string)
        else reject(error)
      }
      state.prompts.set(promptId, { finish })
      const onAbort = (signal: AbortSignal): void => finish(undefined, signal.reason)
      const promptSignal = prompt.signal
      if (promptSignal !== undefined) {
        const withdraw = (): void => onAbort(promptSignal)
        promptSignal.addEventListener('abort', withdraw, { once: true })
        detach.push(() => promptSignal.removeEventListener('abort', withdraw))
        if (promptSignal.aborted) withdraw()
      }
      const withdrawAttempt = (): void => onAbort(state.controller.signal)
      state.controller.signal.addEventListener('abort', withdrawAttempt, { once: true })
      detach.push(() => state.controller.signal.removeEventListener('abort', withdrawAttempt))
      if (state.controller.signal.aborted) withdrawAttempt()
    })
  }

  private finishPrompt(state: AttemptState, promptId: AuthorizationPromptId, value?: string, error?: unknown): void {
    const prompt = state.prompts.get(promptId)
    if (prompt === undefined) throw new AuthorizationError(`authorization prompt "${promptId}" is not open`, 'PROMPT_NOT_FOUND')
    prompt.finish(value, error)
  }

  private declinePrompt(state: AttemptState, promptId: AuthorizationPromptId): void {
    if (!state.prompts.has(promptId)) {
      throw new AuthorizationError(`authorization prompt "${promptId}" is not open`, 'PROMPT_NOT_FOUND')
    }
    state.observedDecline = true
    this.finishPrompt(state, promptId, undefined, new AuthorizationDeclinedError())
  }

  private async drain(state: AttemptState, skipRun: boolean): Promise<void> {
    let settlement: AuthorizationSettlement = 'failed'
    let failure: unknown
    if (skipRun) {
      settlement = 'cancelled'
    } else {
      try {
        await state.flow.run({
          method: state.method,
          signal: state.controller.signal,
          notify: (notice) => { this.push(state, { type: 'notice', notice }) },
          prompt: prompt => this.prompt(state, prompt),
        })
        if (state.controller.signal.aborted) settlement = 'cancelled'
        else {
          const record = await this.credentials.describeRecord(state.key)
          if (state.controller.signal.aborted) settlement = 'cancelled'
          else if (state.observedCommit && record.configured) settlement = 'authorized'
          else {
            failure = new AuthorizationError(`authorization flow for "${state.key}" completed without committing its record`, 'NOT_COMMITTED')
          }
        }
      } catch (error) {
        if (state.controller.signal.aborted || state.observedDecline) settlement = 'cancelled'
        else failure = error
      }
    }

    for (const prompt of [...state.prompts.values()]) {
      prompt.finish(undefined, new Error('authorization flow ended before its prompt was answered'))
    }
    state.detachRequest?.()
    if (this.running.get(state.key) === state) this.running.delete(state.key)
    if (settlement === 'failed') {
      const code = failure instanceof AuthorizationError ? failure.code : 'FLOW_FAILED'
      this.push(state, { type: 'settled', settlement, code })
    } else this.push(state, { type: 'settled', settlement })

    try {
      await this.context.events.parallel(this.scope, 'authorization/settled', state.key, settlement)
    } catch (error) {
      console.warn('authorization: settled listener failed', error)
    }
    if (settlement === 'failed') state.outcome.reject(failure)
    else state.outcome.resolve({ status: settlement })
    state.completion.resolve()
  }
}

/** Native Host provider for authorization flows. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-authorization',
  targets: ['host'],
  requires: ['credentials'],
  provides: ['authorization'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new TypeError('authorization: configuration must be undefined or an empty object')
    }
    return (context) => {
      const service = new NativeAuthorizationProvider(context.scope, context.require('credentials'), context)
      context.on('credentials/record-updated', key => service.recordUpdated(key))
      context.own(() => service.dispose())
      context.provide('authorization', service)
    }
  },
}
