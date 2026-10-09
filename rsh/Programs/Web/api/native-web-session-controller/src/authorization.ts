/** Allowlisted browser operations for native credential authorization. */
import { z } from 'zod'
import { parseCredentialKey, type CredentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type { AuthorizationPromptId, NativeAuthorization, NativeAuthorizationAttempt } from '@deepseek-ai/dsh-authorization/native'
import { AuthorizationError } from '@deepseek-ai/dsh-authorization/native'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'

const listRequest = z.strictObject({})
const beginRequest = z.strictObject({ key: z.string(), method: z.string().optional() })
const answerRequest = z.strictObject({
  key: z.string(), attemptId: z.string(), promptId: z.string(), value: z.string(),
})
const declineRequest = z.strictObject({ key: z.string(), attemptId: z.string(), promptId: z.string() })
const cancelRequest = z.strictObject({ key: z.string(), attemptId: z.string() })

/** Restrict browser authorization to configured credential keys and safe flow metadata. */
export class NativeWebAuthorization {
  /**
   * @param providers - selected authorization and credential providers.
   * @param keys - credential keys the browser may authorize.
   * @param lifetime - plugin installation cancellation.
   */
  constructor(
    private readonly providers: { authorization: NativeAuthorization; credentials: NativeCredentials } | undefined,
    private readonly keys: readonly CredentialKey[],
    private readonly lifetime: AbortSignal,
  ) {}

  /** Handle one authenticated authorization RPC request.
   * @param endpoint - authorization RPC endpoint.
   * @param payload - unknown request fields.
   * @returns safe flow metadata or a command acknowledgement, wrapped in a Connection result.
   */
  async handle(endpoint: string, payload: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      if (endpoint === 'authorization/list') {
        listRequest.parse(payload)
        const providers = this.providers
        if (providers === undefined) return { ok: true, value: [] }
        const entries = providers.authorization.list().filter(entry => this.keys.includes(entry.key))
        return { ok: true, value: await Promise.all(entries.map(async (entry) => {
          const record = await providers.credentials.describeRecord(entry.key)
          const attemptId = providers.authorization.current(entry.key)?.id
          return { key: entry.key, label: entry.label, methods: entry.methods, configured: record.configured,
            writable: record.writable, ...(attemptId === undefined ? {} : { attemptId }) }
        })) }
      }
      if (endpoint === 'authorization/begin') {
        const request = beginRequest.parse(payload)
        const key = this.requireKey(request.key)
        const attempt = this.requireAuthorization().begin({ key, ...(request.method === undefined ? {} : { method: request.method }) })
        return { ok: true, value: { attemptId: attempt.id } }
      }
      if (endpoint === 'authorization/answer') {
        const request = answerRequest.parse(payload)
        const attempt = this.requireAttempt(request.key, request.attemptId)
        attempt.answer(request.promptId as AuthorizationPromptId, request.value)
        return { ok: true, value: { answered: true } }
      }
      if (endpoint === 'authorization/decline') {
        const request = declineRequest.parse(payload)
        const attempt = this.requireAttempt(request.key, request.attemptId)
        attempt.decline(request.promptId as AuthorizationPromptId)
        return { ok: true, value: { declined: true } }
      }
      if (endpoint === 'authorization/cancel') {
        const request = cancelRequest.parse(payload)
        const attempt = this.requireAttempt(request.key, request.attemptId)
        await attempt.cancel()
        return { ok: true, value: { cancelled: true } }
      }
      throw new Error(`native authorization: unsupported endpoint "${endpoint}"`)
    } catch (error: unknown) {
      return { ok: false, error: { code: 'native/authorization', message: 'Authorization request failed.',
        details: error instanceof AuthorizationError ? { authorizationCode: error.code } : {} } }
    }
  }

  /** Stream replayable, secret-free frames for one current attempt.
   * @param request - authenticated Fetch request.
   * @returns an SSE response, or 409 when the requested attempt is unavailable.
   */
  async frames(request: Request): Promise<Response> {
    const body = z.strictObject({ key: z.string(), attemptId: z.string() }).parse(await request.json())
    let attempt: NativeAuthorizationAttempt
    try { attempt = this.requireAttempt(body.key, body.attemptId) }
    catch { return new Response('native authorization: unavailable attempt', { status: 409 }) }
    const stop = new AbortController()
    const signal = AbortSignal.any([request.signal, this.lifetime, stop.signal])
    const iterator = attempt.frames(signal)[Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
      },
      cancel() { stop.abort() },
    }, { highWaterMark: 0 })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }

  private requireKey(value: string): CredentialKey {
    const key = parseCredentialKey(value)
    if (!this.keys.includes(key)) throw new Error('native authorization: credential key is not allowlisted')
    return key
  }

  private requireAuthorization(): NativeAuthorization {
    if (this.providers === undefined) throw new Error('native authorization: provider is unavailable')
    return this.providers.authorization
  }

  private requireAttempt(keyValue: string, attemptId: string) {
    const key = this.requireKey(keyValue)
    const attempt = this.requireAuthorization().current(key)
    if (attempt?.id !== attemptId) throw new Error('native authorization: unavailable attempt')
    return attempt
  }
}
