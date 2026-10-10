import { get as httpGet } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { ModelsError } from '@earendil-works/pi-ai'
import type { Credential, CredentialStore, ProviderAuthInteraction } from '@earendil-works/pi-ai'
import { AuthorizationError } from '@deepseek-ai/dsh-authorization/src/errors.ts'
import { errorChain } from '@deepseek-ai/dsh-llm/native'
import { createSiwcOAuth, isSiwcCredential } from '../src/siwc.ts'

function memoryCredentials(): CredentialStore {
  const values = new Map<string, Credential>()
  return {
    async read(providerId) {
      return values.get(providerId)
    },
    async list() {
      return [...values].map(([providerId, credential]) => ({ providerId, type: credential.type }))
    },
    async modify(providerId, mutate) {
      const next = await mutate(values.get(providerId))
      if (next === undefined) return values.get(providerId)
      values.set(providerId, next)
      return next
    },
    async delete(providerId) {
      values.delete(providerId)
    },
  }
}

describe('Sign in with ChatGPT OAuth', () => {
  it.each(['timeout', 'cancel'] as const)('closes the callback listener after %s', async (cause) => {
    const controller = new AbortController()
    const timeoutController = new AbortController()
    const timeout = cause === 'timeout'
      ? vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
      : undefined
    const authorizationReady = Promise.withResolvers<URL>()
    const oauth = createSiwcOAuth(memoryCredentials())
    const interaction = {
      signal: controller.signal,
      notify(event: { type: string; url?: string }) {
        if (event.type === 'auth_url' && event.url !== undefined) authorizationReady.resolve(new URL(event.url))
      },
      prompt: async () => '',
    } as ProviderAuthInteraction
    try {
      const login = oauth.login(interaction, { getDeviceId: () => 'callback-test-host' })
      const authorization = await authorizationReady.promise
      if (cause === 'timeout') timeoutController.abort()
      else controller.abort(new Error('test cancelled the authorization'))

      await expect(login).rejects.toThrow(cause === 'timeout'
        ? 'timed out waiting for the browser callback'
        : 'test cancelled the authorization')
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      await expect(new Promise<void>((resolve, reject) => {
        const request = httpGet(callback, (response) => {
          response.resume()
          response.on('end', resolve)
        })
        request.on('error', reject)
      })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    } finally {
      timeout?.mockRestore()
    }
  })

  it('registers with PKCE, verifies the account token, and rotates the saved refresh grant', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const kid = 'siwc-test-signing-key'
    const jwk = { ...await exportJWK(publicKey), kid, alg: 'RS256', use: 'sig' }
    const issuedClientId = 'issued-test-client-id'
    const access = 'synthetic-account-access-token'
    const refresh = 'synthetic-account-refresh-token'
    let grantScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
    let tokenError: { error?: unknown; error_description?: unknown } | undefined
    let expiration: number | undefined = Math.floor(Date.now() / 1000) + 3600
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === 'https://auth.openai.com/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://auth.openai.com/api/accounts/oauth/token') {
        const form = new URLSearchParams(init?.body as string)
        if (form.get('grant_type') === 'authorization_code') {
          if (tokenError !== undefined) return new Response(JSON.stringify(tokenError), {
            status: 400, headers: { 'content-type': 'application/json' },
          })
          expect(form.get('client_id')).toBe(issuedClientId)
          expect(form.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
          expect(await credentials.read('openai-codex-siwc-registration')).toEqual({
            type: 'api_key',
            key: 'siwc-registration-v1:{"clientId":"issued-test-client-id","extAgentHostId":"stable-host-id"}',
          })
          return new Response(JSON.stringify({
            access_token: access,
            refresh_token: refresh,
            id_token: await new SignJWT({
              nonce: authorizationNonce,
              ...expiration === undefined ? {} : { exp: expiration },
            })
              .setProtectedHeader({ alg: 'RS256', kid })
              .setIssuer('https://auth.openai.com')
              .setAudience(issuedClientId)
              .setSubject('synthetic-account-subject')
              .sign(privateKey),
            token_type: 'Bearer',
            expires_in: 3600,
            scope: grantScopes,
          }), { headers: { 'content-type': 'application/json' } })
        }
        expect(form.get('grant_type')).toBe('refresh_token')
        expect(form.get('client_id')).toBe(issuedClientId)
        expect(form.get('refresh_token')).toBe(refresh)
        expect(form.has('scope')).toBe(false)
        return new Response(JSON.stringify({
          access_token: 'synthetic-rotated-access-token',
          refresh_token: 'synthetic-rotated-refresh-token',
          expires_in: 3600,
        }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected test request to ${url}`)
    })

    let authorizationNonce = ''
    const authorizationWaiters: Array<(url: URL) => void> = []
    const nextAuthorization = (): Promise<URL> => new Promise((resolve) => { authorizationWaiters.push(resolve) })
    const credentials = memoryCredentials()
    const oauth = createSiwcOAuth(credentials)
    let authorizationInstructions: string | undefined
    const interaction = {
      signal: new AbortController().signal,
      notify(event: { type: string; url?: string; instructions?: string }) {
        if (event.type === 'auth_url' && event.url !== undefined) {
          authorizationWaiters.shift()?.(new URL(event.url))
        }
        authorizationInstructions = event.instructions
      },
      prompt: async () => '',
    } as ProviderAuthInteraction
    const completeCallback = async (authorization: URL): Promise<string> => {
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({
        state: authorization.searchParams.get('state')!,
        code: 'synthetic-code',
        client_id: issuedClientId,
      }).toString()
      return new Promise<string>((resolve, reject) => {
        const request = httpGet(callback, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          response.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
        })
        request.on('error', reject)
      })
    }
    try {
      const authorizationReady = nextAuthorization()
      const login = oauth.login(interaction, { getDeviceId: () => 'stable-host-id' })
      const authorization = await authorizationReady
      authorizationNonce = authorization.searchParams.get('nonce') ?? ''
      expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client')
      expect(authorization.searchParams.get('agent_name_hint')).toBe('RedSpark Harness')
      expect(authorizationInstructions).toBe('Continue in your browser to authorize RedSpark Harness for ChatGPT plan usage.')
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      expect(authorization.searchParams.get('ext_agent_host_id')).toBe('stable-host-id')
      expect(await credentials.read('openai-codex-siwc-registration')).toEqual({
        type: 'api_key',
        key: 'siwc-registration-v1:{"extAgentHostId":"stable-host-id"}',
      })
      expect(await completeCallback(authorization)).toBe('Sign-in received. Return to RedSpark Harness to finish.')

      const credential = await login
      expect(isSiwcCredential(credential)).toBe(true)
      if (!isSiwcCredential(credential)) throw new Error('synthetic login did not produce an SIWC credential')
      expect(credential).toMatchObject({
        type: 'oauth', access, refresh, siwc: 'chatgpt-plan', clientId: issuedClientId,
        subject: 'synthetic-account-subject', extAgentHostId: 'stable-host-id',
      })
      expect(credential.scopes).toContain('chatgpt.tokens.use.direct')
      await expect(oauth.toAuth(credential)).resolves.toEqual({ apiKey: access })
      await expect(oauth.toAuth({ ...credential, clientId: undefined })).rejects.toThrow(
        'ChatGPT subscription credential is incomplete; sign in with ChatGPT again (missing or invalid fields: clientId)')
      const missingScopeCredential = { ...credential, scopes: ['openid', 'profile'] }
      const missingScopeMessage = 'ChatGPT plan usage was not granted for this account; sign in with ChatGPT again and approve plan usage'
      await expect(oauth.toAuth(missingScopeCredential)).rejects.toThrow(missingScopeMessage)
      const missingScopeFailure: unknown = await oauth.toAuth(missingScopeCredential).then(
        () => new Error('expected toAuth to reject'),
        (error: unknown) => error,
      )
      const modelsError = new ModelsError('oauth', 'OAuth auth derivation failed for openai-codex', { cause: missingScopeFailure })
      expect(errorChain(modelsError)).toBe(`OAuth auth derivation failed for openai-codex: ${missingScopeMessage}`)
      const rotated = await oauth.refresh(credential, new AbortController().signal)
      expect(rotated).toMatchObject({
        access: 'synthetic-rotated-access-token',
        refresh: 'synthetic-rotated-refresh-token',
        subject: 'synthetic-account-subject',
      })
      tokenError = { error: 'invalid_grant', error_description: 'private diagnostic text' }
      const failedAuthorizationReady = nextAuthorization()
      const failedLogin = oauth.login(interaction, { getDeviceId: () => 'stable-host-id' })
        .then(() => undefined, (error: unknown) => error)
      const failedAuthorization = await failedAuthorizationReady
      authorizationNonce = failedAuthorization.searchParams.get('nonce') ?? ''
      expect(await completeCallback(failedAuthorization)).toBe('Sign-in received. Return to RedSpark Harness to finish.')
      const exchangeFailure = await failedLogin
      expect(exchangeFailure).toBeInstanceOf(AuthorizationError)
      expect(exchangeFailure).toMatchObject({ code: 'SIWC_TOKEN_EXCHANGE_FAILED' })
      expect((exchangeFailure as Error).message)
        .toBe('Sign in with ChatGPT authorization-code exchange failed with HTTP 400 (invalid_grant)')

      tokenError = undefined
      grantScopes = 'openid profile email'
      const missingScopeAuthorizationReady = nextAuthorization()
      const missingScopeLogin = oauth.login(interaction, { getDeviceId: () => 'stable-host-id' })
        .then(() => undefined, (error: unknown) => error)
      const missingScopeAuthorization = await missingScopeAuthorizationReady
      authorizationNonce = missingScopeAuthorization.searchParams.get('nonce') ?? ''
      expect(await completeCallback(missingScopeAuthorization)).toBe('Sign-in received. Return to RedSpark Harness to finish.')
      const scopeFailure = await missingScopeLogin
      expect(scopeFailure).toBeInstanceOf(AuthorizationError)
      expect(scopeFailure).toMatchObject({ code: 'SIWC_SCOPE_NOT_GRANTED' })
      expect((scopeFailure as Error).message)
        .toBe('Sign in with ChatGPT did not grant chatgpt.tokens.use.direct; granted scopes: openid, profile, email')
      grantScopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
      for (const invalidExpiration of [undefined, Math.floor(Date.now() / 1000) - 60]) {
        expiration = invalidExpiration
        const invalidAuthorizationReady = nextAuthorization()
        const invalidLogin = oauth.login(interaction, { getDeviceId: () => 'stable-host-id' })
          .then(() => undefined, (error: unknown) => error)
        const invalidAuthorization = await invalidAuthorizationReady
        authorizationNonce = invalidAuthorization.searchParams.get('nonce') ?? ''
        await completeCallback(invalidAuthorization)
        const code = invalidExpiration === undefined ? 'ERR_JWT_CLAIM_VALIDATION_FAILED' : 'ERR_JWT_EXPIRED'
        const identityFailure = await invalidLogin
        expect(identityFailure).toBeInstanceOf(AuthorizationError)
        expect(identityFailure).toMatchObject({ code: 'SIWC_ID_TOKEN_INVALID' })
        expect((identityFailure as Error).message).toBe(`Sign in with ChatGPT ID token verification failed: ${code} (exp)`)
      }
    } finally {
      fetch.mockRestore()
    }
  })
})
