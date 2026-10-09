/** Sign in with ChatGPT OAuth for the public Responses API subscription route. */

import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { JSONWebKeySet } from 'jose'
import type { CredentialStore, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'

const ISSUER = 'https://auth.openai.com'
const AUTHORIZATION_URL = `${ISSUER}/api/accounts/authorize`
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`
const RESOURCE = 'https://api.openai.com/v1'
const FIRST_REGISTRATION_CLIENT_ID = 'dynamic_agent_client'
const CODEX_PROVIDER_ID = 'openai-codex'
const REGISTRATION_STORE_ID = 'openai-codex-siwc-registration'
const REGISTRATION_MARKER = 'siwc-registration-v1:'
const REQUIRED_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const HOST_AGENT_NAME = 'DeepSeek Harness'
const OAUTH_REQUEST_TIMEOUT_MS = 30_000
const CALLBACK_TIMEOUT_MS = 10 * 60_000

/** SIWC credential fields retained beside pi-ai's refreshable OAuth tokens. */
export interface SiwcCredential extends OAuthCredential {
  readonly siwc: 'chatgpt-plan'
  readonly clientId: string
  readonly issuer: typeof ISSUER
  readonly subject: string
  readonly email?: string
  readonly idToken: string
  readonly extAgentHostId: string
  readonly scopes: readonly string[]
}

/**
 * Recognize this app's persisted SIWC credential shape.
 * @param value - unknown value read from the credential store.
 * @returns whether value has the saved SIWC OAuth credential shape.
 */
export function isSiwcCredential(value: unknown): value is SiwcCredential {
  if (value === null || typeof value !== 'object') return false
  const credential = value as Partial<SiwcCredential>
  return credential.type === 'oauth'
    && credential.siwc === 'chatgpt-plan'
    && credential.issuer === ISSUER
    && typeof credential.clientId === 'string'
    && typeof credential.subject === 'string'
    && typeof credential.idToken === 'string'
    && typeof credential.extAgentHostId === 'string'
    && Array.isArray(credential.scopes)
    && typeof credential.access === 'string'
    && typeof credential.refresh === 'string'
    && typeof credential.expires === 'number'
}

interface CallbackResult {
  readonly code: string
  readonly clientId?: string
}

interface TokenResponse {
  readonly access_token?: unknown
  readonly refresh_token?: unknown
  readonly id_token?: unknown
  readonly token_type?: unknown
  readonly expires_in?: unknown
  readonly scope?: unknown
}

interface RegistrationMetadata {
  readonly clientId?: string
  readonly extAgentHostId: string
}

function registrationFrom(value: unknown): RegistrationMetadata | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const credential = value as { type?: unknown; key?: unknown }
  if (credential.type !== 'api_key' || typeof credential.key !== 'string'
    || !credential.key.startsWith(REGISTRATION_MARKER)) return undefined
  try {
    const raw = JSON.parse(credential.key.slice(REGISTRATION_MARKER.length)) as Partial<RegistrationMetadata>
    if (typeof raw.extAgentHostId !== 'string' || raw.extAgentHostId.length === 0) return undefined
    if (raw.clientId !== undefined && (typeof raw.clientId !== 'string' || raw.clientId.length === 0)) return undefined
    return {
      extAgentHostId: raw.extAgentHostId,
      ...raw.clientId === undefined ? {} : { clientId: raw.clientId },
    }
  } catch {
    return undefined
  }
}

function registrationCredential(metadata: RegistrationMetadata): { type: 'api_key'; key: string } {
  return { type: 'api_key', key: `${REGISTRATION_MARKER}${JSON.stringify(metadata)}` }
}

function randomBase64Url(): string {
  return randomBytes(32).toString('base64url')
}

/** Bind one ephemeral loopback listener to the exact OAuth callback path. */
async function callbackListener(state: string, signal: AbortSignal): Promise<{
  readonly redirectUri: string
  readonly callback: Promise<CallbackResult>
  close(): Promise<void>
}> {
  const timeout = AbortSignal.timeout(CALLBACK_TIMEOUT_MS)
  const callbackSignal = AbortSignal.any([signal, timeout])
  let resolveCallback!: (value: CallbackResult) => void
  let rejectCallback!: (error: Error) => void
  let settled = false
  const callback = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  void callback.catch(() => {})
  const finish = (result: CallbackResult | Error): void => {
    if (settled) return
    settled = true
    if (result instanceof Error) rejectCallback(result)
    else resolveCallback(result)
  }
  const server = createServer((request, response) => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      response.writeHead(503).end()
      return
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${address.port}`)
    if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
      response.writeHead(404).end()
      return
    }
    const queryValue = (name: string): string | undefined => {
      const values = url.searchParams.getAll(name)
      if (values.length > 1) throw new Error(`Sign in with ChatGPT returned duplicate ${name} values`)
      return values[0]
    }
    let returnedState: string | undefined
    let oauthError: string | undefined
    let code: string | undefined
    let clientId: string | undefined
    try {
      returnedState = queryValue('state')
      oauthError = queryValue('error')
      code = queryValue('code')
      clientId = queryValue('client_id')
    } catch (error: unknown) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Sign-in callback was invalid.')
      finish(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (returnedState !== state) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Sign-in state did not match.')
      finish(new Error('Sign in with ChatGPT returned a mismatched state'))
      return
    }
    if (oauthError !== undefined) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Sign-in was not completed. You can close this tab.')
      finish(new Error(oauthError === 'access_denied'
        ? 'Sign in with ChatGPT was cancelled or plan usage was not approved'
        : 'Sign in with ChatGPT returned an OAuth error'))
      return
    }
    if (code === undefined || code.length === 0) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Sign-in did not return an authorization code.')
      finish(new Error('Sign in with ChatGPT returned no authorization code'))
      return
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Sign-in complete. You can close this tab.')
    finish({ code, ...clientId === undefined ? {} : { clientId } })
  })

  const onAbort = (): void => {
    finish(timeout.aborted
      ? new Error('Sign in with ChatGPT timed out waiting for the browser callback')
      : callbackSignal.reason instanceof Error ? callbackSignal.reason : new Error('Sign in with ChatGPT was cancelled'))
  }
  callbackSignal.throwIfAborted()
  callbackSignal.addEventListener('abort', onAbort, { once: true })
  server.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening', { signal: callbackSignal })
    callbackSignal.throwIfAborted()
  } catch (error: unknown) {
    callbackSignal.removeEventListener('abort', onAbort)
    if (server.listening) {
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    }
    throw error
  }
  const address = server.address()
  if (address === null || typeof address === 'string') {
    callbackSignal.removeEventListener('abort', onAbort)
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    throw new Error('Could not bind the Sign in with ChatGPT callback')
  }
  return {
    redirectUri: `http://127.0.0.1:${address.port}/auth/callback`,
    callback,
    async close() {
      callbackSignal.removeEventListener('abort', onAbort)
      if (!server.listening) return
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    },
  }
}

async function tokenResponse(response: Response, operation: string): Promise<TokenResponse> {
  // The fetch signal also bounds this body read, so it fails if that signal aborts.
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok) {
    throw new Error(`Sign in with ChatGPT ${operation} failed with HTTP ${response.status}`)
  }
  if (body === undefined || body === null || Array.isArray(body) || typeof body !== 'object') {
    throw new Error(`Sign in with ChatGPT ${operation} returned an invalid token response`)
  }
  return body
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Sign in with ChatGPT returned no ${field}`)
  return value
}

function scopesFrom(value: unknown, fallback?: readonly string[]): string[] {
  if (typeof value === 'string') return [...new Set(value.split(/\s+/).filter(Boolean))]
  if (fallback !== undefined) return [...fallback]
  throw new Error('Sign in with ChatGPT returned no granted scopes')
}

function expiresAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Sign in with ChatGPT returned an invalid expires_in value')
  }
  return Date.now() + value * 1000
}

async function verifiedIdentity(idToken: string, clientId: string, nonce: string | undefined, signal: AbortSignal): Promise<{
  readonly subject: string
  readonly email?: string
}> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)])
  const response = await fetch(JWKS_URL, { headers: { accept: 'application/json' }, signal: requestSignal })
  if (!response.ok) throw new Error(`Sign in with ChatGPT JWKS request failed with HTTP ${response.status}`)
  const keys = await response.json() as JSONWebKeySet
  requestSignal.throwIfAborted()
  const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
    issuer: ISSUER,
    audience: clientId,
    requiredClaims: ['exp'],
  })
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Sign in with ChatGPT ID token has no subject')
  }
  if (nonce !== undefined && payload.nonce !== nonce) {
    throw new Error('Sign in with ChatGPT ID token nonce did not match')
  }
  return {
    subject: payload.sub,
    ...typeof payload.email === 'string' ? { email: payload.email } : {},
  }
}

/**
 * Create pi-ai OAuth semantics while keeping this app's registration separate from Codex CLI credentials.
 * @param credentials - credential store for the SIWC registration and OAuth grant.
 * @returns a pi-ai OAuth provider that signs in, refreshes, and resolves SIWC credentials.
 */
export function createSiwcOAuth(credentials: CredentialStore): OAuthAuth {
  return {
    name: 'Sign in with ChatGPT',
    loginLabel: 'Continue with ChatGPT',
    isSubscription: true,
    async login(interaction: ProviderAuthInteraction, options): Promise<OAuthCredential> {
      const previousValue = await credentials.read(CODEX_PROVIDER_ID, { signal: interaction.signal })
      const previous = isSiwcCredential(previousValue) ? previousValue : undefined
      const savedRegistration = registrationFrom(
        await credentials.read(REGISTRATION_STORE_ID, { signal: interaction.signal }),
      )
      const extAgentHostId = previous?.extAgentHostId
        ?? savedRegistration?.extAgentHostId
        ?? options?.getDeviceId?.()
        ?? `urn:uuid:${randomUUID()}`
      const clientId = previous?.clientId ?? savedRegistration?.clientId ?? FIRST_REGISTRATION_CLIENT_ID
      await credentials.modify(
        REGISTRATION_STORE_ID,
        () => Promise.resolve(registrationCredential({
          extAgentHostId,
          ...clientId === FIRST_REGISTRATION_CLIENT_ID ? {} : { clientId },
        })),
        { signal: interaction.signal },
      )
      const state = randomBase64Url()
      const nonce = randomBase64Url()
      const verifier = randomBase64Url()
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const listener = await callbackListener(state, interaction.signal)
      try {
        const authorize = new URL(AUTHORIZATION_URL)
        authorize.search = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: listener.redirectUri,
          scope: SCOPES,
          resource: RESOURCE,
          state,
          nonce,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          ext_agent_host_id: extAgentHostId,
          ...clientId === FIRST_REGISTRATION_CLIENT_ID ? { agent_name_hint: HOST_AGENT_NAME } : {},
        }).toString()
        interaction.notify({
          type: 'auth_url',
          url: authorize.toString(),
          instructions: 'Continue in your browser to authorize DeepSeek Harness for ChatGPT plan usage.',
        })
        const returned = await listener.callback
        interaction.signal.throwIfAborted()
        if (clientId === FIRST_REGISTRATION_CLIENT_ID) {
          if (returned.clientId === undefined || returned.clientId === FIRST_REGISTRATION_CLIENT_ID) {
            throw new Error('Sign in with ChatGPT registration returned no issued client ID')
          }
        } else if (returned.clientId !== undefined && returned.clientId !== clientId) {
          throw new Error('Sign in with ChatGPT returned a different client ID for this saved account')
        }
        const issuedClientId = returned.clientId ?? clientId
        if (issuedClientId !== FIRST_REGISTRATION_CLIENT_ID) {
          await credentials.modify(
            REGISTRATION_STORE_ID,
            () => Promise.resolve(registrationCredential({ clientId: issuedClientId, extAgentHostId })),
            { signal: interaction.signal },
          )
        }
        const form = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: issuedClientId,
          code: returned.code,
          code_verifier: verifier,
          redirect_uri: listener.redirectUri,
          resource: RESOURCE,
        })
        // A cancelled sign-in stores nothing, so the code exchange may stop with the caller.
        const requestSignal = AbortSignal.any([interaction.signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)])
        const tokens = await tokenResponse(await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
          signal: requestSignal,
        }), 'authorization-code exchange')
        const access = requiredString(tokens.access_token, 'access token')
        const refresh = requiredString(tokens.refresh_token, 'refresh token')
        const idToken = requiredString(tokens.id_token, 'ID token')
        if (typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') {
          throw new Error('Sign in with ChatGPT returned an unsupported token_type')
        }
        const scopes = scopesFrom(tokens.scope)
        if (!scopes.includes(REQUIRED_SCOPE)) {
          throw new Error(`Sign in with ChatGPT did not grant ${REQUIRED_SCOPE}`)
        }
        const identity = await verifiedIdentity(idToken, issuedClientId, nonce, interaction.signal)
        if (previous !== undefined && identity.subject !== previous.subject) {
          throw new Error('Sign in with ChatGPT selected a different account than the saved registration')
        }
        interaction.signal.throwIfAborted()
        return {
          type: 'oauth',
          access,
          refresh,
          expires: expiresAt(tokens.expires_in),
          siwc: 'chatgpt-plan',
          clientId: issuedClientId,
          issuer: ISSUER,
          subject: identity.subject,
          ...identity.email === undefined ? {} : { email: identity.email },
          idToken,
          extAgentHostId,
          scopes,
        }
      } finally {
        await listener.close()
      }
    },
    async refresh(credential, _signal): Promise<OAuthCredential> {
      if (!isSiwcCredential(credential)) throw new Error('Sign in with ChatGPT again to use this subscription route')
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credential.clientId,
        refresh_token: credential.refresh,
        resource: RESOURCE,
      })
      // Only the timeout bounds a refresh: the issuer rotates the refresh token once it
      // answers, so a caller abort must not drop the response before it is committed.
      const tokens = await tokenResponse(await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
      }), 'token refresh')
      const scopes = scopesFrom(tokens.scope, credential.scopes)
      return {
        ...credential,
        access: requiredString(tokens.access_token, 'access token'),
        refresh: requiredString(tokens.refresh_token, 'replacement refresh token'),
        expires: expiresAt(tokens.expires_in),
        scopes,
      }
    },
    toAuth(credential) {
      if (!isSiwcCredential(credential) || !credential.scopes.includes(REQUIRED_SCOPE)) {
        return Promise.reject(new Error('Sign in with ChatGPT again and grant ChatGPT plan usage for this subscription route'))
      }
      return Promise.resolve({ apiKey: credential.access })
    },
  }
}
