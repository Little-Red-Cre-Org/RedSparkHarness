import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@earendil-works/pi-ai'
import type { NativeResponsesJsonValue } from '@deepseek-ai/dsh-native-model-execution/responses-transport'
import { attributionHeaders } from '@deepseek-ai/dsh-llm/native'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import type { CodexUsageIdentity, CodexUsageObservation } from '../src/rate-limits.ts'
import { memoryAuth } from './auth-double.ts'

const MODEL = 'gpt-6.1-sol'
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct']

interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

type ResponseHandler = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>

interface LocalServer {
  readonly url: string
  readonly requests: RecordedRequest[]
  responses: ResponseHandler
  token: ResponseHandler
  close(): Promise<void>
}

const servers: LocalServer[] = []

function accessToken(accountId: string): string { return `opaque-access-${accountId}` }

function siwcCredential(accountId: string, overrides: Partial<Credential> = {}): Credential {
  return {
    type: 'oauth',
    access: accessToken(accountId),
    refresh: `refresh-${accountId}`,
    expires: Date.now() + 60 * 60_000,
    siwc: 'chatgpt-plan',
    clientId: 'fixture-client',
    issuer: 'https://auth.openai.com',
    subject: `subject-${accountId}`,
    idToken: 'fixture-id-token',
    extAgentHostId: 'fixture-host',
    scopes: SCOPES,
    ...overrides,
  }
}

async function localServer(): Promise<LocalServer> {
  const requests: RecordedRequest[] = []
  const handlers: Pick<LocalServer, 'responses' | 'token'> = {
    responses: (_request, response) => { response.writeHead(200).end() },
    token: (_request, response) => { response.writeHead(500).end() },
  }
  let closeResult: Promise<void> | undefined
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    incoming.on('end', () => {
      const request: RecordedRequest = {
        method: incoming.method ?? '',
        path: incoming.url ?? '/',
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(request)
      if (request.path === '/models') {
        outgoing.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ models: [{ slug: MODEL, display_name: 'GPT 6.1 Sol', visibility: 'list' }] }))
      } else if (request.path === '/token') {
        void handlers.token(request, outgoing)
      } else if (request.path === '/responses') {
        void handlers.responses(request, outgoing)
      } else {
        outgoing.writeHead(404).end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('local HTTP server has no TCP address')
  const local: LocalServer = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    get responses() { return handlers.responses },
    set responses(handler) { handlers.responses = handler },
    get token() { return handlers.token },
    set token(handler) { handlers.token = handler },
    close: () => {
      if (closeResult !== undefined) return closeResult
      server.closeAllConnections()
      closeResult = new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
      return closeResult
    },
  }
  servers.push(local)
  return local
}

function routeFetchThrough(server: LocalServer): void {
  const fetchUpstream = globalThis.fetch.bind(globalThis)
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
    if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/models') {
      return fetchUpstream(`${server.url}/models`, init)
    }
    if (url.origin === 'https://auth.openai.com' && url.pathname === '/api/accounts/oauth/token') {
      return fetchUpstream(`${server.url}/token`, init)
    }
    if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/responses') {
      return fetchUpstream(`${server.url}/responses`, init)
    }
    return fetchUpstream(input, init)
  })
}

function adapterWith(
  auth: ReturnType<typeof memoryAuth>,
  profiles: () => ReturnType<typeof resolveProfiles>,
): PiAiAdapter {
  return new PiAiAdapter({ profiles, resolveApiKey: () => Promise.resolve(undefined), auth })
}

function requestBody(model = MODEL): Readonly<Record<string, NativeResponsesJsonValue>> {
  return {
    model,
    stream: true,
    instructions: 'You are the harness assistant.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Keep the complete request.' }] }],
    reasoning: { effort: 'high', summary: 'auto' },
    tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } }],
    tool_choice: 'auto',
    parallel_tool_calls: true,
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => server.close()))
})

describe('Native Codex Responses transport', () => {
  it('keeps prepared generation and account identity fixed while captures close independently', async () => {
    const server = await localServer()
    routeFetchThrough(server)
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one') })
    let profiles = resolveProfiles({ 'openai-codex': { headers: { 'x-generation': 'one' } } })
    const adapter = adapterWith(auth, () => profiles)
    const first = await adapter.prepareCall('openai-codex', MODEL)
    const firstCapture = first.nativeResponses
    expect(firstCapture).toBeDefined()
    if (firstCapture === undefined) throw new Error('Codex preparation omitted its Native Responses capture')
    await expect(firstCapture.capture({ route: { provider: 'openai-codex', model: 'other-model' } }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ROUTE_MISMATCH' })
    await expect(firstCapture.capture({ route: { provider: 'openai-codex', model: MODEL }, maxTokens: 10 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })

    const oldTransport = await firstCapture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    const oldBody = await oldTransport.projectRequest(requestBody(), new AbortController().signal)
    profiles = resolveProfiles({ 'openai-codex': { headers: { 'x-generation': 'two' } } })
    auth.stored.set('openai-codex', siwcCredential('account-two'))
    await expect(oldTransport.forward(oldBody, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })

    const second = await adapter.prepareCall('openai-codex', MODEL)
    const secondCapture = second.nativeResponses
    expect(secondCapture).toBeDefined()
    if (secondCapture === undefined) throw new Error('Codex preparation omitted its Native Responses capture')
    const newTransport = await secondCapture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    await oldTransport.close()
    const projected = await newTransport.projectRequest(requestBody(), new AbortController().signal)
    const forwarded = await newTransport.forward(projected, new AbortController().signal)
    await forwarded.body?.cancel()

    expect(server.requests.filter(request => request.path === '/responses')).toHaveLength(1)
    expect(server.requests.find(request => request.path === '/responses')?.headers).toMatchObject({
      authorization: `Bearer ${accessToken('account-two')}`,
      'user-agent': attributionHeaders()['user-agent'],
      'x-generation': 'two',
    })
    expect(server.requests.find(request => request.path === '/responses')?.body).toBe(JSON.stringify({
      ...requestBody(),
      tools: [{
        type: 'namespace',
        name: 'harness',
        description: 'Tools the harness exposes to the model.',
        tools: requestBody().tools,
      }],
      store: false,
    }))
    await newTransport.close()
    await adapter.dispose()
    await server.close()
  })

  it('projects the selected model completely and forwards real status, headers, and response bytes', async () => {
    const server = await localServer()
    const sse = Buffer.from('event: response.completed\ndata: {"type":"response.completed"}\n\n')
    server.responses = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' }).end(sse) }
    routeFetchThrough(server)
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one') })
    const profiles = resolveProfiles({
      'openai-codex': {},
      local: {
        api: 'openai-responses',
        baseURL: 'http://127.0.0.1:1/v1',
        models: [{ id: 'local-model' }],
      },
    })
    const adapter = adapterWith(auth, () => profiles)
    const prepared = await adapter.prepareCall('openai-codex', MODEL)
    const capture = prepared.nativeResponses
    expect(capture).toBeDefined()
    if (capture === undefined) throw new Error('Codex preparation omitted its Native Responses capture')
    const transport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    expect(transport.outputTokenLimit).toBe('unsupported')
    const tools: NativeResponsesJsonValue = [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } }]
    const body: Readonly<Record<string, NativeResponsesJsonValue>> = {
      ...requestBody(),
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Use the system message.' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'Keep the complete request.' }] },
        { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' },
        { type: 'custom_tool_call', call_id: 'call-2', name: 'custom', input: 'run' },
      ],
      tools,
    }
    const originalBody = structuredClone(body)
    const expectedProjected: NativeResponsesJsonValue = {
      ...originalBody,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'Use the system message.' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'Keep the complete request.' }] },
        { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}', namespace: 'harness' },
        { type: 'custom_tool_call', call_id: 'call-2', name: 'custom', input: 'run', namespace: 'harness' },
      ],
      tools: [{
        type: 'namespace',
        name: 'harness',
        description: 'Tools the harness exposes to the model.',
        tools,
      }],
      store: false,
    }
    const projected = await transport.projectRequest(body, new AbortController().signal)
    expect(await adapter.prepareCall('local', 'local-model')).not.toHaveProperty('nativeResponses')
    const imageTransport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    await expect(imageTransport.projectRequest({
      ...body,
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.test/image.png' }] }],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await imageTransport.close()
    const limitTransport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    await expect(limitTransport.projectRequest({ ...body, max_output_tokens: 20 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    await limitTransport.close()

    const response = await transport.forward(projected, new AbortController().signal)
    expect(response.status).toBe(200)
    expect(response.contentType).toBe('text/event-stream; charset=utf-8')
    expect(Buffer.from(await new Response(response.body).arrayBuffer())).toEqual(sse)
    expect(server.requests.filter(request => request.path === '/responses')).toHaveLength(1)
    const forwardedRequest = server.requests.find(request => request.path === '/responses')!
    expect({
      projected,
      forwardedBody: JSON.parse(forwardedRequest.body) as NativeResponsesJsonValue,
      callerBody: body,
    }).toEqual({
      projected: expectedProjected,
      forwardedBody: expectedProjected,
      callerBody: originalBody,
    })
    expect(server.requests.find(request => request.path === '/responses')?.headers).toMatchObject({
      authorization: `Bearer ${accessToken('account-one')}`,
      'user-agent': attributionHeaders()['user-agent'],
      accept: 'text/event-stream',
      'content-type': 'application/json',
    })

    server.responses = (_request, outgoing) => { outgoing.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"limited"}') }
    const errorBody = await transport.projectRequest(requestBody(), new AbortController().signal)
    const errorResponse = await transport.forward(errorBody, new AbortController().signal)
    expect(errorResponse.status).toBe(429)
    expect(errorResponse.contentType).toBe('application/json')
    await expect(new Response(errorResponse.body).text()).resolves.toBe('{"error":"limited"}')
    expect(server.requests.filter(request => request.path === '/responses')).toHaveLength(2)
    server.responses = (_request, outgoing) => { outgoing.writeHead(204).end() }
    const emptyBody = await transport.projectRequest(requestBody(), new AbortController().signal)
    const emptyResponse = await transport.forward(emptyBody, new AbortController().signal)
    expect(emptyResponse.status).toBe(204)
    expect(emptyResponse.body).toBeNull()
    expect(server.requests.filter(request => request.path === '/responses')).toHaveLength(3)

    server.responses = (_request, outgoing) => {
      outgoing.writeHead(307, { location: '/redirected' }).end('redirect')
    }
    const redirectBody = await transport.projectRequest(requestBody(), new AbortController().signal)
    const redirectResponse = await transport.forward(redirectBody, new AbortController().signal)
    expect(redirectResponse.status).toBe(307)
    expect(server.requests.filter(request => request.path === '/redirected')).toHaveLength(0)
    await new Response(redirectResponse.body).text()

    await transport.close()
    await adapter.dispose()
    await server.close()
  })

  it('records native Responses quota headers and rate-limit events for the resolved account', async () => {
    const server = await localServer()
    const sse = Buffer.from([
      'data: {"type":"codex.rate_limits","rate_limits":{"primary":{"used_percent":67,"window_minutes":300,"reset_at":1800000000}}}',
      '',
      '',
    ].join('\n'))
    server.responses = (_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-codex-primary-used-percent': '23',
        'x-codex-primary-window-minutes': '300',
        'x-codex-primary-reset-at': '1800000000',
      }).end(sse)
    }
    routeFetchThrough(server)
    const observations: Array<{
      identity: CodexUsageIdentity
      observation: CodexUsageObservation
      replaceQuotas: boolean
    }> = []
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one') })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth,
      onCodexUsage: (identity, observation, replaceQuotas) => {
        observations.push({ identity, observation, replaceQuotas })
      },
    })
    const prepared = await adapter.prepareCall('openai-codex', MODEL)
    const capture = prepared.nativeResponses
    expect(capture).toBeDefined()
    if (capture === undefined) throw new Error('Codex preparation omitted its Native Responses capture')
    const transport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    const projected = await transport.projectRequest(requestBody(), new AbortController().signal)
    const response = await transport.forward(projected, new AbortController().signal)

    expect(Buffer.from(await new Response(response.body).arrayBuffer())).toEqual(sse)
    expect(observations).toEqual([
      {
        identity: { issuer: 'https://auth.openai.com', subject: 'subject-account-one' },
        observation: {
          quotas: [{ name: 'codex', primary: { usedPercent: 23, windowSeconds: 18000, resetsAt: 1800000000 }, secondary: null }],
          credits: null,
        },
        replaceQuotas: true,
      },
      {
        identity: { issuer: 'https://auth.openai.com', subject: 'subject-account-one' },
        observation: {
          quotas: [{ name: 'codex', primary: { usedPercent: 67, windowSeconds: 18000, resetsAt: 1800000000 }, secondary: null }],
        },
        replaceQuotas: false,
      },
    ])

    await transport.close()
    await adapter.dispose()
    await server.close()
  })

  it('waits for a credential refresh started by prepareCall before disposing', async () => {
    const server = await localServer()
    routeFetchThrough(server)
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one', { expires: 0 }) })
    const adapter = adapterWith(auth, () => resolveProfiles({ 'openai-codex': {} }))
    const refreshStarted = Promise.withResolvers<undefined>()
    const refreshReleased = Promise.withResolvers<undefined>()
    let refreshSignal: AbortSignal | null | undefined
    server.token = async (_request, response) => {
      refreshStarted.resolve(undefined)
      await refreshReleased.promise
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        access_token: accessToken('account-one'),
        refresh_token: 'refresh-account-one-rotated',
        expires_in: 3600,
      }))
    }
    const routedFetch = globalThis.fetch.bind(globalThis)
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
      if (url.origin === 'https://auth.openai.com' && url.pathname === '/api/accounts/oauth/token') {
        refreshSignal = init?.signal
      }
      return routedFetch(input, init)
    })
    const preparing = adapter.prepareCall('openai-codex', MODEL).then(
      () => undefined,
      (error: unknown) => error,
    )
    await refreshStarted.promise

    let disposed = false
    const disposing = adapter.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(refreshSignal?.aborted).toBe(false)

    refreshReleased.resolve(undefined)
    await disposing
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one-rotated' })
    await expect(preparing).resolves.toMatchObject({ code: 'ABORTED' })
    await server.close()
  })

  it('waits for a caller-cancelled credential refresh to persist before disposing', async () => {
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one', { expires: 0 }) })
    const adapter = adapterWith(auth, () => resolveProfiles({ 'openai-codex': {} }))
    const refreshStarted = Promise.withResolvers<undefined>()
    const refreshReleased = Promise.withResolvers<undefined>()
    let refreshSignal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      expect(url).toBe('https://auth.openai.com/api/accounts/oauth/token')
      refreshSignal = init?.signal
      refreshStarted.resolve(undefined)
      await refreshReleased.promise
      return new Response(JSON.stringify({
        access_token: accessToken('account-one'),
        refresh_token: 'refresh-account-one-rotated',
        expires_in: 3600,
      }), { headers: { 'content-type': 'application/json' } })
    })
    const caller = new AbortController()
    const resolving = adapter.getProviderAuth('openai-codex', caller.signal)
    await refreshStarted.promise
    caller.abort(new Error('caller cancelled auth'))
    await expect(resolving).rejects.toThrow('caller cancelled auth')

    let disposed = false
    const disposing = adapter.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(refreshSignal?.aborted).toBe(false)
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one' })

    refreshReleased.resolve(undefined)
    await disposing
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one-rotated' })
  })

  it('drains credential refreshes before reporting a failed response-stream close', async () => {
    const server = await localServer()
    routeFetchThrough(server)
    const auth = memoryAuth({ 'openai-codex': siwcCredential('account-one') })
    const profiles = resolveProfiles({ 'openai-codex': {} })
    const adapter = adapterWith(auth, () => profiles)
    const prepared = await adapter.prepareCall('openai-codex', MODEL)
    const capture = prepared.nativeResponses
    expect(capture).toBeDefined()
    if (capture === undefined) throw new Error('Codex preparation omitted its Native Responses capture')
    const refreshStarted = Promise.withResolvers<undefined>()
    const refreshReleased = Promise.withResolvers<undefined>()
    let refreshSignal: AbortSignal | null | undefined
    server.token = async (_request, response) => {
      refreshStarted.resolve(undefined)
      await refreshReleased.promise
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        access_token: accessToken('account-one'),
        refresh_token: 'refresh-account-one-rotated',
        expires_in: 3600,
      }))
    }
    const expired = siwcCredential('account-one', { expires: 0 })
    auth.stored.set('openai-codex', expired)
    const refreshTransport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    const refreshBody = await refreshTransport.projectRequest(requestBody(), new AbortController().signal)
    const nativeFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
      if (url.origin === 'https://auth.openai.com' && url.pathname === '/api/accounts/oauth/token') refreshSignal = init?.signal
      return nativeFetch(input, init)
    })
    const pendingForward = refreshTransport.forward(refreshBody, new AbortController().signal)
    await refreshStarted.promise
    const refreshClosing = refreshTransport.close()
    expect(refreshTransport.close()).toBe(refreshClosing)
    await expect(pendingForward).rejects.toMatchObject({ code: 'ABORTED' })
    expect(refreshSignal?.aborted).toBe(false)
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one' })
    refreshReleased.resolve(undefined)
    await refreshClosing
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one-rotated' })
    expect(server.requests.filter(request => request.path === '/responses')).toHaveLength(0)

    const bodyStarted = Promise.withResolvers<undefined>()
    const upstreamClosed = Promise.withResolvers<undefined>()
    server.responses = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: pending\n\n')
      bodyStarted.resolve(undefined)
      response.on('close', () => { upstreamClosed.resolve(undefined) })
    }
    const routedFetch = globalThis.fetch.bind(globalThis)
    const cancellationStarted = Promise.withResolvers<undefined>()
    const cancellationReleased = Promise.withResolvers<undefined>()
    const cancellationFailure = new Error('upstream cancellation failed')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = await routedFetch(input, init)
      const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
      if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/responses' || upstream.body === null) {
        return upstream
      }
      const reader = upstream.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const result = await reader.read()
          if (result.done) controller.close()
          else controller.enqueue(result.value)
        },
        async cancel() {
          cancellationStarted.resolve(undefined)
          await cancellationReleased.promise
          throw cancellationFailure
        },
      })
      return new Response(body, { status: upstream.status, headers: upstream.headers })
    })
    const streamTransport = await capture.capture({ route: { provider: 'openai-codex', model: MODEL } }, new AbortController().signal)
    const streamBody = await streamTransport.projectRequest(requestBody(), new AbortController().signal)
    const streamingResponse = await streamTransport.forward(streamBody, new AbortController().signal)
    await bodyStarted.promise

    const pendingCredentialRefreshStarted = Promise.withResolvers<undefined>()
    const pendingCredentialRefreshReleased = Promise.withResolvers<undefined>()
    server.token = async (_request, response) => {
      pendingCredentialRefreshStarted.resolve(undefined)
      await pendingCredentialRefreshReleased.promise
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        access_token: accessToken('account-one'),
        refresh_token: 'refresh-account-one-rotated',
        expires_in: 3600,
      }))
    }
    auth.stored.set('openai-codex', siwcCredential('account-one', { expires: 0 }))
    adapter.invalidate()
    let disposeSettled = false
    let disposeError: unknown
    let disposedBeforeCredentialRefresh: boolean | undefined
    let credentialWasUnchangedBeforeRefreshCompletion: boolean | undefined
    let consumerCancellationResult: PromiseSettledResult<void> | undefined
    let closingResult: PromiseSettledResult<void> | undefined
    let credentialResolutionResult: PromiseSettledResult<Awaited<ReturnType<typeof adapter.getProviderAuth>>> | undefined
    const observe = <T>(work: Promise<T>): Promise<PromiseSettledResult<T>> => work.then(
      value => ({ status: 'fulfilled', value }),
      (reason: unknown) => ({ status: 'rejected', reason }),
    )
    let observedCredentialResolution: Promise<PromiseSettledResult<Awaited<ReturnType<typeof adapter.getProviderAuth>>>> | undefined
    let observedConsumerCancellation: Promise<PromiseSettledResult<void>> | undefined
    let observedClosing: Promise<PromiseSettledResult<void>> | undefined
    let observedDisposal: Promise<void> | undefined
    try {
      observedCredentialResolution = observe(adapter.getProviderAuth('openai-codex'))
      await pendingCredentialRefreshStarted.promise

      const consumerCancellation = streamingResponse.body?.cancel()
      if (consumerCancellation === undefined) throw new Error('Native Responses stream did not expose a body')
      observedConsumerCancellation = observe(consumerCancellation)
      await cancellationStarted.promise
      observedClosing = observe(streamTransport.close())
      observedDisposal = adapter.dispose().then(
        () => { disposeSettled = true },
        (error: unknown) => { disposeSettled = true; disposeError = error },
      )

      cancellationReleased.resolve(undefined)
      consumerCancellationResult = await observedConsumerCancellation
      closingResult = await observedClosing
      await upstreamClosed.promise
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      disposedBeforeCredentialRefresh = disposeSettled
      const pendingCredential = auth.stored.get('openai-codex')
      credentialWasUnchangedBeforeRefreshCompletion = pendingCredential?.type === 'oauth'
        && pendingCredential.refresh === 'refresh-account-one'
    } finally {
      cancellationReleased.resolve(undefined)
      pendingCredentialRefreshReleased.resolve(undefined)
      if (observedClosing === undefined) observedClosing = observe(streamTransport.close())
      if (observedDisposal === undefined) {
        observedDisposal = adapter.dispose().then(
          () => { disposeSettled = true },
          (error: unknown) => { disposeSettled = true; disposeError = error },
        )
      }
      await Promise.all([
        observedCredentialResolution ?? Promise.resolve(undefined),
        observedConsumerCancellation ?? Promise.resolve(undefined),
        observedClosing,
        observedDisposal ?? Promise.resolve(undefined),
      ])
      await server.close()
    }
    if (observedCredentialResolution !== undefined) credentialResolutionResult = await observedCredentialResolution
    expect(consumerCancellationResult).toMatchObject({ status: 'rejected', reason: cancellationFailure })
    expect(closingResult).toMatchObject({ status: 'rejected', reason: cancellationFailure })
    expect(credentialResolutionResult?.status).toBe('fulfilled')
    expect(disposedBeforeCredentialRefresh).toBe(false)
    expect(credentialWasUnchangedBeforeRefreshCompletion).toBe(true)
    expect(disposeError).toBe(cancellationFailure)
    expect(auth.stored.get('openai-codex')).toMatchObject({ refresh: 'refresh-account-one-rotated' })
  })
})
