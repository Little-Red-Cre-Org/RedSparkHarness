/** Native browser Session lifecycle through the authenticated HTTP Connection carrier. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { NativeAgentId, type NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as modelSelection } from '@deepseek-ai/dsh-native-model-selection/native'
import { plugin as tools } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as approval } from '@deepseek-ai/dsh-native-approval/native'
import { plugin as questions } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as askUser } from '@deepseek-ai/dsh-tool-ask-user/native'
import { toolCallResponse, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin as agentPresets } from '@deepseek-ai/dsh-agent-presets/native'
import { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
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
  let foreign: NativeHeadlessApplication | undefined
  let persistence: NativeSessionPersistenceOperations | undefined
  const foreignId = SessionId('foreign-human')
  const foreignModelReady = Promise.withResolvers<undefined>()
  const releaseForeignModel = Promise.withResolvers<undefined>()
  const webReadReady = Promise.withResolvers<undefined>()
  const releaseWebRead = Promise.withResolvers<undefined>()
  const foreignAbort = new AbortController()
  let foreignStep = 0
  let foreignApprovals = 0
  const requests: GenerateOptions[] = []
  const firstContinue = Promise.withResolvers<undefined>()
  const resolving = Promise.withResolvers<undefined>()
  const releaseResolution = Promise.withResolvers<undefined>()
  let holdResolution = false
  let releaseRetainedRoot: (() => void) | undefined
  let retainedExecution: NativeAgentExecution | undefined
  let humanSteps: StreamChunk[][] | undefined
  let protectedRuns = 0
  let followFields: unknown
  let modelAborted!: () => void
  let releaseCleanup!: () => void
  const aborted = new Promise<void>((resolve) => { modelAborted = resolve })
  const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
  const model: NativePlugin = {
    apiVersion: 1, name: 'fixture-model', targets: ['host'], requires: ['agentPresets', 'activeSessions', 'agents', 'tools'], provides: ['model', 'modelDirectory'],
    resolve: () => (context) => {
      for (const id of ['standard', 'alternate']) context.own(context.require('agentPresets').register({ id, name: id, scope }))
      context.effect(context.require('tools').register({ schema: { name: 'guarded', description: 'Guarded fixture.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } }, approval: { reason: 'Protect this action.' },
      execute: async () => { protectedRuns++; return { isError: false, content: [{ type: 'text', text: 'guarded allowed' }] } },
      }, scope))
      const reasoning = { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] }
      context.provide('modelDirectory', { providers: () => [{ id: 'fixture', name: 'Fixture' }],
        resolve: async (provider, id) => {
          if (releaseRetainedRoot === undefined) {
            const owner = context.require('activeSessions').owners().find(owner => owner.invocation === 'root')
            if (owner === undefined) throw new Error('missing active root')
            retainedExecution = context.require('agents').execution(owner.agent)
            releaseRetainedRoot = owner.retain()
            context.own(releaseRetainedRoot)
          }
          if (holdResolution) { resolving.resolve(undefined); await releaseResolution.promise }
          return { provider, id, name: id, reasoning }
        },
        catalog: async defaults => ({ default: defaults, routableProviders: ['fixture'], failures: [], groups: [{
          id: 'fixture', name: 'Fixture', models: [{ id: 'chosen', name: 'Chosen', reasoning }],
        }] }) })
      context.provide('model', {
        async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
          requests.push(request)
          if (request.model === 'foreign') {
            if (foreignStep++ === 0) {
              foreignModelReady.resolve(undefined)
              await releaseForeignModel.promise
              yield* toolCallResponse('foreign-guard', 'guarded', {})
            } else yield* textResponse('foreign complete')
            return
          }
          if (humanSteps !== undefined) { yield* humanSteps.shift() ?? textResponse('human complete'); return }
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
  const foreignProgram: NativePlugin = {
    apiVersion: 1, name: 'foreign-program', targets: ['host'],
    requires: ['nativeWebSession', 'fs', 'sessionPersistence', 'modelExecution', 'agents'],
    optional: ['approval', 'tools', 'promptSections', 'sandboxPolicy', 'codeRuntime', 'timeContext', 'sessionExecution', 'activeSessions', 'modelSelection', 'agentPresets', 'workspaceRegistry', 'agentInstructions'], provides: [],
    resolve: () => (context) => {
      persistence = context.require('sessionPersistence')
      foreign = createNativeHeadlessApplication(context, { cwd, provider: 'fixture', model: 'foreign',
        systemPrompt: 'Foreign.', maxSteps: 3, builtinTools: false })
      const approvals = context.optional('approval')
      if (approvals === undefined) throw new Error('missing approval Provider')
      context.own(approvals.registerAnswerer((request) => {
        if (request.agent.id !== NativeAgentId(foreignId)) return undefined
        foreignApprovals++
        return 'allowed-once'
      }))
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 5, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 2, maxPendingHumanRequests: 2 } },
    ...[agents, execution, modelExecution, modelSelection, tools, approval, questions, askUser,
      model, carrier, foreignProgram].map(plugin =>
      ({ plugin, scope, config: undefined })),
    { plugin: agentPresets, scope, config: { default: 'standard' } },
    { plugin: localFilesystemPlugin, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
  ], 'host'))
  try {
    for (const key of ['maxFollowBufferBytes', 'maxFollowers']) expect(() => resolveNativeWebSessionConfig({ cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
      maxPendingRequests: 1, maxHistoryEvents: 100, maxPromptChars: 100,
      maxFollowBufferBytes: 1000000, maxFollowers: 2, maxPendingHumanRequests: 2, [key]: 0 })).toThrow(key)
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
    expect((await client.modelControls()).catalog?.groups[0]?.models[0]?.id).toBe('chosen')
    await conversation.selectPreset('alternate')
    await conversation.selectModel({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen' }, expectedRevision: null })).rejects.toThrow('stale selection revision')
    const selectedEvent = (await client.history(sessionId)).events.findLast(event => event.type === 'model/selection')
    expect(selectedEvent?.data).toEqual({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen', reasoningEffort: 'unknown' }, expectedRevision: selectedEvent!.seq })).rejects.toThrow()
    holdResolution = true
    const selection = client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen', reasoningEffort: 'high' }, expectedRevision: selectedEvent!.seq })
    await resolving.promise
    const queuedAbort = new AbortController()
    const queued = client.prompt(sessionId, 'queued during selection', true, queuedAbort.signal)
    const refusedQueued = expect(queued).resolves.toEqual({ exitCode: 130 })
    await vi.waitFor(async () => { expect((await client.status(sessionId)).status === 'running' || requests.length > 0).toBe(true) })
    expect(requests).toHaveLength(0)
    expect(retainedExecution?.status).toBe('maintenance')
    queuedAbort.abort(new Error('cancel queued dispatch'))
    holdResolution = false
    releaseResolution.resolve(undefined)
    await selection
    await refusedQueued
    expect(requests).toHaveLength(0)
    releaseRetainedRoot?.()
    await conversation.select(sessionId)
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
    expect(requests[0]).toMatchObject({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectPreset({ id: sessionId, preset: 'standard', expectedRevision: null })).rejects.toThrow()
    await conversation.select(sessionId)
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
    // Control admission still cancels the accepted turn and awaits cleanup.
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
    humanSteps = [toolCallResponse('allow', 'guarded', {}), toolCallResponse('deny', 'guarded', {}),
      toolCallResponse('question', 'ask_user_question', { questions: [{ id: '', question: 'Choose mode', options: [{ label: 'One' }, { label: 'Two' }] }] }), textResponse('human complete')]
    const interactive = conversation.send('human input')
    await vi.waitFor(() => { expect(conversation.getSnapshot().human?.kind).toBe('approval') })
    const allowed = conversation.getSnapshot().human!
    const humanAdmission = followFields as { sessionId: string; admissionId: string }
    await expect(rpc.call('/api', 'session/answer-human', { ...humanAdmission, admissionId: 'stale', id: allowed.id,
      answer: { kind: 'approval', outcome: 'allowed-once' } }, new AbortController().signal)).resolves.toMatchObject({ ok: false })
    await conversation.answerHuman(allowed, { kind: 'approval', outcome: 'allowed-once' })
    await vi.waitFor(() => { expect(conversation.getSnapshot().human?.kind).toBe('approval'); expect(conversation.getSnapshot().human?.id).not.toBe(allowed.id) })
    await expect(client.answerHuman(sessionId, allowed.id, { kind: 'approval', outcome: 'allowed-once' })).rejects.toThrow('stale')
    await conversation.answerHuman(conversation.getSnapshot().human!, { kind: 'approval', outcome: 'rejected' })
    await vi.waitFor(() => { expect(conversation.getSnapshot().human?.kind).toBe('questions') })
    const questionPrompt = conversation.getSnapshot().human!
    await expect(client.answerHuman(sessionId, questionPrompt.id, { kind: 'questions', answer: { answers: [{ id: '', selected: ['invalid'] }] } })).rejects.toThrow('invalid choices')
    await conversation.answerHuman(questionPrompt, { kind: 'questions', answer: { answers: [{ id: '', selected: ['Two'] }] } })
    await interactive
    expect(protectedRuns).toBe(1)
    const audited = (await client.history(sessionId)).events
    expect(audited.filter(event => event.type === 'native-approval/decided').map(event => event.data.outcome)).toEqual(['allowed-once', 'rejected'])
    expect(audited.filter(event => event.type === 'tool/result').some(event => JSON.stringify(event.data).includes('Two'))).toBe(true)
    humanSteps = [toolCallResponse('cancel-human', 'guarded', {})]
    const unanswered = conversation.send('cancel human input')
    await vi.waitFor(() => { expect(conversation.getSnapshot().human?.kind).toBe('approval') })
    const stale = conversation.getSnapshot().human!
    conversation.cancel()
    await unanswered
    expect(conversation.getSnapshot().human).toBeUndefined()
    await expect(client.answerHuman(sessionId, stale.id, { kind: 'approval', outcome: 'allowed-once' })).rejects.toThrow('no owned turn')
    expect(protectedRuns).toBe(1)
    if (foreign === undefined || persistence === undefined) throw new Error('missing foreign Program')
    const foreignTurn = foreign.executeRootTurn({ id: foreignId, resume: false,
      message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'foreign input' }] }) }, foreignAbort.signal)
    await foreignModelReady.promise
    const open = persistence.open.bind(persistence)
    const readSpy = vi.spyOn(persistence, 'open').mockImplementation(async (id, access, options) => {
      if (id === foreignId && access === 'read') { webReadReady.resolve(undefined); await releaseWebRead.promise }
      return open(id, access, options)
    })
    try {
      const started = await rpc.call('/api', 'session/start', { sessionId: foreignId, text: 'competing Web input', resume: true, follow: true }, new AbortController().signal)
      if (!started.ok) throw new Error(started.error.message)
      await webReadReady.promise
      const admission = started.value as { admissionId: string }
      const denied = await rpc.call('/api', 'session/answer-human', { sessionId: foreignId, admissionId: admission.admissionId,
        id: 'foreign-presentation', answer: { kind: 'approval', outcome: 'allowed-once' } }, new AbortController().signal)
      expect(denied).toMatchObject({ ok: false, error: { message: 'native-headless: root route requires the exact attached root owner' } })
      releaseForeignModel.resolve(undefined)
      await vi.waitFor(() => { expect(foreignApprovals).toBe(1) })
      await foreignTurn
      releaseWebRead.resolve(undefined)
      const settlement = await rpc.call('/api', 'session/await', { sessionId: foreignId, ...admission }, new AbortController().signal)
      expect(settlement.ok).toBe(false)
    } finally { releaseWebRead.resolve(undefined); readSpy.mockRestore(); foreignAbort.abort(new Error('foreign fixture complete')); await foreignTurn.catch(() => undefined) }
    await conversation.close()
    await client.close()
  } finally {
    foreignAbort.abort(new Error('foreign fixture cleanup'))
    releaseForeignModel.resolve(undefined)
    releaseWebRead.resolve(undefined)
    releaseResolution.resolve(undefined)
    releaseRetainedRoot?.()
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
  rpc.call = vi.fn(async () => ({ ok: true as const, value: event.type === 'future/required'
    ? { catalog: null, canSelectModel: 'true', presets: [] }
    : { catalog: null, canSelectModel: true, presets: [{ id: '', name: 'invalid' }] } }))
  await expect(client.modelControls()).rejects.toThrow()
})
