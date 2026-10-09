/** Allowlisted browser operations for native credential authorization. */
import { z } from 'zod'
import { parseCredentialKey, type CredentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type { AuthorizationPromptId, NativeAuthorization, NativeAuthorizationAttempt } from '@deepseek-ai/dsh-authorization/native'

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
   * @param authorization - selected authorization provider.
   * @param credentials - selected credential record descriptions.
   * @param keys - credential keys the browser may authorize.
   */
  constructor(
    private readonly authorization: NativeAuthorization | undefined,
    private readonly credentials: NativeCredentials | undefined,
    private readonly keys: readonly CredentialKey[],
  ) {}

  /** Handle one authenticated authorization RPC request.
   * @param endpoint - authorization RPC endpoint.
   * @param payload - unknown request fields.
   * @returns safe flow metadata or a command acknowledgement.
   */
  async handle(endpoint: string, payload: unknown): Promise<unknown> {
    if (endpoint === 'authorization/list') {
      listRequest.parse(payload)
      const authorization = this.authorization
      if (authorization === undefined) return []
      const entries = authorization.list().filter(entry => this.keys.includes(entry.key))
      return Promise.all(entries.map(async (entry) => {
        const record = await this.requireCredentials().describeRecord(entry.key)
        const attemptId = authorization.current(entry.key)?.id
        return { key: entry.key, label: entry.label, methods: entry.methods, configured: record.configured,
          writable: record.writable, ...(attemptId === undefined ? {} : { attemptId }) }
      }))
    }
    if (endpoint === 'authorization/begin') {
      const request = beginRequest.parse(payload)
      const key = this.requireKey(request.key)
      const attempt = this.requireAuthorization().begin({ key, ...(request.method === undefined ? {} : { method: request.method }) })
      return { attemptId: attempt.id }
    }
    if (endpoint === 'authorization/answer') {
      const request = answerRequest.parse(payload)
      const attempt = this.requireAttempt(request.key, request.attemptId)
      attempt.answer(request.promptId as AuthorizationPromptId, request.value)
      return { answered: true }
    }
    if (endpoint === 'authorization/decline') {
      const request = declineRequest.parse(payload)
      const attempt = this.requireAttempt(request.key, request.attemptId)
      attempt.decline(request.promptId as AuthorizationPromptId)
      return { declined: true }
    }
    if (endpoint === 'authorization/cancel') {
      const request = cancelRequest.parse(payload)
      const attempt = this.requireAttempt(request.key, request.attemptId)
      await attempt.cancel()
      return { cancelled: true }
    }
    throw new Error(`native authorization: unsupported endpoint "${endpoint}"`)
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
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const frame of attempt.frames(request.signal)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }

  private requireKey(value: string): CredentialKey {
    const key = parseCredentialKey(value)
    if (!this.keys.includes(key)) throw new Error('native authorization: credential key is not allowlisted')
    return key
  }

  private requireAuthorization(): NativeAuthorization {
    if (this.authorization === undefined) throw new Error('native authorization: provider is unavailable')
    return this.authorization
  }

  private requireCredentials(): NativeCredentials {
    if (this.credentials === undefined) throw new Error('native authorization: credentials are unavailable')
    return this.credentials
  }

  private requireAttempt(keyValue: string, attemptId: string) {
    const key = this.requireKey(keyValue)
    const attempt = this.requireAuthorization().current(key)
    if (attempt?.id !== attemptId) throw new Error('native authorization: unavailable attempt')
    return attempt
  }
}
