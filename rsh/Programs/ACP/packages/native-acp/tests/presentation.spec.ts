import { expect, it, vi } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { nativeAcpUpdates, nativeAcpUsageUpdate } from '../src/presentation.ts'

const image = { attachment: { attachmentId: 'stored-image', mediaType: 'image/png', bytes: 2, width: 1, height: 1 } }

function assistantEvent(content: readonly unknown[], usage?: unknown): SessionEvent<'assistant/message'> {
  return { type: 'assistant/message', surfaceOp: 'append', seq: 0, time: 0, data: { turn: 1, step: 1, stream: [],
    message: { id: 'assistant-image', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content },
    ...usage === undefined ? {} : { usage } } } as unknown as SessionEvent<'assistant/message'>
}

it('projects assistant and tool-result images, optional usage, and image failures', async () => {
  const readImage = vi.fn(async (ref: typeof image.attachment) => ({ ref, data: Buffer.from([1, 2]) }))
  const context = { optional: (name: string) => name === 'attachments' ? { readImage } : undefined } as unknown as NativeContext
  const assistant = await nativeAcpUpdates(context, assistantEvent([{ type: 'image', ...image }]))
  const toolResult = { type: 'tool/result', surfaceOp: 'append', seq: 1, time: 1, data: { turn: 1, step: 1,
    message: { id: 'tool-result', role: 'user', source: { kind: 'tool', callId: 'image-call' }, content: [{ type: 'tool-result',
      toolCallId: 'image-call', isError: false, content: [{ type: 'image', ...image }] }] } } } as unknown as SessionEvent

  await expect(nativeAcpUpdates(context, toolResult)).resolves.toMatchObject([{ sessionUpdate: 'tool_call_update',
    content: [{ type: 'content', content: { type: 'image', data: 'AQI=', mimeType: 'image/png' } }] }])
  expect(assistant).toMatchObject([{ sessionUpdate: 'agent_message_chunk',
    content: { type: 'image', data: 'AQI=', mimeType: 'image/png' } }])
  expect(readImage).toHaveBeenCalledTimes(2)
  const meter = { measure: vi.fn(() => ({ totalTokens: 7 })) }
  const usageContext = { optional: (name: string) => name === 'tokenMeter' ? meter : undefined } as unknown as NativeContext
  const session = { requestContext: () => ({ contextWindow: 128 }) } as unknown as Session
  const event = assistantEvent([{ type: 'text', text: 'done' }], { inputTokens: 3, outputTokens: 2 })

  expect(nativeAcpUsageUpdate(usageContext, session, event)).toEqual({ sessionUpdate: 'usage_update', used: 7, size: 128 })
  expect(nativeAcpUsageUpdate(usageContext, session, assistantEvent([{ type: 'text', text: 'done' }]))).toBeUndefined()
  expect(nativeAcpUsageUpdate(usageContext, { requestContext: () => undefined } as unknown as Session, event)).toBeUndefined()
  expect(nativeAcpUsageUpdate({ optional: () => undefined } as unknown as NativeContext, session, event)).toBeUndefined()
  expect(meter.measure).toHaveBeenCalledTimes(1)
  const failure = new Error('stored image failed integrity verification')
  const failingContext = { optional: () => ({ readImage: async () => { throw failure } }) } as unknown as NativeContext

  await expect(nativeAcpUpdates(failingContext, assistantEvent([{ type: 'image', ...image }]))).rejects.toBe(failure)
})
