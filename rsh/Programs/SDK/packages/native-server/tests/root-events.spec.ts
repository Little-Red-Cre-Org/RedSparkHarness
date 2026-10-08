/** Native SDK root events stay live after the foreground turn and drain at shutdown. */
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { NativeScope, type NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import { NativeSdkApplication } from '../src/native.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

it('deduplicates the foreground event and streams a late root event until shutdown', async () => {
  const sessionId = 'sdk-root-events'
  const agent = { id: sessionId }
  const listeners = new Set<(event: SessionEvent) => void>()
  const attached = new Set<(owner: unknown) => Promise<void>>()
  const detached = new Set<(owner: unknown) => Promise<void>>()
  const owner = {
    agent,
    invocation: 'root',
    session: { id: sessionId, header: {} },
    onEvent(observer: (event: SessionEvent) => void): () => void {
      listeners.add(observer)
      return () => { listeners.delete(observer) }
    },
  }
  const activeSessions = {
    onAttached(observer: (owner: unknown) => Promise<void>) {
      attached.add(observer)
      return async (): Promise<void> => { attached.delete(observer) }
    },
    onDetached(observer: (owner: unknown) => Promise<void>) {
      detached.add(observer)
      return async (): Promise<void> => { detached.delete(observer) }
    },
  }
  const context = {
    scope: new NativeScope(),
    signal: new AbortController().signal,
    require(name: string): unknown {
      if (name === 'activeSessions') return activeSessions
      if (name === 'attachments') return {
        admitPromptContent: async (parts: readonly { type: 'text'; text: string }[]) => parts,
      }
      if (name === 'sessionPersistence') return { stat: async () => undefined }
      throw new Error(`unexpected native SDK service ${name}`)
    },
    optional: () => undefined,
  } as unknown as NativeContext
  const acceptedEvent = Promise.withResolvers<SessionEvent>()
  const lateEvent = {
    type: 'session/title', seq: 2, time: 2,
    data: { title: 'late SDK title', messageSeqs: [], source: { kind: 'fallback' } },
  } as unknown as SessionEvent
  const executor = {
    rootExecution: { capture: () => ({ id: 'root' }) },
    interactionOwner: (candidate: unknown) => candidate === agent
      ? { displayRootAgent: agent, displayRootSessionId: sessionId } : undefined,
    executeRootTurn: async (request: { message: { id: string }; onEvent: (event: SessionEvent) => void }) => {
      const event = {
        type: 'agent/inbox/spliced', seq: 1, time: 1,
        data: { target: 'next-turn', start: 0, inserted: [request.message] },
      } as unknown as SessionEvent
      acceptedEvent.resolve(event)
      request.onEvent(event)
      for (const observer of listeners) observer(event)
    },
    dispose: async () => {},
  } as unknown as NativeHeadlessApplication
  const input = new PassThrough()
  const output = new PassThrough()
  const application = new NativeSdkApplication(context, { systemPrompt: 'fixture', maxSteps: 1 }, input, output)
  Object.defineProperty(application, 'executor', { value: executor, writable: true })
  const replies = new Map<string, ReturnType<typeof Promise.withResolvers<Record<string, unknown>>>>()
  const sessionEvents: unknown[] = []
  const idle = Promise.withResolvers<undefined>()
  const lateEventSeen = Promise.withResolvers<undefined>()
  let outputBuffer = ''
  output.on('data', (chunk: Buffer | string) => {
    outputBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      const newline = outputBuffer.indexOf('\n')
      if (newline < 0) break
      const line = outputBuffer.slice(0, newline)
      outputBuffer = outputBuffer.slice(newline + 1)
      if (line.length === 0) continue
      const message = JSON.parse(line) as {
        id?: string
        result?: Record<string, unknown>
        method?: string
        params?: { sessionId?: string; status?: string; event?: unknown }
      }
      if (message.id !== undefined) replies.get(message.id)?.resolve(message as Record<string, unknown>)
      if (message.method === 'session.status' && message.params?.sessionId === sessionId
        && message.params.status === 'idle') idle.resolve(undefined)
      if (message.method === 'session.event' && message.params?.sessionId === sessionId) {
        sessionEvents.push(message.params.event)
        if (isRecord(message.params.event) && message.params.event.type === 'session/title') lateEventSeen.resolve(undefined)
      }
    }
  })
  const request = (id: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = Promise.withResolvers<Record<string, unknown>>()
    replies.set(id, response)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return response.promise
  }

  const done = application.run([], new AbortController().signal)
  try {
    await Promise.all([...attached].map(observer => observer(owner)))
    const prompt = request('prompt', 'session/prompt', {
      sessionId, contentBlocks: [{ type: 'text', text: 'hello' }],
    })
    expect((await prompt).result).toMatchObject({ messageId: expect.any(String) })
    await idle.promise
    const accepted = await acceptedEvent.promise
    for (const observer of listeners) observer(lateEvent)
    await lateEventSeen.promise
    expect(sessionEvents).toEqual([accepted, lateEvent])
    expect([...listeners]).toHaveLength(1)
    await request('shutdown', 'shutdown', {})
    input.end()
    expect(await done).toBe(0)
    expect([...listeners]).toHaveLength(0)
    expect([...attached]).toHaveLength(0)
    expect([...detached]).toHaveLength(0)
  } finally {
    input.end()
    await done
    input.destroy()
    output.destroy()
  }
})
