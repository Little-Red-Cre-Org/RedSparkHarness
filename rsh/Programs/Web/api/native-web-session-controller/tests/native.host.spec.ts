/** Native browser Session lifecycle through the authenticated HTTP Connection carrier. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { createNativeHostConnectionRegistry } from '@deepseek-ai/dsh-client-connection/native-host'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { bridge } from '@deepseek-ai/dsh-client-connection/native-http-bridge'
import { listenNativeHttpHost, type NativeHttpHost } from '@deepseek-ai/dsh-native-web-assets'
import { createNativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { NativeConversationController } from '@deepseek-ai/dsh-client-native-application'
import { plugin, resolveNativeWebSessionConfig } from '../src/native.ts'

it('creates, resumes and cancels one durable Session through the real browser RPC carrier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-web-session-'))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const scope = new NativeScope()
  let web: NativeHttpHost | undefined
  const requests: GenerateOptions[] = []
  const firstContinue = Promise.withResolvers<undefined>()
  let followFields: unknown
  let modelAborted!: () => void
  let releaseCleanup!: () => void
  const aborted = new Promise<void>((resolve) => { modelAborted = resolve })
  const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
  const model: NativePlugin = {
    apiVersion: 1, name: 'fixture-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', {
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(request)
        if (requests.length > 2) {
          const signal = request.signal
          if (signal === undefined) throw new Error('missing model cancellation')
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          modelAborted()
          await cleanup
          throw signal.reason
        }
        const text = requests.length === 1 ? 'first answer' : 'resumed answer'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        if (requests.length === 1) await firstContinue.promise
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }) },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'fixture-carrier', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => async (context) => {
      let value: CredentialRecord | undefined
      const registry = await createNativeHostConnectionRegistry({}, { async modifyRecord(_key, mutate) {
        value = await mutate(value)
        return value
      } })
      web = await listenNativeHttpHost(registry, { requestBodyMode: () => 'buffered', fetch: () => Promise.resolve(new Response('native')) }, bridge, { port: 0 })
      context.own(() => web!.close())
      context.provide('hostConnection', web.connection)
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
      maxPendingRequests: 1, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000, maxFollowers: 2 } },
    ...[agents, execution, modelExecution, model, carrier].map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: localFilesystemPlugin, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
  ], 'host'))
  try {
    for (const key of ['maxFollowBufferBytes', 'maxFollowers']) expect(() => resolveNativeWebSessionConfig({ cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
      maxPendingRequests: 1, maxHistoryEvents: 100, maxPromptChars: 100,
      maxFollowBufferBytes: 1000000, maxFollowers: 2, [key]: 0 })).toThrow(key)
    await host.start()
    if (web === undefined) throw new Error('missing HTTP Host')
    const login = await fetch(web.connection.authenticatedUrl(web.url), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing browser authentication')
    const url = web.url
    const rpc = createWebConnectionRpc((input, init) => {
      if (input.pathname.endsWith('/native-session/follow')) followFields = JSON.parse(init.body as string)
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return fetch(new URL(input.pathname, url), { ...init, headers })
    })
    const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1000000 })
    const conversation = new NativeConversationController(client, { maxLiveTextChars: 4, maxLiveEvents: 100 })
    await conversation.load()
    await conversation.create()
    const sessionId = conversation.getSnapshot().selected!
    expect((await client.list()).map(header => header.id)).toEqual([sessionId])
    const first = conversation.send('first input')
    await vi.waitFor(() => { expect(conversation.getSnapshot().error).toBeUndefined(); expect(conversation.getSnapshot().liveText).toBe('swer') })
    expect(conversation.getSnapshot()).toMatchObject({ state: 'sending', liveTruncated: true })
    expect(conversation.getSnapshot().events.some(event => event.type === 'user/message')).toBe(true)
    expect(conversation.getSnapshot().events.some(event => event.type === 'assistant/message')).toBe(false)
    const admission = followFields as { sessionId: string; admissionId: string }
    expect((await fetch(new URL('/api/native-session/follow', url), { method: 'POST', body: JSON.stringify(admission) })).status).toBe(401)
    expect((await rpc.response!('/api', 'native-session/follow', { ...admission, admissionId: 'wrong' }, new AbortController().signal)).status).toBe(409)
    expect((await rpc.response!('/api', 'native-session/follow', admission, new AbortController().signal)).status).toBe(409)
    firstContinue.resolve(undefined)
    await first
    expect(conversation.getSnapshot().liveText).toBeUndefined()
    expect(conversation.getSnapshot().events.at(-1)?.type).toBe('turn/end')
    await conversation.select(sessionId)
    await conversation.send('second input')
    const history = await client.history(sessionId)
    expect(history.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message').map(event => event.type))
      .toEqual(['user/message', 'assistant/message', 'user/message', 'assistant/message'])
    expect(requests[1]?.messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'first input'))).toBe(true)
    const early = new AbortController()
    early.abort(new Error('before admission'))
    await expect(client.prompt(sessionId, 'not admitted', true, early.signal)).rejects.toThrow('before admission')
    expect(requests).toHaveLength(2)
    let settled = false
    const pending = conversation.send('cancel input')
    void pending.then(() => { settled = true }, () => { settled = true })
    await vi.waitFor(() => { expect(requests).toHaveLength(3) })
    // The sole ordinary admission slot is full; control admission must still cancel it.
    expect(await client.status(sessionId)).toEqual({ status: 'running' })
    conversation.cancel()
    expect(conversation.getSnapshot().state).toBe('cancelling')
    await aborted
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    releaseCleanup()
    await pending
    expect(conversation.getSnapshot().state).toBe('ready')
    expect(conversation.getSnapshot().events.at(-1)?.type).toBe('turn/end')
    expect(await client.status(sessionId)).toEqual({ status: 'idle' })
    expect((await client.history(sessionId)).events.at(-1)?.type).toBe('turn/end')
    await conversation.close()
    await client.close()
  } finally {
    firstContinue.resolve(undefined)
    releaseCleanup()
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  { type: 'future/required', data: {}, surfaceOp: undefined },
  { type: 'user/message', data: null, surfaceOp: 'append' },
])('refuses unsupported or malformed history event $type', async (event) => {
  const header = { id: 'wire-session', version: 3, createdAt: 0, isSeeded: false }
  const reply = { header, events: [{ seq: 0, time: 0, ...event }], inheritedEventCount: 0 }
  const rpc = { call: vi.fn(async () => ({ ok: true, value: reply })) } as unknown as import('@deepseek-ai/dsh-client-connection/native').ClientConnectionRpc
  const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1000000 })
  await expect(client.history(header.id as import('@deepseek-ai/dsh-session/types').SessionId)).rejects.toThrow()
  if (event.type === 'future/required') {
    Object.assign(reply.events[0]!, { ignorable: true })
    expect((await client.history(header.id as import('@deepseek-ai/dsh-session/types').SessionId)).events[0]?.type).toBe('future/required')
  }
})
