/** The SDK initializes and admits a prompt without installing subagent capabilities, then drains on EOF. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeContext, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { LlmAdapter, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { NativeSdkApplication, plugin as sdkServer } from '../src/native.ts'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as attachments } from '@deepseek-ai/dsh-attachment-local/native'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasMessageId(value: unknown): boolean {
  return isRecord(value) && typeof value.messageId === 'string' && value.messageId.length > 0
}

function isAssistantReply(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'assistant/message' || !isRecord(value.data)
    || !isRecord(value.data.message) || !Array.isArray(value.data.message.content)) return false
  const content = value.data.message.content as unknown[]
  return content.some(block => isRecord(block) && block.type === 'text' && block.text === 'minimal model reply')
}

it('runs without the optional subagent Provider and drains admitted model work after EOF', async () => {
  expect(sdkServer.requires).not.toContain('subagents')
  expect(sdkServer.optional).toContain('subagents')
  expect(sdkServer.provides).toContain('rootExecution')
  const entered = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const idle = Promise.withResolvers<undefined>()
  const sessionEvents: unknown[] = []
  let modelSettled = false
  let modelReleased = false
  let runReturned = false
  class DeferredModel extends LlmAdapter {
    private calls = 0
    override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
      if (this.calls++ < 2) return { provider, id: model, name: model }
      signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      entered.resolve(undefined)
      try {
        await release.promise
        signal?.throwIfAborted()
        return { provider, id: model, name: model }
      } finally { modelSettled = true }
    }

    override async *stream(): AsyncIterable<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'minimal model reply' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'minimal model reply' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const input = new PassThrough()
  const output = new PassThrough()
  const scope = new NativeScope()
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-sdk-minimal-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  await mkdir(workspace)
  const replies = new Map<number, ReturnType<typeof Promise.withResolvers<{ id: number; result?: unknown; error?: unknown }>>>()
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
        id?: number
        result?: unknown
        error?: unknown
        method?: string
        params?: { sessionId?: string; status?: string; event?: unknown }
      }
      if (message.id !== undefined) replies.get(message.id)?.resolve(message as { id: number; result?: unknown; error?: unknown })
      if (message.method === 'session.event' && message.params?.sessionId === 'minimal-sdk-session') {
        sessionEvents.push(message.params.event)
      }
      if (message.method === 'session.status' && message.params?.sessionId === 'minimal-sdk-session'
        && message.params.status === 'idle') idle.resolve(undefined)
    }
  })
  const response = (id: number) => {
    const deferred = Promise.withResolvers<{ id: number; result?: unknown; error?: unknown }>()
    replies.set(id, deferred)
    return deferred.promise
  }
  let app: NativeSdkApplication | undefined
  let carrierContext: NativeContext | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'deferred-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', new DeferredModel())
      context.own(() => { modelReleased = true })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'minimal-sdk-carrier', targets: ['host'],
    requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions', 'attachments'],
    optional: ['subagents', 'tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentInstructions',
      'modelSelection', 'agentPresets', 'workspaceRegistry'], provides: ['application', 'rootExecution'],
    resolve: () => (context) => {
      carrierContext = context
      app = new NativeSdkApplication(context, { systemPrompt: 'fixture', maxSteps: 1 }, input, output)
      context.provide('application', app)
      context.provide('rootExecution', app.rootExecution)
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agents, scope, config: undefined }, { plugin: execution, scope, config: undefined },
    { plugin: modelExecution, scope, config: undefined }, { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: storage, scope, config: { root: sessions, compression: 'none' } },
    { plugin: attachments, scope, config: { dshHome: home } }, { plugin: model, scope, config: undefined },
    { plugin: carrier, scope, config: undefined },
  ], 'host'))
  let done: Promise<unknown> | undefined
  try {
    await host.start()
    if (app === undefined || carrierContext === undefined) throw new Error('minimal SDK carrier did not activate')
    const application = app
    const context = carrierContext
    done = host.run(scope, { kind: 'test' }, invocation => application.run([], invocation.signal)).then(async (result) => {
      runReturned = true
      return result
    }, (error: unknown) => ({ error }))
    const callerAbort = new AbortController()
    const canceledReadiness = application.rootExecution.ready(callerAbort.signal).catch((error: unknown) => error)
    const callerReason = { kind: 'fixture caller cancellation' }
    callerAbort.abort(callerReason)
    expect(await canceledReadiness).toBe(callerReason)
    const pendingReadiness = application.rootExecution.ready(new AbortController().signal)
    const initialized = response(1)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      cwd: workspace, provider: 'fixture', model: 'fixture', maxSteps: 9,
    } })}\n`)
    const initialization = await initialized
    expect(initialization.result, JSON.stringify(initialization)).toMatchObject({
      serverInfo: { name: 'deepseek-harness-sdk-runtime' }, maxSteps: 1,
    })
    await pendingReadiness
    const firstPrompt = response(2)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: {
      sessionId: 'minimal-sdk-session', contentBlocks: [{ type: 'text', text: 'Run without subagents.' }],
    } })}\n`)
    expect(hasMessageId((await firstPrompt).result)).toBe(true)
    await idle.promise
    expect(sessionEvents.some(isAssistantReply)).toBe(true)
    const acceptedPrompt = response(3)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: {
      sessionId: 'minimal-sdk-session', contentBlocks: [{ type: 'text', text: 'Wait for model cancellation.' }],
    } })}\n`)
    await entered.promise
    expect(hasMessageId((await acceptedPrompt).result)).toBe(true)
    input.end()
    await aborted.promise
    await setImmediate()
    expect({ runReturned, modelReleased, modelSettled }).toEqual({ runReturned: false, modelReleased: false, modelSettled: false })
    release.resolve(undefined)
    expect(await done).toBe(0)
    expect({ modelReleased, modelSettled }).toEqual({ modelReleased: false, modelSettled: true })
    const shutdownInput = new PassThrough()
    const shutdownOutput = new PassThrough()
    const shutdownApplication = new NativeSdkApplication(context, { systemPrompt: 'fixture', maxSteps: 1 }, shutdownInput, shutdownOutput)
    const shutdown = new AbortController()
    const shutdownDone = shutdownApplication.run([], shutdown.signal)
    const shutdownReadiness = shutdownApplication.rootExecution.ready(new AbortController().signal).catch((error: unknown) => error)
    shutdown.abort(new Error('Host stopped'))
    expect(await shutdownReadiness).toMatchObject({ message: 'native SDK: closing' })
    expect(await shutdownDone).toBe(0)
    await expect(shutdownApplication.rootExecution.ready(new AbortController().signal)).rejects.toThrow('native SDK: closing')
    shutdownInput.destroy()
    shutdownOutput.destroy()
    await host.stop()
    expect({ modelReleased, modelSettled }).toEqual({ modelReleased: true, modelSettled: true })
    const persistence = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const reader = await persistence.open(SessionId('minimal-sdk-session'), 'read')
      try {
        const events = (await reader.read()).events
        expect(sessionEvents).toEqual(events)
        expect(events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind))
          .toEqual(['completed', 'aborted'])
        expect(events.find(event => event.type === 'assistant/message')).toMatchObject({ data: {
          message: { content: [{ type: 'text', text: 'minimal model reply' }] },
        } })
      } finally { await reader.close() }
    } finally { await persistence.close() }
  } finally {
    release.resolve(undefined)
    input.end()
    await done
    await host.stop()
    input.destroy()
    output.destroy()
    await rm(home, { recursive: true, force: true })
  }
})
