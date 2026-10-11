import { get as httpGet } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialKey, type CredentialRecord, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization/native'
import { plugin, type DeepSeekAccount } from '../src/native.ts'

const KEY = credentialKey('deepseek-account', 'default')
const DEVICE_KEY = credentialKey('deepseek-account', 'device')
const ORIGIN = 'https://platform.deepseek.com'

function credentialStore(initial: readonly (readonly [string, CredentialRecord])[] = []) {
  const records = new Map<string, CredentialRecord>(initial)
  const credentials = {
    async readRecord(key: string) { return records.get(key) },
    async modifyRecord(key: string, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
    async deleteRecord(key: string, options?: { when?: (current: CredentialRecord) => boolean }) {
      const current = records.get(key)
      if (current !== undefined && options?.when?.(current) !== false) records.delete(key)
    },
  }
  return { records, credentials: credentials as unknown as NativeCredentials }
}

async function activate(
  credentials: NativeCredentials,
  authorization?: { registerFlow(flow: AuthorizationFlow): () => Promise<void> },
): Promise<{ service: DeepSeekAccount }> {
  let service: DeepSeekAccount | undefined
  const context = {
    signal: new AbortController().signal,
    require: () => credentials,
    optional: () => authorization,
    own: () => async () => undefined,
    effect: () => undefined,
    provide: (_key: string, value: unknown) => { service = value as DeepSeekAccount },
  }
  await plugin.resolve({})(context as unknown as NativeContext)
  return { service: service as DeepSeekAccount }
}

function platformReply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: data } }), {
    status, headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('native DeepSeek account Provider', () => {
  it.each([
    ['HTTP 401', () => new Response('', { status: 401 })],
    ['body code 40003', () => new Response(JSON.stringify({ code: 40003 }), { status: 200 })],
  ])('deletes the rejected current grant after balance reports %s', async (_case, response) => {
    const { records, credentials } = credentialStore([[KEY, {
      kind: 'grant', payload: { version: 1, token: 'token-secret', issuer: ORIGIN },
    }]])
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const { service } = await activate(credentials)

    await expect(service.balance()).resolves.toBeNull()
    expect(records.has(KEY)).toBe(false)
  })

  it('commits a browser grant and redirects the loopback callback to the authorized page', async () => {
    const { records, credentials } = credentialStore()
    const get = httpGet
    let flow: AuthorizationFlow | undefined
    const authorization = {
      registerFlow(value: AuthorizationFlow) {
        flow = value
        return async () => undefined
      },
    }
    await activate(credentials, authorization)
    let initBody: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      const body = JSON.parse(init?.body as string) as Record<string, string>
      if (url.endsWith('/auth_init')) {
        initBody = body
        return platformReply({
          authorize_url: `${ORIGIN}/dsh/authorize?from=test`, authorize_id: 'authorize-id', expires_in: 60,
        })
      }
      if (url.endsWith('/auth_exchange')) {
        return platformReply({
          token: 'issued-token', authorized_url: `${ORIGIN}/dsh/authorized?done=1`,
        })
      }
      throw new Error(`unexpected Platform request: ${new URL(url).pathname}`)
    }))
    const controller = new AbortController()
    let notify!: (notice: { url?: string }) => void
    const notified = new Promise<{ url?: string }>((resolve) => { notify = resolve })
    const session: AuthorizationSession = {
      method: 'browser', signal: controller.signal,
      notify: (notice) => { notify(notice) },
      prompt: async () => { throw new Error('unexpected prompt') },
    }
    const running = (flow as AuthorizationFlow).run(session)
    try {
      const notice = await Promise.race([
        notified,
        running.then(() => { throw new Error('authorization completed before notifying the browser URL') }),
      ])
      expect(notice).toMatchObject({ url: `${ORIGIN}/dsh/authorize?from=test` })
      const callback = new URL(initBody?.redirect_uri as string)
      callback.search = new URLSearchParams({ state: initBody?.state as string, code: 'auth-code' }).toString()
      type CallbackResponse = { readonly statusCode: number | undefined; readonly location: string | undefined }
      const response = await new Promise<CallbackResponse>((resolve, reject) => {
        get(callback, (response) => {
          response.resume()
          response.on('end', () =>{  resolve({ statusCode: response.statusCode, location: response.headers.location }) })
        }).on('error', reject)
      })
      await running

      expect(response.statusCode).toBe(302)
      expect(response.location).toBe(`${ORIGIN}/dsh/authorized?done=1`)
      expect(records.get(KEY)).toEqual({ kind: 'grant', payload: { version: 1, token: 'issued-token', issuer: ORIGIN } })
      expect(records.get(DEVICE_KEY)?.kind).toBe('grant')
    } finally {
      controller.abort()
      await running.catch(() => undefined)
    }
  })
})
