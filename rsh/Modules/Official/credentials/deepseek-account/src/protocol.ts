/** Validated Platform authorization messages and restricted browser destinations. */
import { z } from 'zod'

/** Protocol failures expose a stable code, never a response body or token. */
export class PlatformAuthError extends Error {
  /** @param code - safe error classification. */
  constructor(readonly code: 'network' | 'protocol' | 'expired' | 'storage') {
    super(`account: ${code}`)
  }
}

/** An authenticated Platform request was rejected with HTTP 401 or code 40003. */
export class AccountUnauthorizedError extends PlatformAuthError {
  constructor() { super('expired') }
}

/**
 * Validate the configured Platform origin, allowing HTTPS only.
 * @param value - configured origin.
 * @param allowLoopbackHttp - development-only loopback HTTP opt-in.
 * @returns normalized origin.
 */
export function platformOrigin(value: string, allowLoopbackHttp: boolean): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !(url.protocol === 'https:' || (allowLoopbackHttp && loopback && url.protocol === 'http:'))) {
    throw new Error('account: platformOrigin must be an HTTPS origin or explicitly enabled loopback HTTP origin')
  }
  return url.origin
}

/**
 * Accept only a Platform-owned browser page on the configured origin and fixed path.
 * @param value - URL returned by Platform.
 * @param origin - configured Platform origin.
 * @param path - required page path.
 * @returns the validated URL.
 */
export function browserUrl(value: string, origin: string, path: string): string {
  let url: URL
  try { url = new URL(value) } catch {
    console.info('[deepseek-account] browser URL rejected', { path, reason: 'invalid-url' })
    throw new PlatformAuthError('protocol')
  }
  if (url.origin !== origin || url.pathname !== path || url.username || url.password || url.hash) {
    console.info('[deepseek-account] browser URL rejected', {
      path, originMismatch: url.origin !== origin, pathMismatch: url.pathname !== path,
      hasCredentials: Boolean(url.username || url.password), hasFragment: Boolean(url.hash),
    })
    throw new PlatformAuthError('protocol')
  }
  return url.href
}

const envelope = z.object({ code: z.literal(0), data: z.object({ biz_code: z.number().int(), biz_data: z.unknown() }) })

/** Successful initialization response. */
export const initialization = z.object({
  authorize_url: z.url(), authorize_id: z.string().min(1), expires_in: z.number().positive(),
})

/** Successful authorization-code exchange response. */
export const exchange = z.object({
  token: z.string().regex(/^[\x21-\x7e]+$/), authorized_url: z.url(), user: z.unknown().optional(),
})

/**
 * POST one authorization operation and return its business payload.
 * @param origin - validated Platform origin.
 * @param signal - cancellation and timeout.
 * @param headers - client identity headers.
 * @param method - auth-api operation name.
 * @param body - request body, never logged.
 * @returns the business payload.
 */
export async function requestPlatform(
  origin: string, method: string, body: unknown, signal: AbortSignal, headers: Record<string, string>,
): Promise<unknown> {
  return platformRequest(`${origin}/auth-api/v0/dsh/${method}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, signal)
}

/**
 * GET one fixed account endpoint with its grant in the Platform authorization header.
 * @param origin - validated Platform origin.
 * @param signal - cancellation and timeout.
 * @param headers - client identity headers.
 * @param path - account endpoint.
 * @param token - stored account grant.
 * @returns the business payload.
 */
export function requestAccount(
  origin: string, path: '/auth-api/v0/users/current' | '/api/v0/users/get_user_summary',
  token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<unknown> {
  return platformRequest(`${origin}${path}`, { method: 'GET', headers: { ...headers, 'x-dsh-auth-token': token } }, signal)
}

/**
 * End a Platform session using its logout endpoint.
 * @param origin - validated Platform origin.
 * @param signal - cancellation and timeout.
 * @param headers - client identity headers.
 * @param token - stored account grant.
 * @returns after Platform confirms logout.
 */
export async function logoutAccount(
  origin: string, token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<void> {
  await platformRequest(`${origin}/auth-api/v0/users/logout`, {
    method: 'POST', headers: { ...headers, 'x-dsh-auth-token': token },
  }, signal)
}

async function platformRequest(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const path = new URL(url).pathname
  console.info('[deepseek-account] request', { path, method: init.method })
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal })
  } catch {
    console.info('[deepseek-account] request failed', { path, errorCode: 'network', aborted: signal.aborted })
    throw new PlatformAuthError('network')
  }
  console.info('[deepseek-account] response', { path, status: response.status })
  const hasToken = new Headers(init.headers).has('x-dsh-auth-token')
  if (response.status === 401 && hasToken) {
    await response.body?.cancel()
    throw new AccountUnauthorizedError()
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    throw new PlatformAuthError('network')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let stage = 'read-body'
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 65_536) {
        stage = 'body-limit'
        throw new PlatformAuthError('protocol')
      }
      chunks.push(next.value)
    }
    stage = 'parse-json'
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const authorization = z.object({ code: z.literal(40003) }).safeParse(payload)
    if (authorization.success && hasToken) throw new AccountUnauthorizedError()
    const codes = z.object({ code: z.number().int(), data: z.object({ biz_code: z.number().int() }).optional() }).safeParse(payload)
    if (codes.success) console.info('[deepseek-account] response codes', {
      path, code: codes.data.code, bizCode: codes.data.data?.biz_code,
    })
    stage = 'envelope'
    const parsed = envelope.safeParse(payload)
    if (!parsed.success) {
      console.info('[deepseek-account] envelope rejected', {
        path, issues: parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
      })
      throw new PlatformAuthError('protocol')
    }
    stage = 'business-code'
    if (parsed.data.data.biz_code !== 0) throw new PlatformAuthError('protocol')
    return parsed.data.data.biz_data
  } catch (error) {
    console.info('[deepseek-account] response rejected', {
      path, stage, errorCode: error instanceof PlatformAuthError ? error.code : 'protocol',
    })
    if (error instanceof PlatformAuthError) throw error
    throw new PlatformAuthError('protocol')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
