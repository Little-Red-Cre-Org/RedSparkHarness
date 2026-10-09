/**
 * Real-composition guard for the dormant pi-ai posture: LlmRuntime,
 * settings-file, credentials-local, and a bare `llm-pi-ai` row boot from a
 * test-only cordis.yml through the actual Loader + Include path, an external
 * edit of settings.yaml registers the route live, and the next request
 * carries the credential the credentials document supplies. A hand-mounted `ctx.plugin` cannot
 * catch Loader export-shape failures, which is why the twin adapter has the
 * same guard.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createMessage, createUserMessage, userAgent } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** One text block, then a tool call truncated by the output-token ceiling. */
const truncatedToolCallEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"partial"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\\"text\\":"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot the dormant composition: a bare `llm-pi-ai` row with no config at all. */
async function loadComposition(): Promise<{ ctx: Context; settingsPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-pi-composition-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, '# personal settings\n')
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  PI_COMPOSITION_KEY: key-from-store\n', { mode: 0o600 })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(settingsPath)}`,
    '    debounceMs: 10',
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: authorization',
    "  name: '@deepseek-ai/dsh-authorization'",
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath }
}

describe('llm-pi-ai real dormant composition', () => {
  it('loads the account catalog before first inference and streams public Responses', async () => {
    const message = { type: 'message', id: 'msg_codex', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'hello from Codex', annotations: [] }] }
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello from Codex' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { id: 'resp_codex', status: 'completed', output: [message],
        usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } },
    ]
    const { ctx, settingsPath } = await loadComposition()
    const key = LlmPiAi.recordKeyFor('openai-codex')
    expect(ctx.authorization.describe(key)?.methods.map(method => method.id)).toEqual(['oauth'])
    const access = 'synthetic-account-access-token'
    await ctx.credentials.modifyRecord(key, () => Promise.resolve({
      kind: 'grant', payload: {
        type: 'oauth', access, refresh: 'synthetic-account-refresh-token', expires: Date.now() + 3_600_000,
        siwc: 'chatgpt-plan', clientId: 'fixture-issued-client-id', issuer: 'https://auth.openai.com',
        subject: 'fixture-account-subject', idToken: 'fixture-id-token', extAgentHostId: 'urn:uuid:fixture-host-id',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
      },
    }))
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      ] })))
      .mockResolvedValueOnce(new Response(
        events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ))
    await writeFile(settingsPath, [
      'llm-pi-ai:', '  providers:', '    openai-codex:',
      '      transport: sse', '',
    ].join('\n'))
    try {
      await vi.waitFor(() => {
        expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openai-codex'])
      }, { timeout: 5000 })
      const result = await assemble(ctx, {
        provider: 'openai-codex', model: 'gpt-6.1-sol', system: 'You are the harness.',
        messages: [createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'call_lookup' as ToolCallId, name: 'lookup', arguments: '{}' }],
          source: {
            kind: 'model', provider: 'openai-codex', model: 'gpt-6.1-sol',
            replayState: {
              response: {
                kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'openai-codex',
                model: 'gpt-6.1-sol', stopReason: 'toolUse',
              },
              blocks: [{ type: 'tool-call' }],
            },
          },
        })],
        tools: [{ name: 'lookup', description: 'Look up a value.', parameters: { type: 'object' } }],
      })
      expect(result.finish).toEqual({ kind: 'stop' })
      expect(result.message.content).toEqual([{ type: 'text', text: 'hello from Codex' }])
      expect(fetch).toHaveBeenCalledTimes(2)
      const [modelsUrl, modelsOptions] = fetch.mock.calls[0]!
      expect(modelsUrl).toBe('https://api.openai.com/v1/models')
      expect(new Headers(modelsOptions?.headers).get('authorization')).toBe(`Bearer ${access}`)
      const [responsesUrl, responsesOptions] = fetch.mock.calls[1]!
      expect(responsesUrl).toBe('https://api.openai.com/v1/responses')
      expect(new Headers(responsesOptions?.headers).get('authorization')).toBe(`Bearer ${access}`)
      const body = JSON.parse(responsesOptions?.body as string) as {
        input: { role?: string; type?: string; content?: string; name?: string; namespace?: string }[]
        tools: { type: string; name: string; tools?: { type: string; name: string }[] }[]
      }
      expect(body).toMatchObject({ model: 'gpt-6.1-sol', store: false, stream: true })
      expect(body.input.find(item => item.role === 'developer')?.content).toContain('You are the harness.')
      expect(body.input.some(item => item.role === 'system')).toBe(false)
      expect(body.input).toContainEqual(expect.objectContaining({
        type: 'function_call', name: 'lookup', namespace: 'harness',
      }))
      expect(body.tools).toEqual([expect.objectContaining({
        type: 'namespace',
        name: 'harness',
        tools: [expect.objectContaining({ type: 'function', name: 'lookup' })],
      })])
    } finally {
      fetch.mockRestore()
    }
    const llm = ctx.llm
    await ctx.fiber.dispose()
    context = undefined
    expect(llm.listProviders()).toEqual([])
  })

  it('replays a real Codex reasoning and tool-call turn natively on the next turn', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_codex', summary: [], encrypted_content: 'encrypted-reasoning' }
    const call = { type: 'function_call', id: 'fc_codex', call_id: 'call_codex', name: 'lookup',
      arguments: '{}', namespace: 'harness', status: 'completed' }
    const answer = { type: 'message', id: 'msg_codex', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'done', annotations: [] }] }
    const sse = (events: unknown[]): Response => new Response(
      events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    )
    const { ctx, settingsPath } = await loadComposition()
    await ctx.credentials.modifyRecord(LlmPiAi.recordKeyFor('openai-codex'), () => Promise.resolve({
      kind: 'grant', payload: {
        type: 'oauth', access: 'synthetic-account-access-token', refresh: 'synthetic-account-refresh-token',
        expires: Date.now() + 3_600_000, siwc: 'chatgpt-plan', clientId: 'fixture-issued-client-id',
        issuer: 'https://auth.openai.com', subject: 'fixture-account-subject', idToken: 'fixture-id-token',
        extAgentHostId: 'urn:uuid:fixture-host-id',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
      },
    }))
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      ] })))
      .mockResolvedValueOnce(sse([
        { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: undefined } },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
        { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_codex', delta: '{}' },
        { type: 'response.output_item.done', output_index: 1, item: call },
        { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [reasoning, call],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } },
      ]))
      .mockResolvedValueOnce(sse([
        { type: 'response.output_item.added', output_index: 0, item: { ...answer, content: [] } },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'done' },
        { type: 'response.output_item.done', output_index: 0, item: answer },
        { type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [answer],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } } },
      ]))
    await writeFile(settingsPath, ['llm-pi-ai:', '  providers:', '    openai-codex:', '      transport: sse', ''].join('\n'))
    try {
      await vi.waitFor(() => {
        expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openai-codex'])
      }, { timeout: 5000 })
      const tools = [{ name: 'lookup', description: 'Look up a value.', parameters: { type: 'object' } }]
      const first = await assemble(ctx, { provider: 'openai-codex', model: 'gpt-6.1-sol', messages: [], tools })
      const toolCall = first.message.content.find(block => block.type === 'tool-call')
      expect(toolCall).toMatchObject({ name: 'lookup' })
      await assemble(ctx, {
        provider: 'openai-codex', model: 'gpt-6.1-sol', tools,
        messages: [first.message, createUserMessage({
          content: [{ type: 'tool-result', toolCallId: toolCall!.id, content: [{ type: 'text', text: '42' }] }],
          source: { kind: 'plugin', plugin: 'test' },
        })],
      })
      const body = JSON.parse(fetch.mock.calls[2]![1]?.body as string) as { input: unknown[] }
      expect(body.input).toContainEqual(expect.objectContaining({ type: 'reasoning', encrypted_content: 'encrypted-reasoning' }))
      expect(body.input).toContainEqual(expect.objectContaining({
        type: 'function_call', id: 'fc_codex', call_id: 'call_codex', namespace: 'harness',
      }))
    } finally {
      fetch.mockRestore()
    }
  })

  it('shares one Codex catalog refresh across concurrent listings', async () => {
    const { ctx, settingsPath } = await loadComposition()
    const key = LlmPiAi.recordKeyFor('openai-codex')
    await ctx.credentials.modifyRecord(key, () => Promise.resolve({
      kind: 'grant', payload: {
        type: 'oauth', access: 'synthetic-account-access-token', refresh: 'synthetic-account-refresh-token',
        expires: Date.now() + 3_600_000, siwc: 'chatgpt-plan', clientId: 'fixture-issued-client-id',
        issuer: 'https://auth.openai.com', subject: 'fixture-account-subject', idToken: 'fixture-id-token',
        extAgentHostId: 'urn:uuid:fixture-host-id',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
      },
    }))
    let released = false
    let release = (_response: Response): void => {}
    const gate = new Promise<Response>((resolve) => {
      release = (response) => { released = true; resolve(response) }
    })
    await writeFile(settingsPath, [
      'llm-pi-ai:', '  providers:', '    openai-codex:',
      '      transport: sse', '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openai-codex'])
    }, { timeout: 5000 })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => gate)
    const pending = Promise.all([
      ctx.llm.listModels('openai-codex'),
      ctx.llm.listModels('openai-codex'),
    ])
    try {
      await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
      release(new Response(JSON.stringify({ models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      ] })))
      const [first, second] = await pending
      expect(first).toEqual(second)
      expect(first).toEqual([{
        provider: 'openai-codex', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', inputModalities: ['text'],
      }])
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      if (!released) release(new Response('{}', { status: 500 }))
      await pending.catch(() => undefined)
      fetch.mockRestore()
    }
  })

  it.each([
    ['aborts the shared Codex catalog refresh on dispose', 'dispose'],
    ['keeps the shared Codex catalog refresh across a credential update', 'credential update'],
  ] as const)('%s', async (_name, interrupt) => {
    const { ctx, settingsPath } = await loadComposition()
    const key = LlmPiAi.recordKeyFor('openai-codex')
    const grant = (access: string) => ctx.credentials.modifyRecord(key, () => Promise.resolve({
      kind: 'grant', payload: {
        type: 'oauth', access, refresh: 'synthetic-account-refresh-token',
        expires: Date.now() + 3_600_000, siwc: 'chatgpt-plan', clientId: 'fixture-issued-client-id',
        issuer: 'https://auth.openai.com', subject: 'fixture-account-subject', idToken: 'fixture-id-token',
        extAgentHostId: 'urn:uuid:fixture-host-id',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'],
      },
    }))
    await grant('synthetic-account-access-token')
    await writeFile(settingsPath, [
      'llm-pi-ai:', '  providers:', '    openai-codex:',
      '      transport: sse', '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['openai-codex'])
    }, { timeout: 5000 })
    let requestSignal: AbortSignal | undefined
    let release = (_response: Response): void => {}
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!
      requestSignal = signal
      release = resolve
      signal.addEventListener('abort', () => { reject(signal.reason as Error) }, { once: true })
    }))
    const pending = ctx.llm.listModels('openai-codex')
    try {
      await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
      if (interrupt === 'dispose') {
        await ctx.fiber.dispose()
        context = undefined
        expect(requestSignal?.aborted).toBe(true)
        await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
        return
      }
      await grant('rotated-account-access-token')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(requestSignal?.aborted).toBe(false)
      release(new Response(JSON.stringify({ models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      ] })))
      expect(await pending).toEqual([{
        provider: 'openai-codex', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', inputModalities: ['text'],
      }])
    } finally {
      release(new Response(JSON.stringify({ models: [] })))
      await pending.catch(() => undefined)
      fetch.mockRestore()
    }
  })

  it('boots with zero routes and registers one the moment settings supply a profile', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()

    // The shipped posture: the adapter exists, no route does.
    expect(ctx.llm.listProviders()).toEqual([])

    // Exactly what the web Models page leaves on disk.
    await writeFile(settingsPath, [
      'llm-pi-ai:',
      '  providers:',
      '    deepseek:',
      '      apiKeyEnv: PI_COMPOSITION_KEY',
      `      baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
  })

  it('uses settings-only route headers for model discovery', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ body: JSON.stringify({ data: [{ id: 'acme-private' }] }) }])
    const { ctx, settingsPath } = await loadComposition()

    await writeFile(settingsPath, [
      'llm-pi-ai:',
      '  providers:',
      '    acme-gateway:',
      '      apiKeyEnv: PI_COMPOSITION_KEY',
      '      api: openai-completions',
      `      baseURL: ${server.url}`,
      '      headers:',
      '        X-Company-Code: private-tenant',
      '        Accept: text/plain',
      '        User-Agent: deployment-owned',
      '      models:',
      '        - id: acme-bootstrap',
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['acme-gateway'])
    }, { timeout: 5000 })

    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      api: 'openai-completions',
    })).resolves.toEqual([{ id: 'acme-private', name: 'acme-private' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.['x-company-code']).toBe('private-tenant')
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('continues natively after max-token assembly drops a tool call, with pruned replay metadata', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([
      { events: truncatedToolCallEvents },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      'llm-pi-ai:',
      '  providers:',
      '    deepseek:',
      '      apiKeyEnv: PI_COMPOSITION_KEY',
      `      baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const truncated = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })
    expect(truncated.finish).toEqual({ kind: 'max-tokens' })
    expect(truncated.message.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(truncated.message.source).toEqual({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-flash',
          stopReason: 'length',
        },
        blocks: [{ type: 'text' }],
      },
    })

    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        truncated.message,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
    const followup = server.requests[1] as { messages?: unknown[] }
    expect(followup.messages?.[0]).not.toHaveProperty('tool_calls')
  })

  it('continues a legacy session whose stored replay state no longer matches its content', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      'llm-pi-ai:',
      '  providers:',
      '    deepseek:',
      '      apiKeyEnv: PI_COMPOSITION_KEY',
      `      baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    // A pre-envelope session log entry: max-token assembly dropped the tool
    // call from content while the flat v1 state still describes both blocks.
    const poisoned = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial' }],
      source: {
        kind: 'model',
        ...{
          provider: 'deepseek',
          model: 'deepseek-flash',
          replayState: {
            kind: 'pi-ai',
            version: 1,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-flash',
            stopReason: 'length',
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      },
    })
    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        poisoned,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.finish).toEqual({ kind: 'stop' })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
  })
})
