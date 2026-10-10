/** Native DeepSeek Platform account Provider and browser authorization flow. */
import { arch, platform, release } from 'node:os'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialKey, CredentialRecord, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { AuthorizationFlow, NativeAuthorization } from '@deepseek-ai/dsh-authorization/native'
import type { AccountBalanceResult, AccountProfileResult } from './index.ts'
import { readAccountDetail } from './details.ts'
import {
  AccountUnauthorizedError, PlatformAuthError, browserUrl, exchange, initialization, logoutAccount,
  platformOrigin, requestPlatform,
} from './protocol.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { deepseekAccount: DeepSeekAccount }
}

/** Native DeepSeek profile, balance, and sign-out operations. */
export interface DeepSeekAccount {
  readonly key: CredentialKey
  /** @param signal - caller cancellation.
   * @returns the current profile, a failed query, or null if signed out or the grant changes mid-request.
   */
  profile(signal?: AbortSignal): Promise<AccountProfileResult | null>
  /** @param signal - caller cancellation.
   * @returns current wallets, a failed query, or null if signed out or the grant changes mid-request.
   */
  balance(signal?: AbortSignal): Promise<AccountBalanceResult | null>
  /** @param signal - caller cancellation while local grant removal is queued.
   * @returns after authorization drains and any matching grant is removed; provider disposal drains Platform logout.
   */
  signOut(signal?: AbortSignal): Promise<void>
}

const KEY = credentialKey('deepseek-account', 'default')
const DEVICE_KEY = credentialKey('deepseek-account', 'device')
const REQUEST_TIMEOUT_MS = 20_000
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }
const grant = z.object({ version: z.literal(1), token: z.string().min(1), issuer: z.url() })
const device = z.object({ id: z.uuid() })

interface PlatformIdentity {
  readonly locale: 'zh_CN' | 'en_US'
  readonly headers: Record<string, string>
}

interface LoopbackCallback {
  readonly redirectUri: string
  readonly code: Promise<string>
  wait(): void
  redirect(url: string): void
  fail(): void
  close(): Promise<void>
}

/** Validate the only accepted native configuration field. */
function resolveConfig(input: unknown): { origin: string } {
  if (input === undefined) return { origin: 'https://platform.deepseek.com' }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('deepseek-account: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'platformOrigin') throw new TypeError(`deepseek-account: unknown native configuration field ${JSON.stringify(key)}`)
  }
  const value = fields['platformOrigin']
  if (value !== undefined && typeof value !== 'string') throw new TypeError('deepseek-account: platformOrigin must be a string')
  return { origin: platformOrigin(value ?? 'https://platform.deepseek.com', false) }
}

/** Build the Platform client identity used by account and authorization requests. */
function platformIdentity(): PlatformIdentity {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh_CN' : 'en_US'
  return {
    locale,
    headers: {
      'x-client-bundle-id': '',
      'x-client-platform': 'web',
      'x-client-version': version,
      'x-client-locale': locale,
      'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
    },
  }
}

function grantFrom(record: CredentialRecord | undefined, origin: string): z.infer<typeof grant> | undefined {
  if (record?.kind !== 'grant') return undefined
  const parsed = grant.safeParse(record.payload)
  return parsed.success && parsed.data.issuer === origin ? parsed.data : undefined
}

function operationSignal(lifetime: AbortSignal, caller?: AbortSignal): AbortSignal {
  return AbortSignal.any(caller === undefined ? [lifetime] : [lifetime, caller])
}

function sameGrant(record: CredentialRecord | undefined, token: string, origin: string): boolean {
  const current = grantFrom(record, origin)
  return current?.token === token
}

async function deleteGrant(
  credentials: NativeCredentials, token: string, origin: string, signal?: AbortSignal,
): Promise<void> {
  const when = (current: CredentialRecord): boolean => sameGrant(current, token, origin)
  await credentials.deleteRecord(KEY, signal === undefined ? { when } : { signal, when })
}

/** Create a loopback callback that accepts one state-matched authorization code. */
async function createLoopbackCallback(state: string, signal: AbortSignal): Promise<LoopbackCallback> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  let settled = false
  let waiting = false
  let accepted = false
  let callbackResponse: ServerResponse | undefined
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  void code.catch(() => undefined)
  const finish = (result: string | Error): void => {
    if (settled) return
    settled = true
    if (result instanceof Error) rejectCode(result)
    else resolveCode(result)
  }
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(404, { 'cache-control': 'no-store' }).end()
      return
    }
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1') }
    catch {
      response.writeHead(400, { 'cache-control': 'no-store' }).end()
      return
    }
    if (url.pathname !== '/oauth/callback') {
      response.writeHead(404, { 'cache-control': 'no-store' }).end()
      return
    }
    if (accepted || signal.aborted || !waiting) {
      response.writeHead(410, { 'cache-control': 'no-store' }).end()
      return
    }
    const states = url.searchParams.getAll('state')
    const codes = url.searchParams.getAll('code')
    const receivedState = states[0]
    const expected = Buffer.from(state)
    const received = Buffer.from(receivedState ?? '')
    const validState = states.length === 1 && received.byteLength === expected.byteLength
      && timingSafeEqual(expected, received)
    if (!validState || codes.length !== 1 || codes[0] === undefined || codes[0].length === 0) {
      response.writeHead(400, { 'cache-control': 'no-store' }).end()
      return
    }
    accepted = true
    waiting = false
    callbackResponse = response
    finish(codes[0])
  })
  const onError = (): void => { finish(new PlatformAuthError('network')) }
  server.once('error', onError)
  server.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
  } catch {
    server.close()
    throw new PlatformAuthError('network')
  }
  const onAbort = (): void => { finish(new PlatformAuthError('expired')) }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  const address = server.address() as AddressInfo
  const respond = (status: number, headers: Record<string, string>, body: string): void => {
    if (callbackResponse === undefined) return
    callbackResponse.writeHead(status, { 'cache-control': 'no-store', ...headers }).end(body)
    callbackResponse = undefined
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
    code,
    wait() { waiting = true },
    redirect(url) { respond(302, { location: url }, '') },
    fail() {
      respond(200, { 'content-type': 'text/html; charset=utf-8' },
        '<!doctype html><title>Sign-in failed</title><p>Sign-in failed. Return to the app and try again.</p>')
    },
    async close() {
      signal.removeEventListener('abort', onAbort)
      server.removeListener('error', onError)
      if (!server.listening) return
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    },
  }
}

/** Commit a browser authorization grant through the selected credential Provider. */
async function runSignIn(
  session: Parameters<AuthorizationFlow['run']>[0], credentials: NativeCredentials, origin: string,
  lifetime: AbortSignal, identity: PlatformIdentity,
): Promise<void> {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const deadline = new AbortController()
  const signal = AbortSignal.any([session.signal, lifetime, deadline.signal])
  let callback: LoopbackCallback | undefined
  let authorizeId: string | undefined
  let timer: NodeJS.Timeout | undefined
  try {
    callback = await createLoopbackCallback(state, signal)
    const redirectUri = callback.redirectUri
    const initPayload = await requestPlatform(origin, 'auth_init', {
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      redirect_uri: redirectUri,
      locale: identity.locale,
      login_source: 'web',
    }, AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]), identity.headers)
    const init = initialization.safeParse(initPayload)
    if (!init.success) throw new PlatformAuthError('protocol')
    const authorizeUrl = browserUrl(init.data.authorize_url, origin, '/dsh/authorize')
    authorizeId = init.data.authorize_id
    timer = setTimeout(() =>{  deadline.abort() }, init.data.expires_in * 1000)
    callback.wait()
    session.notify({ message: 'Open the DeepSeek sign-in page in your browser.', url: authorizeUrl })
    const code = await callback.code
    signal.throwIfAborted()

    let deviceRecord: CredentialRecord | undefined
    try {
      deviceRecord = await credentials.modifyRecord(DEVICE_KEY, current => Promise.resolve(current === undefined
        ? { kind: 'grant', payload: { id: randomUUID() } }
        : undefined), { signal })
    } catch {
      throw new PlatformAuthError('storage')
    }
    const deviceId = deviceRecord?.kind === 'grant' ? device.safeParse(deviceRecord.payload) : undefined
    if (!deviceId?.success) throw new PlatformAuthError('storage')

    const exchangePayload = await requestPlatform(origin, 'auth_exchange', {
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      device_id: deviceId.data.id,
      device_model: `${platform()}-${arch()}`,
      os_version: `${platform()} ${release()}`,
    }, AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]), identity.headers)
    const result = exchange.safeParse(exchangePayload)
    if (!result.success) throw new PlatformAuthError('protocol')
    const authorizedUrl = browserUrl(result.data.authorized_url, origin, '/dsh/authorized')
    signal.throwIfAborted()
    try {
      await credentials.modifyRecord(KEY, () => Promise.resolve({
        kind: 'grant', payload: { version: 1, token: result.data.token, issuer: origin },
      }), { signal })
    } catch {
      throw new PlatformAuthError('storage')
    }
    clearTimeout(timer)
    timer = undefined
    callback.redirect(authorizedUrl)
  } catch (error) {
    callback?.fail()
    if (session.signal.aborted) {
      throw session.signal.reason instanceof Error ? session.signal.reason : new Error('DeepSeek sign-in was cancelled')
    }
    const code = deadline.signal.aborted ? 'expired'
      : error instanceof PlatformAuthError ? error.code : 'protocol'
    const { AuthorizationError } = await import('@deepseek-ai/dsh-authorization/native')
    throw new AuthorizationError(`DeepSeek sign-in failed: ${code}`, `DEEPSEEK_SIGN_IN_${code.toUpperCase()}`)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (signal.aborted && authorizeId !== undefined) {
      await requestPlatform(origin, 'auth_cancel', { authorize_id: authorizeId, code_verifier: verifier },
        AbortSignal.timeout(REQUEST_TIMEOUT_MS), identity.headers).catch(() => undefined)
    }
    await callback?.close()
  }
}

function accountService(
  credentials: NativeCredentials, origin: string, lifetime: AbortSignal,
  authorization: NativeAuthorization | undefined, pending: Set<Promise<void>>,
): DeepSeekAccount {
  async function detail(field: 'profile', caller?: AbortSignal): Promise<AccountProfileResult | null>
  async function detail(field: 'balance', caller?: AbortSignal): Promise<AccountBalanceResult | null>
  async function detail(field: 'profile' | 'balance', caller?: AbortSignal): Promise<AccountProfileResult | AccountBalanceResult | null> {
    const operation = operationSignal(lifetime, caller)
    operation.throwIfAborted()
    const stored = grantFrom(await credentials.readRecord(KEY), origin)
    operation.throwIfAborted()
    if (stored === undefined) return null
    try {
      const requestSignal = AbortSignal.any([operation, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const headers = platformIdentity().headers
      const result = field === 'profile'
        ? await readAccountDetail('profile', origin, stored.token, requestSignal, headers)
        : await readAccountDetail('balance', origin, stored.token, requestSignal, headers)
      operation.throwIfAborted()
      if (result.status === 'ready') {
        const current = await credentials.readRecord(KEY)
        operation.throwIfAborted()
        if (!sameGrant(current, stored.token, origin)) return null
      }
      return result
    } catch (error) {
      if (!(error instanceof AccountUnauthorizedError)) throw error
      await deleteGrant(credentials, stored.token, origin)
      return null
    }
  }
  return {
    key: KEY,
    profile: signal => detail('profile', signal),
    balance: signal => detail('balance', signal),
    async signOut(signal) {
      if (authorization !== undefined) await authorization.cancel(KEY)
      const stored = grantFrom(await credentials.readRecord(KEY), origin)
      if (stored === undefined) return
      await deleteGrant(credentials, stored.token, origin, operationSignal(lifetime, signal))
      const logout = logoutAccount(origin, stored.token,
        AbortSignal.any([lifetime, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]), platformIdentity().headers)
        .catch(() => undefined)
      pending.add(logout)
      void logout.then(() => { pending.delete(logout) })
    },
  }
}

/** Register the native account service and, when available, its browser login flow. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-deepseek-account',
  targets: ['host'],
  requires: ['credentials'],
  optional: ['authorization'],
  provides: ['deepseekAccount'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context: NativeContext) => {
      const credentials = context.require('credentials')
      const authorization = context.optional('authorization')
      const pending = new Set<Promise<void>>()
      context.own(async () => { await Promise.all(pending) })
      if (authorization !== undefined) {
        const flow: AuthorizationFlow = {
          key: KEY,
          label: 'DeepSeek',
          methods: [{ id: 'browser', label: 'Sign in with browser' }],
          run: session => runSignIn(session, credentials, config.origin, context.signal, platformIdentity()),
        }
        context.effect(authorization.registerFlow(flow))
      }
      context.provide('deepseekAccount', accountService(credentials, config.origin, context.signal, authorization, pending))
    }
  },
}
