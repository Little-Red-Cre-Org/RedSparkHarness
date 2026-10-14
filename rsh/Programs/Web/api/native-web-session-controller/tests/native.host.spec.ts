/** Native browser Session lifecycle through the authenticated HTTP Connection carrier. */
import { createHmac } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile, symlink } from 'node:fs/promises'
import { plugin as attachmentStorage } from '@deepseek-ai/dsh-attachment-local/native'
import { plugin as githubWebhook } from '@deepseek-ai/dsh-webhook-github/src/native.ts'
import { plugin as webhook } from '../../../../../Modules/Official/webhook/webhook/src/native.ts'
import { WebhookRuleId } from '../../../../../Modules/Official/webhook/webhook/src/brand.ts'
import type {} from '../../../../../Modules/Official/webhook/webhook/src/native-definition.ts'
import { plugin as workspaceRegistry } from '@deepseek-ai/dsh-workspace/native'
import { plugin as permissionPresets } from '../../../../../Modules/Official/interaction/permission-presets/src/native.ts'
import { plugin as sandboxPolicy } from '../../../../../Modules/Official/sandbox/native-sandbox-policy/src/native.ts'
import { plugin as storageHub } from '@deepseek-ai/dsh-storage/native'
import { plugin as storageJson } from '@deepseek-ai/dsh-storage-json/native'
import { plugin as storageDomain } from '@deepseek-ai/dsh-storage-domain/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as sandboxedFilesystem } from '../../../../../Modules/Official/fs/fs-sandbox/src/native.ts'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { NativeAgentId, type NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as modelSelection } from '@deepseek-ai/dsh-native-model-selection/native'
import { plugin as tools } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as approval } from '@deepseek-ai/dsh-native-approval/native'
import { plugin as questions } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as askUser } from '@deepseek-ai/dsh-tool-ask-user/native'
import { plugin as planMode } from '../../../../../Modules/Official/plan/plan-mode/src/native.ts'
import { toolCallResponse, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin as agentPresets } from '@deepseek-ai/dsh-agent-presets/native'
import { ReasoningEffortId, createUserMessage, type PreparedAdapterCall } from '@deepseek-ai/dsh-llm/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { createNativeHostConnectionRegistry } from '@deepseek-ai/dsh-client-connection/native-host'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection/native-host'
import { createWebConnectionRpc, type ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { bridge } from '@deepseek-ai/dsh-client-connection/native-http-bridge'
import { listenNativeHttpHost, type NativeHttpHost } from '@deepseek-ai/dsh-native-web-assets'
import { createNativeSessionClient, nativeSubmissionRequestId } from '@deepseek-ai/dsh-client-native-session/native'
import { createNativeWorkspaceClients } from '@deepseek-ai/dsh-client-native-session/workspaces'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import type { NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeSettings } from '@deepseek-ai/dsh-settings/native'
import type { NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { NativeConversationController } from '@deepseek-ai/dsh-client-native-application/controller'
import { plugin as sessionTitles, SessionTitleProviderId } from '@deepseek-ai/dsh-session-title/native'
import { NativeWebSessionService, plugin, resolveNativeWebSessionConfig } from '../src/native.ts'

it('closes a list follower aborted while its consumer is paused at yield', async () => {
  const rpc = {
    call: async () => ({ ok: true as const, value: {} }),
    response: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"baseline","items":[]}\n\n'))
      },
    }), { headers: { 'content-type': 'text/event-stream' } }),
  } satisfies ClientConnectionRpc
  const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1024 })
  const abort = new AbortController()
  const iterator = client.follow(abort.signal)[Symbol.asyncIterator]()
  let closed = false
  let closing: Promise<void> | undefined
  try {
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: 'baseline', items: [] } })
    abort.abort()
    closing = client.close().then(() => { closed = true })
    await vi.waitFor(() => { expect(closed).toBe(true) }, { interval: 10, timeout: 1000 })
    await closing
  } finally {
    await iterator.return?.()
    await closing
    await client.close()
  }
})

it('cancels and drains a stalled upload body before Native Web shutdown completes', async () => {
  const stageStarted = Promise.withResolvers<undefined>()
  const cancelStarted = Promise.withResolvers<undefined>()
  const finishCancel = Promise.withResolvers<undefined>()
  const cleanupError = new Error('request body reader cleanup failed')
  const dispose = vi.fn(async () => undefined)
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
  let bodyCanceled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { bodyController = controller },
    cancel() { bodyCanceled = true; cancelStarted.resolve(undefined); return finishCancel.promise },
  })
  const executor = {
    rootExecution: { stagedFiles: { async stageStream({ data }: { readonly data: AsyncIterable<Uint8Array> }, signal: AbortSignal) {
      stageStarted.resolve(undefined)
      for await (const chunk of data) expect(chunk).toBeInstanceOf(Uint8Array)
      signal.throwIfAborted()
      throw new Error('stalled upload unexpectedly completed')
    } } },
    dispose,
  } as unknown as NativeHeadlessApplication
  const active = { owners: () => [], onAttached: () => () => {}, onDetached: () => () => {} } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(executor, {} as NativeSessionPersistenceOperations, active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1,
      builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 10,
      maxFollowBufferBytes: 1024, maxFollowers: 1, maxPendingHumanRequests: 1 }), new AbortController().signal)
  const upload = service.uploadFile(new Request('http://localhost/api/native-session/file-upload?sessionId=stalled-upload', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }))
  let closing: Promise<void> | undefined
  let closed = false
  try {
    await stageStarted.promise
    closing = service.close().then(() => { closed = true })
    await vi.waitFor(() => { expect(bodyCanceled).toBe(true) }, { interval: 10, timeout: 1000 })
    expect(closed).toBe(false)
    finishCancel.reject(cleanupError)
    const closeFailure = await closing.then(() => undefined, (error: unknown) => error)
    expect(closeFailure).toMatchObject({ errors: [{ errors: [cleanupError] }] })
    const response = await upload
    expect(await response.json()).toMatchObject({ ok: false, error: { message: cleanupError.message } })
    expect(dispose).toHaveBeenCalledOnce()
  } finally {
    finishCancel.resolve(undefined)
    if (!bodyCanceled) bodyController?.close()
    await Promise.allSettled([upload, ...(closing === undefined ? [] : [closing])])
    await Promise.allSettled([service.close()])
  }
})

it('waits for an owned file upload to settle when the Native Session Client closes', async () => {
  const fetchStarted = Promise.withResolvers<undefined>()
  const abortObserved = Promise.withResolvers<undefined>()
  const finishFetch = Promise.withResolvers<undefined>()
  const rpc = {
    call: async () => ({ ok: true as const, value: {} }),
    response: async (_base: string, _endpoint: string, _payload: unknown, signal: AbortSignal) => {
      fetchStarted.resolve(undefined)
      await new Promise<void>((resolve) => {
        const abort = (): void => { abortObserved.resolve(undefined); void finishFetch.promise.then(resolve) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
      return new Response(null, { status: 499 })
    },
  } as unknown as ClientConnectionRpc
  const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1024 })
  const upload = client.uploadFile(SessionId('upload-close'), new Blob(['staged bytes']))
  let closed = false
  const closing = client.close().then(() => { closed = true })
  try {
    await fetchStarted.promise
    await abortObserved.promise
    expect(closed).toBe(false)
    finishFetch.resolve(undefined)
    await closing
    await expect(upload).rejects.toThrow('native Session file upload failed with HTTP 499')
  } finally {
    finishFetch.resolve(undefined)
    await Promise.allSettled([upload, closing])
    await client.close()
  }
})

it('includes nested AggregateError messages in native Session failures', async () => {
  const failure = new AggregateError([
    new AggregateError([new Error("Cannot find module '/fixture/system.node'")], 'native-active-session: lifecycle observer failed'),
  ], 'native-headless: turn cleanup failed')
  const active = {
    owners: () => [], onAttached: () => async () => {}, onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(
    { dispose: async () => undefined } as unknown as NativeHeadlessApplication,
    { open: async () => { throw failure } } as unknown as NativeSessionPersistenceOperations,
    active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1,
      builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 10,
      maxFollowBufferBytes: 1024, maxFollowers: 1, maxPendingHumanRequests: 1 }),
    new AbortController().signal,
  )
  try {
    await expect(service.handle('session/history', { sessionId: 'fixture' }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'native/session', message: "native-headless: turn cleanup failed: native-active-session: lifecycle observer failed: Cannot find module '/fixture/system.node'" },
    })
  } finally {
    await service.close()
  }
})

it('lists slash commands available to the exact Program root owner', async () => {
  const programScope = new NativeScope()
  const agentScope = new NativeScope()
  const id = SessionId('command-catalog-session')
  const owner = {
    agent: { scope: agentScope }, session: { id }, invocation: 'root', writerAvailable: true,
    onEvent: () => () => {},
  } as unknown as NativeActiveSessionOwner
  const programCommands = [
    { name: 'compact', description: 'Program description' },
    { name: 'program-only', description: 'Program only' },
  ]
  const ownerCommands = [
    { name: 'compact', description: 'Session description', input: { hint: '[target]', attachments: true } },
    { name: 'agent-only', description: 'Agent only' },
  ]
  const list = vi.fn((scope: NativeScope) => scope === programScope ? programCommands : ownerCommands)
  const commands = { list } as unknown as NativeCommandOperations
  const route = 'program-root-route'
  const executeSessionOperation = vi.fn(async (
    _request: unknown,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
  ) => operation(owner, signal))
  const executor = {
    rootExecution: { capture: vi.fn(() => ({ id: route })) },
    executeSessionOperation,
    dispose: async () => {},
  } as unknown as NativeHeadlessApplication
  const active = {
    owners: () => [owner], onAttached: () => async () => {}, onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(executor, {} as NativeSessionPersistenceOperations, active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
      maxSteps: 1, builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
      maxFollowBufferBytes: 1024, maxFollowers: 1, maxPendingHumanRequests: 1 }), new AbortController().signal,
    { commands, commandScope: programScope })
  try {
    expect(await service.handle('session/commands', { sessionId: id }, new AbortController().signal)).toEqual({
      ok: true,
      value: { commands: [ownerCommands[0]] },
    })
    expect(list.mock.calls.map(([scope]) => scope)).toEqual([programScope, agentScope])
    expect(executeSessionOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id, resume: true, route }), expect.any(Function), expect.any(AbortSignal))
  } finally {
    await service.close()
  }
})

it('keeps schedule state unavailable and enforces the shared follower limit', async () => {
  const scheduledId = SessionId('scheduled-root')
  const releasedId = SessionId('released-root')
  const scheduledHeader = { id: scheduledId, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false }
  const releasedHeader = { id: releasedId, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false }
  const enteredRead = Promise.withResolvers<undefined>()
  const releasedEvents = Promise.withResolvers<readonly []>()
  const turnResult = Promise.withResolvers<{ exitCode: number }>()
  let released = false
  const scheduledOwner = {
    agent: {}, session: { id: scheduledId, header: scheduledHeader }, invocation: 'root', rootOrigin: 'scheduled',
    writerAvailable: true, inheritedEventCount: 0, readEvents: async () => [], onEvent: () => () => {},
  } as unknown as NativeActiveSessionOwner
  const releasedOwner = {
    agent: {}, session: { id: releasedId, header: releasedHeader }, invocation: 'root',
    writerAvailable: true, inheritedEventCount: 0,
    readEvents: async () => { enteredRead.resolve(undefined); return releasedEvents.promise }, onEvent: () => () => {},
  } as unknown as NativeActiveSessionOwner
  const executionFor = vi.fn((agent: unknown) => {
    if (agent === releasedOwner.agent && released) throw new Error('released Agent was queried')
    return { status: 'running' as const }
  })
  const active = {
    owners: () => released ? [scheduledOwner] : [scheduledOwner, releasedOwner],
    owner: (_agent: unknown, session: { id: SessionId }) => session.id === scheduledId ? scheduledOwner
      : !released && session.id === releasedId ? releasedOwner : undefined,
    onAttached: () => async () => {}, onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(
    { dispose: async () => undefined, executeRootTurn: async () => turnResult.promise } as unknown as NativeHeadlessApplication,
    { list: async () => [] } as unknown as NativeSessionPersistenceOperations,
    active,
    resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1,
      builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 10,
      maxFollowBufferBytes: 1024, maxFollowers: 1, maxPendingHumanRequests: 1 }),
    new AbortController().signal,
    { executionFor },
  )
  try {
    const listing = service.handle('session/list', {}, new AbortController().signal)
    await enteredRead.promise
    released = true
    releasedEvents.resolve([])
    const result = await listing
    expect(result).toMatchObject({ ok: true, value: [
      { header: { id: scheduledId }, hasActiveSchedule: false },
      { header: { id: releasedId }, running: false, hasActiveSchedule: false },
    ] })
    const started = await service.handle('session/start', {
      sessionId: 'follower-limit', text: 'go', resume: true, follow: true, lastSeq: -1,
    }, new AbortController().signal)
    if (!started.ok) throw new Error(started.error.message)
    const admissionId = (started.value as { admissionId: string }).admissionId
    const listAbort = new AbortController()
    await service.followList(new Request('http://localhost', { method: 'POST', body: '{}', signal: listAbort.signal }))
    const turnFollow = await service.follow(new Request('http://localhost', { method: 'POST',
      body: JSON.stringify({ sessionId: 'follower-limit', admissionId }) }))
    expect(turnFollow.status).toBe(429)
    listAbort.abort()
    turnResult.resolve({ exitCode: 0 })
  } finally {
    releasedEvents.resolve([])
    turnResult.resolve({ exitCode: 0 })
    await service.close()
  }
})

it('creates, resumes and cancels one durable Session through the real browser RPC carrier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-web-session-'))
  const cwd = join(directory, 'work')
  const webhookCwd = join(cwd, 'webhook')
  const outsideCwd = join(directory, 'outside')
  await mkdir(cwd)
  await mkdir(webhookCwd)
  await mkdir(outsideCwd)
  const scope = new NativeScope()
  let web: NativeHttpHost | undefined
  let foreign: NativeHeadlessApplication | undefined
  let persistence: NativeSessionPersistenceOperations | undefined
  const foreignId = SessionId('foreign-human')
  const foreignModelReady = Promise.withResolvers<undefined>()
  const releaseForeignModel = Promise.withResolvers<undefined>()
  const foreignAbort = new AbortController()
  let foreignStep = 0
  let foreignApprovals = 0
  const requests: GenerateOptions[] = []
  const streamedFileBytes = new TextEncoder().encode('uploaded through the Native Web carrier\n')
  let streamedUploadRequest: {
    readonly path: string
    readonly sessionId: string | null
    readonly method: string | undefined
    readonly contentType: string | null
    readonly body: BodyInit | null | undefined
  } | undefined
  let streamedUploadResponseStatus: number | undefined
  let streamedFileProjected = false
  const firstContinue = Promise.withResolvers<undefined>()
  const racePreparation = Array.from({ length: 2 }, () => ({
    entered: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>(),
  }))
  let racePreparationCount = 0
  let racePreparationEnabled = false
  const submissionUpdates: Array<{ requestId: string; status: string }> = []
  let restoreClientPrompt: (() => void) | undefined
  const resolving = Promise.withResolvers<undefined>()
  const releaseResolution = Promise.withResolvers<undefined>()
  let holdResolution = false
  const preparingImage = Promise.withResolvers<undefined>()
  const releaseImage = Promise.withResolvers<undefined>()
  let holdImage = false
  let imageExecution: NativeAgentExecution | undefined
  let releaseRetainedRoot: (() => void) | undefined
  let retainedExecution: NativeAgentExecution | undefined
  let humanSteps: StreamChunk[][] | undefined
  let protectedRuns = 0
  let followFields: unknown
  let modelAborted!: () => void
  let releaseCleanup!: () => void
  const webhookTurnStarted = Promise.withResolvers<undefined>()
  const releaseWebhookTurn = Promise.withResolvers<undefined>()
  const webhookShutdownStarted = Promise.withResolvers<undefined>()
  const webhookShutdownAborted = Promise.withResolvers<undefined>()
  const releaseWebhookShutdown = Promise.withResolvers<undefined>()
  const webhookTurnFinished = Promise.withResolvers<undefined>()
  const webhookOverlapFinished = Promise.withResolvers<undefined>()
  const webhookReadonlyFinished = Promise.withResolvers<undefined>()
  const webhookShutdownTurnFinished = Promise.withResolvers<undefined>()
  let webhookMode: 'complete' | 'readonly' | 'shutdown' | undefined
  let webhookCalls = 0
  let firstWebhookSessionId: string | undefined
  let webhookAgentId: NativeAgentId | undefined
  let webhookApprovals = 0
  let webhookSelectionApplied = false
  let webhookPromptContainsDelivery = false
  let activeSessionsService: NativeActiveSessionOperations | undefined
  const webhookRootOwners: NativeActiveSessionOwner[] = []
  let sandboxPolicyService: NativeSandboxPolicy | undefined
  let workspaceRegistryService: import('../../../../../Modules/Official/workspace/workspace/src/native.ts').WorkspaceRegistryRuntime | undefined
  let rootExecutionService: NativeRootExecutionOperations | undefined
  let approvalService: NativeApprovalServiceDefinition | undefined
  let hostStop: Promise<void> | undefined
  const aborted = new Promise<void>((resolve) => { modelAborted = resolve })
  const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
  const model: NativePlugin = {
    apiVersion: 1, name: 'fixture-model', targets: ['host'],
    requires: ['agentPresets', 'activeSessions', 'agents', 'tools', 'fs', 'sandboxPolicy'], provides: ['model', 'modelDirectory'],
    resolve: () => (context) => {
      for (const id of ['standard', 'alternate']) context.own(context.require('agentPresets').register({ id, name: id, scope }))
      context.effect(context.require('tools').register({ schema: { name: 'guarded', description: 'Guarded fixture.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } }, approval: { reason: 'Protect this action.' },
      execute: async () => { protectedRuns++; return { isError: false, content: [{ type: 'text', text: 'guarded allowed' }] } },
      }, scope))
      context.effect(context.require('tools').register({ schema: { name: 'write_file', description: 'Write a workspace file.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'], additionalProperties: false } }, approval: { reason: 'Writing a file changes the selected workspace.' },
      execute: async (call) => {
        const args = call.arguments as { readonly path?: unknown; readonly content?: unknown }
        if (typeof args.path !== 'string' || typeof args.content !== 'string') throw new Error('write_file requires path and content')
        const fs = context.require('fs')
        const workspaceRoot = call.session.header.cwd
        if (workspaceRoot === undefined) throw new Error('write_file requires a Session Workspace')
        const root = await fs.resolve(workspaceRoot, { signal: call.signal })
        const target = await fs.resolve(args.path, { cwd: workspaceRoot, signal: call.signal })
        if (!fs.contains(root, target)) throw new Error('write_file path is outside the selected workspace')
        const result = await fs.writeText(target, args.content, undefined, call.signal,
          context.require('sandboxPolicy').resolve({ session: call.session }))
        return { isError: false, content: [{ type: 'text', text: `${result.operation}: ${args.path}` }] }
      },
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
          if (racePreparationEnabled) {
            const barrier = racePreparation[racePreparationCount]
            if (barrier !== undefined) {
              racePreparationCount++
              barrier.entered.resolve(undefined)
              await barrier.release.promise
            }
          }
          if (holdImage) {
            const owner = context.require('activeSessions').owners().find(owner => owner.invocation === 'root')!
            imageExecution = context.require('agents').execution(owner.agent)
            preparingImage.resolve(undefined)
            await releaseImage.promise
          }
          return { provider, id, name: id, reasoning, inputModalities: ['text', 'image'] }
        },
        catalog: async defaults => ({ default: defaults, routableProviders: ['fixture'], failures: [], groups: [{
          id: 'fixture', name: 'Fixture', models: [{ id: 'chosen', name: 'Chosen', reasoning }],
        }] }) })
      context.provide('model', {
        async prepareCall(provider: string, id: string): Promise<PreparedAdapterCall> {
          const stream = this.stream.bind(this)
          return {
            model: { provider, id, name: id, reasoning, inputModalities: ['text', 'image'] },
            supportsOutputTokenLimit: async (maxTokens: number) => maxTokens === 1234,
            stream,
          }
        },
        async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
          requests.push(request)
          if (webhookMode === 'complete') {
            const owner = context.require('activeSessions').owners().find(candidate => candidate.session.id === request.sessionId)
            if (owner !== undefined && webhookAgentId === undefined) webhookAgentId = owner.agent.id
            webhookPromptContainsDelivery = request.messages.some(message => message.content.some(block => block.type === 'text'
              && block.text.includes('native-durable-admission')))
            webhookSelectionApplied = request.model === 'chosen' && request.maxTokens === 1234
            if (webhookCalls++ === 0) {
              firstWebhookSessionId = request.sessionId
              webhookTurnStarted.resolve(undefined)
              await releaseWebhookTurn.promise
              yield* toolCallResponse('webhook-guard', 'guarded', {})
            } else {
              yield* textResponse('webhook processed')
              if (request.sessionId === firstWebhookSessionId) webhookTurnFinished.resolve(undefined)
              else webhookOverlapFinished.resolve(undefined)
            }
            return
          }
          if (webhookMode === 'readonly') {
            const owner = context.require('activeSessions').owners().find(candidate => candidate.session.id === request.sessionId)
            if (owner !== undefined) webhookAgentId = owner.agent.id
            if (requests.filter(item => item.sessionId === request.sessionId).length === 1) {
              yield* toolCallResponse('webhook-readonly-write', 'write_file', {
                path: join(webhookCwd, 'denied.txt'), content: 'must remain absent',
              })
            } else {
              yield* textResponse('read-only policy enforced')
              webhookReadonlyFinished.resolve(undefined)
            }
            return
          }
          if (webhookMode === 'shutdown') {
            webhookShutdownStarted.resolve(undefined)
            const signal = request.signal
            if (signal === undefined) throw new Error('missing webhook cancellation')
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve()
              else signal.addEventListener('abort', () => { resolve() }, { once: true })
            })
            webhookShutdownAborted.resolve(undefined)
            await releaseWebhookShutdown.promise
            webhookShutdownTurnFinished.resolve(undefined)
            throw signal.reason
          }
          if (request.model === 'foreign') {
            if (foreignStep++ === 0) {
              foreignModelReady.resolve(undefined)
              await releaseForeignModel.promise
              yield* toolCallResponse('foreign-guard', 'guarded', {})
            } else yield* textResponse('foreign complete')
            return
          }
          if (humanSteps !== undefined) { yield* humanSteps.shift() ?? textResponse('human complete'); return }
          if (requests.length === 3 && request.messages.some(message => message.content.some(block => block.type === 'text'
            && block.text.includes('File "web-upload.txt"') && block.text.includes('saved at')))) {
            streamedFileProjected = true
            yield* textResponse('staged file projected')
            return
          }
          const latestUser = request.messages.findLast(message => message.role === 'user')
          if (latestUser?.content.some(block => block.type === 'text' && block.text === 'cancel input')) {
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
  const nativePolicyProbe: NativePlugin = {
    apiVersion: 1, name: 'native-policy-probe', targets: ['host'],
    requires: ['activeSessions', 'sandboxPolicy', 'workspaceRegistry', 'rootExecution', 'approval'], provides: [],
    resolve: () => (context) => {
      activeSessionsService = context.require('activeSessions')
      context.own(activeSessionsService.onAttached(async (owner) => {
        if (owner.session.header.cwd === webhookCwd) webhookRootOwners.push(owner)
      }))
      sandboxPolicyService = context.require('sandboxPolicy')
      workspaceRegistryService = context.require('workspaceRegistry')
      rootExecutionService = context.require('rootExecution')
      approvalService = context.require('approval')
    },
  }
  const webhookRuleRegistration: NativePlugin = {
    apiVersion: 1, name: 'native-webhook-test-rule', targets: ['host'], requires: ['webhookRules'], provides: [],
    resolve: () => (context) => {
      context.own(context.require('webhookRules').register({
        id: WebhookRuleId('native-test-rule'), kind: 'github',
        run: (delivery) => {
          const action = (delivery.event as unknown as { readonly payload?: { readonly action?: unknown } }).payload?.action
          if (action === 'ignored') return null
          if (action === 'failed') throw new Error('trusted rule fixture failure')
          return { workspacePath: action === 'outside' ? outsideCwd : webhookCwd,
            title: action === 'readonly' ? 'Native read-only webhook' : 'Native durable webhook',
            prompt: 'Process GitHub delivery ' + delivery.deliveryId,
            agentPreset: 'alternate', permissionPreset: action === 'readonly' ? 'read-only' : 'workspace-write',
            model: { provider: 'fixture', model: 'chosen', maxTokens: 1234 } }
        },
      }))
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'fixture-carrier', targets: ['host'], requires: [], provides: ['hostConnection', 'httpRoutes'],
    resolve: () => async (context) => {
      let value: CredentialRecord | undefined
      const registry = await createNativeHostConnectionRegistry({}, { async modifyRecord(_key, mutate) {
        value = await mutate(value)
        return value
      } })
      web = await listenNativeHttpHost(registry, { requestBodyMode: () => 'buffered', fetch: () => Promise.resolve(new Response('native')) }, bridge, { port: 0 })
      context.own(() => web!.close())
      context.provide('hostConnection', web.connection)
      context.provide('httpRoutes', web.httpRoutes)
    },
  }
  const foreignProgram: NativePlugin = {
    apiVersion: 1, name: 'foreign-program', targets: ['host'],
    requires: ['nativeWebSession', 'fs', 'sessionPersistence', 'modelExecution', 'agents'],
    optional: ['approval', 'tools', 'promptSections', 'sandboxPolicy', 'codeRuntime', 'timeContext', 'tmuxContext', 'sessionExecution', 'activeSessions', 'modelSelection', 'agentPresets', 'workspaceRegistry', 'agentInstructions', 'attachments', 'requestContexts'], provides: [],
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
  const settingsSchema = z.object({
    apiKeyEnv: z.string().role('credential-ref'), label: z.string(),
    privateValue: z.string().role('secret').default('private-leaf-schema-default'),
  }).default({ apiKeyEnv: 'NATIVE_TEST_KEY', label: 'schema-default', privateValue: 'private-parent-schema-default' })
  let settingsDocument: NativeSettingsSection = { 'native-settings-test': { label: 'stored', privateValue: 'private-setting' } }
  const settingsProvider: NativePlugin = {
    apiVersion: 1, name: 'native-settings-test-provider', targets: ['host'], requires: [], provides: ['settings'],
    resolve: () => async (context) => {
      const settings = new NativeSettings({
        load: async () => settingsDocument,
        persist: async (update) => { settingsDocument = update(settingsDocument); return settingsDocument },
      })
      context.own(() => settings.dispose())
      await settings.start()
      context.provide('settings', settings)
    },
  }
  const settingsRegistrant: NativePlugin = {
    apiVersion: 1, name: 'native-settings-test-registrant', targets: ['host'], requires: ['settings'], provides: [],
    resolve: () => (context) => {
      const scope = context.require('settings').register('native-settings-test',
        { apiKeyEnv: 'NATIVE_TEST_KEY', label: 'base', privateValue: 'base-private' }, value => settingsSchema(value),
        (next) => {
          if (next.label === 'leak-trigger') throw new Error(`validator detail: ${next.privateValue}`)
        }, { schema: settingsSchema, applies: 'live' })
      context.own(() => { scope.dispose() })
    },
  }
  const githubSecret = 'fixture github webhook secret'
  const credentials = new Map<string, string>([['NATIVE_GITHUB_SECRET', githubSecret]])
  const credentialProvider: NativePlugin = {
    apiVersion: 1, name: 'native-credentials-test-provider', targets: ['host'], requires: [], provides: ['credentials'],
    resolve: () => (context) => {
      const service = {
        resolve: async (ref: string) => credentials.has(ref) ? { value: credentials.get(ref)!, source: 'test-store' } : undefined,
        describe: async (ref: string) => ({ configured: credentials.has(ref), ...credentials.has(ref) ? { source: 'test-store' } : {}, writable: true }),
        set: async (ref: string, value: string) => {
          if (value === 'reject-write') throw new Error(`credential store detail: ${credentials.get(ref)}`)
          credentials.set(ref, value)
        },
        unset: async (ref: string) => { credentials.delete(ref) },
        readRecord: async () => undefined,
        describeRecord: async () => ({ configured: false, writable: false }),
        listRecords: async () => [],
        modifyRecord: async () => undefined,
        deleteRecord: async () => undefined,
      } as unknown as NativeCredentials
      context.provide('credentials', service)
    },
  }
  const inventory: NativePlugin = {
    apiVersion: 1, name: 'test-plugin-inventory', targets: ['host'], requires: [], provides: ['pluginInventory'],
    resolve: () => (context) => { context.provide('pluginInventory', { list: () => host.diagnostics(), packages: () => [] }) },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: inventory, scope, config: undefined },
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 5, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 2, maxPendingHumanRequests: 2, maxCredentialRefsPerRead: 2, maxSettingsOperations: 1,
      workspaceRoutes: { maxRoutes: 2, allowedRoots: [directory] } } },
    { plugin: githubWebhook, scope, config: { source: 'native-test', path: '/github', secretEnv: 'NATIVE_GITHUB_SECRET',
      maxBodyBytes: 4096, rootRoute: 'root' } },
    ...[agents, execution, modelExecution, modelSelection, tools, approval, questions, askUser,
      model, carrier, foreignProgram, settingsProvider, settingsRegistrant, credentialProvider, webhook,
      workspaceRegistry, storageHub,
      webhookRuleRegistration, nativePolicyProbe].map(plugin =>
      ({ plugin, scope, config: undefined })),
    { plugin: agentPresets, scope, config: { default: 'standard' } },
    { plugin: planMode, scope, config: { section: 'Use the plan to guide implementation.' } },
    { plugin: permissionPresets, scope, config: { presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      'read-only': { sandbox: 'read-only', approval: 'ask' },
    } } },
    { plugin: sandboxPolicy, scope, config: { mode: 'workspace-write', workspaceRoot: cwd } },
    { plugin: sandboxedFilesystem, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
    { plugin: storageJson, scope, config: { root: join(directory, 'domains') } },
    { plugin: storageDomain, scope, config: { backend: 'json' } },
    { plugin: attachmentStorage, scope, config: { dshHome: directory } },
  ], 'host'))
  let pendingSelection: Promise<unknown> | undefined
  let pendingQueuedPrompt: Promise<unknown> | undefined
  let queuedPromptAbort: AbortController | undefined
  try {
    const baseConfig = { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
      maxPendingRequests: 1, maxHistoryEvents: 100, maxPromptChars: 100,
      maxFollowBufferBytes: 1000000, maxFollowers: 2, maxPendingHumanRequests: 2 }
    expect(resolveNativeWebSessionConfig(baseConfig)).toMatchObject({ maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 })
    for (const key of ['maxFollowBufferBytes', 'maxFollowers', 'maxCredentialRefsPerRead', 'maxSettingsOperations']) {
      for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => resolveNativeWebSessionConfig({ ...baseConfig, [key]: value })).toThrow(key)
      }
    }
    await host.start()
    if (web === undefined) throw new Error('missing HTTP Host')
    const login = await fetch(web.connection.authenticatedUrl(web.url), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing browser authentication')
    const url = web.url
    const rpc = createWebConnectionRpc(async (input, init) => {
      if (input.pathname.endsWith('/native-session/follow')) followFields = JSON.parse(init.body as string)
      if (input.pathname.endsWith('/native-session/file-upload')) {
        const uploadUrl = new URL(input.href)
        streamedUploadRequest = { path: uploadUrl.pathname, sessionId: uploadUrl.searchParams.get('sessionId'),
          method: init.method, contentType: new Headers(init.headers).get('content-type'), body: init.body }
      }
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      const response = await fetch(new URL(input.pathname + input.search, url), { ...init, headers })
      if (input.pathname.endsWith('/native-session/file-upload')) {
        streamedUploadResponseStatus = response.status
      }
      return response
    })
    const rawSettingsReply = await rpc.call('/api', 'settings/describe', {}, new AbortController().signal)
    expect(rawSettingsReply).toMatchObject({ ok: true, value: {
      hasDocument: false,
      limits: { maxCredentialRefsPerRead: 2, maxSettingsOperations: 1 },
    } })
    const hasSettingsNamespaces = rawSettingsReply.ok
      && typeof rawSettingsReply.value === 'object'
      && rawSettingsReply.value !== null
      && 'namespaces' in rawSettingsReply.value
      && Array.isArray(rawSettingsReply.value.namespaces)
    expect(hasSettingsNamespaces).toBe(true)
    expect(JSON.stringify(rawSettingsReply)).not.toContain('private-leaf-schema-default')
    expect(JSON.stringify(rawSettingsReply)).not.toContain('private-parent-schema-default')
    expect(JSON.stringify(rawSettingsReply)).not.toContain('"default"')
    const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1000000 })
    const originalPrompt = client.prompt.bind(client)
    client.prompt = (selectedSession, text, resume, signal, observe, images, onFollowError, lastSeq) => originalPrompt(
      selectedSession, text, resume, signal, (frame) => {
        if (frame.type === 'submission-update') submissionUpdates.push({ requestId: frame.requestId, status: frame.status })
        observe?.(frame)
      }, images, onFollowError, lastSeq)
    restoreClientPrompt = () => { client.prompt = originalPrompt }
    const settingsDescription = await client.settingsDescribe()
    expect((await client.pluginInventoryList()).entries).toContainEqual(expect.objectContaining({ name: plugin.name, state: 'ready' }))
    expect(await rpc.call('/api', 'settings/open-document', {}, new AbortController().signal)).toMatchObject({
      ok: false, error: { code: 'native/settings', message: 'Settings request failed.' },
    })
    expect(settingsDescription.limits).toEqual({ maxCredentialRefsPerRead: 2, maxSettingsOperations: 1 })
    const settingsViews = settingsDescription.namespaces
    const settingsView = settingsViews.find(row => row.namespace === 'native-settings-test')
    expect(settingsView).toMatchObject({ credentialRefs: ['NATIVE_TEST_KEY'], applies: 'live', revision: 0 })
    expect(JSON.stringify(settingsViews)).not.toContain('private-setting')
    const failedValidation = await rpc.call('/api', 'settings/mutate', { ns: 'native-settings-test',
      ops: [{ op: 'set', path: ['label'], value: 'leak-trigger' }], expectedRevision: settingsView!.revision }, new AbortController().signal)
    expect(failedValidation).toMatchObject({ ok: false, error: { code: 'native/settings', message: 'Settings request failed.' } })
    expect(JSON.stringify(failedValidation)).not.toContain('private-setting')
    const oversizedMutation = await rpc.call('/api', 'settings/mutate', { ns: 'native-settings-test', ops: [
      { op: 'set', path: ['label'], value: 'oversized-partial' },
      { op: 'set', path: ['apiKeyEnv'], value: 'OTHER_KEY' },
    ], expectedRevision: settingsView!.revision }, new AbortController().signal)
    expect(oversizedMutation).toMatchObject({ ok: false, error: { code: 'native/settings', message: 'Settings request failed.' } })
    expect(settingsDocument['native-settings-test']).toEqual({ label: 'stored', privateValue: 'private-setting' })
    await expect(client.settingsMutate('native-settings-test', [
      { op: 'set', path: ['privateValue'], value: 'must-stay-out-of-settings' },
    ], settingsView!.revision)).rejects.toMatchObject({ code: 'native/settings' })
    expect(settingsDocument['native-settings-test']).toMatchObject({ privateValue: 'private-setting' })
    const changedSettings = await client.settingsMutate('native-settings-test', [
      { op: 'set', path: ['label'], value: 'changed' },
    ], settingsView!.revision)
    expect(changedSettings.value).toMatchObject({ label: 'changed', apiKeyEnv: 'NATIVE_TEST_KEY' })
    await expect(client.settingsMutate('native-settings-test', [], settingsView!.revision))
      .rejects.toMatchObject({ code: 'native/settings-conflict', details: { expected: 0, actual: 1 } })
    const refreshedSettings = await client.settingsDescribe()
    expect(refreshedSettings.namespaces.find(row => row.namespace === 'native-settings-test')?.value).toMatchObject({ label: 'changed' })
    expect(await client.credentialsDescribe(['NATIVE_TEST_KEY'])).toEqual({ NATIVE_TEST_KEY: { configured: false, writable: true } })
    const credentialSecret = 'native-rpc-secret-must-not-return'
    await client.credentialsSet('NATIVE_TEST_KEY', credentialSecret)
    const secretReply = await rpc.call('/api', 'credentials/set', { ref: 'NATIVE_TEST_KEY', value: credentialSecret }, new AbortController().signal)
    expect(secretReply).toEqual({ ok: true, value: { updated: true } })
    expect(JSON.stringify(secretReply)).not.toContain(credentialSecret)
    expect(await client.credentialsDescribe(['NATIVE_TEST_KEY'])).toEqual({
      NATIVE_TEST_KEY: { configured: true, source: 'test-store', writable: true },
    })
    const failedCredentialWrite = await rpc.call('/api', 'credentials/set', {
      ref: 'NATIVE_TEST_KEY', value: 'reject-write',
    }, new AbortController().signal)
    expect(failedCredentialWrite).toMatchObject({ ok: false,
      error: { code: 'native/credentials', message: 'Credentials request failed.' } })
    expect(JSON.stringify(failedCredentialWrite)).not.toContain(credentialSecret)
    await expect(client.credentialsDescribe(['UNRELATED_KEY'])).rejects.toBeInstanceOf(NativeSessionRpcError)
    await expect(client.credentialsDescribe(['NATIVE_TEST_KEY', 'NATIVE_TEST_KEY', 'NATIVE_TEST_KEY']))
      .rejects.toMatchObject({ code: 'native/credentials' })
    const conversation = new NativeConversationController(client, { maxLiveTextChars: 4, maxLiveEvents: 200 })
    await conversation.load()
    await conversation.create()
    const sessionId = conversation.getSnapshot().selected!
    const sessions = await client.list()
    expect(sessions.map(session => session.header.id)).toEqual([sessionId])
    expect(sessions[0]?.titleProjection).toEqual({ status: 'absent' })
    expect(sessions[0]).toMatchObject({ blank: true, running: false, completed: false,
      runningSubagentCount: 0, hasActiveSchedule: false })
    expect(sessions[0]!.updatedAt).toBeGreaterThanOrEqual(sessions[0]!.header.createdAt)
    const initialMode = await client.modeControls(sessionId)
    expect(initialMode).toMatchObject({ current: 'standard', revision: null, locked: false, canSelect: true,
      options: [{ id: 'standard' }, { id: 'alternate' }], planMode: { available: true, active: false } })
    expect(await client.permissionControls(sessionId)).toMatchObject({ available: true, currentValue: 'workspace-write',
      options: [{ value: 'workspace-write' }, { value: 'danger-full-access' }, { value: 'read-only' }] })
    await client.selectPermissionPreset(sessionId, 'danger-full-access')
    expect(await client.permissionControls(sessionId)).toMatchObject({ currentValue: 'danger-full-access' })
    await client.selectPermissionPreset(sessionId, 'workspace-write')
    await expect(client.selectPlanMode(sessionId, true)).resolves.toEqual({ active: true, outcome: 'committed' })
    await expect(client.selectPlanMode(sessionId, false)).resolves.toEqual({ active: false, outcome: 'committed' })
    const listAbort = new AbortController()
    const listFollowing = client.follow(listAbort.signal)[Symbol.asyncIterator]()
    await expect(listFollowing.next()).resolves.toMatchObject({ value: { type: 'baseline', items: [{ header: { id: sessionId } }] } })
    const nextListFrame = listFollowing.next()
    expect((await client.modelControls()).catalog?.groups[0]?.models[0]?.id).toBe('chosen')
    await conversation.selectPreset('alternate')
    expect(await client.modeControls(sessionId)).toMatchObject({ current: 'alternate', locked: false, canSelect: true,
      planMode: { available: true, active: false } })
    await expect(nextListFrame).resolves.toMatchObject({ value: { type: 'upsert', item: { header: { id: sessionId }, blank: true } } })
    listAbort.abort()
    await listFollowing.return?.()
    await conversation.selectModel({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen' }, expectedRevision: null })).rejects.toThrow('stale selection revision')
    const selectedEvent = (await client.history(sessionId)).events.findLast(event => event.type === 'model/selection')
    expect(selectedEvent?.data).toEqual({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen', reasoningEffort: 'unknown' }, expectedRevision: selectedEvent!.seq })).rejects.toThrow()
    holdResolution = true
    const selection = client.selectModel(sessionId, { selected: { provider: 'fixture', model: 'chosen', reasoningEffort: 'high' }, expectedRevision: selectedEvent!.seq }).then(
      () => ({ resolved: true as const }), (error: unknown) => ({ resolved: false as const, error }))
    pendingSelection = selection
    await resolving.promise
    const queuedAbort = new AbortController()
    queuedPromptAbort = queuedAbort
    const queued = client.prompt(sessionId, 'queued during selection', true, queuedAbort.signal).then(
      result => ({ result }), (error: unknown) => ({ error }))
    pendingQueuedPrompt = queued
    await vi.waitFor(async () => { expect((await client.status(sessionId)).status === 'running' || requests.length > 0).toBe(true) })
    await expect(client.modeControls(sessionId)).rejects.toThrow('native-headless: exclusive Session maintenance is active')
    await expect(client.permissionControls(sessionId)).rejects.toThrow('native-headless: exclusive Session maintenance is active')
    expect(requests).toHaveLength(0)
    expect(retainedExecution?.status).toBe('maintenance')
    queuedAbort.abort(new Error('cancel queued dispatch'))
    holdResolution = false
    releaseResolution.resolve(undefined)
    expect(await selection).toEqual({ resolved: true })
    expect(await queued).toEqual({ result: { exitCode: 130 } })
    expect(requests).toHaveLength(0)
    await expect(client.modeControls(sessionId)).resolves.toMatchObject({ current: 'alternate',
      planMode: { available: true, active: false } })
    await expect(client.permissionControls(sessionId)).resolves.toMatchObject({ currentValue: 'workspace-write' })
    releaseRetainedRoot?.()
    await conversation.select(sessionId)
    racePreparationEnabled = true
    const first = conversation.send('first input')
    await racePreparation[0]!.entered.promise
    expect(requests).toHaveLength(0)
    const submissionId = nativeSubmissionRequestId('native-host-edit-promote')
    await expect(client.queue(sessionId, 'queued original', submissionId)).resolves.toMatchObject({
      requestId: submissionId, placement: 'queued', status: 'accepted',
    })
    await expect(client.editSubmission(sessionId, submissionId, 'edited before promotion')).resolves.toEqual({
      requestId: submissionId, outcome: 'updated',
    })
    const editedSubmissions = await client.submissions(sessionId)
    expect(editedSubmissions.throughSeq).toBeGreaterThanOrEqual(0)
    expect(editedSubmissions.submissions).toContainEqual(expect.objectContaining({
      requestId: submissionId, placement: 'queued', status: 'accepted',
      message: { id: submissionId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'edited before promotion' }] },
    }))
    await expect(client.promoteSubmission(sessionId, submissionId)).resolves.toEqual({
      requestId: submissionId, outcome: 'promoted',
    })
    const promotedSnapshot = await client.submissions(sessionId)
    expect(promotedSnapshot.throughSeq).toBeGreaterThanOrEqual(0)
    const promoted = promotedSnapshot.submissions.find(submission => submission.requestId === submissionId)
    if (promoted === undefined) throw new Error('pending reader missed the promoted submission')
    expect(promoted.placement).toBe('steering')
    expect(promoted.status).toBe('accepted')
    expect(nativeSubmissionRequestId(promoted.message.id)).toBe(submissionId)
    expect(promoted.message.content).toEqual([{ type: 'text', text: 'edited before promotion' }])
    racePreparation[0]!.release.resolve(undefined)
    await racePreparation[1]!.entered.promise
    const owner = activeSessionsService?.owners().find(candidate => candidate.session.id === sessionId
      && candidate.invocation === 'root')
    if (owner === undefined) throw new Error('missing browser root owner for existing pending submission')
    await expect(client.editSubmission(sessionId, submissionId, 'edited immediately before claim')).resolves.toEqual({
      requestId: submissionId, outcome: 'updated',
    })
    racePreparation[1]!.release.resolve(undefined)
    await vi.waitFor(() => { expect(owner.messages('next-step')).toEqual([]) })
    await expect(owner.flush()).resolves.toBeUndefined()
    await vi.waitFor(() => {
      expect(conversation.getSnapshot().error).toBeUndefined()
      expect(conversation.getSnapshot().liveText).toBe('swer')
      expect(requests).toHaveLength(1)
    })
    expect(conversation.getSnapshot()).toMatchObject({ state: 'sending', liveTruncated: true })
    expect(conversation.getSnapshot().events.some(event => event.type === 'user/message')).toBe(true)
    expect(conversation.getSnapshot().events.some(event => event.type === 'assistant/message')).toBe(false)
    expect(requests[0]?.messages.some(message => message.content.some(block => block.type === 'text'
      && block.text === 'edited immediately before claim'))).toBe(true)
    expect(requests[0]?.messages.some(message => message.content.some(block => block.type === 'text'
      && block.text === 'edited before promotion'))).toBe(false)
    expect(requests[0]?.messages.some(message => message.content.some(block => block.type === 'text'
      && block.text === 'queued original'))).toBe(false)
    expect(await client.submissions(sessionId)).toMatchObject({ submissions: [] })
    const existing = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued by another owner consumer' }] })
    const existingRequestId = nativeSubmissionRequestId(existing.id)
    await owner.enqueue(existing, 'next-turn', false, new AbortController().signal)
    const pendingSnapshot = await client.submissions(sessionId)
    const observed = pendingSnapshot.submissions.find(submission => submission.requestId === existingRequestId)
    expect(observed).toMatchObject({ requestId: existingRequestId, placement: 'queued', status: 'accepted', message: existing })
    if (observed === undefined) throw new Error('pending reader missed the existing queued submission')
    await expect(client.promoteSubmission(sessionId, observed.requestId)).resolves.toEqual({
      requestId: observed.requestId, outcome: 'promoted',
    })
    expect(await client.submissions(sessionId)).toMatchObject({ submissions: [{
      requestId: existingRequestId, placement: 'steering', status: 'accepted', message: existing,
    }] })
    await expect(client.dequeue(sessionId, observed.requestId)).resolves.toBeUndefined()
    expect(await client.submissions(sessionId)).toMatchObject({ submissions: [] })
    const admission = followFields as { sessionId: string; admissionId: string }
    expect((await fetch(new URL('/api/native-session/follow', url), { method: 'POST', body: JSON.stringify(admission) })).status).toBe(401)
    expect((await rpc.response!('/api', 'native-session/follow', { ...admission, admissionId: 'wrong' }, new AbortController().signal)).status).toBe(409)
    expect((await rpc.response!('/api', 'native-session/follow', admission, new AbortController().signal)).status).toBe(409)
    firstContinue.resolve(undefined)
    await first
    expect(submissionUpdates.filter(update => update.requestId === submissionId).map(update => update.status))
      .toEqual(['accepted', 'settled'])
    const search = await client.search('first input')
    expect(search.items.map(item => item.sessionId)).toEqual([sessionId])
    expect(search.items[0]?.snippet).toContain('first input')
    expect(requests[0]).toMatchObject({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
    await expect(client.selectPreset({ id: sessionId, preset: 'standard', expectedRevision: null })).rejects.toThrow()
    await conversation.select(sessionId)
    expect(conversation.getSnapshot().liveText).toBeUndefined()
    expect(conversation.getSnapshot().events.slice(-2).map(event => event.type)).toEqual(['turn/end', 'session/end-seed'])
    await conversation.select(sessionId)
    const png = await readFile(new URL('../../../../../../snapshots/native-sdk/text-turn/image.png', import.meta.url))
    const images = [{ mediaType: 'image/png' as const, data: png.toString('base64'), name: 'image.png' }]
    await expect(client.prompt(sessionId, 'invalid image', true, undefined, undefined,
      [{ mediaType: 'image/png', data: 'invalid' }])).rejects.toThrow('canonical base64')
    expect((await client.history(sessionId)).events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'invalid image'))).toBe(false)
    holdImage = true
    const imageTurn = client.prompt(sessionId, 'second input', true, undefined, undefined, images)
    await preparingImage.promise
    expect(imageExecution?.status).toBe('running')
    expect(() => imageExecution!.runMaintenance(() => Promise.resolve(undefined))).toThrow('Agent is busy')
    expect(requests).toHaveLength(1)
    holdImage = false
    releaseImage.resolve(undefined)
    await imageTurn
    await conversation.select(sessionId)
    const history = await client.history(sessionId)
    const image = history.events.flatMap(event => event.type === 'user/message' ? event.data.content : []).find(block => block.type === 'image')
    if (image?.type !== 'image') throw new Error('image input was not durable')
    expect(requests[1]?.messages.some(message => message.content.some(block => block.type === 'image'
      && block.attachment.attachmentId === image.attachment.attachmentId))).toBe(true)
    const blob = await client.image(sessionId, image.attachment)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(image.attachment.bytes)
    const receipt = await client.uploadFile(sessionId, { data: new Blob([streamedFileBytes]), name: 'web-upload.txt' })
    expect(receipt).toMatchObject({ name: 'web-upload.txt', bytes: streamedFileBytes.byteLength })
    expect(streamedUploadRequest).toMatchObject({ path: '/api/native-session/file-upload', sessionId, method: 'POST',
      contentType: 'application/octet-stream' })
    expect(streamedUploadResponseStatus).toBe(200)
    expect(streamedUploadRequest?.body).toBeInstanceOf(Blob)
    expect(new Uint8Array(await (streamedUploadRequest?.body as Blob).arrayBuffer())).toEqual(streamedFileBytes)
    await expect(client.promptContent(sessionId, [
      { type: 'text', text: 'before staged file' },
      { type: 'file', receiptId: receipt.receiptId },
      { type: 'text', text: 'after staged file' },
    ], true)).resolves.toMatchObject({ exitCode: 0 })
    await conversation.select(sessionId)
    expect(streamedFileProjected).toBe(true)
    expect(requests[2]?.messages.some((message) => {
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      const before = text.findIndex(block => block === 'before staged file')
      const handle = text.findIndex(block => block.includes('File "web-upload.txt"') && block.includes('saved at'))
      const after = text.findIndex(block => block === 'after staged file')
      return before >= 0 && handle > before && after > handle
    })).toBe(true)
    const stagedHistory = await client.history(sessionId)
    const stagedMessage = stagedHistory.events.findLast(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'file' && block.attachment.name === 'web-upload.txt'))
    expect(stagedMessage?.type === 'user/message' ? stagedMessage.data.content : []).toEqual([
      { type: 'text', text: 'before staged file' },
      expect.objectContaining({ type: 'file', attachment: expect.objectContaining({ name: 'web-upload.txt', bytes: streamedFileBytes.byteLength }) }),
      { type: 'text', text: 'after staged file' },
    ])
    expect((await rpc.response!('/api', 'native-session/image', { sessionId, attachmentId: 'wrong' }, new AbortController().signal)).status).toBe(404)
    expect((await fetch(new URL('/api/native-session/image', url), { method: 'POST', body: JSON.stringify({ sessionId, attachmentId: image.attachment.attachmentId }) })).status).toBe(401)
    expect(history.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message').map(event => event.type))
      .toEqual(['user/message', 'user/message', 'assistant/message', 'user/message', 'assistant/message'])
    expect(requests[1]?.messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'first input'))).toBe(true)
    const early = new AbortController()
    early.abort(new Error('before admission'))
    await expect(client.prompt(sessionId, 'not admitted', true, early.signal)).rejects.toThrow('before admission')
    expect(requests).toHaveLength(3)
    let settled = false
    const pending = conversation.send('cancel input')
    void pending.then(() => { settled = true }, () => { settled = true })
    await vi.waitFor(() => { expect(conversation.getSnapshot().error).toBeUndefined(); expect(requests).toHaveLength(4) })
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
    expect(conversation.getSnapshot().events.slice(-2).map(event => event.type)).toEqual(['turn/end', 'session/end-seed'])
    expect(await client.status(sessionId)).toEqual({ status: 'idle' })
    expect((await client.history(sessionId)).events.slice(-2).map(event => event.type)).toEqual(['turn/end', 'session/end-seed'])
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
    try {
      const started = await rpc.call('/api', 'session/start', { sessionId: foreignId, text: 'competing Web input', resume: true, follow: true, lastSeq: -1 }, new AbortController().signal)
      if (!started.ok) throw new Error(started.error.message)
      const admission = started.value as { admissionId: string }
      const settlement = await rpc.call('/api', 'session/await', { sessionId: foreignId, ...admission }, new AbortController().signal)
      expect(settlement).toMatchObject({ ok: false,
        error: { message: 'native-headless: root route requires the exact attached root owner' } })
      releaseForeignModel.resolve(undefined)
      await vi.waitFor(() => { expect(foreignApprovals).toBe(1) })
      await foreignTurn
    } finally { foreignAbort.abort(new Error('foreign fixture complete')); await foreignTurn.catch(() => undefined) }
    await conversation.close()
    await client.archive(sessionId)
    expect((await client.list()).some(item => item.header.id === sessionId)).toBe(false)
    await expect(client.search('first input')).resolves.toMatchObject({ items: [] })
    await client.close()

    const unauthenticatedApi = await fetch(new URL('/api/native-session/follow', url), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(unauthenticatedApi.status).toBe(401)

    const payload = '{ "action" : "opened", "issue": {"title":"durable native webhook"} }\n'
    const signedRequest = (body: string, delivery = 'native-durable-admission', signature = createHmac('sha256', githubSecret).update(body).digest('hex')) => fetch(
      new URL('/github', url), {
        method: 'POST', headers: {
          'content-type': 'application/json', 'x-github-delivery': delivery,
          'x-github-event': 'issues', 'x-hub-signature-256': `sha256=${signature}`,
        }, body,
      })
    const requestCount = requests.length
    const sessionIdsBeforeInvalid = (await persistence.list()).map(row => row.header.id).sort()
    const createdSessions = persistence.create.bind(persistence)
    let failNextCreate = false
    const webhookSessions: SessionId[] = []
    if (approvalService === undefined) throw new Error('missing Native approval authority')
    const releaseWebhookApprover = approvalService.registerAnswerer((request) => {
      if (webhookAgentId === undefined || request.agent.id !== webhookAgentId) return undefined
      webhookApprovals++
      return 'allowed-once'
    })
    const createSpy = vi.spyOn(persistence, 'create').mockImplementation(async (header, options) => {
      if (failNextCreate) {
        failNextCreate = false
        throw new Error('fixture root admission failure')
      }
      const writer = await createdSessions(header, options)
      webhookSessions.push(header.id)
      return writer
    })
    try {
      const nullAction = await signedRequest(JSON.stringify({ action: 'ignored' }), 'native-null-rule')
      expect(nullAction.status).toBe(202)
      expect(requests).toHaveLength(requestCount)
      expect(createSpy).not.toHaveBeenCalled()
      expect((await persistence.list()).map(row => row.header.id).sort()).toEqual(sessionIdsBeforeInvalid)

      const invalid = await signedRequest(payload, 'native-invalid-signature', '0'.repeat(64))
      expect(invalid.status).toBe(401)
      expect(requests).toHaveLength(requestCount)
      expect(createSpy).not.toHaveBeenCalled()
      expect((await persistence.list()).map(row => row.header.id).sort()).toEqual(sessionIdsBeforeInvalid)

      const ruleFailure = await signedRequest(JSON.stringify({ action: 'failed' }), 'native-rule-failure')
      expect(ruleFailure.status).toBe(503)
      expect(requests).toHaveLength(requestCount)
      expect(createSpy).not.toHaveBeenCalled()
      expect(workspaceRegistryService?.list()).toEqual([])
      expect(rootExecutionService?.workspaceRoutes()).toEqual([])

      const outsidePolicy = await signedRequest(JSON.stringify({ action: 'outside' }), 'native-outside-policy')
      expect(outsidePolicy.status).toBe(503)
      expect(requests).toHaveLength(requestCount)
      expect(createSpy).not.toHaveBeenCalled()
      expect(workspaceRegistryService?.list()).toEqual([])
      expect(rootExecutionService?.workspaceRoutes()).toEqual([])

      failNextCreate = true
      const beforeFailedAdmission = requests.length
      expect((await signedRequest(payload, 'native-failed-admission')).status).toBe(503)
      expect(requests).toHaveLength(beforeFailedAdmission)
      expect((await persistence.list()).map(row => row.header.id).sort()).toEqual(sessionIdsBeforeInvalid)
      expect(workspaceRegistryService?.list().map(workspace => ({ path: workspace.path, sessionIds: workspace.sessionIds })))
        .toEqual([{ path: webhookCwd, sessionIds: [] }])
      expect(rootExecutionService?.workspaceRoutes()).toEqual([])

      webhookMode = 'complete'
      const accepted = await signedRequest(payload)
      expect(accepted.status).toBe(202)
      await webhookTurnStarted.promise
      expect(webhookPromptContainsDelivery).toBe(true)
      const admittedId = webhookSessions[0]
      if (admittedId === undefined) throw new Error('webhook created no Session writer')
      const duringTurn = await persistence.open(SessionId(admittedId), 'read')
      const acceptedPrefix = (await duringTurn.read()).events
      await duringTurn.close()
      const inbox = acceptedPrefix.find(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.content.some(block => block.type === 'text'
          && block.text.includes('native-durable-admission'))))
      expect(inbox?.type).toBe('agent/inbox/spliced')
      expect(acceptedPrefix.some(event => event.type === 'turn/end')).toBe(false)
      expect(acceptedPrefix.some(event => event.type === 'session/title' && event.data.title === 'Native durable webhook')).toBe(true)
      expect(acceptedPrefix.some(event => event.type === 'permission/preset' && event.data.preset === 'workspace-write')).toBe(true)
      const overlappingAccepted = await signedRequest(payload, 'native-durable-admission-overlap')
      expect(overlappingAccepted.status).toBe(202)
      await webhookOverlapFinished.promise
      expect(webhookSessions).toHaveLength(2)
      expect(rootExecutionService?.workspaceRoutes()).toHaveLength(1)
      expect(duringTurn.header.agentPreset).toBe('alternate')
      expect(webhookSelectionApplied).toBe(true)
      const owner = activeSessionsService?.owners().find(candidate => candidate.session.id === admittedId)
      if (owner === undefined || sandboxPolicyService === undefined) throw new Error('missing live webhook owner or sandbox policy')
      expect(sandboxPolicyService.resolve({ session: owner.session }).mode).toBe('workspace-write')
      const root = rootExecutionService
      if (root === undefined) throw new Error('missing Native root execution service')
      const activeRoute = root.capture(owner)
      await expect(root.releaseIdle({ route: activeRoute.id, id: admittedId, expectedOwner: owner },
        new AbortController().signal)).rejects.toThrow(/settled Session/)
      expect(duringTurn.header.cwd).toBe(webhookCwd)
      const overlappingId = webhookSessions[1]
      if (overlappingId === undefined) throw new Error('overlapping Webhook created no Session writer')
      expect(workspaceRegistryService?.list().map(workspace => ({ path: workspace.path, sessionIds: [...workspace.sessionIds].sort() })))
        .toEqual([{ path: webhookCwd, sessionIds: [admittedId, overlappingId].sort() }])
      expect(rootExecutionService?.workspaceRoutes()).toHaveLength(1)
      const protectedBeforeWebhook = protectedRuns
      releaseWebhookTurn.resolve(undefined)
      await webhookTurnFinished.promise
      expect(webhookApprovals).toBe(1)
      expect(protectedRuns).toBe(protectedBeforeWebhook + 1)
      await vi.waitFor(() => {
        expect(rootExecutionService?.workspaceRoutes()).toEqual([])
        expect(activeSessionsService?.owners().some(candidate => candidate.session.id === admittedId)).toBe(false)
      })
      const preservedReader = await persistence.open(admittedId, 'read')
      const preservedEvents = (await preservedReader.read()).events
      await preservedReader.close()
      expect(preservedEvents.some(event => event.type === 'session/title' && event.data.title === 'Native durable webhook')).toBe(true)
      expect(preservedEvents.some(event => event.type === 'turn/end')).toBe(true)
      const maintenanceOwner = webhookRootOwners[0]
      if (maintenanceOwner === undefined) throw new Error('missing captured Webhook maintenance owner')
      await root.releaseIdle({ route: activeRoute.id, id: admittedId, expectedOwner: maintenanceOwner }, new AbortController().signal)
      await expect(root.releaseIdle({ route: 'wrong-route' as typeof activeRoute.id, id: admittedId, expectedOwner: maintenanceOwner },
        new AbortController().signal)).rejects.toThrow(/route does not match/)

      webhookMode = 'readonly'
      const readonlyResponse = await signedRequest(JSON.stringify({ action: 'readonly' }), 'native-readonly-enforcement')
      expect(readonlyResponse.status).toBe(202)
      await webhookReadonlyFinished.promise
      const readonlyId = webhookSessions[2]
      if (readonlyId === undefined) throw new Error('read-only webhook created no Session writer')
      const readonlyReader = await persistence.open(readonlyId, 'read')
      const readonlyEvents = (await readonlyReader.read()).events
      await readonlyReader.close()
      expect(readonlyEvents.find(event => event.type === 'session/title')).toMatchObject({ data: { title: 'Native read-only webhook' } })
      expect(readonlyEvents.find(event => event.type === 'sandbox/mode')).toMatchObject({ data: { mode: 'read-only' } })
      expect(readonlyEvents.find(event => event.type === 'approval/policy')).toMatchObject({ data: { policy: 'ask' } })
      expect(readonlyEvents.find(event => event.type === 'native-approval/decided')).toMatchObject({ data: { outcome: 'allowed-once' } })
      expect(readonlyEvents.find(event => event.type === 'tool/result')).toMatchObject({ data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      await expect(readFile(join(webhookCwd, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(webhookApprovals).toBe(2)
      await vi.waitFor(() => {
        expect(rootExecutionService?.workspaceRoutes()).toEqual([])
        expect(activeSessionsService?.owners().some(candidate => candidate.session.id === readonlyId)).toBe(false)
      })

      const clients = createNativeWorkspaceClients(rpc, 1000000)
      const workspacePath = join(cwd, 'native-workspace')
      await mkdir(workspacePath)
      const directoryListing = await clients.directoryPicker.list(cwd)
      expect(directoryListing.entries).toContainEqual({ name: 'native-workspace', path: workspacePath, kind: 'directory' })
      if (process.platform !== 'win32') {
        const danglingPath = join(cwd, 'dangling-workspace-link')
        await symlink(join(cwd, 'missing-target'), danglingPath)
        expect((await clients.directoryPicker.list(cwd)).entries.map(entry => entry.name)).not.toContain('dangling-workspace-link')
      }
      expect(await clients.directoryPicker.createDirectory(workspacePath, 'child')).toBe(join(workspacePath, 'child'))
      const frames = clients.workspace.follow(new AbortController().signal)[Symbol.asyncIterator]()
      const secondFrames = clients.workspace.follow(new AbortController().signal)[Symbol.asyncIterator]()
      try {
        expect((await frames.next()).value).toMatchObject({ type: 'baseline' })
        expect((await secondFrames.next()).value).toMatchObject({ type: 'baseline' })
        const refused = clients.workspace.follow(new AbortController().signal)[Symbol.asyncIterator]()
        await expect(refused.next()).rejects.toThrow('invalid response HTTP 429')
        const createdWorkspace = await clients.workspace.create({ path: workspacePath })
        expect(createdWorkspace.created).toBe(true)
        expect((await frames.next()).value).toMatchObject({ type: 'upsert', workspace: { workspaceId: createdWorkspace.workspace.workspaceId } })
        expect((await frames.next()).value).toMatchObject({ type: 'order' })
        expect(await clients.workspace.search('NATIVE-WORKSPACE')).toEqual([createdWorkspace.workspace.workspaceId])
        const connected = await clients.workspace.connectWorkspace(createdWorkspace.workspace.workspaceId)
        expect((await clients.workspace.connectWorkspace(createdWorkspace.workspace.workspaceId)).sessionId).toBe(connected.sessionId)
        expect((await clients.workspace.list()).workspaces.find(
          row => row.workspaceId === createdWorkspace.workspace.workspaceId,
        )?.sessionIds)
          .toContain(connected.sessionId)
        if (rootExecutionService === undefined) throw new Error('missing Native root execution authority')
        await clients.workspace.delete(createdWorkspace.workspace.workspaceId)
        expect(rootExecutionService.workspaceRoutes()).toEqual([])
        expect(await persistence?.stat(connected.sessionId)).toBeDefined()
        expect(await clients.workspace.search('native-workspace')).toEqual([])
      } finally {
        await frames.return?.()
        await secondFrames.return?.()
        await clients.workspace.close()
      }

      webhookMode = 'shutdown'
      const drainingResponse = await signedRequest(payload, 'native-shutdown-admission')
      expect(drainingResponse.status).toBe(202)
      await webhookShutdownStarted.promise
      const beforeWithdrawal = requests.length
      const sessionIdsBeforeWithdrawal = (await persistence.list()).map(row => row.header.id).sort()
      hostStop = host.stop()
      await webhookShutdownAborted.promise
      await vi.waitFor(async () => {
        const afterWithdrawal = await signedRequest(payload, 'native-after-withdrawal')
        expect(afterWithdrawal.status).toBe(503)
      })
      let stopped = false
      void hostStop.then(() => { stopped = true })
      expect(stopped).toBe(false)
      expect(requests).toHaveLength(beforeWithdrawal)
      expect((await persistence.list()).map(row => row.header.id).sort()).toEqual(sessionIdsBeforeWithdrawal)
      releaseWebhookShutdown.resolve(undefined)
      await webhookShutdownTurnFinished.promise
      await hostStop
    } finally {
      releaseWebhookApprover()
      createSpy.mockRestore()
      releaseWebhookTurn.resolve(undefined)
      releaseWebhookShutdown.resolve(undefined)
      await (hostStop ?? host.stop())
    }
  } finally {
    for (const barrier of racePreparation) barrier.release.resolve(undefined)
    restoreClientPrompt?.()
    foreignAbort.abort(new Error('foreign fixture cleanup'))
    releaseForeignModel.resolve(undefined)
    holdResolution = false
    queuedPromptAbort?.abort(new Error('web fixture cleanup'))
    releaseResolution.resolve(undefined)
    await Promise.all([pendingSelection, pendingQueuedPrompt].filter((pending): pending is Promise<unknown> => pending !== undefined))
    releaseImage.resolve(undefined)
    releaseRetainedRoot?.()
    firstContinue.resolve(undefined)
    releaseCleanup()
    await (hostStop ?? host.stop())
    await rm(directory, { recursive: true, force: true })
  }
})

it('lists native preset folders with standing compositions and returns an empty catalog without the service', async () => {
  const scope = new NativeScope()
  const presets = {
    catalog: () => ({ default: 'standard', folders: [
      { id: 'standard', name: 'Standard folder', trust: 'system', status: 'ready' },
      { id: 'user-ready', name: 'User ready', trust: 'user', status: 'ready' },
      { id: 'legacy', name: 'Legacy', trust: 'user', status: 'needs-migration' },
      { id: 'broken', name: 'Broken', trust: 'system', status: 'invalid', problem: 'invalid file' },
    ] }),
    list: () => [
      { id: 'standard', name: 'Standard', scope },
      { id: 'profile-only', name: 'Profile only', scope },
    ],
  } as unknown as NativeAgentPresetOperations
  const config = resolveNativeWebSessionConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
    maxSteps: 1, builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
    maxFollowBufferBytes: 1000, maxFollowers: 1, maxPendingHumanRequests: 1 })
  const signal = new AbortController().signal
  const active = {
    onAttached: () => async () => {},
    onDetached: () => async () => {},
    owners: () => [],
  } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(
    { dispose: async () => {} } as unknown as NativeHeadlessApplication,
    {} as NativeSessionPersistenceOperations, active, config, signal, { presets },
  )
  const emptyService = new NativeWebSessionService(
    { dispose: async () => {} } as unknown as NativeHeadlessApplication,
    {} as NativeSessionPersistenceOperations, active, config, signal,
  )
  try {
    expect(await service.handle('agent-presets/list', {}, signal)).toEqual({ ok: true, value: {
      default: 'standard', presets: [
        { id: 'standard', name: 'Standard', source: 'system', status: 'ready' },
        { id: 'profile-only', name: 'Profile only', source: 'profile', status: 'ready' },
        { id: 'user-ready', name: 'User ready', source: 'user', status: 'ready' },
        { id: 'legacy', name: 'Legacy', source: 'user', status: 'needs-migration' },
        { id: 'broken', name: 'Broken', source: 'system', status: 'invalid', problem: 'invalid file' },
      ],
    } })
    expect(await service.handle('agent-presets/list', { extra: true }, signal)).toMatchObject({
      ok: false, error: { code: 'native/agent-presets' },
    })
    expect(await emptyService.handle('agent-presets/list', {}, signal)).toEqual({
      ok: true, value: { default: null, presets: [] },
    })
  } finally {
    await service.close()
    await emptyService.close()
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

it('removes the Native Web controller after cancelling and draining retained title work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-web-controller-removal-'))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const scope = new NativeScope()
  const providerStarted = Promise.withResolvers<undefined>()
  const providerAbortObserved = Promise.withResolvers<undefined>()
  const releaseProviderCleanup = Promise.withResolvers<undefined>()
  const sessionId = SessionId('controller-removal-title')
  let providerSignal: AbortSignal | undefined
  let nativeWebSession: NativeWebSessionService | undefined
  let persistence: NativeSessionPersistenceOperations | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'controller-removal-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', { async *stream() { yield* textResponse('Foreground reply') } })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'controller-removal-carrier', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => (context) => {
      const connection: HostConnectionHandle = {
        rpc: { handle: () => () => Promise.resolve(), intercept: () => () => Promise.resolve() },
        fetch: { register: () => () => Promise.resolve() },
        createSharedFetchHandler: () => ({ requestBodyMode: () => 'buffered', fetch: async () => new Response(null, { status: 404 }) }),
        requestRejection: () => undefined,
        authorizeIndex: () => false,
        authenticatedUrl: baseUrl => baseUrl,
      }
      context.provide('hostConnection', connection)
    },
  }
  const titleProvider: NativePlugin = {
    apiVersion: 1, name: 'controller-removal-title-provider', targets: ['host'], requires: ['sessionTitles'], provides: [],
    resolve: () => (context) => {
      context.effect(context.require('sessionTitles').register({
        id: SessionTitleProviderId('controller-removal-title-provider'), automatic: 'first-prompt',
        async generate(request) {
          providerSignal = request.signal
          providerStarted.resolve(undefined)
          const observeAbort = (): void => { providerAbortObserved.resolve(undefined) }
          if (request.signal.aborted) observeAbort()
          else request.signal.addEventListener('abort', observeAbort, { once: true })
          await providerAbortObserved.promise
          await releaseProviderCleanup.promise
          return { title: 'late provider title', messageSeqs: request.messages.map(message => message.seq) }
        },
      }))
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'controller-removal-capture', targets: ['host'], requires: ['nativeWebSession', 'sessionPersistence'], provides: [],
    resolve: () => (context) => {
      nativeWebSession = context.require('nativeWebSession')
      persistence = context.require('sessionPersistence')
    },
  }
  const controllerRequest = { plugin, scope, config: {
    cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
    maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 10000,
    maxFollowers: 2, maxPendingHumanRequests: 2,
  } }
  const host = new NativeHost(resolveInstallation([
    { plugin: agents, scope, config: undefined },
    { plugin: execution, scope, config: undefined },
    { plugin: model, scope, config: undefined },
    { plugin: modelExecution, scope, config: undefined },
    { plugin: approval, scope, config: undefined },
    { plugin: permissionPresets, scope, config: { presets: {
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    } } },
    { plugin: sandboxPolicy, scope, config: { mode: 'danger-full-access', workspaceRoot: cwd } },
    { plugin: sandboxedFilesystem, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
    { plugin: storageHub, scope, config: undefined },
    { plugin: storageJson, scope, config: { root: join(directory, 'domains') } },
    { plugin: storageDomain, scope, config: { backend: 'json' } },
    { plugin: workspaceRegistry, scope, config: undefined },
    { plugin: sessionTitles, scope, config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    { plugin: titleProvider, scope, config: undefined },
    { plugin: carrier, scope, config: undefined },
    controllerRequest,
    { plugin: capture, scope, config: undefined },
  ], 'host'))
  let removing: Promise<void> | undefined
  try {
    await host.start()
    if (nativeWebSession === undefined || persistence === undefined) throw new Error('missing Native Web Session fixture')
    const prompted = await nativeWebSession.handle('session/prompt', {
      sessionId, text: 'First prompt', resume: false, follow: true, lastSeq: -1,
    }, new AbortController().signal)
    await providerStarted.promise
    expect(prompted).toMatchObject({ ok: true, value: { exitCode: 0 } })
    const readTitles = async () => {
      const reader = await persistence!.open(sessionId, 'read')
      try {
        return (await reader.read()).events.filter(event => event.type === 'session/title')
          .map(event => event.type === 'session/title' ? { seq: event.seq, title: event.data.title, source: event.data.source } : undefined)
      } finally { await reader.close() }
    }
    const titlesBeforeRemoval = await readTitles()
    let removed = false
    removing = host.remove(controllerRequest).then(() => { removed = true })
    await vi.waitFor(() => { expect(providerSignal?.aborted).toBe(true) })
    await providerAbortObserved.promise
    expect(removed).toBe(false)
    expect(host.diagnostics().find(entry => entry.name === titleProvider.name)?.state).toBe('ready')
    releaseProviderCleanup.resolve(undefined)
    await removing
    expect(removed).toBe(true)
    expect(await readTitles()).toEqual(titlesBeforeRemoval)
  } finally {
    releaseProviderCleanup.resolve(undefined)
    if (removing !== undefined) await Promise.allSettled([removing])
    await host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
