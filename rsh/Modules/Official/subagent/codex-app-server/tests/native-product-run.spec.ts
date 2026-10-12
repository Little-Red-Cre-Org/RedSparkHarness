import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type {
  NativeExternalJsonValue,
  NativeExternalModelAttemptLease,
  NativeExternalModelFailure,
  NativeExternalModelResponse,
  NativeExternalModelRoute,
  NativeExternalSubagentModelOperations,
  NativeExternalToolCallGrant,
  NativeExternalToolSettlement,
} from '@deepseek-ai/dsh-native-subagent/native'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import type { SubprocessEnvironmentMode } from '@deepseek-ai/dsh-subprocess/native'
import { createLocalChildConnectionProvider } from '@deepseek-ai/dsh-subprocess-local/child-connection'
import { startNativeCodexProductRun } from '../src/native-product-run.ts'
import type { NativeResponsesTransportResponse } from '../src/responses-gateway.ts'

const route: NativeExternalModelRoute = { provider: 'codex', model: 'fixture-model' }
const task = 'Return the isolated gateway sentinel exactly.'
const sentinel = 'NATIVE_GATEWAY_PRODUCT_SENTINEL'
const limits = { requestBytes: 1_048_576, responseBytes: 1_048_576, jsonDepth: 64, sseEvents: 64 }

function removeOwnedWorkspace(path: string): void {
  const target = resolve(path)
  const parent = resolve(tmpdir())
  if (dirname(target) !== parent || !target.split(/[\\/]/).at(-1)?.startsWith('dsh-native-product-test-')) {
    throw new Error('codex-app-server: refusing to remove an unowned product-test workspace')
  }
  rmSync(target, { recursive: true, force: true })
}

function completionEvents(text: string): readonly Record<string, unknown>[] {
  const part = { type: 'output_text', annotations: [], logprobs: [], text }
  const message = {
    id: 'msg_native_fixture',
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [part],
  }
  const response = {
    id: 'resp_native_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: route.model,
    output: [message],
    parallel_tool_calls: false,
    previous_response_id: null,
    prompt_cache_key: null,
    prompt_cache_retention: null,
    reasoning: { effort: null, summary: null },
    safety_identifier: null,
    service_tier: 'default',
    store: false,
    temperature: null,
    text: { format: { type: 'text' }, verbosity: 'medium' },
    tool_choice: 'none',
    tools: [],
    top_logprobs: 0,
    top_p: null,
    truncation: 'disabled',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 11,
    },
    user: null,
    metadata: {},
  }
  return [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: text, logprobs: [] },
    { type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text, logprobs: [] },
    { type: 'response.content_part.done', item_id: message.id, output_index: 0, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response },
  ]
}

function completionStream(text: string): Uint8Array<ArrayBuffer> {
  const events = completionEvents(text).map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new TextEncoder().encode(`${events}data: [DONE]\n\n`)
}

function functionCallStream(): Uint8Array<ArrayBuffer> {
  const item = {
    id: 'fc_native_fixture',
    call_id: 'call_native_fixture',
    name: 'fixture_echo',
    arguments: '{"value":"Ada"}',
    type: 'function_call',
    status: 'completed',
  }
  const response = {
    id: 'resp_native_function_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model: route.model,
    output: [item],
    parallel_tool_calls: false,
    previous_response_id: null,
    prompt_cache_key: null,
    prompt_cache_retention: null,
    reasoning: { effort: null, summary: null },
    safety_identifier: null,
    service_tier: 'default',
    store: false,
    temperature: null,
    text: { format: { type: 'text' }, verbosity: 'medium' },
    tool_choice: 'auto',
    tools: [{ type: 'function', name: 'fixture_echo', description: 'fixture', parameters: { type: 'object' } }],
    top_logprobs: 0,
    top_p: null,
    truncation: 'disabled',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 11,
    },
    user: null,
    metadata: {},
  }
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: '{"value":' },
    { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: item.arguments },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ]
  const text = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return new TextEncoder().encode(text)
}

it('runs pinned Codex through its isolated authenticated gateway and logs the forwarded body', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-product-test-'))
  const cwd = join(root, 'workspace')
  mkdirSync(cwd)
  const provider = createLocalChildConnectionProvider()
  const trace: string[] = []
  const admitted: Record<string, unknown>[] = []
  const forwarded: NativeExternalJsonValue[] = []
  const recorded: NativeExternalModelResponse[] = []
  const failures: NativeExternalModelFailure[] = []
  const fatals: Error[] = []
  let childEnv: typeof process.env | undefined
  let childEnvMode: SubprocessEnvironmentMode | undefined
  const connection: ChildConnectionDefinition = {
    connect: (spec) => {
      childEnv = spec.env
      childEnvMode = spec.envMode
      return provider.connect(spec)
    },
  }
  const lease = Object.freeze({ sequence: 1, signal: new AbortController().signal }) as unknown as NativeExternalModelAttemptLease
  const model: NativeExternalSubagentModelOperations = {
    tools: { schemas: [], programSchemas: [], promptText: '' },
    async admitModelRequest(input) {
      trace.push('admit')
      admitted.push(JSON.parse(input.requestBody) as Record<string, unknown>)
      return lease
    },
    async recordModelResponse(_lease, outcome) {
      trace.push('record-response')
      recorded.push(outcome)
      return []
    },
    async recordModelFailure(_lease, failure) {
      failures.push(failure)
    },
    async executeTool() { throw new Error('unexpected model-only tool execution') },
    fatal(error) {
      fatals.push(error)
    },
  }
  const operation = new AbortController()
  const ambientNodeOptions = process.env.NODE_OPTIONS
  let run: Awaited<ReturnType<typeof startNativeCodexProductRun>> | undefined

  try {
    process.env.NODE_OPTIONS = '--require=./dsh-native-preload-must-not-exist-20261010.cjs'
    run = await startNativeCodexProductRun([task], {
      connection,
      cwd,
      route,
      model,
      limits,
      projectRequest: async body => body,
      forward: async (body) => {
        trace.push('forward')
        forwarded.push(body)
        return {
          status: 200,
          contentType: 'text/event-stream',
          body: new Response(completionStream(sentinel)).body,
        }
      },
    }, operation.signal)

    expect(new URL(run.gatewayUrl).hostname).toBe('127.0.0.1')
    expect(existsSync(run.configPath)).toBe(true)
    const config = readFileSync(run.configPath, 'utf8')
    expect(config).toContain(`base_url = "${run.gatewayUrl}"`)
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('requires_openai_auth = false')
    expect(childEnv?.CODEX_HOME).toBe(run.codexHome)
    expect(childEnvMode).toBe('replace')
    expect(childEnv).not.toHaveProperty('NODE_OPTIONS')
    if (process.platform === 'win32') {
      expect(childEnv?.SystemRoot).toBe(process.env.SystemRoot ?? process.env.SYSTEMROOT)
    }
    const token = childEnv?.DSH_NATIVE_GATEWAY_TOKEN
    expect(token).toBeTruthy()
    if (token === undefined) throw new Error('Codex child did not receive the gateway token')

    const result = await run.result

    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: sentinel }])
    expect(trace).toEqual(['admit', 'forward', 'record-response'])
    expect(admitted).toHaveLength(1)
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0]).toEqual(admitted[0])
    expect(admitted[0]).toMatchObject({ model: route.model, tools: [], tool_choice: 'none', store: false })
    expect(JSON.stringify(admitted[0])).not.toContain(token)
    expect(recorded).toHaveLength(1)
    expect(failures).toEqual([])
    expect(fatals).toEqual([])

    operation.abort(new Error('product acceptance completed'))
    await run.dispose()
    expect(existsSync(run.codexHome)).toBe(false)
  } finally {
    try {
      if (run !== undefined) await run.dispose()
    } finally {
      try {
        await provider.dispose()
      } finally {
        try {
          removeOwnedWorkspace(root)
        } finally {
          if (ambientNodeOptions === undefined) delete process.env.NODE_OPTIONS
          else process.env.NODE_OPTIONS = ambientNodeOptions
        }
      }
    }
  }
})

it.each([false, true])('records granted dynamic calls before execution (concludesTurn=%s)', async (concludesTurn) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-product-test-'))
  const cwd = join(root, 'workspace')
  mkdirSync(cwd)
  const provider = createLocalChildConnectionProvider()
  const admitted: Record<string, unknown>[] = []
  const executed: string[] = []
  const recorded: NativeExternalModelResponse[] = []
  const fatalErrors: Error[] = []
  const connection: ChildConnectionDefinition = { connect: spec => provider.connect(spec) }
  const model: NativeExternalSubagentModelOperations = {
    tools: {
      schemas: [{ name: 'fixture_echo', description: 'fixture', parameters: { type: 'object' } }],
      programSchemas: [],
      promptText: 'Use fixture_echo for this task.',
    },
    async admitModelRequest(input) {
      admitted.push(JSON.parse(input.requestBody) as Record<string, unknown>)
      // The test fake simulates an Engine-issued lease whose brand is runtime-private.
      const lease = Object.freeze({ sequence: admitted.length, signal: new AbortController().signal })
      return lease as unknown as NativeExternalModelAttemptLease
    },
    async recordModelResponse(_lease, response) {
      recorded.push(response)
      const call = response.toolCalls[0]
      return call === undefined ? [] : [Object.freeze({ ...call }) as NativeExternalToolCallGrant]
    },
    async recordModelFailure(_lease, failure) { throw new Error(`unexpected failure: ${failure.kind}`) },
    async executeTool(grant): Promise<NativeExternalToolSettlement> {
      executed.push(String(grant.callId))
      return {
        result: {
          content: [{ type: 'text', text: 'tool-result-text' }],
          isError: false,
          additionalContexts: [createUserMessage({
            content: [{ type: 'text', text: 'tool-owned-context' }],
            source: { kind: 'user' },
          })],
        },
        settlementContexts: [createUserMessage({
          content: [{ type: 'text', text: 'policy-settlement-context' }],
          source: { kind: 'user' },
        })],
        concludesTurn,
        images: [],
      }
    },
    fatal(error) { fatalErrors.push(error) },
  }
  const operation = new AbortController()
  let requestCount = 0
  let run: Awaited<ReturnType<typeof startNativeCodexProductRun>> | undefined

  try {
    run = await startNativeCodexProductRun(['Call fixture_echo once.'], {
      connection,
      cwd,
      route,
      model,
      limits,
      projectRequest: async body => body,
      forward: async (_body, signal) => {
        signal.throwIfAborted()
        requestCount += 1
        if (requestCount === 1) {
          return { status: 200, contentType: 'text/event-stream', body: new Response(functionCallStream()).body }
        }
        return { status: 200, contentType: 'text/event-stream', body: new Response(completionStream(sentinel)).body }
      },
    }, operation.signal)

    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(executed).toEqual(['call_native_fixture'])
    expect(requestCount).toBe(concludesTurn ? 1 : 2)
    expect(recorded).toHaveLength(concludesTurn ? 1 : 2)
    expect(recorded[0]?.toolCalls).toHaveLength(1)
    expect(admitted).toHaveLength(concludesTurn ? 1 : 2)
    expect(admitted[0]).toMatchObject({ tools: [{ type: 'function', name: 'fixture_echo' }], tool_choice: 'auto' })
    if (concludesTurn) {
      expect(result.toolResult).toMatchObject({ content: [{ type: 'text', text: 'tool-result-text' }], isError: false })
    } else {
      expect(result.output).toEqual([{ type: 'text', text: sentinel }])
      expect(recorded[1]?.toolCalls).toEqual([])
      const continuation = JSON.stringify(admitted[1])
      expect(continuation).toContain('tool-result-text')
      expect(continuation.split('tool-owned-context')).toHaveLength(2)
      expect(continuation.split('policy-settlement-context')).toHaveLength(2)
    }
    expect(fatalErrors).toEqual([])
  } finally {
    try {
      if (run !== undefined) await run.dispose()
    } finally {
      try {
        await provider.dispose()
      } finally {
        removeOwnedWorkspace(root)
      }
    }
  }
})

it('cancels the real Codex process and drains its in-flight gateway request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-product-test-'))
  const cwd = join(root, 'workspace')
  mkdirSync(cwd)
  const provider = createLocalChildConnectionProvider()
  const operation = new AbortController()
  const cancelReason = new Error('product operation cancelled')
  let markForwardStarted!: () => void
  const forwardStarted = new Promise<void>((resolve) => { markForwardStarted = resolve })
  let markForwardAborted!: () => void
  const forwardAborted = new Promise<void>((resolve) => { markForwardAborted = resolve })
  let releaseForward: ((reason: Error) => void) | undefined
  let failure: NativeExternalModelFailure | undefined
  const fatalErrors: Error[] = []
  const lease = Object.freeze({ sequence: 1, signal: new AbortController().signal }) as unknown as NativeExternalModelAttemptLease
  const model: NativeExternalSubagentModelOperations = {
    tools: { schemas: [], programSchemas: [], promptText: '' },
    async admitModelRequest() { return lease },
    async recordModelResponse() { return [] },
    async recordModelFailure(_lease, value) { failure = value },
    async executeTool() { throw new Error('unexpected model-only tool execution') },
    fatal(error) { fatalErrors.push(error) },
  }
  const connection: ChildConnectionDefinition = {
    connect: spec => provider.connect(spec),
  }
  let run: Awaited<ReturnType<typeof startNativeCodexProductRun>> | undefined

  try {
    run = await startNativeCodexProductRun([task], {
      connection,
      cwd,
      route,
      model,
      limits,
      projectRequest: async body => body,
      forward: async (_body, signal) => new Promise<NativeResponsesTransportResponse>((_resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort)
          markForwardAborted()
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error('gateway request aborted', { cause: signal.reason }))
        }
        markForwardStarted()
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        releaseForward = (reason) => {
          signal.removeEventListener('abort', onAbort)
          reject(reason)
        }
      }),
    }, operation.signal)

    const result = run.result
    await forwardStarted
    operation.abort(cancelReason)
    await forwardAborted
    await expect(result).resolves.toMatchObject({ stopReason: 'aborted' })
    await run.dispose()

    expect(failure).toMatchObject({ kind: 'transport', events: [] })
    expect(fatalErrors).toEqual([])
    expect(existsSync(run.codexHome)).toBe(false)
  } finally {
    operation.abort(cancelReason)
    releaseForward?.(cancelReason)
    try {
      if (run !== undefined) await run.dispose()
    } finally {
      try {
        await provider.dispose()
      } finally {
        removeOwnedWorkspace(root)
      }
    }
  }
})
