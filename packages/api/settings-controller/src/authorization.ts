/** Browser Remote bridge for human-guided authorization flows. */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  AuthorizationError,
} from '@deepseek-ai/dsh-authorization'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationEntry,
  AuthorizationNotice,
  AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization/types'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AuthorizationAttemptId,
  AuthorizationEntryView,
  AuthorizationFrame,
  AuthorizationPromptId,
  AuthorizationPromptView,
} from './types.ts'

interface PendingPrompt {
  readonly resolve: (value: string) => void
  readonly reject: (reason: Error) => void
}

interface RemoteAttempt {
  readonly signal: AbortSignal
  readonly prompts: Map<AuthorizationPromptId, PendingPrompt>
}

/** Browser-exposed account flows selected by the deployment. */
export interface AuthorizationControllerConfig {
  /** Credential keys to expose; other registered flows remain Host-only. */
  readonly keys: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/** Minimal async queue for one authorization stream. */
class FrameQueue {
  private readonly frames: AuthorizationFrame[] = []
  private waiter: (() => void) | undefined
  private failure: Error | undefined
  private done = false

  push(frame: AuthorizationFrame): void {
    if (this.done) return
    this.frames.push(frame)
    if (frame.type === 'settled') this.done = true
    this.waiter?.()
  }

  fail(error: Error): void {
    if (this.done) return
    this.failure = error
    this.done = true
    this.waiter?.()
  }

  async * iterate(signal: AbortSignal): AsyncIterable<AuthorizationFrame> {
    const wake = (): void => { this.waiter?.() }
    signal.addEventListener('abort', wake, { once: true })
    try {
      while (true) {
        while (this.frames.length > 0) yield this.frames.shift() as AuthorizationFrame
        if (this.failure !== undefined) throw this.failure
        if (this.done || signal.aborted) return
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', wake)
    }
  }
}

/** Remove the process-local AbortSignal before a prompt crosses the wire. */
function promptView(prompt: AuthorizationPrompt): AuthorizationPromptView {
  switch (prompt.kind) {
    case 'select':
      return { kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return {
        kind: 'secret',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    case 'text':
      return {
        kind: 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
  }
}

function remoteFailure(error: unknown): RemoteError<'authorization/rejected'> {
  const messages: Readonly<Record<string, string>> = {
    ALREADY_IN_FLIGHT: 'account sign-in is already in progress',
    NO_FLOW: 'account sign-in is unavailable for this provider',
    NOT_COMMITTED: 'account sign-in finished without saving the account',
    UNKNOWN_METHOD: 'the selected account sign-in method is unavailable',
  }
  if (error instanceof AuthorizationError && Object.hasOwn(messages, error.code)) {
    return new RemoteError(
      'authorization/rejected',
      messages[error.code] as string,
      { authorizationCode: error.code },
      { cause: error },
    )
  }
  return new RemoteError(
    'authorization/rejected',
    'account sign-in failed; try again',
    {},
    { cause: error },
  )
}

function rejectionReason(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : fallback, { cause: reason })
}

/** Host owner of the generated `ctx.remote.authorization` namespace. */
export class AuthorizationController extends TypertRemoteService {
  private readonly attempts = new Map<AuthorizationAttemptId, RemoteAttempt>()
  private readonly keys: ReadonlySet<CredentialKey>

  /**
   * @param ctx - Host context carrying the optional authorization capability.
   * @param config - Explicit browser account-flow selection.
   */
  constructor(ctx: Context, config: AuthorizationControllerConfig = { keys: [] }) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
    this.keys = new Set(config.keys.map(key => parseCredentialKey(key)))
  }

  /**
   * List browser-enabled flows and their stored-record state.
   * @returns Enabled registered flows joined with redacted stored-record state.
   */
  @Remote
  async list(): Promise<AuthorizationEntryView[]> {
    const authorization = this.provider()
    const credentials = this.credentials()
    return Promise.all(authorization.list().filter(entry => this.keys.has(entry.key)).map(async (entry) => {
      const record = await credentials.describeRecord(entry.key)
      return {
        ...this.projectEntry(entry),
        configured: record.configured,
        writable: record.writable,
        ...record.kind === undefined ? {} : { kind: record.kind },
      }
    }))
  }

  /**
   * Run one flow and stream its notices and prompts to the initiating browser.
   * @param key - Credential key owned by the registered flow.
   * @param method - Optional flow-owned method identifier.
   * @param signal - Browser stream lifetime.
   * @returns Notices, prompts, and final status for this attempt.
   */
  @Remote({ mode: 'stream' })
  async * authorize(key: string, method: string | undefined, signal: AbortSignal): AsyncIterable<AuthorizationFrame> {
    let parsed: CredentialKey
    try {
      parsed = parseCredentialKey(key)
    } catch (error) {
      throw new RemoteError('gateway/bad-request', 'invalid authorization credential key', {}, { cause: error })
    }
    this.requireEnabled(parsed)
    const provider = this.provider()
    const lifetime = new AbortController()
    const attemptSignal = AbortSignal.any([signal, lifetime.signal])
    const attemptId = randomUUID() as AuthorizationAttemptId
    const attempt: RemoteAttempt = { signal: attemptSignal, prompts: new Map() }
    const queue = new FrameQueue()
    this.attempts.set(attemptId, attempt)
    queue.push({ type: 'started', attemptId })
    const running = provider.begin({
      key: parsed,
      ...method === undefined ? {} : { method },
      signal: attemptSignal,
      interaction: {
        notify: (notice: AuthorizationNotice) => { queue.push({ type: 'notice', notice }) },
        prompt: prompt => this.prompt(attemptId, attempt, queue, prompt),
      },
    }).then(
      (outcome) => { queue.push({ type: 'settled', status: outcome.status }) },
      (error: unknown) => { queue.fail(remoteFailure(error)) },
    )
    try {
      yield* queue.iterate(attemptSignal)
    } finally {
      lifetime.abort()
      for (const pending of attempt.prompts.values()) {
        pending.reject(rejectionReason(signal.reason, 'authorization ended'))
      }
      this.attempts.delete(attemptId)
      await running
    }
  }

  /**
   * Answer the prompt currently displayed for one attempt.
   * @param attemptId - Opaque identifier returned by the stream.
   * @param promptId - Opaque identifier of the pending prompt.
   * @param value - User-entered answer passed to the Host flow.
   */
  @Remote
  answer(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId, value: string): void {
    const prompt = this.pending(attemptId, promptId)
    prompt.resolve(value)
  }

  /**
   * Decline the prompt currently displayed for one attempt.
   * @param attemptId - Opaque identifier returned by the stream.
   * @param promptId - Opaque identifier of the pending prompt.
   */
  @Remote
  decline(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId): void {
    const prompt = this.pending(attemptId, promptId)
    prompt.reject(new AuthorizationDeclinedError())
  }

  private requireEnabled(key: CredentialKey): void {
    if (!this.keys.has(key)) {
      throw new RemoteError('authorization/rejected', 'account sign-in is not enabled for this provider', {})
    }
  }

  private prompt(
    attemptId: AuthorizationAttemptId,
    attempt: RemoteAttempt,
    queue: FrameQueue,
    prompt: AuthorizationPrompt,
  ): Promise<string> {
    if (attempt.signal.aborted) return Promise.reject(new Error('authorization ended'))
    if (prompt.signal?.aborted === true) return Promise.reject(rejectionReason(prompt.signal.reason, 'prompt withdrawn'))
    const promptId = randomUUID() as AuthorizationPromptId
    return new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        prompt.signal?.removeEventListener('abort', withdrawn)
        attempt.prompts.delete(promptId)
      }
      const withdrawn = (): void => {
        cleanup()
        reject(rejectionReason(prompt.signal?.reason, 'prompt withdrawn'))
      }
      attempt.prompts.set(promptId, {
        resolve: (value) => { cleanup(); resolve(value) },
        reject: (reason) => { cleanup(); reject(reason) },
      })
      prompt.signal?.addEventListener('abort', withdrawn, { once: true })
      queue.push({ type: 'prompt', attemptId, promptId, prompt: promptView(prompt) })
    })
  }

  private pending(attemptId: AuthorizationAttemptId, promptId: AuthorizationPromptId): PendingPrompt {
    const prompt = this.attempts.get(attemptId)?.prompts.get(promptId)
    if (prompt === undefined) {
      throw new RemoteError('authorization/prompt-not-found', 'authorization prompt is no longer awaiting an answer', {
        attemptId,
        promptId,
      })
    }
    return prompt
  }

  private provider(): AuthorizationService {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError('gateway/internal', 'authorization service is absent from this deployment', {})
    }
    return authorization
  }

  private credentials(): CredentialProvider {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new RemoteError('gateway/internal', 'credentials service is absent from this deployment', {})
    }
    return credentials
  }

  private projectEntry(entry: AuthorizationEntry): AuthorizationEntry {
    return { key: entry.key, label: entry.label, methods: entry.methods, inFlight: entry.inFlight }
  }
}

export default AuthorizationController
