import { PassThrough, Writable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { AttachmentId } from '@deepseek-ai/dsh-attachment/brand'
import type {
  NativeExternalSubagentModelOperations,
  NativeExternalToolCall,
  NativeExternalToolCallGrant,
} from '@deepseek-ai/dsh-native-subagent/native'
import { createCodexDynamicToolCatalog } from '../src/dynamic-tools.ts'
import { NativeCodexToolBridge } from '../src/native-tool-bridge.ts'
import { CodexAppServerWire } from '../src/wire.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

it.each([
  { label: 'wrong authoritative turn', changes: { turnId: 'foreign-turn' }, cancelBeforeTurnStart: false, fatal: true },
  { label: 'different recorded arguments', changes: { arguments: { key: 'different' } }, cancelBeforeTurnStart: false, fatal: true },
  { label: 'unissued call id', changes: { callId: 'foreign-call' }, cancelBeforeTurnStart: false, fatal: true },
  { label: 'cancellation during turn/start', changes: {}, cancelBeforeTurnStart: true, fatal: false },
])('fails closed when a tool call has $label', async ({ changes, cancelBeforeTurnStart, fatal }) => {
  const input = new PassThrough()
  const controller = new AbortController()
  const turnStartSent = Promise.withResolvers<undefined>()
  const turnStarted = Promise.withResolvers<undefined>()
  const reply = Promise.withResolvers<Record<string, unknown>>()
  const executeTool = vi.fn(async () => ({
    result: { content: [], isError: false }, settlementContexts: [], concludesTurn: false, images: [],
  }))
  const fatalFn = vi.fn()
  const model: NativeExternalSubagentModelOperations = {
    tools: { schemas: [{ name: 'lookup', description: 'lookup', parameters: { type: 'object' } }], programSchemas: [], promptText: '' },
    async admitModelRequest() { throw new Error('unexpected model request') },
    async recordModelResponse() { throw new Error('unexpected model response') },
    async recordModelFailure() {},
    executeTool,
    fatal: fatalFn,
  }
  const output = new Writable({ write(chunk, _encoding, callback) {
    const text = String(chunk).trim()
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text)
      if (!isRecord(parsed)) throw new Error('fixture expected an outgoing JSON-RPC object')
      const frame = parsed
      if (frame.id === 'server-call') reply.resolve(frame)
      else if (frame.method === 'initialize') input.write(`${JSON.stringify({ id: frame.id, result: {} })}\n`)
      else if (frame.method === 'thread/start') input.write(`${JSON.stringify({ id: frame.id, result: { thread: { id: 'thread', ephemeral: true } } })}\n`)
      else if (frame.method === 'turn/start') {
        turnStartSent.resolve(undefined)
        if (!cancelBeforeTurnStart) {
          input.write(`${JSON.stringify({ id: frame.id, result: { turn: { id: 'turn' } } })}\n`)
          turnStarted.resolve(undefined)
        }
      }
    }
    callback()
  } })
  const bridge = new NativeCodexToolBridge(model, createCodexDynamicToolCatalog(model.tools))
  const wire = new CodexAppServerWire(input, output, 'never', 'fixture-model', bridge)
  wire.start()
  const call = { callId: ToolCallId('call'), name: 'lookup', arguments: { key: 'recorded' } }
  let pending: Promise<unknown> | undefined
  try {
    await wire.initialize(controller.signal)
    await wire.startThread(process.cwd(), controller.signal)
    // The runtime-private brand is supplied by the Engine grant issuer in production.
    if (!cancelBeforeTurnStart) {
      bridge.registerResponseGrants(1, [call], [Object.freeze({ ...call }) as unknown as NativeExternalToolCallGrant])
    }
    pending = wire.runTurn(['fixture'], controller.signal).then(
      () => undefined,
      (error: unknown) => error instanceof Error ? error : new Error(String(error)),
    )
    if (cancelBeforeTurnStart) {
      await turnStartSent.promise
      const reason = new Error('fixture cancellation during turn/start')
      controller.abort(reason)
      expect(await pending).toBe(reason)
      expect(executeTool).not.toHaveBeenCalled()
      expect(fatalFn).not.toHaveBeenCalled()
      expect(bridge.modelAdmissionOpen).toBe(false)
      return
    }
    await turnStarted.promise
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    input.write(`${JSON.stringify({
      id: 'server-call',
      method: 'item/tool/call',
      params: {
        threadId: 'thread',
        turnId: 'turn',
        callId: 'call',
        tool: 'lookup',
        arguments: { key: 'recorded' },
        ...changes,
      },
    })}\n`)
    expect(await reply.promise).toMatchObject({ id: 'server-call', error: { code: -32603 } })
    expect(executeTool).not.toHaveBeenCalled()
    expect(fatalFn).toHaveBeenCalledTimes(fatal ? 1 : 0)
    expect(bridge.modelAdmissionOpen).toBe(false)
  } finally {
    controller.abort(new Error('probe cleanup'))
    wire.close()
    await bridge.drainAccepted()
    await pending
    input.destroy()
    output.destroy()
  }
})

it('settles every grant in a response batch before concluding after its last written reply', async () => {
  const tools: NativeExternalSubagentModelOperations['tools'] = {
    schemas: [{ name: 'fixture_tool', description: 'fixture', parameters: { type: 'object' } }],
    programSchemas: [],
    promptText: '',
  }
  const calls: NativeExternalToolCall[] = [
    { callId: ToolCallId('call-a'), name: 'fixture_tool', arguments: { value: 'a' } },
    { callId: ToolCallId('call-b'), name: 'fixture_tool', arguments: { value: 'b' } },
  ]
  const grants = calls.map(call => Object.freeze({ ...call }) as NativeExternalToolCallGrant)
  const imageRef = { attachmentId: AttachmentId('fixture-image'), mediaType: 'image/png' as const, bytes: 3, width: 1, height: 1 }
  const imageBytes = new Uint8Array([1, 2, 3])
  const executed: string[] = []
  const model: NativeExternalSubagentModelOperations = {
    tools,
    async admitModelRequest() { throw new Error('unexpected model request') },
    async recordModelResponse() { throw new Error('unexpected model response') },
    async recordModelFailure() {},
    async executeTool(grant) {
      const callId = String(grant.callId)
      executed.push(callId)
      return {
        result: {
          content: callId === 'call-b'
            ? [{ type: 'text', text: callId }, { type: 'image', attachment: imageRef }]
            : [{ type: 'text', text: callId }],
          isError: false,
        },
        settlementContexts: [],
        concludesTurn: callId === 'call-a',
        images: callId === 'call-b' ? [{ ref: imageRef, data: imageBytes }] : [],
      }
    },
    fatal: vi.fn(),
  }
  const bridge = new NativeCodexToolBridge(model, createCodexDynamicToolCatalog(tools))
  bridge.bindThread('thread-1')
  bridge.registerResponseGrants(1, calls, grants)

  const paramsA = { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-a', tool: 'fixture_tool', arguments: calls[0]!.arguments }
  const pendingA = bridge.executeCall(paramsA, new AbortController().signal)
  expect(executed).toEqual([])
  bridge.bindTurn('turn-1')
  const responseA = await pendingA
  expect(responseA.success).toBe(true)
  expect(bridge.requestResultWritten('item/tool/call', paramsA, responseA)).toBeUndefined()
  expect(bridge.modelAdmissionOpen).toBe(false)

  const paramsB = { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-b', tool: 'fixture_tool', arguments: calls[1]!.arguments }
  const responseB = await bridge.executeCall(paramsB, new AbortController().signal)
  expect(responseB.success).toBe(true)
  expect(responseB.contentItems).toEqual([
    { type: 'inputText', text: 'call-b' },
    { type: 'inputImage', imageUrl: 'data:image/png;base64,AQID' },
  ])
  const conclusion = bridge.requestResultWritten('item/tool/call', paramsB, responseB)

  expect(executed).toEqual(['call-a', 'call-b'])
  expect(conclusion).toEqual({ threadId: 'thread-1', turnId: 'turn-1', result: { content: [{ type: 'text', text: 'call-a' }], isError: false } })
  expect(bridge.requestResultWritten('turn/interrupt', {}, {})).toBeUndefined()
  await bridge.drainAccepted()
})
