/** Raw Responses transport for one SIWC-bound Native Codex operation. */

import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm/native'
import type {
  NativeResponsesGenerationCapture,
  NativeResponsesJsonValue,
  NativeResponsesRoute,
  NativeResponsesTransport,
} from '@deepseek-ai/dsh-native-model-execution/responses-transport'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** SIWC identity fixed by the prepared adapter generation. */
export interface CodexAccountIdentity {
  /** SIWC issuer validated by the saved credential owner. */
  readonly issuer: string
  /** Account subject validated during sign-in. */
  readonly subject: string
  /** OAuth client that owns the saved grant. */
  readonly clientId: string
  /** Host id registered for the saved grant. */
  readonly extAgentHostId: string
  /** Account id required by the Codex Responses request header. */
  readonly accountId: string
}

/** Inputs retained by one prepared `openai-codex` model generation. */
export interface NativeCodexResponsesCaptureOptions {
  /** Exact route selected during `prepareCall()`. */
  readonly route: NativeResponsesRoute
  /** Input modalities declared by the selected account-catalog model. */
  readonly inputModalities: readonly string[]
  /** Identity read during `prepareCall()`, when a usable SIWC grant exists. */
  readonly identity: CodexAccountIdentity | undefined
  /** Identity error observed during `prepareCall()`, if the saved record was malformed. */
  readonly identityError?: unknown
  /** Profile headers after Harness attribution has claimed `User-Agent`. */
  readonly headers: Readonly<Record<string, string>>
  /** Captured whole-request timeout. */
  readonly timeoutMs: number | undefined
  /** Captured timeout while a consumer waits for the next response byte. */
  readonly streamIdleTimeoutMs: number | undefined
  /** Captured Provider installation lifetime. */
  readonly lifetimeSignal: AbortSignal
  /** Re-read the saved identity without starting or cancelling token refresh. */
  readonly readIdentity: () => Promise<CodexAccountIdentity | undefined>
  /** Resolve auth through pi-ai's credential refresh owner without an operation signal. */
  readonly resolveAuth: () => Promise<{ readonly accessToken: string; readonly identity: CodexAccountIdentity }>
  /** Track returned transports until their close has drained. */
  readonly onTransport: (transport: NativeResponsesTransport) => void
  /** Forget a transport after its close result settles. */
  readonly onClose: (transport: NativeResponsesTransport) => void
}

function isRecord(value: NativeResponsesJsonValue): value is Readonly<Record<string, NativeResponsesJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasInputImage(value: NativeResponsesJsonValue): boolean {
  if (Array.isArray(value)) return value.some(hasInputImage)
  if (!isRecord(value)) return false
  if (value.type === 'input_image') return true
  return Object.values(value).some(hasInputImage)
}

function sameIdentity(left: CodexAccountIdentity, right: CodexAccountIdentity): boolean {
  return left.issuer === right.issuer
    && left.subject === right.subject
    && left.clientId === right.clientId
    && left.extAgentHostId === right.extAgentHostId
    && left.accountId === right.accountId
}

function routeMismatch(): LlmError {
  return new LlmError('OpenAI Codex Native Responses route does not match the prepared model generation', 'ROUTE_MISMATCH')
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new LlmError('OpenAI Codex Native Responses operation was cancelled', 'ABORTED')
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
    const onAbort = (): void => { cleanup(); reject(aborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => { cleanup(); resolve(value) },
      (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error('OpenAI Codex Native Responses auth resolution failed'))
      },
    )
  })
}

/** Return a captured Codex transport generation with independent operation handles. */
export function createNativeCodexResponsesCapture(
  options: NativeCodexResponsesCaptureOptions,
): NativeResponsesGenerationCapture {
  return {
    async capture(request, signal): Promise<NativeResponsesTransport> {
      signal.throwIfAborted()
      options.lifetimeSignal.throwIfAborted()
      if (request.route.provider !== options.route.provider || request.route.model !== options.route.model) {
        throw routeMismatch()
      }
      if (request.maxTokens !== undefined) {
        throw new LlmError('OpenAI Codex Sign in with ChatGPT does not enforce an output-token limit', 'UNSUPPORTED_OPTION')
      }
      if (options.identityError !== undefined) {
        throw new LlmError('OpenAI Codex Sign in with ChatGPT account identity is invalid', 'INVALID_CREDENTIAL', {
          cause: options.identityError,
        })
      }
      const identity = options.identity
      if (identity === undefined) {
        throw new LlmError('OpenAI Codex Native Responses requires an active Sign in with ChatGPT account', 'MISSING_CREDENTIAL')
      }
      const current = await options.readIdentity()
      signal.throwIfAborted()
      if (current === undefined || !sameIdentity(identity, current)) {
        throw new LlmError('OpenAI Codex Sign in with ChatGPT account changed after model preparation', 'INVALID_CREDENTIAL')
      }
      options.lifetimeSignal.throwIfAborted()
      return createTransport(options, identity)
    },
  }
}

function createTransport(
  options: NativeCodexResponsesCaptureOptions,
  identity: CodexAccountIdentity,
): NativeResponsesTransport {
  const operation = new AbortController()
  const active = new Set<Promise<unknown>>()
  const credentialWork = new Set<Promise<unknown>>()
  let closed = false
  let projectRequested = false
  let forwarded = false
  let projectedJson: string | undefined
  let responseBody: TrackedResponseBody | undefined
  let closeResult: Promise<void> | undefined

  const track = <T>(work: Promise<T>, set: Set<Promise<unknown>> = active): Promise<T> => {
    set.add(work)
    void work.then(() => set.delete(work), () => set.delete(work))
    return work
  }

  const assertOpen = (signal: AbortSignal): void => {
    if (closed) throw new LlmError('OpenAI Codex Native Responses transport is closed', 'ABORTED')
    signal.throwIfAborted()
    operation.signal.throwIfAborted()
    options.lifetimeSignal.throwIfAborted()
  }

  const transport: NativeResponsesTransport = {
    route: { ...options.route },
    outputTokenLimit: 'unsupported',
    projectRequest(body, signal): Promise<NativeResponsesJsonValue> {
      assertOpen(signal)
      if (projectRequested) {
        return Promise.reject(new LlmError('OpenAI Codex Native Responses request was already projected', 'INVALID_REQUEST'))
      }
      projectRequested = true
      const work = Promise.resolve().then(() => {
        assertOpen(signal)
        if (!isRecord(body)
          || body.model !== options.route.model
          || body.stream !== true
          || !('input' in body)
          || typeof body.instructions !== 'string') {
          throw routeMismatch()
        }
        if ('max_output_tokens' in body) {
          throw new LlmError('OpenAI Codex Sign in with ChatGPT does not support max_output_tokens', 'UNSUPPORTED_OPTION')
        }
        if ('temperature' in body) {
          throw new LlmError('OpenAI Codex Sign in with ChatGPT does not support temperature', 'UNSUPPORTED_OPTION')
        }
        if (hasInputImage(body.input)) {
          const reason = options.inputModalities.includes('image')
            ? 'OpenAI Codex Responses image input has no attachment-backed request projection'
            : `OpenAI Codex model "${options.route.model}" does not support image input`
          throw new LlmError(reason, 'UNSUPPORTED_CONTENT')
        }
        const projected = { ...body, store: false }
        const serialized = JSON.stringify(projected)
        projectedJson = serialized
        return projected
      })
      return track(work)
    },
    forward(body, signal) {
      assertOpen(signal)
      if (forwarded) return Promise.reject(new LlmError('OpenAI Codex Native Responses transport forwards one request', 'INVALID_REQUEST'))
      if (projectedJson === undefined || JSON.stringify(body) !== projectedJson) {
        return Promise.reject(new LlmError('OpenAI Codex Native Responses must forward its final projected request', 'INVALID_REQUEST'))
      }
      forwarded = true
      const timeout = options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs)
      const requestSignal = AbortSignal.any([
        signal,
        operation.signal,
        options.lifetimeSignal,
        ...timeout === undefined ? [] : [timeout],
      ])
      const work = (async () => {
        requestSignal.throwIfAborted()
        const auth = track(options.resolveAuth(), credentialWork)
        const resolved = await awaitWithSignal(auth, requestSignal)
        if (!sameIdentity(identity, resolved.identity)
          || options.route.model !== transport.route.model) {
          throw new LlmError('OpenAI Codex Sign in with ChatGPT account changed before request forwarding', 'INVALID_CREDENTIAL')
        }
        requestSignal.throwIfAborted()
        const headers = new Headers(options.headers)
        headers.set('authorization', `Bearer ${resolved.accessToken}`)
        headers.set('chatgpt-account-id', identity.accountId)
        headers.set('originator', 'pi')
        headers.set('user-agent', attributionHeaders()['user-agent'] as string)
        headers.set('openai-beta', 'responses=experimental')
        headers.set('accept', 'text/event-stream')
        headers.set('content-type', 'application/json')
        const response = await fetch(CODEX_RESPONSES_URL, {
          method: 'POST',
          headers,
          body: projectedJson,
          signal: requestSignal,
        })
        if (response.body !== null) {
          responseBody = trackedResponseBody(response.body, operation, requestSignal, options.streamIdleTimeoutMs)
        }
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: responseBody?.stream ?? null,
        }
      })()
      return track(work)
    },
    close(): Promise<void> {
      if (closeResult !== undefined) return closeResult
      closed = true
      const reason = new LlmError('OpenAI Codex Native Responses transport is closed', 'ABORTED')
      closeResult = (async () => {
        operation.abort(reason)
        let closeError: Error | undefined
        try {
          await responseBody?.cancel(reason)
        } catch (error: unknown) {
          if (error !== reason) {
            closeError = error instanceof Error
              ? error
              : new Error('OpenAI Codex Native Responses response-body cancellation failed')
          }
        }
        const remaining = [...active, ...credentialWork]
        await Promise.allSettled(remaining)
        options.onClose(transport)
        if (closeError !== undefined) throw closeError
      })()
      return closeResult
    },
  }
  options.onTransport(transport)
  return transport
}

interface TrackedResponseBody {
  readonly stream: ReadableStream<Uint8Array>
  cancel(reason: Error): Promise<void>
}

function trackedResponseBody(
  body: ReadableStream<Uint8Array>,
  operation: AbortController,
  signal: AbortSignal,
  idleTimeoutMs: number | undefined,
): TrackedResponseBody {
  const reader = body.getReader()
  const reads = new Set<Promise<ReadableStreamReadResult<Uint8Array>>>()
  let settled = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let lockReleased = false
  const releaseLock = (): void => {
    if (lockReleased) return
    reader.releaseLock()
    lockReleased = true
  }

  const cancel = async (reason: Error): Promise<void> => {
    if (settled) {
      await Promise.allSettled([...reads])
      return
    }
    settled = true
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    const cancellation = reader.cancel(reason)
    await Promise.allSettled([...reads])
    try {
      await cancellation
    } finally {
      releaseLock()
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (settled) {
        controller.close()
        return
      }
      const read = reader.read()
      reads.add(read)
      if (idleTimeoutMs !== undefined) {
        idleTimer = setTimeout(() => {
          operation.abort(new LlmError(`OpenAI Codex Responses stream idle timeout after ${idleTimeoutMs}ms`, 'TIMEOUT'))
        }, idleTimeoutMs)
      }
      try {
        const result = await read
        if (result.done) {
          settled = true
          releaseLock()
          controller.close()
          return
        }
        controller.enqueue(result.value)
      } catch (error: unknown) {
        settled = true
        releaseLock()
        controller.error(error)
      } finally {
        reads.delete(read)
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        idleTimer = undefined
        if (signal.aborted) operation.abort(aborted(signal))
      }
    },
    async cancel(reason) {
      await cancel(reason instanceof Error ? reason : new LlmError('Responses body consumer cancelled', 'ABORTED'))
    },
  })
  return { stream, cancel }
}
