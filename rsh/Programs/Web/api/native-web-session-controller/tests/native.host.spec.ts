/** Native browser Session lifecycle through the authenticated HTTP Connection carrier. */
import { createHmac } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
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
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeSettings } from '@deepseek-ai/dsh-settings/native'
import type { NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { NativeConversationController } from '@deepseek-ai/dsh-client-native-application/controller'
import { plugin, resolveNativeWebSessionConfig } from '../src/native.ts'

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
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 5, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 2, maxPendingHumanRequests: 2, maxCredentialRefsPerRead: 2, maxSettingsOperations: 1,
      workspaceRoutes: { maxRoutes: 1, allowedRoots: [directory] } } },
    { plugin: githubWebhook, scope, config: { source: 'native-test', path: '/github', secretEnv: 'NATIVE_GITHUB_SECRET',
      maxBodyBytes: 4096, rootRoute: 'root' } },
    ...[agents, execution, modelExecution, modelSelection, tools, approval, questions, askUser,
      model, carrier, foreignProgram, settingsProvider, settingsRegistrant, credentialProvider, webhook,
      workspaceRegistry, storageHub,
      webhookRuleRegistration, nativePolicyProbe].map(plugin =>
      ({ plugin, scope, config: undefined })),
    { plugin: agentPresets, scope, config: { default: 'standard' } },
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
    const rpc = createWebConnectionRpc((input, init) => {
      if (input.pathname.endsWith('/native-session/follow')) followFields = JSON.parse(init.body as string)
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return fetch(new URL(input.pathname, url), { ...init, headers })
    })
    const rawSettingsReply = await rpc.call('/api', 'settings/describe', {}, new AbortController().signal)
    expect(rawSettingsReply).toMatchObject({ ok: true, value: {
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
    const settingsDescription = await client.settingsDescribe()
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
    expect((await rpc.response!('/api', 'native-session/image', { sessionId, attachmentId: 'wrong' }, new AbortController().signal)).status).toBe(404)
    expect((await fetch(new URL('/api/native-session/image', url), { method: 'POST', body: JSON.stringify({ sessionId, attachmentId: image.attachment.attachmentId }) })).status).toBe(401)
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
    await vi.waitFor(() => { expect(conversation.getSnapshot().error).toBeUndefined(); expect(requests).toHaveLength(3) })
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
    foreignAbort.abort(new Error('foreign fixture cleanup'))
    releaseForeignModel.resolve(undefined)
    releaseWebRead.resolve(undefined)
    releaseResolution.resolve(undefined)
    releaseImage.resolve(undefined)
    releaseRetainedRoot?.()
    firstContinue.resolve(undefined)
    releaseCleanup()
    await (hostStop ?? host.stop())
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
