/** Sign in with ChatGPT OAuth for the public Responses API subscription route. */

import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { HarnessError } from '@deepseek-ai/dsh-llm/native'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { JSONWebKeySet } from 'jose'
import type { Credential, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'
import type { CredentialMetadataMigration, CredentialRecord } from '@deepseek-ai/dsh-credentials/native'

const ISSUER = 'https://auth.openai.com'
const AUTHORIZATION_URL = `${ISSUER}/api/accounts/authorize`
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`
const RESOURCE = 'https://api.openai.com/v1'
const FIRST_REGISTRATION_CLIENT_ID = 'dynamic_agent_client'
const REGISTRATION_MARKER = 'siwc-registration-v1:'
const REQUIRED_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const HOST_AGENT_NAME = 'RedSpark Harness'
const OAUTH_REQUEST_TIMEOUT_MS = 30_000
const CALLBACK_TIMEOUT_MS = 10 * 60_000
const SIWC_TOOL_NAMESPACE = 'harness'

/** Normalize SIWC Responses roles and tool namespaces while preserving existing namespace groups.
 * @param payload - Responses JSON body (mutated in place and returned).
 * @returns the same object with system roles mapped to developer and ungrouped tools and calls under `harness`.
 */
export function siwcResponsesPayload<T>(payload: T): T {
  const body = payload as unknown as {
    input?: { role?: string; type?: string; namespace?: string }[]
    tools?: unknown
  }
  if (body.input !== undefined) {
    for (const item of body.input) {
      if (item.role === 'system') item.role = 'developer'
      if ((item.type === 'function_call' || item.type === 'custom_tool_call') && item.namespace === undefined) {
        item.namespace = SIWC_TOOL_NAMESPACE
      }
    }
  }
  if (body.tools !== undefined) {
    const tools = body.tools as { type?: string }[]
    const ungrouped = tools.filter(tool => tool.type !== 'namespace')
    if (ungrouped.length > 0) {
      body.tools = [
        ...tools.filter(tool => tool.type === 'namespace'),
        {
          type: 'namespace',
          name: SIWC_TOOL_NAMESPACE,
          description: 'Tools the harness exposes to the model.',
          tools: ungrouped,
        },
      ]
    }
  }
  return payload
}

const SIWC_CREDENTIAL_FIELDS: readonly [string, (value: unknown) => boolean][] = [
  ['type', value => value === 'oauth'],
  ['siwc', value => value === 'chatgpt-plan'],
  ['issuer', value => value === ISSUER],
  ['clientId', value => typeof value === 'string'],
  ['subject', value => typeof value === 'string'],
  ['name', value => value === undefined || typeof value === 'string'],
  ['picture', value => value === undefined || typeof value === 'string'],
  ['idToken', value => typeof value === 'string'],
  ['extAgentHostId', value => typeof value === 'string'],
  ['scopes', value => Array.isArray(value)],
  ['access', value => typeof value === 'string'],
  ['refresh', value => typeof value === 'string'],
  ['expires', value => typeof value === 'number'],
]

function invalidSiwcCredentialFields(value: unknown): string[] {
  const credential = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  return SIWC_CREDENTIAL_FIELDS
    .filter(([field, valid]) => !valid(credential[field]))
    .map(([field]) => field)
}

/** SIWC credential fields retained beside pi-ai's refreshable OAuth tokens. */
export interface SiwcCredential extends OAuthCredential {
  readonly siwc: 'chatgpt-plan'
  readonly clientId: string
  readonly issuer: typeof ISSUER
  readonly subject: string
  readonly email?: string
  readonly name?: string
  readonly picture?: string
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
  return invalidSiwcCredentialFields(value).length === 0
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

/** Durable SIWC registration ids required to resume browser authorization without changing provider identity. */
export interface SiwcRegistrationMetadata {
  readonly clientId?: string
  readonly extAgentHostId: string
}

/** Durable storage adapter for SIWC registration identity, separate from pi-ai credentials. */
export interface SiwcRegistrationStore {
  /** Reconcile registration metadata with its grant and legacy record under the credentials provider's lock.
   * @param migrate - validates the current metadata, legacy record, and authorized grant before choosing persisted metadata.
   * @returns the verified registration metadata.
   */
  reconcile(
    migrate: (
      current: unknown,
      legacy: CredentialRecord | undefined,
      authorized: Credential | undefined,
    ) => Promise<CredentialMetadataMigration>,
  ): Promise<unknown>
  /** Persist callback-updated registration identity and read it back before continuing OAuth.
   * @param mutate - validates the current ids and returns the issued client id to persist.
   * @returns the verified registration metadata.
   */
  modify(mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
}

function registrationFrom(value: unknown): SiwcRegistrationMetadata | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Sign in with ChatGPT registration metadata is invalid')
  }
  const raw = value as Partial<SiwcRegistrationMetadata>
  if (typeof raw.extAgentHostId !== 'string' || raw.extAgentHostId.length === 0) {
    throw new Error('Sign in with ChatGPT registration metadata has no host ID')
  }
  if (raw.clientId !== undefined && (typeof raw.clientId !== 'string' || raw.clientId.length === 0)) {
    throw new Error('Sign in with ChatGPT registration metadata has an invalid client ID')
  }
  if (Object.keys(raw).some(key => key !== 'clientId' && key !== 'extAgentHostId')) {
    throw new Error('Sign in with ChatGPT registration metadata has unsupported fields')
  }
  return {
    extAgentHostId: raw.extAgentHostId,
    ...raw.clientId === undefined ? {} : { clientId: raw.clientId },
  }
}

function legacyRegistrationFrom(record: CredentialRecord | undefined): SiwcRegistrationMetadata | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'api-key' || record.env !== undefined
    || typeof record.key !== 'string' || !record.key.startsWith(REGISTRATION_MARKER)) {
    throw new Error('Sign in with ChatGPT legacy registration record is invalid and was preserved')
  }
  try {
    return registrationFrom(JSON.parse(record.key.slice(REGISTRATION_MARKER.length)))
  } catch {
    throw new Error('Sign in with ChatGPT legacy registration record is invalid and was preserved')
  }
}

/** Move valid legacy registration identity into metadata without inventing a replacement.
 * @param current - the owner metadata value, if one is present.
 * @param legacy - the old api-key record, if one is present.
 * @param authorized - an existing pi-ai credential read from the locked credential snapshot.
 * @returns the merged ids, or a retirement decision for the valid legacy record.
 * @throws when metadata, legacy ids, or the authorized account conflict; the legacy record remains stored.
 */
// oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics for the async reconciliation callback.
export async function migrateExistingSiwcRegistration(
  current: unknown,
  legacy: CredentialRecord | undefined,
  authorized?: Credential,
): Promise<CredentialMetadataMigration> {
  const saved = registrationFrom(current)
  const old = legacyRegistrationFrom(legacy)
  if (saved !== undefined && old !== undefined
    && (saved.extAgentHostId !== old.extAgentHostId
      || (saved.clientId !== undefined && old.clientId !== undefined && saved.clientId !== old.clientId))) {
    throw new Error('Sign in with ChatGPT registration identity conflicts with its legacy record; the record was preserved')
  }
  const clientId = saved?.clientId ?? old?.clientId
  const value = saved === undefined
    ? old
    : { extAgentHostId: saved.extAgentHostId, ...(clientId === undefined ? {} : { clientId }) }
  if (value !== undefined && isSiwcCredential(authorized)
    && (authorized.extAgentHostId !== value.extAgentHostId
      || (value.clientId !== undefined && authorized.clientId !== value.clientId))) {
    throw new Error('Sign in with ChatGPT registration identity conflicts with the authorized account; the legacy record was preserved')
  }
  return { value, retireRecord: legacy !== undefined }
}

function randomBase64Url(): string {
  return randomBytes(32).toString('base64url')
}

/** Bind one ephemeral loopback listener to the exact OAuth callback path. */
async function callbackListener(state: string, signal: AbortSignal): Promise<{
  readonly redirectUri: string
  readonly callback: Promise<CallbackResult>
  respond(success: boolean): Promise<void>
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
  let callbackResponse: ServerResponse | undefined
  const respond = (success: boolean): Promise<void> => {
    const response = callbackResponse
    callbackResponse = undefined
    if (response === undefined || response.destroyed) return Promise.resolve()
    return new Promise((resolve) => {
      const complete = (): void => {
        response.off('close', complete)
        response.off('error', complete)
        resolve()
      }
      response.once('error', complete)
      response.once('close', complete)
      response.writeHead(success ? 200 : 500, {
        'content-type': 'text/plain; charset=utf-8',
        connection: 'close',
      })
        .end(success ? 'Sign-in complete. You can close this tab.' : 'Sign-in could not be completed. Return to RedSpark Harness.')
    })
  }
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
      callbackResponse = response
      finish(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (returnedState !== state) {
      callbackResponse = response
      finish(new Error('Sign in with ChatGPT returned a mismatched state'))
      return
    }
    if (oauthError !== undefined) {
      callbackResponse = response
      finish(new Error(oauthError === 'access_denied'
        ? 'Sign in with ChatGPT was cancelled or plan usage was not approved'
        : 'Sign in with ChatGPT returned an OAuth error'))
      return
    }
    if (code === undefined || code.length === 0) {
      callbackResponse = response
      finish(new Error('Sign in with ChatGPT returned no authorization code'))
      return
    }
    callbackResponse = response
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
    } else {
      server.once('error', () => {})
      server.once('listening', () => { server.close() })
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
    respond,
    async close() {
      callbackSignal.removeEventListener('abort', onAbort)
      if (!server.listening) return
      await new Promise<void>((resolve) => {
        server.close(() => { resolve() })
        server.closeAllConnections()
      })
    },
  }
}

// RFC 6749 token-endpoint error codes; any other server value is omitted from diagnostics.
const OAUTH_ERROR_CODES = ['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope']

async function tokenResponse(response: Response, operation: string): Promise<TokenResponse> {
  // The fetch signal also bounds this body read, so it fails if that signal aborts.
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const errorCode = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as { error?: unknown }).error
      : undefined
    const message = `Sign in with ChatGPT ${operation} failed with HTTP ${response.status}`
      + (typeof errorCode === 'string' && OAUTH_ERROR_CODES.includes(errorCode) ? ` (${errorCode})` : '')
    if (operation === 'authorization-code exchange') {
      throw new HarnessError(message, 'SIWC_TOKEN_EXCHANGE_FAILED')
    }
    throw new Error(message)
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
  readonly name?: string
  readonly picture?: string
}> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)])
  const response = await fetch(JWKS_URL, { headers: { accept: 'application/json' }, signal: requestSignal })
  if (!response.ok) throw new Error(`Sign in with ChatGPT JWKS request failed with HTTP ${response.status}`)
  const keys = await response.json() as JSONWebKeySet
  requestSignal.throwIfAborted()
  const keySet = createLocalJWKSet(keys)
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    ({ payload } = await jwtVerify(idToken, keySet, {
      issuer: ISSUER,
      audience: clientId,
      requiredClaims: ['exp'],
    }))
  } catch (error: unknown) {
    const joseError = error as Error & { code?: string; claim?: string }
    throw new HarnessError(
      `Sign in with ChatGPT ID token verification failed: ${joseError.code ?? joseError.name}`
        + (joseError.claim === undefined ? '' : ` (${joseError.claim})`),
      'SIWC_ID_TOKEN_INVALID',
    )
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Sign in with ChatGPT ID token has no subject')
  }
  if (nonce !== undefined && payload.nonce !== nonce) {
    throw new Error('Sign in with ChatGPT ID token nonce did not match')
  }
  const pictureUrl = typeof payload.picture === 'string' && URL.canParse(payload.picture)
    ? new URL(payload.picture)
    : undefined
  return {
    subject: payload.sub,
    ...typeof payload.email === 'string' ? { email: payload.email } : {},
    ...typeof payload.name === 'string' ? { name: payload.name } : {},
    ...pictureUrl !== undefined && (pictureUrl.protocol === 'http:' || pictureUrl.protocol === 'https:')
      ? { picture: pictureUrl.href }
      : {},
  }
}

/**
 * Create pi-ai OAuth semantics while keeping registration metadata separate from OAuth grants.
 * The callback success page follows token and identity validation. Failures receive generic text.
 * Listener shutdown closes remaining connections.
 * @param registration - durable owner metadata store shared by Native and Cordis entry points.
 * @returns a pi-ai OAuth provider that signs in, refreshes, and resolves SIWC credentials.
 */
export function createSiwcOAuth(registration: SiwcRegistrationStore): OAuthAuth {
  return {
    name: 'Sign in with ChatGPT',
    loginLabel: 'Continue with ChatGPT',
    isSubscription: true,
    async login(interaction: ProviderAuthInteraction, options): Promise<OAuthCredential> {
      let previous: SiwcCredential | undefined
      const savedRegistration = registrationFrom(await registration.reconcile(async (current, legacy, authorized) => {
        previous = isSiwcCredential(authorized) ? authorized : undefined
        const migrated = await migrateExistingSiwcRegistration(current, legacy, authorized)
        const saved = registrationFrom(migrated.value)
        const extAgentHostId = saved?.extAgentHostId
          ?? previous?.extAgentHostId
          ?? options?.getDeviceId?.()
          ?? `urn:uuid:${randomUUID()}`
        const clientId = saved?.clientId ?? previous?.clientId
        return {
          value: { extAgentHostId, ...(clientId === undefined ? {} : { clientId }) },
          retireRecord: migrated.retireRecord,
        }
      }))
      if (savedRegistration === undefined) throw new Error('Sign in with ChatGPT registration metadata was not saved')
      const extAgentHostId = savedRegistration.extAgentHostId
      const clientId = savedRegistration.clientId ?? FIRST_REGISTRATION_CLIENT_ID
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
          instructions: 'Continue in your browser to authorize RedSpark Harness for ChatGPT plan usage.',
        })
        const returned = await listener.callback
        if (clientId === FIRST_REGISTRATION_CLIENT_ID) {
          if (returned.clientId === undefined || returned.clientId === FIRST_REGISTRATION_CLIENT_ID) {
            throw new Error('Sign in with ChatGPT registration returned no issued client ID')
          }
        } else if (returned.clientId !== undefined && returned.clientId !== clientId) {
          throw new Error('Sign in with ChatGPT returned a different client ID for this saved account')
        }
        const issuedClientId = returned.clientId ?? clientId
        if (issuedClientId !== FIRST_REGISTRATION_CLIENT_ID) {
          await registration.modify(
            // oxlint-disable-next-line typescript/require-await -- Preserve async rejection from metadata validation.
            async (current) => {
              const saved = registrationFrom(current)
              if (saved === undefined || saved.extAgentHostId !== extAgentHostId
                || (saved.clientId !== undefined && saved.clientId !== issuedClientId)) {
                throw new Error('Sign in with ChatGPT registration identity changed during browser sign-in')
              }
              return { extAgentHostId, clientId: issuedClientId }
            },
          )
        }
        interaction.signal.throwIfAborted()
        const form = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: issuedClientId,
          code: returned.code,
          code_verifier: verifier,
          redirect_uri: listener.redirectUri,
          resource: RESOURCE,
        })
        // The registration is already durable; cancellation now stops token exchange and grant creation.
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
          throw new HarnessError(
            `Sign in with ChatGPT did not grant ${REQUIRED_SCOPE}; granted scopes: ${scopes.filter(scope => SCOPES.split(' ').includes(scope)).join(', ') || 'none'}`,
            'SIWC_SCOPE_NOT_GRANTED',
          )
        }
        const identity = await verifiedIdentity(idToken, issuedClientId, nonce, interaction.signal)
        if (previous !== undefined && identity.subject !== previous.subject) {
          throw new Error('Sign in with ChatGPT selected a different account than the saved registration')
        }
        interaction.signal.throwIfAborted()
        const credential: OAuthCredential = {
          type: 'oauth',
          access,
          refresh,
          expires: expiresAt(tokens.expires_in),
          siwc: 'chatgpt-plan',
          clientId: issuedClientId,
          issuer: ISSUER,
          subject: identity.subject,
          ...identity.email === undefined ? {} : { email: identity.email },
          ...identity.name === undefined ? {} : { name: identity.name },
          ...identity.picture === undefined ? {} : { picture: identity.picture },
          idToken,
          extAgentHostId,
          scopes,
        }
        await listener.respond(true)
        return credential
      } finally {
        await listener.respond(false)
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
      const access = requiredString(tokens.access_token, 'access token')
      return {
        ...credential,
        access,
        refresh: requiredString(tokens.refresh_token, 'replacement refresh token'),
        expires: expiresAt(tokens.expires_in),
        scopes,
      }
    },
    toAuth(credential) {
      if (!isSiwcCredential(credential)) {
        return Promise.reject(new Error('ChatGPT subscription credential is incomplete; sign in with ChatGPT again'
          + ` (missing or invalid fields: ${invalidSiwcCredentialFields(credential).join(', ')})`))
      }
      if (!credential.scopes.includes(REQUIRED_SCOPE)) return Promise.reject(new Error(
        'ChatGPT plan usage was not granted for this account; sign in with ChatGPT again and approve plan usage'))
      return Promise.resolve({ apiKey: credential.access })
    },
  }
}
