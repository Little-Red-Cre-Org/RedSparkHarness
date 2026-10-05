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
import { plugin } from '../src/native.ts'

it('creates, resumes and cancels one durable Session through the real browser RPC carrier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-web-session-'))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const scope = new NativeScope()
  let web: NativeHttpHost | undefined
  const requests: GenerateOptions[] = []
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
          throw signal.reason
        }
        const text = requests.length === 1 ? 'first answer' : 'resumed answer'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
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
      maxPendingRequests: 1, maxHistoryEvents: 100, maxPromptChars: 100 } },
    ...[agents, execution, modelExecution, model, carrier].map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: localFilesystemPlugin, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
  ], 'host'))
  try {
    await host.start()
    if (web === undefined) throw new Error('missing HTTP Host')
    const login = await fetch(web.connection.authenticatedUrl(web.url), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing browser authentication')
    const url = web.url
    const rpc = createWebConnectionRpc((input, init) => {
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return fetch(new URL(input.pathname, url), { ...init, headers })
    })
    const client = createNativeSessionClient(rpc)
    const { sessionId } = await client.create()
    expect((await client.list()).map(header => header.id)).toEqual([sessionId])
    expect(await client.prompt(sessionId, 'first input', true)).toEqual({ exitCode: 0, answer: 'first answer' })
    expect(await client.prompt(sessionId, 'second input', true)).toEqual({ exitCode: 0, answer: 'resumed answer' })
    const history = await client.history(sessionId)
    expect(history.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message').map(event => event.type))
      .toEqual(['user/message', 'assistant/message', 'user/message', 'assistant/message'])
    expect(requests[1]?.messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'first input'))).toBe(true)
    const pending = client.prompt(sessionId, 'cancel input', true)
    await vi.waitFor(() => { expect(requests).toHaveLength(3) })
    // The sole ordinary admission slot is full; control admission must still cancel it.
    expect(await client.status(sessionId)).toEqual({ status: 'running' })
    expect(await client.cancel(sessionId)).toEqual({ cancelled: true })
    expect((await pending).exitCode).not.toBe(0)
    expect(await client.status(sessionId)).toEqual({ status: 'idle' })
    expect((await client.history(sessionId)).events.at(-1)?.type).toBe('turn/end')
  } finally {
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
