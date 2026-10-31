/** Native Agent, model, filesystem tool, and released Session storage in one host. */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativeContext, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { LocalFileSystemBackend } from '@deepseek-ai/dsh-fs-local/backend'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as toolFsPlugin } from '@deepseek-ai/dsh-tool-fs/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import {
  plugin as subagentPlugin,
  serializeNativeExternalJson,
  type NativeExternalJsonValue,
  type NativeExternalModelAttemptLease,
  type NativeExternalSubagentDriver,
  type NativeExternalSubagentOutcome,
  type NativeExternalSubagentRequest,
  type NativeSubagentOperations,
} from '@deepseek-ai/dsh-native-subagent/native'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentOperations, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import { plugin as sessionExecutionPlugin } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as approvalPlugin } from '@deepseek-ai/dsh-native-approval/native'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import { plugin as codeToolPlugin } from '@deepseek-ai/dsh-tool-code-runtime/native'
import { plugin as codeRuntimePlugin } from '@deepseek-ai/dsh-native-code-runtime/native'
import { plugin as toolSubagentPlugin } from '@deepseek-ai/dsh-tool-subagent/native'
import type { NativeCodeRunRequest, NativeCodeRuntime } from '@deepseek-ai/dsh-code-runtime-definition'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection'
import type { NativeResponsesGenerationCapture, NativeResponsesTransport } from '@deepseek-ai/dsh-native-model-execution/responses-transport'
import { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { plugin as instructionsPlugin } from '@deepseek-ai/dsh-agent-instructions/native'
import { plugin as timeContextPlugin } from '@deepseek-ai/dsh-native-time-context/native'
import { plugin as tmuxContextPlugin } from '@deepseek-ai/dsh-native-tmux-context/native'
import { plugin as requestContextsPlugin } from '@deepseek-ai/dsh-request-context/native'
import { plugin as skillsPlugin } from '@deepseek-ai/dsh-skill/native'
import type { NativeSkills } from '@deepseek-ai/dsh-skill/native'
import type { SkillProvider } from '@deepseek-ai/dsh-skill/types'
import { plugin as skillFilesystemPlugin } from '@deepseek-ai/dsh-skill-filesystem/native'
import { plugin as toolSkillPlugin } from '@deepseek-ai/dsh-tool-skill/native'
import type { ShellExecRequest, ShellExecSpec, ShellOperations, ShellRunResult } from '@deepseek-ai/dsh-shell/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { FILE_REFERENCE_PROMPT } from '@deepseek-ai/dsh-file-reference/prompt'
import { plugin as fileReferencePlugin } from '@deepseek-ai/dsh-native-file-reference-local/native'
import { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOwner, NativeRootExecutionOperations, NativeRootRouteId,
  NativeSessionExecutionOperations, NativeSessionOwnerApproval } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeToolDelegationContext, NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin, type NativeHeadlessApplication } from '../src/native.ts'

function isNativeExternalJsonValue(value: unknown): value is NativeExternalJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isNativeExternalJsonValue)
  return typeof value === 'object' && Object.values(value).every(isNativeExternalJsonValue)
}

function isNativeExternalJsonArray(value: NativeExternalJsonValue): value is readonly NativeExternalJsonValue[] {
  return Array.isArray(value)
}

function isNativeExternalJsonRecord(
  value: NativeExternalJsonValue,
): value is { readonly [key: string]: NativeExternalJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function fixture(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: {
    approvalPolicy?: 'ask' | 'never'
    timeContext?: { timeZone: string; refreshIntervalMs?: number }
    tmuxContext?: { refreshIntervalMs?: number }
    shellOperations?: ShellOperations
    instructions?: boolean
    ptc?: boolean
    fileReferences?: boolean
    allowedTools?: readonly string[]
    maxSteps?: number
    /** Persona template registered as a prompt section; `{{variable}}` references render strictly. */
    persona?: string
    directory?: string
    workspaceWriteRoot?: string
    codeRuntimeProvider?: NativePlugin
    toolSubagent?: boolean
    sandboxPolicy?: NativeSandboxPolicy
    modelSelection?: NativeModelSelectionOperations
    attachments?: AttachmentOperations
    parentAttachments?: AttachmentOperations
    externalSubagentDriver?: NativeExternalSubagentDriver
    skillDirectory?: string
    observeSkillProvider?: (provider: SkillProvider) => void
  } = {},
) {
  const ownsDirectory = options.directory === undefined
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'rsh-native-headless-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  const skillDirectory = options.skillDirectory ?? (options.observeSkillProvider === undefined ? undefined : join(directory, 'skills'))
  await import('node:fs/promises').then(fs => fs.mkdir(workspace, { recursive: true }))
  if (skillDirectory !== undefined) {
    await mkdir(join(skillDirectory, 'handoff-skill'), { recursive: true })
    await writeFile(join(skillDirectory, 'handoff-skill', 'SKILL.md'), '---\nname: handoff-skill\ndescription: Handoff skill\n---\n\nFilesystem instructions.\n')
  }
  const parentScope = options.parentAttachments === undefined ? undefined : new NativeScope()
  const scope = new NativeScope(parentScope)
  const adapter = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let filesystem: LocalFileSystemBackend | undefined
  let agents: NativeAgentRegistry | undefined
  let tools: NativeToolRegistry | undefined
  let rootExecution: NativeRootExecutionOperations | undefined
  let persistence: NativeSessionPersistenceOperations | undefined
  let sessionExecution: NativeSessionExecutionOperations | undefined
  let subagents: NativeSubagentOperations | undefined
  let approval: NativeApprovalServiceDefinition | undefined
  let codeRuntime: NativeCodeRuntime | undefined
  let skills: NativeSkills | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const selectedModelSelection = options.modelSelection
  const needsSessionExecution = options.fileReferences || options.toolSubagent || selectedModelSelection !== undefined
    || skillDirectory !== undefined
  const modelSelectionProvider: NativePlugin | undefined = selectedModelSelection === undefined ? undefined : {
    apiVersion: 1, name: 'test-model-selection', targets: ['host'], requires: [], provides: ['modelSelection'],
    resolve: () => (context) => { context.provide('modelSelection', selectedModelSelection) },
  }
  const selectedSandboxPolicy = options.sandboxPolicy
  const sandboxPolicyProvider: NativePlugin | undefined = selectedSandboxPolicy === undefined ? undefined : {
    apiVersion: 1, name: 'test-native-sandbox-policy', targets: ['host'], requires: [], provides: ['sandboxPolicy'],
    resolve: () => (context) => { context.provide('sandboxPolicy', selectedSandboxPolicy) },
  }
  const attachmentProvider: NativePlugin | undefined = options.attachments === undefined ? undefined : {
    apiVersion: 1, name: 'test-attachments', targets: ['host'], requires: [], provides: ['attachments'],
    resolve: () => (context) => { context.provide('attachments', options.attachments!) },
  }
  const parentAttachmentProvider: NativePlugin | undefined = options.parentAttachments === undefined ? undefined : {
    apiVersion: 1, name: 'test-parent-attachments', targets: ['host'], requires: [], provides: ['attachments'],
    resolve: () => (context) => { context.provide('attachments', options.parentAttachments!) },
  }
  const externalSubagentDriver = options.externalSubagentDriver
  const externalSubagentDriverProvider: NativePlugin | undefined = externalSubagentDriver === undefined ? undefined : {
    apiVersion: 1, name: 'test-external-subagent-driver', targets: ['host'], requires: [], provides: ['externalSubagentDriver'],
    resolve: () => (context) => { context.provide('externalSubagentDriver', externalSubagentDriver) },
  }
  const selectedShell = options.shellOperations
  const shellProvider: NativePlugin | undefined = selectedShell === undefined ? undefined : {
    apiVersion: 1, name: 'test-shell', targets: ['host'], requires: [], provides: ['shell'],
    resolve: () => (context) => { context.provide('shell', selectedShell) },
  }
  const skillProviderObserver: NativePlugin | undefined = skillDirectory === undefined ? undefined : {
    apiVersion: 1, name: 'test-skill-provider-observer', targets: ['host'], requires: ['skills'], provides: [],
    resolve: () => (context) => {
      const registry = context.require('skills')
      const registerProvider = registry.registerProvider.bind(registry)
      registry.registerProvider = (registrationScope, createProvider) => registerProvider(registrationScope, (control) => {
        const provider = createProvider(control)
        if (provider.name === 'filesystem') options.observeSkillProvider?.(provider)
        return provider
      })
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['application', 'fs', 'agents', 'tools', 'rootExecution', 'sessionPersistence'], optional: ['approval', 'codeRuntime', 'sessionExecution', 'subagents', 'skills'], provides: [],
    resolve: () => (context) => {
      app = context.require('application') as NativeHeadlessApplication
      const provided = context.require('fs')
      if (!(provided instanceof LocalFileSystemBackend)) throw new Error('missing local filesystem')
      filesystem = provided
      agents = context.require('agents')
      tools = context.require('tools')
      rootExecution = context.require('rootExecution')
      persistence = context.require('sessionPersistence')
      sessionExecution = context.optional('sessionExecution')
      subagents = context.optional('subagents')
      approval = context.optional('approval')
      codeRuntime = context.optional('codeRuntime')
      skills = context.optional('skills')
    },
  }
  let host: NativeHost | undefined
  let toolsRequest: InstallationRequest = { plugin: toolsPlugin, scope, config: undefined }
  let codeRuntimeRequest: InstallationRequest = { plugin: options.codeRuntimeProvider ?? codeRuntimePlugin, scope,
    config: options.codeRuntimeProvider === undefined ? { computeMs: 2_000, maxWallMs: 2_000 } : undefined }
  let skillProviderRequest: InstallationRequest | undefined = skillDirectory === undefined ? undefined : {
    plugin: skillFilesystemPlugin, scope, config: { includeDefaultRoots: false, customSkillDirs: [skillDirectory], watch: true,
      watchUsePolling: true, watchStabilityThresholdMs: 20, watchPollIntervalMs: 10 },
  }
  let requests: InstallationRequest[]
  try {
    requests = [
      ...(parentScope === undefined ? [] : [{ plugin: localFilesystemPlugin, scope: parentScope, config: { cwd: directory } }]),
      ...(parentScope === undefined || parentAttachmentProvider === undefined ? [] : [
        { plugin: parentAttachmentProvider, scope: parentScope, config: undefined },
      ]),
      { plugin: capture, scope, config: undefined },
      ...(skillDirectory === undefined ? [] : [
        { plugin: skillsPlugin, scope, config: undefined },
        { plugin: skillProviderObserver!, scope, config: undefined },
        { plugin: requestContextsPlugin, scope, config: undefined },
      ]),
      ...(modelSelectionProvider === undefined ? [] : [{ plugin: modelSelectionProvider, scope, config: undefined }]),
      ...(attachmentProvider === undefined ? [] : [{ plugin: attachmentProvider, scope, config: undefined }]),
      { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use tools.', maxSteps: options.maxSteps ?? 4, ...(options.ptc ? { builtinTools: false } : {}),
        ...options.allowedTools === undefined ? {} : { allowedTools: options.allowedTools },
        ...options.workspaceWriteRoot === undefined ? {} : { workspaceWriteRoot: options.workspaceWriteRoot } } },
      { plugin: agentPlugin, scope, config: undefined },
      ...(needsSessionExecution ? [{ plugin: sessionExecutionPlugin, scope, config: undefined }] : []),
      { plugin: modelExecutionPlugin, scope, config: undefined },
      ...(externalSubagentDriverProvider === undefined || externalSubagentDriver === undefined ? [] : [
        { plugin: externalSubagentDriverProvider, scope, config: undefined },
        { plugin: subagentPlugin, scope, config: { providerName: externalSubagentDriver.name } },
      ]),
      ...(options.toolSubagent ? [{ plugin: toolSubagentPlugin, scope, config: { toolName: 'subagent', maxDepth: 2 } }] : []),
      codeRuntimeRequest,
      ...(options.ptc ? [{ plugin: codeToolPlugin, scope, config: undefined }] : []),
      ...(sandboxPolicyProvider === undefined ? [] : [{ plugin: sandboxPolicyProvider, scope, config: undefined }]),
      ...(shellProvider === undefined ? [] : [{ plugin: shellProvider, scope, config: undefined }]),
      ...(options.timeContext === undefined ? [] : [{ plugin: timeContextPlugin, scope, config: options.timeContext }]),
      ...(options.tmuxContext === undefined ? [] : [{ plugin: tmuxContextPlugin, scope, config: options.tmuxContext }]),
      ...(options.instructions ? [{ plugin: instructionsPlugin, scope, config: { maxBytes: 65_536, dshHome: directory } }] : []),
      toolsRequest,
      ...(skillDirectory === undefined ? [] : [
        { plugin: toolSkillPlugin, scope, config: undefined },
      ]),
      { plugin: policyPlugin, scope, config: undefined },
      ...(options.fileReferences || options.toolSubagent || options.persona ? [{ plugin: promptPlugin, scope, config: undefined }] : []),
      ...(options.fileReferences ? [
        { plugin: toolFsPlugin, scope, config: undefined },
        { plugin: fileReferencePlugin, scope, config: undefined },
      ] : []),
      { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
      { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
      { plugin: model, scope, config: undefined },
      ...(skillProviderRequest === undefined ? [] : [skillProviderRequest]),
      ...(options.approvalPolicy === undefined ? [] : [{ plugin: approvalPlugin, scope, config: { policy: options.approvalPolicy } }]),
      ...(options.persona === undefined ? [] : [{
        plugin: {
          name: 'test-persona-section', apiVersion: 1, targets: ['host'] as const, provides: [], requires: ['promptSections' as const],
          // The persona template is a prompt section, exactly like a shipped preset row: the
          // variables it references are resolved by the Registry at render time, not here.
          resolve: () => (context: NativeContext): void => {
            context.require('promptSections').register({
              name: 'deployment:persona-prefix', order: 10_000, text: () => options.persona!,
            })
          },
        },
        scope,
        config: undefined,
      }]),
    ]
    host = new NativeHost(resolveInstallation(requests, 'host'))
    await host.start()
    if (app === undefined || filesystem === undefined || agents === undefined || tools === undefined
      || rootExecution === undefined || persistence === undefined) {
      throw new Error('missing native application dependencies')
    }  } catch (error: unknown) {
    const cleanupFailures: unknown[] = []
    if (host !== undefined && !host.signal.aborted) {
      try { await host.stop() } catch (cleanupError: unknown) { cleanupFailures.push(cleanupError) }
    }
    if (ownsDirectory) {
      try { await rm(directory, { recursive: true, force: true }) } catch (cleanupError: unknown) { cleanupFailures.push(cleanupError) }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], 'native-headless fixture startup and cleanup failed')
    }
    throw error
  }
  if (host === undefined) throw new Error('native-headless fixture has no Host')
  return {
    host, scope, get app() { return app! }, filesystem, agents, get tools() { return tools! }, rootExecution, persistence,
    sessionExecution, subagents, approval,
    get skills() { return skills! },
    get codeRuntime() { return codeRuntime },
    adapter, directory, workspace, sessions, skillDirectory,
    async replaceCodeRuntime(provider: NativePlugin) {
      const nextRequest: InstallationRequest = { plugin: provider, scope, config: undefined }
      const nextRequests = requests.map(request => request === codeRuntimeRequest ? nextRequest : request)
      await host.replace(resolveInstallation(nextRequests, 'host'))
      codeRuntimeRequest = nextRequest
      requests = nextRequests
    },
    async replaceToolsProvider(provider: NativePlugin) {
      const nextRequest: InstallationRequest = { plugin: provider, scope, config: undefined }
      const nextRequests = requests.map(request => request === toolsRequest ? nextRequest : request)
      await host.replace(resolveInstallation(nextRequests, 'host'))
      toolsRequest = nextRequest
      requests = nextRequests
    },
    async replaceSkillProvider(provider: NativePlugin) {
      if (skillProviderRequest === undefined) throw new Error('fixture has no skill Provider')
      const nextRequest: InstallationRequest = { plugin: provider, scope, config: undefined }
      const nextRequests = requests.map(request => request === skillProviderRequest ? nextRequest : request)
      await host.replace(resolveInstallation(nextRequests, 'host'))
      skillProviderRequest = nextRequest
      requests = nextRequests
    },
  }
}

const TMUX_LOCATION = 'work\\t2\\teditor\\t1\\t%3\\t1\\t1\\tlayout-3'

function shellResult(stdout: string): ShellRunResult {
  return {
    exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 30_000,
    stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false },
  }
}

/** Locate a persisted Session log, whose directory key derives from its project path. */
async function findSessionLog(root: string, id: string): Promise<string> {
  const match = (await readdir(root, { withFileTypes: true, recursive: true }))
    .find(entry => entry.isFile() && entry.name === 'session.v3.jsonl' && entry.parentPath.endsWith(id))
  if (match === undefined) throw new Error(`missing stored log for ${id}`)
  return join(match.parentPath, match.name)
}
function testShell(run: ShellOperations['run']): ShellOperations {
  return {
    sandboxMode: undefined,
    resolve(request: ShellExecRequest): ShellExecSpec {
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 30_000,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    run,
    start() { throw new Error('unexpected background shell process') },
  }
}

function imageAttachmentOperations(readImage: AttachmentOperations['readImage']): AttachmentOperations {
  return {
    imageLimits: { maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, maxImagePixels: 1,
      maxImageDimension: 1, mediaTypes: ['image/png'] },
    imageHostPath: () => undefined,
    async readImageRequest() { throw new Error('request image projection is not used by this fixture') },
    async validateImage() {},
    async saveImages() { return [] },
    async saveImage() { throw new Error('image writes are not used by this fixture') },
    readImage,
    async saveFile() { throw new Error('file writes are not used by this fixture') },
    async saveFileStream() { throw new Error('file writes are not used by this fixture') },
    async *readFileStream() {},
    fileHostPath: () => undefined,
    async admitEncodedFile() { throw new Error('file admission is not used by this fixture') },
    async admitPromptContent() { return [] },
    isAttachmentError: () => false,
  }
}

it('streams current Session attachment reads while denying other outside reads and writes', async () => {
  const attachmentDirectory = await mkdtemp(join(tmpdir(), 'rsh-native-file-read-'))
  const attachmentPath = join(attachmentDirectory, 'notes.txt')
  const outsidePath = join(attachmentDirectory, 'private.txt')
  const bytes = new TextEncoder().encode('first line\nsecond 📎\nthird line')
  await writeFile(attachmentPath, bytes)
  await writeFile(outsidePath, 'private')
  const ref: FileAttachmentRef = { attachmentId: AttachmentId('file-read-stream'), name: 'notes.txt', bytes: bytes.length }
  const decoyRef: FileAttachmentRef = { ...ref, attachmentId: AttachmentId('parent-decoy-file') }
  let selectedSaveCount = 0
  let decoySaveCount = 0
  let removeCapturedRead: (() => Promise<void>) | undefined
  let streamFinished = false
  let readCount = 0
  const attachments: AttachmentOperations = {
    ...imageAttachmentOperations(async image => ({ ref: image, data: new Uint8Array() })),
    async saveFileStream({ data }) {
      const chunks: Uint8Array[] = []
      for await (const chunk of data) chunks.push(chunk)
      expect(Buffer.concat(chunks).equals(Buffer.from(bytes))).toBe(true)
      selectedSaveCount++
      return ref
    },
    fileHostPath: file => file.attachmentId === ref.attachmentId ? attachmentPath : undefined,
    async *readFileStream(file, signal) {
      expect(file).toEqual(ref)
      signal?.throwIfAborted()
      readCount++
      const split = bytes.findIndex(value => value === 0xf0) + 2
      yield bytes.subarray(0, split)
      yield bytes.subarray(split)
      streamFinished = true
    },
  }
  const parentAttachments: AttachmentOperations = {
    ...imageAttachmentOperations(async image => ({ ref: image, data: new Uint8Array() })),
    async saveFileStream({ data }) {
      for await (const _chunk of data) {}
      decoySaveCount++
      return decoyRef
    },
    fileHostPath: file => file.attachmentId === decoyRef.attachmentId ? outsidePath : undefined,
  }
  const state = await fixture([
    toolCallResponse('read-uploaded-file', 'read', { file_path: attachmentPath, offset: 2, limit: 1 }),
    toolCallResponse('read-captured-upload', 'read-captured-upload', {}),
    toolCallResponse('read-private-file', 'read', { file_path: outsidePath }),
    toolCallResponse('write-uploaded-file', 'write_file', { path: attachmentPath, content: 'overwritten' }),
    textResponse('finished'),
  ], { attachments, parentAttachments, fileReferences: true, allowedTools: ['read', 'read_file', 'write_file', 'read-captured-upload'] })
  const id = SessionId('native-attachment-read')
  const route = brandString<NativeRootRouteId>('root')
  const signal = new AbortController().signal
  let sibling: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    removeCapturedRead = state.tools.registerValueTool({
      schema: { name: 'read-captured-upload', description: 'Read the exact Session attachment through captured Headless tools.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } },
      output: { schema: { type: 'string' }, render: (_call, value) => {
        if (typeof value !== 'string') throw new Error('captured attachment result must be text')
        return { content: [{ type: 'text', text: value }], isError: false }
      } },
      async execute(call) {
        if (state.sessionExecution === undefined) throw new Error('sessionExecution is unavailable')
        const operations = await state.sessionExecution.captureExternalTools(call.agent, call.session, {
          depth: 1, maxDepth: 1, cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 3,
          toolNames: ['read_file'], builtinToolNames: ['read_file'], programToolNames: [],
        }, call.signal)
        try {
          const read = await operations.execute({ callId: ToolCallId('captured-file-read'), name: 'read_file',
            arguments: { path: attachmentPath } }, call.signal)
          const readText = read.result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
          expect(read.result.isError).toBe(false)
          expect(readText).toBe(new TextDecoder().decode(bytes))
          read.acceptRecordedResult()
          return readText
        } finally { await operations.dispose() }
      },
    })
    expect(state.filesystem.config.cwd).toBe(state.workspace)
    await state.rootExecution.maintenance({ route, id, resume: false }, async () => undefined, signal)
    const receipt = await state.rootExecution.stagedFiles.stageStream({ route, id,
      data: (async function* () { yield bytes })(), name: ref.name }, signal)
    expect(selectedSaveCount).toBe(1)
    expect(decoySaveCount).toBe(0)
    sibling = await fixture([textResponse('must not execute with another Program receipt')], {
      attachments, fileReferences: true, allowedTools: [],
    })
    await sibling.rootExecution.maintenance({ route, id, resume: false }, async () => undefined, signal)
    await expect(sibling.rootExecution.maintenance({ route, id, resume: true }, async (owner) => {
      sibling!.rootExecution.stagedFiles.prepare({ owner, receiptIds: [receipt.receiptId], signal,
        createMessage: files => createUserMessage({ source: { kind: 'user' }, content: [...files] }) })
    }, signal)).rejects.toThrow('staged file receipt')
    expect(sibling.adapter.requests).toHaveLength(0)
    await state.app.executeRootTurn({ route, id, resume: true, prepareMessage: async (_model, owner, ownerSignal) =>
      state.rootExecution.stagedFiles.prepare({ owner, receiptIds: [receipt.receiptId], signal: ownerSignal,
        createMessage: files => createUserMessage({ source: { kind: 'user' }, content: [
          { type: 'text', text: 'Read the uploaded file.' }, ...files, { type: 'text', text: 'Keep this after the file.' },
        ] }) }) }, signal)

    expect(state.adapter.requests[0]?.messages.some(message =>
      message.content.some(block => block.type === 'text' && block.text.includes(JSON.stringify(attachmentPath))))).toBe(true)
    expect(readCount).toBe(2)
    expect(streamFinished).toBe(true)
    expect(selectedSaveCount).toBe(1)
    expect(decoySaveCount).toBe(0)
    expect(JSON.stringify(state.adapter.requests[1]?.messages)).toContain('2: second 📎')
    expect(state.adapter.requests[2]?.messages.some(message => message.content.some(block =>
      block.type === 'tool-result' && block.content.some(result =>
        result.type === 'text' && result.text.includes(new TextDecoder().decode(bytes)))))).toBe(true)
    expect(JSON.stringify(state.adapter.requests[3]?.messages)).toContain('path outside workspace')
    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const writeCall = events.find(event => event.type === 'tool/call' && event.data.name === 'write_file')
        if (writeCall?.type !== 'tool/call') throw new Error('uploaded-file write call was not recorded')
        const writeResult = events.find(event => event.type === 'tool/result' && event.data.message.source.kind === 'tool'
          && event.data.message.source.callId === writeCall.data.callId)
        expect(writeResult).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
    await expect(readFile(attachmentPath).then(value => new Uint8Array(value))).resolves.toEqual(bytes)
  } finally {
    if (sibling !== undefined) {
      await sibling.host.stop()
      await rm(sibling.directory, { recursive: true, force: true })
    }
    if (removeCapturedRead !== undefined) await removeCapturedRead()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
    await rm(attachmentDirectory, { recursive: true, force: true })
  }
})

it.each(['initial stat', 'file save', 'final stat'] as const)(
  'rejects an upload when delete and same-header restore replace its generation during %s', async (barrier) => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let saveCalls = 0
    const saved: FileAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), name: 'staged.txt', bytes: 3,
    }
    const attachments: AttachmentOperations = {
      ...imageAttachmentOperations(async image => ({ ref: image, data: new Uint8Array() })),
      async saveFileStream({ data }) {
        for await (const _chunk of data) {}
        saveCalls++
        if (barrier === 'file save' && saveCalls === 2) {
          entered.resolve(undefined)
          await release.promise
        }
        return saved
      },
    }
    const state = await fixture([textResponse('ready')], { attachments, fileReferences: true })
    const id = SessionId(`staged-generation-${barrier.replaceAll(' ', '-')}`)
    const route = brandString<NativeRootRouteId>('root')
    const signal = new AbortController().signal
    let stage: Promise<Awaited<ReturnType<NativeRootExecutionOperations['stagedFiles']['stageStream']>>> | undefined
    let statCalls = 0
    const originalStat = state.persistence.stat.bind(state.persistence)
    try {
      await state.rootExecution.maintenance({ route, id, resume: false }, async () => undefined, signal)
      const retained = await state.rootExecution.stagedFiles.stageStream({ route, id,
        data: (async function* () { yield Uint8Array.of(1, 2, 3) })(), name: 'idle-retained.txt' }, signal)
      await state.rootExecution.maintenance({ route, id, resume: true }, async (owner) => {
        const admission = state.rootExecution.stagedFiles.prepare({ owner, receiptIds: [retained.receiptId], signal,
          createMessage: files => createUserMessage({ source: { kind: 'user' }, content: [...files] }) })
        expect(admission.message.content).toEqual([{ type: 'file', attachment: saved }])
        admission.refused()
      }, signal)
      state.persistence.stat = async (candidate, options) => {
        statCalls++
        const blocked = candidate === id && (barrier === 'initial stat' ? statCalls === 1
          : barrier === 'final stat' && statCalls === 2)
        if (blocked) {
          entered.resolve(undefined)
          await release.promise
        }
        return originalStat(candidate, options)
      }
      async function* upload(): AsyncIterable<Uint8Array> { yield Uint8Array.of(1, 2, 3) }
      stage = state.rootExecution.stagedFiles.stageStream({ route, id, data: upload(), name: saved.name }, signal)
      await entered.promise
      const deletions = state.rootExecution.deletions
      if (deletions === undefined) throw new Error('Session deletion Provider is unavailable')
      const deleted = await deletions.delete({ route, id }, signal)
      await deletions.restore({ route, id: deleted.id }, signal)
      release.resolve(undefined)
      await expect(stage).rejects.toThrow('staged file Session generation changed during upload')
      if (barrier !== 'initial stat') expect(statCalls).toBeGreaterThanOrEqual(2)
    } finally {
      release.resolve(undefined)
      await stage?.catch(() => undefined)
      await state.host.stop()
      await rm(state.directory, { recursive: true, force: true })
    }
  },
)

it('reads deduplicated images only after an external tool result and its settlement are accepted, then drains reads', async () => {
  const first: ImageAttachmentRef = { attachmentId: AttachmentId('captured-image-first'), mediaType: 'image/png', bytes: 2, width: 1, height: 1 }
  const second: ImageAttachmentRef = { attachmentId: AttachmentId('captured-image-second'), mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
  const readEntered = Promise.withResolvers<undefined>()
  const releaseRead = Promise.withResolvers<undefined>()
  let readCount = 0
  const readImage = vi.fn(async (ref: ImageAttachmentRef, _signal?: AbortSignal) => {
    readCount++
    if (readCount === 3) throw new Error('one accepted image read failed')
    if (readCount === 4) {
      readEntered.resolve(undefined)
      await releaseRead.promise
    }
    return { ref, data: new Uint8Array(ref.attachmentId === first.attachmentId ? [1, 2] : [3, 4, 5]) }
  })
  const attachments = imageAttachmentOperations(readImage)
  const state = await fixture([
    toolCallResponse('capture-images', 'capture_images', {}),
    textResponse('captured images'),
  ], { attachments, fileReferences: true })
  let removeImage: (() => Promise<void>) | undefined
  let removeCapture: (() => Promise<void>) | undefined
  let removePolicy: (() => void) | undefined
  let imagesObserved = false
  let captureEntered = false
  let internalFailure: unknown
  try {
    removeImage = state.tools.registerValueTool({
      schema: { name: 'headless_external_images', description: 'Return stored image references.', parameters: {
        type: 'object', properties: { slow: { type: 'boolean' } }, additionalProperties: false,
      } },
      output: { schema: { type: 'string' }, render: (call) => {
        const ref = call.arguments !== null && typeof call.arguments === 'object' && 'slow' in call.arguments
          && call.arguments.slow === true ? second : first
        const context = createUserMessage({ content: [{ type: 'image', attachment: first }],
          source: { kind: 'plugin', plugin: 'native-headless-image-test' } })
        return { content: [{ type: 'image', attachment: ref }, { type: 'tool-result', toolCallId: call.callId,
          content: [{ type: 'image', attachment: first }] }], additionalContexts: [context], isError: false }
      } },
      async execute() { return 'stored images' },
    })
    removePolicy = state.tools.onSettlement(settlement => settlement.name === 'headless_external_images'
      ? [createUserMessage({ content: [{ type: 'image', attachment: second }],
        source: { kind: 'plugin', plugin: 'native-headless-image-policy-test' } })]
      : [], state.scope)
    removeCapture = state.tools.registerValueTool({
      schema: { name: 'capture_images', description: 'Read accepted image results.', parameters: {
        type: 'object', properties: {}, additionalProperties: false,
      } },
      output: { schema: { type: 'string' }, render: (_call, value) => {
        if (typeof value !== 'string') throw new Error('image fixture output must be text')
        return { content: [{ type: 'text', text: value }], isError: false }
      } },
      async execute(call) {
        captureEntered = true
        const sessionExecution = state.sessionExecution
        if (sessionExecution === undefined) throw new Error('sessionExecution is unavailable')
        const operations = await sessionExecution.captureExternalTools(call.agent, call.session, {
          depth: 1, maxDepth: 2, cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 4,
          toolNames: ['headless_external_images'], builtinToolNames: [], programToolNames: [],
        }, call.signal)
        try {
          const invocation = await operations.execute({ callId: ToolCallId('accepted-image-call'),
            name: 'headless_external_images', arguments: {} }, call.signal)
          await expect(invocation.readAcceptedImages()).rejects.toThrow('must be accepted before reading images')
          const accepted = invocation.acceptRecordedResult()
          expect(accepted.settlementContexts).toHaveLength(1)
          const images = await invocation.readAcceptedImages()
          expect(images.map(image => image.ref.attachmentId)).toEqual([first.attachmentId, second.attachmentId])
          expect(images.map(image => [...image.data])).toEqual([[1, 2], [3, 4, 5]])
          expect(readImage.mock.calls.map(([ref]) => ref.attachmentId)).toEqual([first.attachmentId, second.attachmentId])

          const slow = await operations.execute({ callId: ToolCallId('drained-image-call'),
            name: 'headless_external_images', arguments: { slow: true } }, call.signal)
          slow.acceptRecordedResult()
          const pendingRead = slow.readAcceptedImages()
          const rejectedRead = expect(pendingRead).rejects.toThrow()
          await readEntered.promise
          let disposed = false
          const disposal = operations.dispose().then(() => { disposed = true })
          await Promise.resolve()
          expect(disposed).toBe(false)
          releaseRead.resolve(undefined)
          await rejectedRead
          await disposal
          expect(disposed).toBe(true)
          imagesObserved = true
          return 'images drained'
        } catch (error: unknown) {
          internalFailure = error
          throw error
        } finally {
          releaseRead.resolve(undefined)
          await operations.dispose()
        }
      },
    })
    await state.host.run(state.scope, { kind: 'captured-images' }, invocation =>
      state.app.run(['read captured images'], invocation.signal))
    expect(state.adapter.requests).toHaveLength(2)
    expect(state.adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('capture_images')
    expect(captureEntered).toBe(true)
    expect(imagesObserved, String(internalFailure)).toBe(true)
    expect(readImage).toHaveBeenCalledTimes(4)
  } finally {
    releaseRead.resolve(undefined)
    removePolicy?.()
    if (removeCapture !== undefined) await removeCapture()
    if (removeImage !== undefined) await removeImage()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('records real Headless external operations and reconstructs them from a cold JSONL reader', async () => {
  const contextToolName = 'headless_external_context'
  const launchToolName = 'start_external_task'
  const contextToolParameters = { type: 'object', properties: {}, additionalProperties: false } as const
  const launchToolParameters = { type: 'object', properties: {}, additionalProperties: false } as const
  const resultContext = createUserMessage({ content: [{ type: 'text', text: 'tool-owned result context' }],
    source: { kind: 'plugin', plugin: 'native-headless-external-result-test' } })
  const settlementContext = createUserMessage({ content: [{ type: 'text', text: 'policy settlement context' }],
    source: { kind: 'plugin', plugin: 'native-headless-external-settlement-test' } })
  const childRequest = Promise.withResolvers<NativeExternalSubagentRequest>()
  const childSignal = Promise.withResolvers<AbortSignal>()
  const childOutcome = Promise.withResolvers<NativeExternalSubagentOutcome>()
  let childFinished = false
  const finishChild = (outcome: NativeExternalSubagentOutcome): void => {
    if (childFinished) return
    childFinished = true
    childOutcome.resolve(outcome)
  }
  const driver: NativeExternalSubagentDriver = {
    name: 'native-headless-external-fixture', routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    async start(request, signal) {
      childRequest.resolve(request)
      childSignal.resolve(signal)
      return {
        remoteId: 'native-headless-external-fixture-child',
        result: childOutcome.promise,
        async dispose() {
          finishChild({ output: [], stopReason: 'aborted' })
          await childOutcome.promise
        },
      }
    },
  }
  const state = await fixture([
    toolCallResponse('headless-external-launch', launchToolName, {}),
    textResponse('Headless parent completed the external child.'),
  ], { fileReferences: true, allowedTools: [launchToolName, contextToolName], externalSubagentDriver: driver })
  let removeContextTool: (() => Promise<void>) | undefined
  let removeLaunchTool: (() => Promise<void>) | undefined
  let removeSettlementPolicy: (() => void) | undefined
  let launchExecution: NativeToolExecution | undefined
  let contextExecution: NativeToolExecution | undefined
  let rootRun: Promise<unknown> | undefined
  let externalRequest: NativeExternalSubagentRequest | undefined
  let pendingLease: NativeExternalModelAttemptLease | undefined
  let contextRequestBody: ReturnType<typeof serializeNativeExternalJson> | undefined
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  try {
    const subagents = state.subagents
    if (subagents === undefined) throw new Error('NativeSubagent is unavailable in the fixture')
    removeContextTool = state.tools.registerProjectedTool({
      schema: { name: contextToolName, description: 'Return a durable sourced context.', parameters: contextToolParameters },
      output: { schema: { type: 'string' }, render: (_call, value) => {
        if (typeof value !== 'string') throw new Error('external fixture tool output must be text')
        return { content: [{ type: 'text', text: value }], isError: false }
      } },
      async execute(call) {
        contextExecution = call
        return { value: 'captured tool result', additionalContexts: [resultContext] }
      },
    })
    removeSettlementPolicy = state.tools.onSettlement(settlement => settlement.name === contextToolName
      ? [settlementContext] : [], state.scope)
    removeLaunchTool = state.tools.registerValueTool({
      schema: { name: launchToolName, description: 'Run one external child task.', parameters: launchToolParameters },
      output: { schema: { type: 'string' }, render: (_call, value) => {
        if (typeof value !== 'string') throw new Error('external fixture tool output must be text')
        return { content: [{ type: 'text', text: value }], isError: false }
      } },
      async execute(call) {
        launchExecution = call
        const resolved = subagents.resolve({ agent: call.agent, session: call.session, label: 'keyless external fixture',
          prompt: [{ type: 'text', text: 'Run the external fixture task.' }], options: { maxDepth: 1 },
          ...call.delegationContext === undefined ? {} : { delegationContext: call.delegationContext } })
        const result = await subagents.run(resolved, call.signal)
        return result.stopReason === 'completed' ? 'external child completed' : `external child ${result.stopReason}`
      },
    })

    rootRun = state.host.run(state.scope, { kind: 'external-operation-cold-reconstruction' }, invocation =>
      state.app.run(['Start one external child task.'], invocation.signal))
    const started = await Promise.race([
      childRequest.promise.then(request => ({ kind: 'started' as const, request })),
      rootRun.then(() => ({ kind: 'ended' as const })),
    ])
    if (started.kind !== 'started') throw new Error('parent run ended before the external child started')
    externalRequest = started.request
    const request = externalRequest
    const toolSignal = await childSignal.promise
    const model = request.model
    expect(launchExecution?.agent.id).toBe(request.parentSessionId)
    expect(launchExecution?.session.id).toBe(request.parentSessionId)
    expect(launchExecution?.delegationContext).toBeUndefined()
    expect(request).toMatchObject({
      label: 'keyless external fixture', cwd: state.workspace,
      parentSessionId: launchExecution?.session.id, rootSessionId: launchExecution?.session.id,
      parentDepth: 0, maxDepth: 1, limits: { maxSteps: 4 },
      route: { provider: 'mock', model: 'fixture', overrides: {} },
      authority: { programToolNames: [], builtinToolNames: [], approvalRequired: false },
    })
    expect(request.authority.toolNames).toEqual(expect.arrayContaining([launchToolName, contextToolName]))
    expect(request.model.tools.schemas.map(schema => schema.name).sort()).toEqual([contextToolName, launchToolName].sort())
    expect(request.model.tools.programSchemas).toEqual([])
    expect(request.model.tools.promptText).toContain('Use tools.')
    const route = { provider: request.route.provider, model: request.route.model }
    const capturedContextTool = model.tools.schemas.find(tool => tool.name === contextToolName)
    if (capturedContextTool === undefined) throw new Error('captured Native tool schema is missing')
    expect(capturedContextTool.parameters).toEqual(contextToolParameters)
    const modelTools = model.tools.schemas.map((tool) => {
      const parameters = tool.name === contextToolName ? contextToolParameters
        : tool.name === launchToolName ? launchToolParameters : undefined
      if (parameters === undefined) throw new Error(`unexpected fixture tool schema ${tool.name}`)
      return { type: 'function', name: tool.name, description: tool.description, parameters }
    })
    const prompt = request.prompt[0]
    if (request.prompt.length !== 1 || prompt?.type !== 'text') throw new Error('fixture expects one text child prompt')
    const body = (input: readonly NativeExternalJsonValue[], previousResponseId?: string) => serializeNativeExternalJson({
      model: route.model,
      instructions: model.tools.promptText,
      input,
      tools: modelTools,
      ...previousResponseId === undefined ? {} : { previous_response_id: previousResponseId },
    })
    const firstRequestBody = body([{ role: 'user', content: [{ type: 'input_text', text: prompt.text }] }])
    const firstLease = await model.admitModelRequest({ route, requestBody: firstRequestBody })
    pendingLease = firstLease
    const callId = ToolCallId('native-headless-external-context-call')
    const completedWithCall = { type: 'response.completed', response: { id: 'fixture-response-tool-call', output: [
      { type: 'function_call', id: 'fixture-function-call-item', call_id: callId,
        name: contextToolName, arguments: '{}' },
    ] } }
    const grants = await model.recordModelResponse(firstLease, {
      events: [serializeNativeExternalJson(completedWithCall)], completed: serializeNativeExternalJson(completedWithCall),
      toolCalls: [{ callId, name: contextToolName, arguments: {} }],
    }).finally(() => { if (pendingLease === firstLease) pendingLease = undefined })
    const grant = grants[0]
    if (grant === undefined) throw new Error('recorded fixture response did not issue its tool grant')
    const settlement = await model.executeTool(grant, toolSignal)
    expect(contextExecution?.agent.id).toBe(request.parentSessionId)
    expect(contextExecution?.session.id).toBe(request.parentSessionId)
    expect(contextExecution?.delegationContext).toMatchObject({ depth: request.parentDepth + 1,
      maxDepth: request.maxDepth, cwd: request.cwd, provider: request.route.provider, model: request.route.model,
      maxSteps: request.limits.maxSteps, programToolNames: [], builtinToolNames: [],
    })
    expect(contextExecution?.delegationContext?.toolNames).toEqual(expect.arrayContaining([launchToolName, contextToolName]))
    expect(settlement.result.content).toEqual([{ type: 'text', text: 'captured tool result' }])
    expect(settlement.result.additionalContexts).toEqual([resultContext])
    expect(settlement.settlementContexts).toEqual([settlementContext])
    expect(settlement.concludesTurn).toBe(false)

    const contexts = [...settlement.result.additionalContexts ?? [], ...settlement.settlementContexts]
    const contextInput = contexts.map(message => ({ role: 'user', content: message.content.map((block) => {
      switch (block.type) {
        case 'text': return { type: 'input_text', text: block.text }
        default: throw new Error(`fixture context projection requires text, received ${block.type}`)
      }
    }) }))
    const toolOutput = settlement.result.content.map((block) => {
      switch (block.type) {
        case 'text': return block.text
        default: throw new Error(`fixture tool output requires text, received ${block.type}`)
      }
    }).join('\n')
    contextRequestBody = body([
      { type: 'function_call_output', call_id: callId, output: toolOutput },
      ...contextInput,
    ], 'fixture-response-tool-call')
    const contextLease = await model.admitModelRequest({ route, requestBody: contextRequestBody })
    pendingLease = contextLease
    const completedWithContext = { type: 'response.completed', response: { id: 'fixture-response-context', output: [] } }
    await model.recordModelResponse(contextLease, {
      events: [serializeNativeExternalJson(completedWithContext)],
      completed: serializeNativeExternalJson(completedWithContext), toolCalls: [],
    }).finally(() => { if (pendingLease === contextLease) pendingLease = undefined })

    const retryRequestBody = body([{ role: 'user', content: [{ type: 'input_text', text: 'Continue after the accepted context.' }] }],
      'fixture-response-context')
    const failedLease = await model.admitModelRequest({ route, requestBody: retryRequestBody })
    pendingLease = failedLease
    const fixtureTransportError = new Error('fixture transport failed before a response')
    const fixtureTransport = async (): Promise<never> => { throw fixtureTransportError }
    await expect(fixtureTransport()).rejects.toBe(fixtureTransportError)
    await model.recordModelFailure(failedLease, { kind: 'transport', events: [] })
      .finally(() => { if (pendingLease === failedLease) pendingLease = undefined })
    const retryLease = await model.admitModelRequest({ route, requestBody: retryRequestBody })
    pendingLease = retryLease
    const completedAfterRetry = { type: 'response.completed', response: { id: 'fixture-response-final', output: [] } }
    await model.recordModelResponse(retryLease, {
      events: [serializeNativeExternalJson(completedAfterRetry)],
      completed: serializeNativeExternalJson(completedAfterRetry), toolCalls: [],
    }).finally(() => { if (pendingLease === retryLease) pendingLease = undefined })
    finishChild({ output: [{ type: 'text', text: 'External fixture completed.' }], stopReason: 'completed' })
    await rootRun
    await state.host.stop()
    rootRun = undefined

    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const sessions = await storage.list()
      expect(sessions).toHaveLength(1)
      const sessionId = sessions[0]?.header.id
      if (sessionId === undefined) throw new Error('cold Session listing omitted its identity')
      const reader = await storage.open(sessionId, 'read')
      try {
        const events = (await reader.read()).events
        const operationEvents = events.filter(event => event.type === 'subagent/external-operation')
        expect(operationEvents.map(event => event.data.kind)).toEqual([
          'model-request', 'model-response', 'tool-call', 'tool-result', 'tool-settlement',
          'model-request', 'model-response', 'model-request', 'model-failure', 'model-request', 'model-response',
        ])
        const modelRequests = operationEvents.filter(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-request')
        expect(modelRequests.map(event => event.type === 'subagent/external-operation' && event.data.kind === 'model-request'
          ? event.data.sequence : undefined)).toEqual([1, 2, 3, 4])
        const modelTerminals = operationEvents.filter(event => event.type === 'subagent/external-operation'
          && (event.data.kind === 'model-response' || event.data.kind === 'model-failure'))
        expect(modelTerminals.map(event => event.type === 'subagent/external-operation'
          && (event.data.kind === 'model-response' || event.data.kind === 'model-failure')
          ? [event.data.kind, event.data.sequence] : undefined)).toEqual([
          ['model-response', 1], ['model-response', 2], ['model-failure', 3], ['model-response', 4],
        ])
        for (const sequence of [1, 2, 3, 4]) {
          expect(modelTerminals.filter(event => event.type === 'subagent/external-operation'
            && (event.data.kind === 'model-response' || event.data.kind === 'model-failure')
            && event.data.sequence === sequence)).toHaveLength(1)
        }
        const started = events.find(event => event.type === 'subagent/external-start')
        const finished = events.find(event => event.type === 'subagent/external-end')
        if (started?.type !== 'subagent/external-start' || finished?.type !== 'subagent/external-end') {
          throw new Error('cold Session omitted external child lineage')
        }
        expect(finished.data.id).toBe(started.data.id)
        expect(operationEvents.every(event => event.data.id === started.data.id
          && event.data.parentSessionId === sessionId && event.data.rootSessionId === sessionId
          && event.data.parentEpoch === started.data.parentEpoch && event.data.rootEpoch === started.data.rootEpoch)).toBe(true)
        const lifecycleEvents = events.filter(event => event === started || event.type === 'subagent/external-operation' || event === finished)
        expect(lifecycleEvents[0]).toBe(started)
        expect(lifecycleEvents.at(-1)).toBe(finished)
        expect(lifecycleEvents.every((event, index) => index === 0 || event.seq > lifecycleEvents[index - 1]!.seq)).toBe(true)
        expect(operationEvents.filter(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-call'))
          .toHaveLength(1)
        expect(operationEvents.filter(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-result'))
          .toHaveLength(1)
        expect(operationEvents.filter(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-settlement'))
          .toHaveLength(1)
        const recordedToolCall = operationEvents.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-call')
        const recordedToolResult = operationEvents.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-result')
        const recordedSettlement = operationEvents.find(event => event.type === 'subagent/external-operation' && event.data.kind === 'tool-settlement')
        const recordedContextRequest = operationEvents.find(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-request' && event.data.sequence === 2)
        if (recordedToolCall?.type !== 'subagent/external-operation' || recordedToolCall.data.kind !== 'tool-call'
          || recordedToolResult?.type !== 'subagent/external-operation' || recordedToolResult.data.kind !== 'tool-result'
          || recordedSettlement?.type !== 'subagent/external-operation' || recordedSettlement.data.kind !== 'tool-settlement'
          || recordedContextRequest?.type !== 'subagent/external-operation' || recordedContextRequest.data.kind !== 'model-request') {
          throw new Error('cold Session omitted the recorded tool batch or following request')
        }
        expect(recordedToolCall.data).toMatchObject({ modelSequence: 1, callId, name: contextToolName, arguments: {} })
        expect(recordedToolResult.data).toMatchObject({ modelSequence: 1, callId, name: contextToolName,
          arguments: {}, result: settlement.result })
        expect(recordedToolResult.data.result.additionalContexts).toEqual([resultContext])
        expect(recordedSettlement.data).toMatchObject({
          modelSequence: 1, callId, settlementContexts: [settlementContext], concludesTurn: false,
        })
        expect(recordedSettlement.data.settlementContexts.map(message => ({ id: message.id, source: message.source,
          text: message.content.map(block => block.type === 'text' ? block.text : '').join('') }))).toEqual([
          { id: settlementContext.id, source: settlementContext.source, text: 'policy settlement context' },
        ])
        expect(recordedToolResult.data.result.additionalContexts?.map(message => ({ id: message.id, source: message.source,
          text: message.content.map(block => block.type === 'text' ? block.text : '').join('') }))).toEqual([
          { id: resultContext.id, source: resultContext.source, text: 'tool-owned result context' },
        ])
        expect(recordedContextRequest.data.requestBody).toBe(contextRequestBody)
        const parseJson = (serialized: string): NativeExternalJsonValue => {
          const value: unknown = JSON.parse(serialized)
          if (!isNativeExternalJsonValue(value)) throw new Error('cold Session contains invalid serialized model JSON')
          return value
        }
        const record = (value: NativeExternalJsonValue, label: string): Record<string, NativeExternalJsonValue> => {
          if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} is not a JSON object`)
          // Array.isArray rejects readonly JSON arrays at runtime, though TypeScript retains that union arm.
          return value as { readonly [key: string]: NativeExternalJsonValue }
        }
        const recordedFirstRequest = modelRequests.find(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-request' && event.data.sequence === 1)
        const recordedFirstResponse = operationEvents.find(event => event.type === 'subagent/external-operation'
          && event.data.kind === 'model-response' && event.data.sequence === 1)
        if (recordedFirstRequest?.type !== 'subagent/external-operation' || recordedFirstRequest.data.kind !== 'model-request'
          || recordedFirstResponse?.type !== 'subagent/external-operation' || recordedFirstResponse.data.kind !== 'model-response') {
          throw new Error('cold Session omitted the first recorded request or response')
        }
        expect(recordedFirstResponse.data.toolCalls).toEqual([{
          callId: recordedToolCall.data.callId,
          name: recordedToolCall.data.name,
          arguments: recordedToolCall.data.arguments,
        }])
        const initialBody = record(parseJson(recordedFirstRequest.data.requestBody), 'recorded first request')
        const completedResponse = record(parseJson(recordedFirstResponse.data.completed), 'recorded first completion')
        const response = record(completedResponse.response ?? null, 'recorded first response')
        const previousResponseId = response.id
        if (typeof previousResponseId !== 'string') throw new Error('recorded response omitted its identity')
        const coldContexts = [...recordedToolResult.data.result.additionalContexts ?? [], ...recordedSettlement.data.settlementContexts]
        const coldContextInput = coldContexts.map(message => ({ role: 'user', content: message.content.map((block) => {
          switch (block.type) {
            case 'text': return { type: 'input_text', text: block.text }
            default: throw new Error(`cold context projection requires text, received ${block.type}`)
          }
        }) }))
        const coldToolOutput = recordedToolResult.data.result.content.map((block) => {
          switch (block.type) {
            case 'text': return block.text
            default: throw new Error(`cold tool output projection requires text, received ${block.type}`)
          }
        }).join('\n')
        const reconstructedBody = serializeNativeExternalJson({ ...initialBody,
          previous_response_id: previousResponseId,
          input: [{ type: 'function_call_output', call_id: recordedToolCall.data.callId, output: coldToolOutput }, ...coldContextInput],
        })
        expect(recordedContextRequest.data.requestBody).toBe(reconstructedBody)
        const failures = operationEvents.filter(event => event.type === 'subagent/external-operation' && event.data.kind === 'model-failure')
        expect(failures).toHaveLength(1)
        expect(failures[0]?.type === 'subagent/external-operation' && failures[0].data.kind === 'model-failure'
          ? failures[0].data.failure.kind : undefined).toBe('transport')
      } finally { await reader.close() }
    } finally { await storage.close() }
  } catch (error: unknown) {
    primaryFailure = error
    hasPrimaryFailure = true
  }
  const cleanupFailures: unknown[] = []
  const captureCleanup = async (operation: () => unknown): Promise<void> => {
    try { await operation() } catch (error: unknown) { cleanupFailures.push(error) }
  }
  if (externalRequest !== undefined && pendingLease !== undefined) {
    const request = externalRequest
    const lease = pendingLease
    pendingLease = undefined
    await captureCleanup(() => request.model.recordModelFailure(lease, { kind: 'transport', events: [] }))
  }
  finishChild({ output: [], stopReason: 'aborted' })
  await captureCleanup(async () => { await rootRun })
  await captureCleanup(() => { removeSettlementPolicy?.() })
  await captureCleanup(() => removeLaunchTool?.())
  await captureCleanup(() => removeContextTool?.())
  await captureCleanup(() => state.host.stop())
  await captureCleanup(() => rm(state.directory, { recursive: true, force: true }))
  if (hasPrimaryFailure) {
    if (cleanupFailures.length > 0) throw new AggregateError([primaryFailure, ...cleanupFailures], 'external fixture and cleanup failed')
    throw primaryFailure
  }
  if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'external fixture cleanup failed')
})

it('captures resolved builtin tool defaults and explicit route selection', async () => {
  for (const [options, expected] of [[{}, true], [{ ptc: true }, false]] as const) {
    const state = await fixture([], options)
    try {
      expect(state.rootExecution.resolve(brandString<NativeRootRouteId>('root')).configuration.builtinTools).toBe(expected)
    } finally {
      await state.host.stop()
      await rm(state.directory, { recursive: true, force: true })
    }
  }
})

it('prepares root input with the effective default model for a fresh Session', async () => {
  const modelSelection: NativeModelSelectionOperations = {
    async state() { return { lastUsed: null, next: null, revision: null } },
    async select() { throw new Error('unused') },
    async capture(_owner, defaults) { return { config: defaults, requestedConfig: defaults } },
  }
  const state = await fixture([textResponse('Prepared input sent.')], { modelSelection })
  const prepared: { provider: string; model: string }[] = []
  try {
    await state.host.run(state.scope, { kind: 'prepared-model' }, invocation =>
      state.app.executeRootTurn({ id: SessionId('prepared-model'), resume: false,
        prepareMessage: async (model) => {
          prepared.push(model)
          return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Prepared prompt.' }] })
        } }, invocation.signal))

    expect(prepared).toEqual([{ provider: 'mock', model: 'fixture' }])
    expect(state.adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'fixture' })
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('enforces restored output ceilings after selection and issues approval only for the attached owner', async () => {
  let selectedMaxTokens: number | undefined
  const modelSelection: NativeModelSelectionOperations = {
    async state() { return { lastUsed: null, next: null, revision: null } },
    async select() { throw new Error('unused') },
    async capture(_owner, defaults) {
      return { config: defaults, requestedConfig: { ...defaults,
        ...selectedMaxTokens === undefined ? {} : { maxTokens: selectedMaxTokens } } }
    },
  }
  const state = await fixture([textResponse('initial')], { modelSelection })
  const id = SessionId('execution-policy-selected-ceiling')
  const route = brandString<NativeRootRouteId>('root')
  const message = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const signal = new AbortController().signal
  let restored: Awaited<ReturnType<typeof fixture>> | undefined
  let stateStopped = false
  try {
    await state.rootExecution.execute({ route, id, resume: false, message: message('Create the policy Session.') }, signal)
    await state.rootExecution.maintenance({ route, id, resume: true }, async (owner) => {
      owner.append('execution/policy', { version: 1, maxSteps: 4, maxTokens: 64,
        permission: { mode: 'require-approval', authority: 'session-owner' } })
      await owner.flush()
    }, signal)
    await state.host.stop()
    stateStopped = true
    restored = await fixture([
      toolCallResponse('policy-write', 'write_file', { path: 'policy-created.txt', content: 'authorized by owner' }),
      textResponse('write completed'),
      textResponse('fork completed'),
    ], { directory: state.directory, modelSelection })
    const prepared = restored.adapter.prepareCall.bind(restored.adapter)
    vi.spyOn(restored.adapter, 'prepareCall').mockImplementation(async (provider, model, caller) => {
      const captured = await prepared(provider, model, caller)
      return { ...captured, supportsOutputTokenLimit: async () => true }
    })

    await expect(restored.rootExecution.execute({ route, id, resume: true, message: message('No owner proof.') }, signal))
      .rejects.toThrow('accepted Session policy requires a live exact-owner approval capability')
    expect(restored.adapter.requests).toHaveLength(0)

    selectedMaxTokens = 1024
    let issuedOwner: NativeActiveSessionOwner | undefined
    const authorizedCalls: { id: string; callId: string; toolName: string; reason?: string }[] = []
    const issueOwnerApproval = (owner: NativeActiveSessionOwner): NativeSessionOwnerApproval => {
      issuedOwner = owner
      const lifetime = owner.rootOperations?.signal
      if (lifetime === undefined) throw new Error('root owner has no live approval lifetime')
      return { agent: owner.agent, session: owner.session, lifetime, async authorize(request) {
        authorizedCalls.push({ id: request.id, callId: request.callId, toolName: request.toolName,
          ...request.reason === undefined ? {} : { reason: request.reason } })
        return 'allowed-once'
      } }
    }
    await expect(restored.rootExecution.execute({ route, id, resume: true, message: message('Reject selected 1024.'),
      issueOwnerApproval }, signal)).rejects.toThrow('selected model controls exceed the accepted Session output-token ceiling')
    expect(issuedOwner?.session.id).toBe(id)
    expect(issuedOwner?.invocation).toBe('root')
    expect(restored.adapter.requests).toHaveLength(0)

    selectedMaxTokens = 32
    await restored.rootExecution.execute({ route, id, resume: true, message: message('Run within the ceiling.'),
      issueOwnerApproval }, signal)
    expect(restored.adapter.requests).toHaveLength(2)
    expect(restored.adapter.requests.map(request => request.maxTokens)).toEqual([32, 32])
    expect(authorizedCalls[0]?.id).toBeTypeOf('string')
    expect(authorizedCalls).toMatchObject([{
      callId: 'policy-write', toolName: 'write_file', reason: 'Writing a file changes the selected workspace.',
    }])
    expect(await readFile(join(restored.workspace, 'policy-created.txt'), 'utf8')).toBe('authorized by owner')

    const forkId = SessionId('execution-policy-fork')
    await restored.rootExecution.fork({ route, source: id, id: forkId }, signal)
    selectedMaxTokens = 32
    await expect(restored.rootExecution.execute({ route, id: forkId, resume: true, message: message('Reject fork without owner.'),
    }, signal)).rejects.toThrow('accepted Session policy requires a live exact-owner approval capability')
    expect(restored.adapter.requests).toHaveLength(2)
    selectedMaxTokens = 1024
    await expect(restored.rootExecution.execute({ route, id: forkId, resume: true, message: message('Reject fork ceiling.'),
      issueOwnerApproval }, signal)).rejects.toThrow('selected model controls exceed the accepted Session output-token ceiling')
    expect(restored.adapter.requests).toHaveLength(2)
    selectedMaxTokens = 32
    await restored.rootExecution.execute({ route, id: forkId, resume: true, message: message('Run fork within ceiling.'),
      issueOwnerApproval }, signal)
    expect(restored.adapter.requests).toHaveLength(3)
    expect(restored.adapter.requests.at(-1)?.maxTokens).toBe(32)

    const storage = new JsonlSessionBackend({ root: restored.sessions, compression: 'none' })
    try {
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { id: authorizedCalls[0]?.id, toolName: 'write_file', callId: 'policy-write', reason: 'Writing a file changes the selected workspace.' },
        }])
        expect(events.filter(event => event.type === 'native-approval/decided')).toMatchObject([{
          data: { id: authorizedCalls[0]?.id, policy: 'ask', outcome: 'allowed-once' },
        }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    if (restored !== undefined) await restored.host.stop()
    if (!stateStopped) await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('logs the model-visible request and tool result, then resumes the same stored Session', async () => {
  const state = await fixture([
    toolCallResponse('write-1', 'write_file', { path: 'created.txt', content: 'native content' }),
    textResponse('created'),
    textResponse('resumed'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'test' }, invocation => state.app.run(['create', 'the', 'file'], invocation.signal))
    expect(await readFile(join(state.workspace, 'created.txt'), 'utf8')).toBe('native content')
    expect(state.adapter.requests).toHaveLength(2)
    expect(state.adapter.requests[0]?.messages.some(message => message.role === 'user')).toBe(true)
    expect(state.adapter.requests[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const snapshots = await storage.list()
      expect(snapshots).toHaveLength(1)
      const id = snapshots[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      await state.host.run(state.scope, { kind: 'resume' }, invocation => state.app.run(['--resume', id, 'continue'], invocation.signal))
      const reader = await storage.open(SessionId(id), 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.filter(event => event.type === 'request/header')).toHaveLength(2)
        expect(events.filter(event => event.type === 'request/header').at(-1)).toMatchObject({ data: { reason: 'resume' } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it.each([
  { label: 'false', selection: false, expectedBuiltinTools: false },
  { label: 'true', selection: true, expectedBuiltinTools: true },
  { label: 'omitted', selection: undefined, expectedBuiltinTools: true },
])('captures exact delegated Registry authority with builtinTools=$label and drains an accepted builtin call on disposal', async ({ selection, expectedBuiltinTools }) => {
  const runtimeEntered = Promise.withResolvers<undefined>()
  const runtimeAborted = Promise.withResolvers<undefined>()
  const releaseRuntime = Promise.withResolvers<undefined>()
  let runtimeExited = false
  const codeRuntime: NativeCodeRuntime = {
    language: 'typescript', isolation: 'worker-thread',
    async run(request) {
      runtimeEntered.resolve(undefined)
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => { runtimeAborted.resolve(undefined); resolve() }, { once: true })
      })
      await releaseRuntime.promise
      runtimeExited = true
      return { logs: [], error: { kind: 'abort', message: 'cancelled' } }
    },
    async dispose() {},
  }
  const codeRuntimeProvider: NativePlugin = {
    apiVersion: 1, name: 'test-capture-code-runtime', targets: ['host'], requires: [], provides: ['codeRuntime'],
    resolve: () => (context) => {
      context.own(() => codeRuntime.dispose())
      context.provide('codeRuntime', codeRuntime)
    },
  }
  const state = await fixture([
    toolCallResponse('capture-external', 'capture_external', {}),
    toolCallResponse('capture-delegated', 'capture_external', { child: true }),
    textResponse('delegated turn completed'),
    textResponse('external operations drained'),
    toolCallResponse('provider-real-result', 'provider_probe', { mode: 'real' }), textResponse('real Provider completed'),
    toolCallResponse('provider-held-result', 'provider_probe', { mode: 'hold' }),
    toolCallResponse('provider-substitute-result', 'provider_probe', { mode: 'replacement' }),
    textResponse('replacement Provider completed'),
  ], { fileReferences: true, codeRuntimeProvider })
  const calls: NativeToolExecution[] = []
  let childOwnerObserved = false
  let parentInitiator: NativeToolExecution['agent'] | undefined
  let parentSession: NativeToolExecution['session'] | undefined
  const childSessionId = SessionId('native-headless-delegated-child')
  const childCalls: NativeToolExecution[] = []
  let childInitiator: NativeToolExecution['agent'] | undefined
  let childConfiguration: ReturnType<NonNullable<typeof state.sessionExecution>['configuration']> | undefined
  let childAuthority: ReturnType<NonNullable<typeof state.sessionExecution>['delegationAuthority']> | undefined
  let childOwnerFailure: unknown
  let childToolPrepared = false
  let removeEcho: (() => Promise<void>) | undefined
  let removeCapture: (() => Promise<void>) | undefined
  try {
    removeEcho = state.tools.registerValueTool({
      schema: { name: 'headless_external_echo', description: 'Return its value.', parameters: {
        type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
      } },
      output: { schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
        render: (_call, value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }) },
      async execute(call) { calls.push(call); return call.arguments },
    })
    removeCapture = state.tools.registerValueTool({
      schema: { name: 'capture_external', description: 'Exercise the captured Headless tool owner.', parameters: {
        type: 'object', properties: { child: { type: 'boolean' } }, additionalProperties: false,
      } },
      output: { schema: { type: 'string' }, render: (_call, value) => {
        if (typeof value !== 'string') throw new Error('capture tool result must be a string')
        return { content: [{ type: 'text', text: value }], isError: false }
      } },
      async execute(call) {
        if (state.sessionExecution === undefined) throw new Error('sessionExecution is unavailable')
        parentInitiator = state.agents.currentInitiator()
        parentSession = call.session
        if (selection !== undefined && typeof call.arguments === 'object' && call.arguments !== null && 'child' in call.arguments) {
          const config = state.sessionExecution.configuration(call.agent, call.session)
          const authority = state.sessionExecution.delegationAuthority(call.agent, call.session)
          expect(config).toMatchObject({ cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 3,
            builtinTools: expectedBuiltinTools })
          expect([...(authority?.toolNames ?? [])].sort()).toEqual([
            'capture_external', 'headless_external_echo', ...(expectedBuiltinTools ? ['read_file'] : []),
          ])
          expect(authority?.builtinToolNames).toEqual(expectedBuiltinTools ? ['read_file'] : [])
          expect(authority?.programToolNames).toEqual([])
          childOwnerObserved = true
          return 'child owner observed'
        }
        const delegation: NativeToolDelegationContext = Object.freeze({
          depth: 1, maxDepth: 2, cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 3,
          toolNames: Object.freeze(['headless_external_echo', 'run_code']),
          builtinToolNames: Object.freeze(['run_code']),
          programToolNames: Object.freeze([]),
        })
        const operations = await state.sessionExecution.captureExternalTools(call.agent, call.session, delegation, call.signal)
        try {
          expect(operations.schemas.map(schema => schema.name)).toEqual(['run_code', 'headless_external_echo'])
          expect(operations.programSchemas).toEqual([])
          const direct = await operations.execute({ callId: ToolCallId('captured-echo'), name: 'headless_external_echo',
            arguments: { value: 'captured' } }, call.signal)
          expect(direct.result.value).toEqual({ value: 'captured' })
          direct.acceptRecordedResult()
          expect(calls.at(-1)?.delegationContext).toEqual(delegation)

          const builtin = operations.execute({ callId: ToolCallId('captured-code'), name: 'run_code',
            arguments: { program: 'return 42' } }, call.signal)
          const rejectedBuiltin = expect(builtin).rejects.toThrow('native-session-execution: external tool capture disposed')
          await runtimeEntered.promise
          let disposed = false
          const disposal = operations.dispose().then(() => { disposed = true })
          await runtimeAborted.promise
          expect(disposed).toBe(false)
          releaseRuntime.resolve(undefined)
          await disposal
          await rejectedBuiltin
          expect(runtimeExited).toBe(true)
          await state.sessionExecution.delegate(call.agent, call.session, {
            id: childSessionId,
            config: { cwd: state.workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Delegated child.', maxSteps: 3,
              ...(selection === undefined ? {} : { builtinTools: selection }) },
            maxDepth: 2,
            prepare({ agent, own }) {
              if (selection !== undefined) return
              const remove = state.tools.registerValueTool({
                schema: { name: 'capture_external', description: 'Return the child Agent owner.', parameters: {
                  type: 'object', properties: { child: { type: 'boolean' } }, additionalProperties: false,
                } },
                output: { schema: { type: 'string' }, render: (_call, value) => {
                  if (typeof value !== 'string') throw new Error('child tool output must be text')
                  return { content: [{ type: 'text', text: value }], isError: false }
                } },
                async execute(childCall) {
                  childInitiator = state.agents.currentInitiator()
                  childCalls.push(childCall)
                  childOwnerObserved = true
                  try {
                    if (state.sessionExecution === undefined) throw new Error('sessionExecution is unavailable')
                    childConfiguration = state.sessionExecution.configuration(childCall.agent, childCall.session)
                    childAuthority = state.sessionExecution.delegationAuthority(childCall.agent, childCall.session)
                  } catch (error: unknown) { childOwnerFailure = error }
                  return 'delegated child result'
                },
              }, agent.scope)
              own(remove)
              childToolPrepared = true
            },
            message: createUserMessage({ content: [{ type: 'text', text: 'inspect inherited tool grants' }], source: { kind: 'user' } }),
            delegationContext: Object.freeze({
              depth: 0, maxDepth: 2, cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 4,
              toolNames: Object.freeze(['read_file', 'write_file', 'run_code', 'headless_external_echo', 'capture_external']),
              builtinToolNames: Object.freeze(['read_file']),
              programToolNames: Object.freeze([]),
            }),
          }, call.signal)
          return 'drained'
        } finally {
          releaseRuntime.resolve(undefined)
          await operations.dispose()
        }
      },
    })
    await state.host.run(state.scope, { kind: 'external-tool-capture' }, invocation =>
      state.app.run(['capture the external tool owner'], invocation.signal))
    expect(state.adapter.requests).toHaveLength(4)
    expect(childOwnerObserved).toBe(true)
    if (selection === undefined) {
      expect(childToolPrepared).toBe(true)
      expect(state.adapter.requests[1]?.tools?.find(schema => schema.name === 'capture_external')?.description)
        .toBe('Return the child Agent owner.')
      expect(parentInitiator).toBe(calls[0]?.agent)
    }
    expect(state.adapter.requests[0]?.tools?.some(schema => schema.name === 'capture_external')).toBe(true)
    const delegatedTools = state.adapter.requests[1]?.tools?.map(schema => schema.name).sort() ?? []
    expect(delegatedTools).toEqual(['capture_external', 'headless_external_echo', ...(expectedBuiltinTools ? ['read_file'] : [])])
    if (selection === undefined) {
      expect(childCalls).toHaveLength(1)
      const childCall = childCalls[0]
      if (childCall === undefined || state.sessionExecution === undefined) throw new Error('delegated tool call was not captured')
      expect(childInitiator).toBe(childCall.agent)
      expect(childCall.agent.id).toBe(NativeAgentId(childSessionId))
      expect(childCall.session.id).toBe(childSessionId)
      expect(childCall.session).not.toBe(parentSession)
      expect(childCall.callId).toBe(ToolCallId('capture-delegated'))
      expect(childOwnerFailure).toBeUndefined()
      expect(childConfiguration).toMatchObject({
        cwd: state.workspace, provider: 'mock', model: 'fixture', maxSteps: 3,
        builtinTools: expectedBuiltinTools,
      })
      expect([...(childAuthority?.toolNames ?? [])].sort()).toEqual([
        'capture_external', 'headless_external_echo', ...(expectedBuiltinTools ? ['read_file'] : []),
      ])
      expect(childAuthority?.builtinToolNames).toEqual(expectedBuiltinTools ? ['read_file'] : [])
      expect(childCall.delegationContext).toMatchObject({ depth: 1, maxDepth: 2 })
      expect(childCall.delegationContext?.toolNames).toEqual([
        'read_file', 'write_file', 'run_code', 'headless_external_echo', 'capture_external',
      ])
    }
    const modelToolOutput = (callId: string): string => {
      const result = state.adapter.requests.flatMap(request => request.messages).flatMap(message => message.content)
        .find(block => block.type === 'tool-result' && block.toolCallId === ToolCallId(callId))
      if (result?.type !== 'tool-result') throw new Error(`missing model-visible result for ${callId}`)
      const output = result.content.find(block => block.type === 'text')
      if (output?.type !== 'text') throw new Error(`missing text output for ${callId}`)
      return output.text
    }
    if (selection === undefined) expect(modelToolOutput('capture-delegated')).toBe('delegated child result')

    if (selection === undefined) {
      const oldTools = state.tools
      const capturedOldExecute = oldTools.execute.bind(oldTools)
      const providerProbeSchema = { name: 'provider_probe', description: 'Return the current tools Provider.', parameters: {
        type: 'object', properties: { mode: { type: 'string', enum: ['real', 'hold', 'replacement'] } },
        required: ['mode'], additionalProperties: false,
      } }
      const providerProbeOutput = { schema: { type: 'string' as const }, render: (_call: NativeToolExecution, value: import('@deepseek-ai/dsh-util-values').JsonValue) => {
        if (typeof value !== 'string') throw new Error('Provider probe output must be text')
        return { content: [{ type: 'text' as const, text: value }], isError: false }
      } }
      const heldEntered = Promise.withResolvers<undefined>()
      const heldAborted = Promise.withResolvers<undefined>()
      const releaseHeld = Promise.withResolvers<undefined>()
      const cleanupEntered = Promise.withResolvers<undefined>()
      const releaseCleanup = Promise.withResolvers<undefined>()
      let heldBodySettled = false
      let oldResourcesCleaned = false
      let replacementActive = false
      let oldExecutionCalls = 0
      let replacementExecutionCalls = 0
      let replacementRegistry: NativeToolRegistry | undefined
      const removeProbe = oldTools.registerValueTool({
        schema: providerProbeSchema,
        output: providerProbeOutput,
        async execute(call) {
          oldExecutionCalls += 1
          const mode = (call.arguments as { mode: string }).mode
          if (mode === 'hold') {
            heldEntered.resolve(undefined)
            await new Promise<void>((resolve) => {
              if (call.signal.aborted) { heldAborted.resolve(undefined); resolve() }
              else call.signal.addEventListener('abort', () => { heldAborted.resolve(undefined); resolve() }, { once: true })
            })
            await releaseHeld.promise
            heldBodySettled = true
            return 'old Provider drained'
          }
          return 'real Provider'
        },
      })
      const clearOldTools = oldTools.clear.bind(oldTools)
      oldTools.clear = async () => {
        await clearOldTools()
        oldResourcesCleaned = true
        cleanupEntered.resolve(undefined)
        await releaseCleanup.promise
      }
      const substituteToolsProvider: NativePlugin = {
        apiVersion: 1, name: 'test-substitute-native-tools', targets: ['host'], requires: ['agents'], provides: ['tools'],
        resolve: () => (context) => {
          expect(oldResourcesCleaned).toBe(true)
          expect(oldTools.schemas()).toEqual([])
          expect(() => oldTools.register({ schema: providerProbeSchema,
            execute: async () => ({ content: [], isError: false }) })).toThrow('native-tools: registry is disposed')
          const registry = new NativeToolRegistry(context.require('agents'), context.scope)
          context.own(() => registry.clear())
          context.effect(registry.registerValueTool({ schema: providerProbeSchema, output: providerProbeOutput,
            async execute() { replacementExecutionCalls += 1; return 'replacement Provider' } }))
          replacementRegistry = registry
          replacementActive = true
          context.provide('tools', registry)
        },
      }
      let inFlightOutcome: { status: 'fulfilled' } | { status: 'rejected'; reason: unknown } | undefined
      let replacementSettled = false
      let inFlight: Promise<void> | undefined
      let replacing: Promise<void> | undefined
      let unregisterCapturedAgent: (() => Promise<void>) | undefined
      try {
        await state.host.run(state.scope, { kind: 'real-tools-provider' }, invocation =>
          state.app.run(['call the tools Provider'], invocation.signal))
        expect(modelToolOutput('provider-real-result')).toBe('real Provider')
        inFlight = state.host.run(state.scope, { kind: 'held-tools-provider' }, invocation =>
          state.app.run(['hold the tools Provider'], invocation.signal)).then(
          () => { inFlightOutcome = { status: 'fulfilled' } },
          (reason: unknown) => { inFlightOutcome = { status: 'rejected', reason } },
        )
        await heldEntered.promise
        replacing = state.replaceToolsProvider(substituteToolsProvider).then(() => { replacementSettled = true })
        await heldAborted.promise
        await new Promise<void>(resolve => setImmediate(resolve))
        expect(replacementSettled).toBe(false)
        expect(replacementActive).toBe(false)
        expect(state.tools).toBe(oldTools)
        expect(oldTools.schemas().some(schema => schema.name === 'provider_probe')).toBe(true)
        releaseHeld.resolve(undefined)
        await cleanupEntered.promise
        expect(heldBodySettled).toBe(true)
        expect(oldTools.schemas()).toEqual([])
        expect(state.tools).toBe(oldTools)
        await new Promise<void>(resolve => setImmediate(resolve))
        expect(replacementSettled).toBe(false)
        expect(replacementActive).toBe(false)
        releaseCleanup.resolve(undefined)
        await replacing
        await inFlight
        expect(inFlightOutcome).toMatchObject({ status: 'rejected' })
        const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
        try {
          let heldResult: SessionEvent | undefined
          for (const snapshot of await storage.list()) {
            const reader = await storage.open(SessionId(snapshot.header.id), 'read')
            try {
              heldResult ??= (await reader.read()).events.find(event => event.type === 'tool/result'
                && event.data.message.source.kind === 'tool'
                && event.data.message.source.callId === ToolCallId('provider-held-result'))
            } finally { await reader.close() }
          }
          expect(heldResult).toMatchObject({
            type: 'tool/result',
            data: {
              error: { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' },
              message: { content: [{ type: 'tool-result', toolCallId: ToolCallId('provider-held-result'), isError: true }] },
            },
          })
        } finally { await storage.close() }
        expect(state.tools).toBe(replacementRegistry)
        expect(oldTools.schemas()).toEqual([])
        const capturedAgent: NativeAgent = { id: NativeAgentId('captured-old-tools-agent'), scope: state.scope }
        unregisterCapturedAgent = state.agents.register(capturedAgent)
        const capturedSessionId = SessionId('captured-old-tools-session')
        const capturedSession = Session.create(capturedSessionId, undefined, {
          version: SESSION_FORMAT_VERSION, id: capturedSessionId, createdAt: 1, cwd: state.workspace, isSeeded: false,
        })
        const signal = new AbortController().signal
        expect(signal.aborted).toBe(false)
        await expect(capturedOldExecute({
          agent: capturedAgent, callId: ToolCallId('captured-old-tools-call'), name: 'provider_probe', arguments: { mode: 'real' },
          session: capturedSession, signal,
          appendEvent: async (type, data, ...opts) => capturedSession.append(type, data, ...opts),
        })).rejects.toThrow('native-tools: unknown tool provider_probe')
        expect(oldExecutionCalls).toBe(2)
        expect(replacementExecutionCalls).toBe(0)
        await unregisterCapturedAgent()
        unregisterCapturedAgent = undefined
        await state.host.run(state.scope, { kind: 'replacement-tools-provider' }, invocation =>
          state.app.run(['call the replacement tools Provider'], invocation.signal))
        expect(modelToolOutput('provider-substitute-result')).toBe('replacement Provider')
        expect(replacementExecutionCalls).toBe(1)
      } finally {
        releaseHeld.resolve(undefined)
        releaseCleanup.resolve(undefined)
        await Promise.allSettled([inFlight, replacing].filter((work): work is Promise<void> => work !== undefined))
        if (unregisterCapturedAgent !== undefined) await unregisterCapturedAgent()
        await removeProbe()
      }
    }
  } finally {
    releaseRuntime.resolve(undefined)
    if (removeCapture !== undefined) await removeCapture()
    if (removeEcho !== undefined) await removeEcho()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('passes the prepared generation through real PTC subagent work and drains it on parent cancellation', async () => {
  const nestedForwardEntered = Promise.withResolvers<undefined>()
  const releaseNestedForward = Promise.withResolvers<undefined>()
  const nestedDisposeStarted = Promise.withResolvers<undefined>()
  const lifecycle: string[] = []
  const externalRequests: NativeExternalSubagentRequest[] = []
  const preparedGenerations: number[] = []
  const forwardedOperations: number[] = []
  const consumedResponseBodies: number[] = []
  const captures: { readonly generation: number; readonly transport: NativeResponsesTransport }[] = []
  let prepareCount = 0

  const driver: NativeExternalSubagentDriver = {
    name: 'native-headless-ptc-generation-fixture', modelProtocol: 'responses', routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    async start(request, signal) {
      const operation = externalRequests.push(request)
      const run = async (): Promise<NativeExternalSubagentOutcome> => {
        const responses = request.responses
        if (responses === undefined) throw new Error('Responses fixture requires the captured operation transport')
        if (operation === 1) {
          expect(request.model.tools.schemas.map(schema => schema.name)).toContain('run_code')
          expect(request.model.tools.programSchemas.map(schema => schema.name)).toContain('subagent')
        }
        const route = { provider: request.route.provider, model: request.route.model }
        const projected = await responses.projectRequest({ model: route.model, input: [] }, signal)
        const requestBody = serializeNativeExternalJson(projected)
        const lease = await request.model.admitModelRequest({ route, requestBody })
        if (operation === 2) {
          try {
            await responses.forward(projected, signal)
          } catch (error: unknown) {
            if (!signal.aborted) throw error
            await request.model.recordModelFailure(lease, { kind: 'transport', events: [] })
            return { output: [], stopReason: 'aborted' }
          }
          throw new Error('nested Responses forward unexpectedly completed without parent cancellation')
        }
        const forwarded = await responses.forward(projected, signal)
        forwardedOperations.push(operation)
        if (forwarded.body === null) throw new Error('outer Responses transport returned no body')
        const responseValue: unknown = JSON.parse(await new Response(forwarded.body).text())
        if (!isNativeExternalJsonValue(responseValue) || !isNativeExternalJsonRecord(responseValue)) {
          throw new Error('outer Responses transport returned a non-object body')
        }
        const returnedResponse = responseValue
        if (!('output' in returnedResponse)) throw new Error('outer Responses body omitted its output')
        const output = returnedResponse.output
        if (!isNativeExternalJsonArray(output) || output.length !== 1) throw new Error('outer Responses body did not contain one function call')
        const functionCall = output[0]
        if (functionCall === undefined || !isNativeExternalJsonRecord(functionCall)) {
          throw new Error('outer Responses body contained a malformed function call')
        }
        if (functionCall.type !== 'function_call' || functionCall.name !== 'run_code'
          || typeof functionCall.call_id !== 'string' || typeof functionCall.arguments !== 'string') {
          throw new Error('outer Responses body contained an unexpected function call')
        }
        const parsedArguments: unknown = JSON.parse(functionCall.arguments)
        if (!isNativeExternalJsonValue(parsedArguments) || !isNativeExternalJsonRecord(parsedArguments)) {
          throw new Error('run_code arguments were not an object')
        }
        const code = parsedArguments.code
        const description = parsedArguments.description
        if (typeof code !== 'string' || typeof description !== 'string') throw new Error('run_code arguments did not match its schema')
        const callId = ToolCallId(functionCall.call_id)
        const argumentsValue = { code, description }
        const serialized = serializeNativeExternalJson({ type: 'response.completed', response: returnedResponse })
        consumedResponseBodies.push(operation)
        const grants = await request.model.recordModelResponse(lease, {
          events: [serialized], completed: serialized,
          toolCalls: [{ callId, name: 'run_code', arguments: argumentsValue }],
        })
        const grant = grants[0]
        if (grant === undefined) throw new Error('outer Responses response did not issue its run_code grant')
        try {
          await request.model.executeTool(grant, signal)
          return { output: [], stopReason: signal.aborted ? 'aborted' : 'completed' }
        } catch (error: unknown) {
          if (!signal.aborted) throw error
          return { output: [], stopReason: 'aborted' }
        }
      }
      const result = Promise.resolve().then(run)
      // Native observes the same result after the readiness handshake; this handles an earlier rejection.
      void result.catch(() => {})
      return {
        remoteId: `native-ptc-generation-${operation}`,
        result,
        async dispose() {
          lifecycle.push(`product-dispose-start:${operation}`)
          if (operation === 2) nestedDisposeStarted.resolve(undefined)
          await result.then(() => undefined, () => undefined)
          lifecycle.push(`product-dispose-end:${operation}`)
        },
      }
    },
  }

  const state = await fixture([
    toolCallResponse('native-root-subagent', 'subagent', {
      description: 'outer Responses child', prompt: 'Run the nested delegated task.',
    }),
  ], { ptc: true, toolSubagent: true, externalSubagentDriver: driver })
  const parentAbort = new AbortController()
  const parentAbortReason = new Error('native-headless PTC parent cancelled')
  const prepareCall = state.adapter.prepareCall.bind(state.adapter)
  const prepareSpy = vi.spyOn(state.adapter, 'prepareCall').mockImplementation(async (provider, model, signal) => {
    prepareCount += 1
    const generation = prepareCount
    const prepared = await prepareCall(provider, model, signal)
    const nativeResponses: NativeResponsesGenerationCapture = {
      async capture(request, captureSignal) {
        captureSignal.throwIfAborted()
        preparedGenerations.push(generation)
        const index = captures.length + 1
        const transport: NativeResponsesTransport = {
          route: request.route,
          outputTokenLimit: 'supported',
          async projectRequest(body, operationSignal) {
            operationSignal.throwIfAborted()
            return body
          },
          async forward(_body, operationSignal) {
            operationSignal.throwIfAborted()
            if (index === 2) {
              nestedForwardEntered.resolve(undefined)
              // Keep this already accepted call pending until the test releases the provider operation.
              await releaseNestedForward.promise
            }
            const responseBody = index === 1 ? {
              id: 'native-ptc-outer-response',
              output: [{
                type: 'function_call', call_id: 'native-ptc-run-code', name: 'run_code',
                arguments: JSON.stringify({
                  code: "return await tools.subagent({ description: 'nested captured child', prompt: 'Continue the task.' })",
                  description: 'Delegate the nested task',
                }),
              }],
            } : { id: 'native-ptc-nested-response', output: [] }
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(responseBody)))
                controller.close()
              },
            })
            return { status: 200, contentType: 'application/json', body }
          },
          async close() { lifecycle.push(`transport-close:${index}`) },
        }
        captures.push({ generation, transport })
        return transport
      },
    }
    return { ...prepared, nativeResponses }
  })
  let rootSettled = false
  const rootRun = state.host.run(state.scope, { kind: 'native-ptc-generation-cancel' }, invocation =>
    state.app.run(['Delegate the nested task.'], AbortSignal.any([invocation.signal, parentAbort.signal])))
    .finally(() => { rootSettled = true })
  const rootOutcome = rootRun.then(
    value => ({ kind: 'resolved' as const, value }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  )

  try {
    const nestedStart = await Promise.race([
      nestedForwardEntered.promise.then(() => 'nested-forward-entered' as const),
      rootOutcome.then(() => 'root-ended-early' as const),
    ])
    expect(nestedStart).toBe('nested-forward-entered')
    expect(state.adapter.requests[0]?.tools?.map(schema => schema.name)).toEqual(expect.arrayContaining(['subagent', 'run_code']))
    expect(externalRequests).toHaveLength(2)
    expect(captures).toHaveLength(2)
    expect(preparedGenerations).toEqual([1, 1])
    expect(prepareCount).toBe(1)
    expect(externalRequests.map(request => request.responses?.route)).toEqual([
      { provider: 'mock', model: 'fixture' }, { provider: 'mock', model: 'fixture' },
    ])
    expect(forwardedOperations).toEqual([1])
    expect(consumedResponseBodies).toEqual([1])

    parentAbort.abort(parentAbortReason)
    const disposing = await Promise.race([
      nestedDisposeStarted.promise.then(() => 'nested-dispose-started' as const),
      rootOutcome.then(() => 'root-ended-before-nested-dispose' as const),
    ])
    expect(disposing).toBe('nested-dispose-started')
    expect(rootSettled).toBe(false)
    expect(lifecycle).not.toContain('transport-close:2')

    releaseNestedForward.resolve(undefined)
    const outcome = await rootOutcome
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind !== 'rejected') throw new Error('parent cancellation unexpectedly completed the root turn')
    expect(outcome.error).toBe(parentAbortReason)
    for (const operation of [1, 2]) {
      expect(lifecycle.indexOf(`product-dispose-end:${operation}`)).toBeGreaterThanOrEqual(0)
      expect(lifecycle.indexOf(`product-dispose-end:${operation}`)).toBeLessThan(lifecycle.indexOf(`transport-close:${operation}`))
    }
    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const sessions = await storage.list()
      expect(sessions).toHaveLength(1)
      const sessionId = sessions[0]?.header.id
      if (sessionId === undefined) throw new Error('cold Session listing omitted its identity')
      const reader = await storage.open(sessionId, 'read')
      try {
        const events = (await reader.read()).events
        const starts = events.filter(event => event.type === 'tool/ptc-dispatch-start')
        const settlements = events.filter(event => event.type === 'tool/ptc-dispatch')
        const externalStarts = events.filter(event => event.type === 'subagent/external-start')
        const externalEnds = events.filter(event => event.type === 'subagent/external-end')
        expect(starts).toHaveLength(1)
        expect(settlements).toHaveLength(starts.length)
        expect(settlements.map(event => event.data.subCallId)).toEqual(starts.map(event => event.data.subCallId))
        expect(settlements.every(event => event.data.isError)).toBe(true)
        expect(externalStarts).toHaveLength(2)
        expect(externalEnds).toHaveLength(externalStarts.length)
        expect(externalEnds.every(event => event.data.stopReason === 'aborted')).toBe(true)
        expect(externalEnds.map(event => event.data.id).sort()).toEqual(externalStarts.map(event => event.data.id).sort())
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    if (!parentAbort.signal.aborted) parentAbort.abort(parentAbortReason)
    releaseNestedForward.resolve(undefined)
    await rootOutcome
    prepareSpy.mockRestore()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('applies the Session allowlist to Native file-reference guidance in model requests and durable prompts', async () => {
  const state = await fixture([textResponse('File-reference request completed.')], { fileReferences: true, allowedTools: [] })
  try {
    await import('node:fs/promises').then(fs => fs.writeFile(join(state.workspace, 'README.md'), 'workspace facts'))
    await state.host.run(state.scope, { kind: 'file-reference-profile' }, invocation =>
      state.app.run(['Inspect @README.md.'], invocation.signal))

    const request = state.adapter.requests[0]
    expect(state.tools.modelSchemas(state.scope).some(schema => schema.name === 'read')).toBe(true)
    expect(request?.tools?.some(schema => schema.name === 'read')).toBe(false)
    expect(request?.messages.some(message => message.role === 'system'
      && message.content.some(block => block.type === 'text' && block.text.includes(FILE_REFERENCE_PROMPT)))).toBe(false)
    expect(request?.messages.some(message => message.role === 'user'
      && message.content.some(block => block.type === 'text' && block.text.includes('@README.md')))).toBe(true)

    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing file-reference Session id')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.some(event => event.type === 'system/message'
          && event.data.message.content.some(block => block.type === 'text' && block.text.includes(FILE_REFERENCE_PROMPT)))).toBe(false)
        expect(events.some(event => event.type === 'user/message'
          && event.data.content.some(block => block.type === 'text' && block.text.includes('@README.md')))).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('rejects prompt-mismatched admissions before persisting resume or fork facts', async () => {
  const original = await fixture([textResponse('Source Session ready.')], { fileReferences: true, allowedTools: [] })
  let activeHost: (typeof original)['host'] | undefined = original.host
  try {
    await original.host.run(original.scope, { kind: 'file-reference-source' }, invocation =>
      original.app.run(['Keep this source Session.'], invocation.signal))
    await original.host.stop()
    activeHost = undefined

    const storage = new JsonlSessionBackend({ root: original.sessions, compression: 'none' })
    let source: ReturnType<typeof SessionId> | undefined
    let interruptedEvents: readonly import('@deepseek-ai/dsh-session/native').SessionEvent[] = []
    try {
      const row = (await storage.list())[0]
      if (row === undefined) throw new Error('missing fork source Session')
      source = row.header.id
      const writer = await storage.open(source, 'write')
      try {
        const events = (await writer.read()).events
        const lastTurn = events.findLast(event => event.type === 'turn/end')
        if (lastTurn?.type !== 'turn/end') throw new Error('source Session has no closed turn')
        const lastSeq = events.at(-1)?.seq
        if (lastSeq === undefined) throw new Error('source Session has no stored events')
        await writer.append([{ type: 'turn/start', seq: SessionSeq(lastSeq + 1), time: Date.now(), data: { turn: lastTurn.data.turn + 1 } }])
        interruptedEvents = (await writer.read()).events
      } finally { await writer.close() }
    } finally { await storage.close() }
    if (source === undefined) throw new Error('missing fork source identity')

    const changed = await fixture([textResponse('Must not reach the model.')], {
      directory: original.directory, fileReferences: true, allowedTools: ['read'],
    })
    activeHost = changed.host
    try {
      const route = brandString<NativeRootRouteId>('root')
      const signal = new AbortController().signal
      const fork = SessionId('prompt-mismatch-fork')
      await expect(changed.rootExecution.fork({ route, source, id: fork }, signal))
        .rejects.toThrow('native-headless: fork source systemPrompt differs from profile configuration')
      const verifyFork = new JsonlSessionBackend({ root: original.sessions, compression: 'none' })
      try { expect((await verifyFork.list()).map(row => row.header.id)).toEqual([source]) }
      finally { await verifyFork.close() }

      await expect(changed.rootExecution.execute({ route, id: source, resume: true, rootOrigin: 'scheduled' }, signal))
        .rejects.toThrow('native-headless: resumed Session systemPrompt differs from profile configuration')
      const verify = new JsonlSessionBackend({ root: original.sessions, compression: 'none' })
      try {
        const reader = await verify.open(source, 'read')
        try {
          const events = (await reader.read()).events
          expect(events).toEqual(interruptedEvents)
          expect(events.some(event => event.type === 'session/root-origin')).toBe(false)
        } finally { await reader.close() }
        expect((await verify.list()).map(row => row.header.id)).toEqual([source])
      } finally { await verify.close() }
      expect(changed.adapter.requests).toHaveLength(0)
    } finally {
      const host = activeHost
      activeHost = undefined
      await host?.stop()
    }
  } finally {
    await activeHost?.stop()
    await rm(original.directory, { recursive: true, force: true })
  }
})
it('waits for an admitted model stream and persists the cancelled turn before shutdown', async () => {
  const entered = Promise.withResolvers<boolean>()
  const aborted = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  const state = await fixture(['hang'])
  const model = state.adapter
  model.stream = async function* (options) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'partial' }
    await new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        aborted.resolve(true)
        void release.promise.then(() => { reject(new Error('stream stopped')) })
      }, { once: true })
      entered.resolve(true)
    })
  }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-test' }, invocation => state.app.run(['cancel', 'me'], invocation.signal))
    await entered.promise
    let stopped = false
    const stopping = state.host.stop().then(() => { stopped = true })
    await aborted.promise
    expect(stopped).toBe(false)
    release.resolve(true)
    await expect(running).rejects.toThrow()
    await stopping
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('cancelled Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
        expect(events.some(event => event.type === 'assistant/attempt')).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(true)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('repairs a persisted tool call when shutdown interrupts the file write', async () => {
  const state = await fixture([toolCallResponse('write-1', 'write_file', { path: 'interrupted.txt', content: 'uncommitted' })])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  state.filesystem.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-write' }, invocation => state.app.run(['create', 'a', 'file'], invocation.signal))
    await entered.promise
    const stopping = state.host.stop()
    release.resolve(undefined)
    await expect(running).rejects.toThrow()
    await stopping
    await expect(readFile(join(state.workspace, 'interrupted.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('interrupted Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(undefined)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('supports empty writes, denies paths outside the workspace, and records both tool outcomes', async () => {
  const state = await fixture([
    toolCallResponse('empty', 'write_file', { path: 'empty.txt', content: '' }),
    toolCallResponse('outside', 'write_file', { path: '../outside.txt', content: 'denied' }),
    textResponse('done'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'tools' }, invocation => state.app.run(['check', 'tools'], invocation.signal))
    expect(await readFile(join(state.workspace, 'empty.txt'), 'utf8')).toBe('')
    await expect(readFile(join(state.directory, 'outside.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state.adapter.requests[2]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results[0]?.type === 'tool/result' && results[0].data.message.content[0]?.type === 'tool-result' && results[0].data.message.content[0].isError).toBe(false)
        expect(results[1]).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('keeps SDK child writes inside the parent-authorized workspace root even with fs-local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-headless-write-root-'))
  const workspace = join(directory, 'work')
  const writeRoot = join(workspace, 'authorized')
  await import('node:fs/promises').then(fs => fs.mkdir(writeRoot, { recursive: true }))
  const state = await fixture([
    toolCallResponse('inside', 'write_file', { path: 'authorized/child.txt', content: 'allowed' }),
    toolCallResponse('outside', 'write_file', { path: 'denied.txt', content: 'blocked' }),
    textResponse('done'),
  ], { directory, workspaceWriteRoot: writeRoot })
  try {
    await state.host.run(state.scope, { kind: 'child-write-fence' }, invocation => state.app.run(['write under parent grant'], invocation.signal))
    expect(await readFile(join(writeRoot, 'child.txt'), 'utf8')).toBe('allowed')
    await expect(readFile(join(workspace, 'denied.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing fenced Session id')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results[1]).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('projects a bounded worker-thread code result through the Session tool sequence', async () => {
  const state = await fixture([
    toolCallResponse('code-1', 'run_code', { program: 'console.log("native code"); return { total: 6 * 7 }' }),
    textResponse('code completed'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'code-runtime' }, invocation => state.app.run(['calculate'], invocation.signal))
    expect(state.adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('run_code')
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('code Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const result = (await reader.read()).events.find(event => event.type === 'tool/result')
        expect(result).toMatchObject({ data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: '{"logs":["native code"],"value":{"total":42}}' }] }] } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it.each([false, true])('passes the current Session to builtin/PTC code runtime and rejects restricted worker execution (PTC %s)', async (ptc) => {
  const requests: NativeCodeRunRequest[] = []
  const initialRuntime: NativeCodeRuntime = {
    language: 'typescript', isolation: 'worker-thread',
    run: async (request) => { requests.push(request); return { logs: [], value: 42 } },
    dispose: async () => {},
  }
  const initialProvider: NativePlugin = {
    apiVersion: 1, name: 'test-code-runtime', targets: ['host'], requires: [], provides: ['codeRuntime'],
    resolve: () => (context) => {
      context.own(() => initialRuntime.dispose())
      context.provide('codeRuntime', initialRuntime)
    },
  }
  const args = ptc ? { code: 'return 6 * 7', description: 'Calculate six times seven.' } : { program: 'return 6 * 7' }
  const waitingProgram = ptc ? 'await tools.headless_in_flight({}); return 0' : 'while (true) {}'
  const waitingArgs = ptc ? { code: waitingProgram, description: 'Wait for the in-flight call to be cancelled.' }
    : { program: waitingProgram }
  const safe = await fixture([
    toolCallResponse('code-safe', 'run_code', args), textResponse('calculation complete'),
    toolCallResponse('code-in-flight', 'run_code', waitingArgs),
    toolCallResponse('code-after-replacement', 'run_code', args), textResponse('replacement calculation complete'),
  ], { ptc, ...ptc ? { allowedTools: ['run_code', 'headless_in_flight'] } : { codeRuntimeProvider: initialProvider } })
  let removeBusiness: (() => Promise<void>) | undefined
  let removeInFlightTool: (() => Promise<void>) | undefined
  const handoff: string[] = []
  const inFlightToolEntered = Promise.withResolvers<undefined>()
  const inFlightRuntimeResult = Promise.withResolvers<Awaited<ReturnType<NativeCodeRuntime['run']>>>()
  const cleanupEntered = Promise.withResolvers<undefined>()
  const releaseCleanup = Promise.withResolvers<undefined>()
  try {
    const previousRuntime = safe.codeRuntime
    if (previousRuntime === undefined) throw new Error('missing production code-runtime Provider')
    let staleRequest: NativeCodeRunRequest | undefined
    let oldRuntimeDisposedAtActivation = false
    if (ptc) {
      const realRun = previousRuntime.run.bind(previousRuntime)
      previousRuntime.run = async (request) => {
        requests.push(request)
        if (request.program === waitingProgram) handoff.push('old runtime entered')
        const result = await realRun(request)
        if (request.program === waitingProgram) {
          handoff.push('old runtime settled')
          inFlightRuntimeResult.resolve(result)
        }
        return result
      }
      const realDispose = previousRuntime.dispose.bind(previousRuntime)
      previousRuntime.dispose = async () => {
        handoff.push('old cleanup entered')
        await realDispose()
        cleanupEntered.resolve(undefined)
        await releaseCleanup.promise
        handoff.push('old cleanup completed')
      }
    }
    if (ptc) {
      removeInFlightTool = safe.tools.registerValueTool({
        schema: { name: 'headless_in_flight', description: 'Hold a code-runtime call until its signal aborts.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } },
        output: { schema: { type: 'string' }, render: (_call, value) => {
          if (typeof value !== 'string') throw new Error('in-flight fixture output must be text')
          return { content: [{ type: 'text', text: value }], isError: false }
        } },
        async execute(call) {
          handoff.push('old bound work entered')
          inFlightToolEntered.resolve(undefined)
          await new Promise<void>((resolve) => {
            if (call.signal.aborted) resolve()
            else call.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          handoff.push('old bound work settled')
          return 'cancelled'
        },
      }, safe.scope)
      removeBusiness = safe.tools.registerValueTool({
        schema: { name: 'headless_unallowed_business', description: 'Return an unallowed fixture value.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } },
        output: { schema: { type: 'string' }, render: (_call, value) => {
          if (typeof value !== 'string') throw new Error('fixture business tool output must be text')
          return { content: [{ type: 'text', text: value }], isError: false }
        } },
        async execute() { return 'hidden' },
      }, safe.scope)
      expect(safe.tools.sdkSchemas(safe.scope).map(schema => schema.name)).toContain('headless_unallowed_business')
    }
    await safe.host.run(safe.scope, { kind: 'code-runtime-session' }, invocation => safe.app.run(['calculate'], invocation.signal))
    expect(requests).toHaveLength(1)
    if (ptc) expect(requests[0]?.bindings.flatMap(binding => Object.keys(binding.functions))).toEqual(['headless_in_flight'])
    expect(requests[0]?.session.header.cwd).toBe(safe.workspace)

    if (ptc) {
      const before = JSON.stringify(safe.adapter.requests[1]?.messages)
      expect(before).toContain('42')
      const inFlight = safe.host.run(safe.scope, { kind: 'code-runtime-replacement' },
        invocation => safe.app.run(['hold for replacement'], invocation.signal))
      await inFlightToolEntered.promise
      staleRequest = requests.find(request => request.program === waitingProgram)
      if (staleRequest === undefined) throw new Error('old Provider did not receive the in-flight program')
      const substituteRuntime: NativeCodeRuntime = {
        language: 'typescript', isolation: 'worker-thread',
        run: async (request) => { requests.push(request); handoff.push('substitute served'); return { logs: [], value: 7 } },
        dispose: async () => {},
      }
      const substituteProvider: NativePlugin = {
        apiVersion: 1, name: 'test-code-runtime-substitute', targets: ['host'], requires: [], provides: ['codeRuntime'],
        resolve: () => async (context) => {
          if (staleRequest === undefined) throw new Error('old Provider did not receive the in-flight program')
          await expect(previousRuntime.run({ ...staleRequest, program: 'return 1' })).rejects.toThrow('run() after disposal')
          oldRuntimeDisposedAtActivation = true
          context.own(() => substituteRuntime.dispose())
          context.provide('codeRuntime', substituteRuntime)
          handoff.push('substitute provider active')
        },
      }
      let replacementSettled = false
      const replacing = safe.replaceCodeRuntime(substituteProvider).then(() => { replacementSettled = true })
      await cleanupEntered.promise
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(replacementSettled).toBe(false)
      expect(safe.codeRuntime).toBe(previousRuntime)
      expect(handoff).toEqual([
        'old runtime entered', 'old bound work entered', 'old bound work settled', 'old runtime settled',
        'old cleanup entered',
      ])
      await expect(inFlightRuntimeResult.promise).resolves.toMatchObject({ error: { kind: 'abort' } })
      releaseCleanup.resolve(undefined)
      await replacing
      await Promise.allSettled([inFlight])
      expect(handoff).toEqual([
        'old runtime entered', 'old bound work entered', 'old bound work settled', 'old runtime settled',
        'old cleanup entered', 'old cleanup completed', 'substitute provider active',
      ])
      expect(oldRuntimeDisposedAtActivation).toBe(true)
      expect(safe.codeRuntime).toBe(substituteRuntime)

      await safe.host.run(safe.scope, { kind: 'code-runtime-replacement-result' },
        invocation => safe.app.run(['calculate with replacement'], invocation.signal))
      const modelToolOutput = (callId: string): string => {
        const result = safe.adapter.requests.flatMap(request => request.messages).flatMap(message => message.content)
          .find(block => block.type === 'tool-result' && block.toolCallId === ToolCallId(callId))
        if (result?.type !== 'tool-result') throw new Error(`missing model-visible result for ${callId}`)
        const output = result.content.find(block => block.type === 'text')
        if (output?.type !== 'text') throw new Error(`missing text output for ${callId}`)
        return output.text
      }
      expect(modelToolOutput('code-safe')).toBe('42')
      expect(modelToolOutput('code-after-replacement')).toBe('7')
      expect(handoff.at(-1)).toBe('substitute served')
    }
  } finally {
    releaseCleanup.resolve(undefined)
    await safe.host.stop()
    await removeBusiness?.()
    await removeInFlightTool?.()
    await rm(safe.directory, { recursive: true, force: true })
  }

  requests.length = 0
  const restrictedRuntime: NativeCodeRuntime = {
    language: 'typescript', isolation: 'worker-thread',
    run: async (request) => { requests.push(request); return { logs: [], value: 42 } },
    dispose: async () => {},
  }
  const codeRuntimeProvider: NativePlugin = {
    apiVersion: 1, name: 'test-restricted-code-runtime', targets: ['host'], requires: [], provides: ['codeRuntime'],
    resolve: () => (context) => {
      context.own(() => restrictedRuntime.dispose())
      context.provide('codeRuntime', restrictedRuntime)
    },
  }
  const policy = new NativeSandboxPolicy({ mode: 'danger-full-access', workspaceRoot: process.cwd() })
  const resolvePolicy = vi.spyOn(policy, 'resolve').mockImplementation((request = {}) => ({
    mode: request.session === undefined ? 'danger-full-access' : 'read-only',
    workspaceRoot: request.session?.header.cwd ?? process.cwd(),
  }))
  const restricted = await fixture([
    toolCallResponse('code-restricted', 'run_code', args), textResponse('restricted call recorded'),
  ], { ptc, codeRuntimeProvider, sandboxPolicy: policy })
  try {
    await restricted.host.run(restricted.scope, { kind: 'code-runtime-session-policy' }, invocation => restricted.app.run(['calculate'], invocation.signal))
    expect(requests).toHaveLength(0)
    const resolvedSessions = resolvePolicy.mock.calls.flatMap(([request]) => request?.session === undefined ? [] : [request.session])
    expect(resolvedSessions.length).toBeGreaterThan(0)
    expect(resolvedSessions.every(session => session.header.cwd === restricted.workspace)).toBe(true)
  } finally {
    await restricted.host.stop()
    await rm(restricted.directory, { recursive: true, force: true })
  }
}, 15_000)

it('projects a program failure as an explicit native code-runtime tool error', async () => {
  const state = await fixture([
    toolCallResponse('code-failure', 'run_code', { program: 'throw new Error("calculation failed")' }),
    textResponse('code failure recorded'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'code-runtime-failure' }, invocation => state.app.run(['calculate'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('failed code Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const result = (await reader.read()).events.find(event => event.type === 'tool/result')
        expect(result).toMatchObject({ data: {
          error: { name: 'NativeCodeRuntimeError', code: 'CODE_RUNTIME_EXCEPTION' },
          message: { content: [{ type: 'tool-result', isError: true }] },
        } })
        expect(JSON.stringify(result)).toContain('calculation failed')
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('records Native tmux context once and suppresses it after a new Host restores the Session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-headless-tmux-'))
  let activeHost: NativeHost | undefined
  const selectedShell = testShell(async () => shellResult(`${TMUX_LOCATION}\n`))
  try {
    const first = await fixture([textResponse('tmux recorded')], {
      directory, tmuxContext: {}, shellOperations: selectedShell,
    })
    activeHost = first.host
    await first.host.run(first.scope, { kind: 'tmux-context' }, invocation =>
      first.app.run(['report the current pane'], invocation.signal))

    const firstStorage = new JsonlSessionBackend({ root: first.sessions, compression: 'none' })
    let sessionId: SessionId
    try {
      const row = (await firstStorage.list())[0]
      if (row === undefined) throw new Error('tmux Session was not stored')
      sessionId = row.header.id
      const reader = await firstStorage.open(sessionId, 'read')
      try {
        expect((await reader.read()).events.filter(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin' && event.data.source.plugin === 'native-tmux-context')).toHaveLength(1)
      } finally { await reader.close() }
    } finally { await firstStorage.close() }
    await first.host.stop()
    activeHost = undefined

    const resumed = await fixture([textResponse('tmux restored')], {
      directory, tmuxContext: {}, shellOperations: selectedShell,
    })
    activeHost = resumed.host
    await resumed.host.run(resumed.scope, { kind: 'tmux-resume' }, invocation =>
      resumed.app.run(['--resume', sessionId, 'continue'], invocation.signal))
    const tmuxMessages = resumed.adapter.requests[0]?.messages.filter(message => message.role === 'user'
      && message.source.kind === 'plugin' && message.source.plugin === 'native-tmux-context')
    expect(tmuxMessages).toHaveLength(1)

    const resumedStorage = new JsonlSessionBackend({ root: resumed.sessions, compression: 'none' })
    try {
      const reader = await resumedStorage.open(sessionId, 'read')
      try {
        expect((await reader.read()).events.filter(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin' && event.data.source.plugin === 'native-tmux-context')).toHaveLength(1)
      } finally { await reader.close() }
    } finally { await resumedStorage.close() }
  } finally {
    await activeHost?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('drains an aborted tmux query before stopping without appending its late reading', async () => {
  const entered = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const selectedShell = testShell(spec => new Promise((resolve) => {
    entered.resolve(undefined)
    if (spec.signal?.aborted) aborted.resolve(undefined)
    else spec.signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    void release.promise.then(() => { resolve(shellResult(`${TMUX_LOCATION}\n`)) })
  }))
  const state = await fixture([textResponse('must not reach model')], {
    tmuxContext: {}, shellOperations: selectedShell,
  })
  try {
    const running = state.host.run(state.scope, { kind: 'tmux-cancel' }, invocation =>
      state.app.run(['report the current pane'], invocation.signal))
      .then(value => ({ value }), (error: unknown) => ({ error }))
    await entered.promise
    let stopped = false
    const stopping = state.host.stop().then(() => { stopped = true })
    await aborted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(stopped).toBe(false)
    release.resolve(undefined)
    const outcome = await running
    expect(outcome).toHaveProperty('error')
    await stopping
    expect(state.adapter.requests).toHaveLength(0)

    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const row = (await storage.list())[0]
      if (row === undefined) throw new Error('cancelled tmux Session was not stored')
      const reader = await storage.open(row.header.id, 'read')
      try {
        expect((await reader.read()).events.some(event => event.type === 'user/message'
          && event.data.source.kind === 'plugin' && event.data.source.plugin === 'native-tmux-context')).toBe(false)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(undefined)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('persists native time context before the model reads the request', async () => {
  const state = await fixture([textResponse('time recorded')], { timeContext: { timeZone: 'UTC', refreshIntervalMs: 60_000 } })
  try {
    await state.host.run(state.scope, { kind: 'time-context' }, invocation => state.app.run(['report', 'time'], invocation.signal))
    expect(state.adapter.requests[0]?.messages.some(message =>
      message.role === 'user' && message.source.kind === 'plugin' && message.source.plugin === 'native-time-context',
    )).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('time-context Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.some(event =>
          event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === 'native-time-context',
        )).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('rejects write_file under the installed never approval policy and persists its paired audit', async () => {
  const state = await fixture([
    toolCallResponse('write-denied', 'write_file', { path: 'denied.txt', content: 'must not exist' }),
    textResponse('denied'),
  ], { approvalPolicy: 'never' })
  try {
    await state.host.run(state.scope, { kind: 'approval-write' }, invocation => state.app.run(['try', 'a', 'write'], invocation.signal))
    await expect(readFile(join(state.workspace, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('approval Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { toolName: 'write_file', callId: 'write-denied', reason: 'Writing a file changes the selected workspace.' },
        }])
        expect(events.filter(event => event.type === 'native-approval/decided')).toMatchObject([{ data: { policy: 'never', outcome: 'rejected' } }])
        expect(events.find(event => event.type === 'tool/result')).toMatchObject({ data: { error: { code: 'APPROVAL_REJECTED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('keeps read_file available and rejects write_file under the durable deny policy', async () => {
  const modelSelection: NativeModelSelectionOperations = {
    async state() { return { lastUsed: null, next: null, revision: null } },
    async select() { throw new Error('unused') },
    async capture(_owner, defaults) { return { config: defaults, requestedConfig: defaults } },
  }
  const state = await fixture([
    textResponse('Session ready.'),
    toolCallResponse('read-deny-policy', 'read_file', { path: 'readable.txt' }),
    toolCallResponse('write-deny-policy', 'write_file', { path: 'denied.txt', content: 'must not exist' }),
    textResponse('read succeeded and write was denied'),
  ], { modelSelection })
  const route = brandString<NativeRootRouteId>('root')
  const id = SessionId('execution-policy-deny')
  const signal = new AbortController().signal
  try {
    await writeFile(join(state.workspace, 'readable.txt'), 'harmless read fixture')
    await state.rootExecution.execute({ route, id, resume: false, message: createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Seed the policy Session.' }],
    }) }, signal)
    await state.rootExecution.maintenance({ route, id, resume: true }, async (owner) => {
      owner.append('execution/policy', { version: 1, maxSteps: 4, permission: { mode: 'deny' } })
      await owner.flush()
    }, signal)
    await state.rootExecution.execute({ route, id, resume: true, message: createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'Read this file, then try to overwrite it.' }],
    }) }, signal)

    expect(state.adapter.requests).toHaveLength(4)
    await expect(readFile(join(state.workspace, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const readResult = events.find(event => event.type === 'tool/result'
          && event.data.message.source.kind === 'tool' && event.data.message.source.callId === 'read-deny-policy')
        const writeResult = events.find(event => event.type === 'tool/result'
          && event.data.message.source.kind === 'tool' && event.data.message.source.callId === 'write-deny-policy')
        if (readResult?.type !== 'tool/result') throw new Error('The allowed read result was not persisted.')
        expect(readResult.data.message.content[0].content).toContainEqual({ type: 'text', text: 'harmless read fixture' })
        expect(writeResult).toMatchObject({ data: { error: { code: 'APPROVAL_REJECTED' } } })
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { toolName: 'write_file', callId: 'write-deny-policy' },
        }])
        expect(events.filter(event => event.type === 'native-approval/decided')).toMatchObject([{
          data: { policy: 'never', outcome: 'rejected' },
        }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('durably records the approval question before dispatch and its grant before the tool runs', async () => {
  const state = await fixture([
    toolCallResponse('guarded-approval', 'guarded', {}),
    textResponse('guarded complete'),
  ], { approvalPolicy: 'ask' })
  const approval = state.approval
  if (approval === undefined) throw new Error('approval Provider was not installed')
  const readAudit = async (): Promise<unknown[]> => {
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({
      root: state.sessions,
      compression: 'none',
    })
    try {
      const entry = (await storage.list())[0]
      if (entry === undefined) throw new Error('approval Session was not durable before answerer dispatch')
      const reader = await storage.open(entry.header.id, 'read')
      try {
        return (await reader.read()).events.filter(event => (
          event.type === 'native-approval/asked' || event.type === 'native-approval/decided'
        ))
      } finally { await reader.close() }
    } finally { await storage.close() }
  }
  let requestId: string | undefined
  let sawAskedBeforeAnswer = false
  let sawDecisionBeforeExecution = false
  let executed = false
  const removeAnswerer = approval.registerAnswerer(async (request) => {
    requestId = request.id
    const events = await readAudit()
    sawAskedBeforeAnswer = events.some(event => (
      typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/asked'
      && 'data' in event && typeof event.data === 'object' && event.data !== null && 'id' in event.data
      && event.data.id === request.id
    )) && !events.some(event => typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/decided')
    return 'allowed-once' as const
  })
  const removeTool = state.tools.register({
    schema: { name: 'guarded', description: 'A protected fixture contribution.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    approval: { reason: 'This contribution changes protected state.' },
    async execute() {
      const events = await readAudit()
      sawDecisionBeforeExecution = events.some(event => (
        typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/decided'
        && 'data' in event && typeof event.data === 'object' && event.data !== null && 'id' in event.data
        && event.data.id === requestId && 'outcome' in event.data && event.data.outcome === 'allowed-once'
      ))
      executed = true
      return { content: [{ type: 'text', text: 'guarded complete' }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'approval-durability' }, invocation => state.app.run(['invoke', 'guarded'], invocation.signal))
    expect(sawAskedBeforeAnswer).toBe(true)
    expect(sawDecisionBeforeExecution).toBe(true)
    expect(executed).toBe(true)
  } finally {
    removeAnswerer()
    await removeTool()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('records a max-token model finish without claiming normal completion', async () => {
  const state = await fixture([maxTokensResponse('partial')])
  try {
    await state.host.run(state.scope, { kind: 'max-tokens' }, invocation => state.app.run(['continue'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('runs registered native tools under the exact live Agent initiator', async () => {
  const state = await fixture([
    toolCallResponse('identity-1', 'identity', {}),
    textResponse('identity confirmed'),
  ])
  let initiatedAgent: unknown
  const dispose = state.tools.register({
    schema: { name: 'identity', description: 'Confirm the current native Agent.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    async execute(call) {
      expect(state.agents.requireInitiator()).toBe(call.agent)
      expect(state.agents.get(call.agent.id)).toBe(call.agent)
      initiatedAgent = call.agent
      return { content: [{ type: 'text', text: String(call.agent.id) }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'identity' }, invocation => state.app.run(['confirm', 'identity'], invocation.signal))
    const resident = state.agents.list()
    expect(resident).toHaveLength(1)
    expect(resident[0]).toBe(initiatedAgent)
  } finally {
    await dispose()
    await state.host.stop()
    expect(state.agents.list()).toEqual([])
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('stops a protected contribution before its executor under the selected approval policy', async () => {
  const state = await fixture([
    toolCallResponse('guarded-1', 'guarded', {}),
    textResponse('guarded denied'),
  ], { approvalPolicy: 'never' })
  let executed = false
  const dispose = state.tools.register({
    schema: { name: 'guarded', description: 'A protected fixture contribution.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    approval: { reason: 'The fixture contribution changes protected state.' },
    async execute() {
      executed = true
      return { content: [{ type: 'text', text: 'unexpected' }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'approval-contribution' }, invocation => state.app.run(['invoke', 'guarded'], invocation.signal))
    expect(executed).toBe(false)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('protected contribution Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { toolName: 'guarded', reason: 'The fixture contribution changes protected state.' },
        }])
        expect(events.find(event => event.type === 'tool/result')).toMatchObject({ data: { error: { code: 'APPROVAL_REJECTED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await dispose()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})


it('persists native workspace instructions and reconciles an offline edit on resume', async () => {
  const state = await fixture([textResponse('first'), textResponse('second')], { instructions: true })
  const fs = await import('node:fs/promises')
  try {
    await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Initial workspace rule.')
    await state.host.run(state.scope, { kind: 'instructions' }, invocation => state.app.run(['first'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl/native')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Updated workspace rule.')
      await state.host.run(state.scope, { kind: 'instructions-resume' }, invocation => state.app.run(['--resume', id, 'second'], invocation.signal))
      expect(state.adapter.requests[0]?.messages.some(message => JSON.stringify(message).includes('Initial workspace rule.'))).toBe(true)
      expect(state.adapter.requests[1]?.messages.some(message => JSON.stringify(message).includes('Updated workspace rule.'))).toBe(true)
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const contexts = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'agent-instructions')
        expect(contexts).toHaveLength(2)
        expect(contexts[1]).toMatchObject({ data: { source: { changes: [{ action: 'replace', path: 'AGENTS.md' }] } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})


it.each([false, true])('projects nested instruction discovery and removal after accepted file results (PTC %s)', async (ptc) => {
  let state = await fixture([
    ptc ? toolCallResponse('code-1', 'run_code', { code: "return await tools.read({ file_path: 'nested/file.txt' })", description: 'Read nested file.' })
      : toolCallResponse('read-1', 'read', { file_path: 'nested/file.txt' }),
  ], { instructions: true, maxSteps: 1, ptc })
  const fs = await import('node:fs/promises')
  try {
    await fs.mkdir(join(state.workspace, 'nested'))
    await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Baseline rule.')
    await fs.writeFile(join(state.workspace, 'CLAUDE.md'), '  Baseline rule.  ')
    await fs.writeFile(join(state.workspace, 'nested', 'AGENTS.md'), 'Nested rule.')
    const registerRead = (remove: boolean): void => {
      state.tools.registerValueTool({
        schema: { name: 'read', description: 'Read fixture.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false } },
        output: { schema: { type: 'string' }, render: (_call, value) => ({ content: [{ type: 'text', text: value as string }], isError: false }) },
        execute: async () => {
          if (remove) await fs.unlink(join(state.workspace, 'nested', 'AGENTS.md'))
          return 'file contents'
        },
      }, state.scope)
    }
    registerRead(false)
    await state.host.run(state.scope, { kind: 'nested-instructions' }, invocation => state.app.run(['inspect nested file'], invocation.signal))
    const initial = JSON.stringify(state.adapter.requests[0]?.messages)
    expect(initial).toContain('Baseline rule.')
    expect(initial).not.toContain('Instructions from: CLAUDE.md')
    expect(initial).not.toContain('Nested rule.')
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl/native')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    const id = (await storage.list())[0]?.header.id
    await storage.close()
    if (id === undefined) throw new Error('missing Session id')
    const directory = state.directory
    await state.host.stop()
    state = await fixture([
      toolCallResponse('read-2', 'read', { file_path: 'nested/file.txt' }),
      textResponse('done'),
    ], { instructions: true, maxSteps: 1, directory, ptc })
    registerRead(true)
    await state.host.run(state.scope, { kind: 'nested-instructions-cold-resume' }, invocation => state.app.run(['--resume', id, 'continue'], invocation.signal))
    expect(JSON.stringify(state.adapter.requests[0]?.messages)).toContain('Nested rule.')
    await state.host.run(state.scope, { kind: 'nested-instructions-removal' }, invocation => state.app.run(['--resume', id, 'finish'], invocation.signal))
    const final = JSON.stringify(state.adapter.requests[1]?.messages)
    expect(final).toContain('Instructions removed:')
    expect(final.match(/Nested rule\./g)).toHaveLength(1)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it.each(['read-first', 'cleanup-first'] as const)('replaces the filesystem skill Provider after pending work (%s)', async (releaseOrder) => {
  const cleanupEntered = Promise.withResolvers<undefined>()
  const releaseCleanup = Promise.withResolvers<undefined>()
  const cleanupCompleted = Promise.withResolvers<undefined>()
  let capturedFilesystemProvider: (SkillProvider & { dispose(): Promise<void> }) | undefined
  let oldProviderCalls = 0
  let oldProviderCallsAtReplacement = 0
  let oldResourcesCleaned = false
  const observeSkillProvider = (provider: SkillProvider): void => {
    if (provider.name !== 'filesystem') throw new Error(`unexpected skill Provider ${provider.name}`)
    const disposable = provider as SkillProvider & { dispose(): Promise<void> }
    const originalList = disposable.list.bind(disposable)
    Object.defineProperty(disposable, 'list', {
      value: async (...args: Parameters<SkillProvider['list']>) => {
        oldProviderCalls += 1
        return await originalList(...args)
      },
    })
    const originalGet = disposable.get.bind(disposable)
    Object.defineProperty(disposable, 'get', {
      value: async (...args: Parameters<SkillProvider['get']>) => {
        oldProviderCalls += 1
        return await originalGet(...args)
      },
    })
    const originalDispose = disposable.dispose.bind(disposable)
    let disposal: Promise<void> | undefined
    Object.defineProperty(disposable, 'dispose', {
      value: () => disposal ??= (async () => {
        cleanupEntered.resolve(undefined)
        await releaseCleanup.promise
        await originalDispose()
        oldResourcesCleaned = true
        cleanupCompleted.resolve(undefined)
      })(),
    })
    capturedFilesystemProvider = disposable
  }
  const state = await fixture([
    toolCallResponse('skill-real', 'skill', { name: 'handoff-skill' }), textResponse('real Provider completed'),
    toolCallResponse('skill-controlled', 'skill', { name: 'handoff-skill' }), textResponse('controlled Provider completed'),
  ], { observeSkillProvider })
  const skillDirectory = state.skillDirectory
  if (skillDirectory === undefined) throw new Error('missing real skill directory')
  const skillFile = join(skillDirectory, 'handoff-skill', 'SKILL.md')
  let holdSkillRead = false
  const readEntered = Promise.withResolvers<undefined>()
  const releaseRead = Promise.withResolvers<undefined>()
  const readAborted = Promise.withResolvers<undefined>()
  const readFinished = Promise.withResolvers<undefined>()
  const originalReadText = state.filesystem.readText.bind(state.filesystem)
  state.filesystem.readText = async (target, signal) => {
    if (holdSkillRead && state.filesystem.processPath(target) === skillFile) {
      holdSkillRead = false
      readEntered.resolve(undefined)
      signal?.addEventListener('abort', () => { readAborted.resolve(undefined) }, { once: true })
      await releaseRead.promise
      try { signal?.throwIfAborted() } finally { readFinished.resolve(undefined) }
    }
    return await originalReadText(target, signal)
  }
  let controlledActive = false
  let controlledGetCalls = 0
  const controlledProvider: SkillProvider = {
    name: 'controlled-handoff',
    async list() {
      return [{ name: 'handoff-skill', description: 'Handoff skill', invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom', provider: 'controlled-handoff', resourceBase: { kind: 'opaque', description: 'controlled resource store' },
        rank: 0, locator: 'handoff-skill' }]
    },
    async get(candidate) {
      controlledGetCalls += 1
      return { ...candidate, content: 'Controlled instructions.' }
    },
  }
  const controlledPlugin: NativePlugin = {
    apiVersion: 1, name: 'test-controlled-skill-provider', targets: ['host'], requires: ['skills'], provides: [],
    resolve: () => (context) => {
      if (!oldResourcesCleaned) throw new Error('filesystem skill resources were not disposed before replacement activation')
      context.own(context.require('skills').registerProvider(state.scope, () => controlledProvider))
      controlledActive = true
    },
  }
  let inFlight: Promise<{ result: Awaited<ReturnType<NativeToolRegistry['execute']>> } | { error: unknown }> | undefined
  let replacing: Promise<void> | undefined
  let replacementSettled = false
  try {
    const activeApplication = state.app
    const run = async (prompt: string): Promise<void> => {
      await state.host.run(state.scope, { kind: 'skill-provider-handoff' }, invocation =>
        state.app.run([prompt], invocation.signal))
    }
    await run('Load handoff-skill')
    expect(state.adapter.requests).toHaveLength(2)
    const firstRequest = state.adapter.requests[0]
    if (firstRequest === undefined) throw new Error('missing first model request')
    if (firstRequest.tools === undefined) throw new Error('missing first model schemas')
    const firstSkillSchemas = firstRequest.tools.filter(tool => tool.name === 'skill')
    expect(firstSkillSchemas).toHaveLength(1)

    const directSessionId = SessionId('skill-provider-handoff-in-flight')
    const directSession = Session.create(directSessionId, undefined, {
      version: SESSION_FORMAT_VERSION, id: directSessionId, createdAt: 1, cwd: state.workspace, isSeeded: false,
    })
    const directAgent: NativeAgent = { id: NativeAgentId('skill-provider-handoff-agent'), scope: state.scope }
    const unregisterAgent = state.agents.register(directAgent)
    holdSkillRead = true
    inFlight = state.tools.execute({
      agent: directAgent, callId: ToolCallId('skill-in-flight'), name: 'skill', arguments: { name: 'handoff-skill' },
      session: directSession, signal: new AbortController().signal,
      appendEvent: async (type, data, ...opts) => directSession.append(type, data, ...opts),
    }).then(result => ({ result }), (error: unknown) => ({ error }))
    await readEntered.promise
    oldProviderCallsAtReplacement = oldProviderCalls
    replacing = state.replaceSkillProvider(controlledPlugin).then(() => { replacementSettled = true })
    await readAborted.promise
    await cleanupEntered.promise
    if (releaseOrder === 'read-first') {
      releaseRead.resolve(undefined)
      await readFinished.promise
    } else {
      releaseCleanup.resolve(undefined)
      await cleanupCompleted.promise
    }
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(replacementSettled).toBe(false)
    expect(controlledActive).toBe(false)
    expect(controlledGetCalls).toBe(0)
    if (releaseOrder === 'read-first') {
      releaseCleanup.resolve(undefined)
      await cleanupCompleted.promise
    } else {
      releaseRead.resolve(undefined)
      await readFinished.promise
    }
    const inFlightOutcome = await inFlight
    expect(inFlightOutcome).toMatchObject({ error: new Error('skill "handoff-skill" is unknown or no longer available') })
    await replacing
    expect(oldResourcesCleaned).toBe(true)
    await unregisterAgent()
    expect(state.app).toBe(activeApplication)
    expect(state.tools.schemas().filter(tool => tool.name === 'skill')).toEqual(firstSkillSchemas)
    expect(capturedFilesystemProvider).toBeDefined()

    await run('Load handoff-skill')
    expect(state.adapter.requests).toHaveLength(4)
    expect(controlledActive).toBe(true)
    expect(controlledGetCalls).toBe(1)
    expect(oldProviderCalls).toBe(oldProviderCallsAtReplacement)

    const realContent = [
      '<skill_content name="handoff-skill">', '<skill_resources>',
      `Base directory for this skill: ${join(skillDirectory, 'handoff-skill')}`,
      'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
      '</skill_resources>', '', '<skill_instructions>', 'Filesystem instructions.', '</skill_instructions>', '</skill_content>',
    ].join('\n')
    const controlledContent = [
      '<skill_content name="handoff-skill">', '<skill_resources>',
      'Resources for this skill: controlled resource store', 'Load referenced resources only as needed.',
      '</skill_resources>', '', '<skill_instructions>', 'Controlled instructions.', '</skill_instructions>', '</skill_content>',
    ].join('\n')
    const skillCatalogText = [
      '<system-reminder>',
      'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
      '',
      '<available_skills>',
      '- `handoff-skill`: Handoff skill',
      '</available_skills>',
      '',
      "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
      'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
      '</system-reminder>',
    ].join('\n')
    const skillCatalogMessage = (index: number) => {
      const request = state.adapter.requests[index]
      if (request === undefined) throw new Error(`missing model request ${index}`)
      const message = request.messages.find(candidate => candidate.source.kind === 'skill-catalog')
      if (message === undefined) throw new Error(`missing skill catalog in request ${index}`)
      const { id: _messageId, ...catalog } = message
      return catalog
    }
    for (const index of [0, 1, 2, 3]) {
      expect(skillCatalogMessage(index)).toEqual({
        role: 'user',
        content: [{ type: 'text', text: skillCatalogText }],
        source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'handoff-skill', description: 'Handoff skill' }] },
      })
    }
    const modelInput = (index: number) => {
      const request = state.adapter.requests[index]
      if (request === undefined) throw new Error(`missing model request ${index}`)
      const { messages, signal, sessionId, ...input } = request
      expect(signal?.aborted).toBe(false)
      expect(sessionId).toBeDefined()
      return {
        ...input,
        messages: messages.map(({ id: _messageId, ...message }) => ({
          ...message,
          source: message.source.kind === 'tool'
            ? { ...message.source, callId: ToolCallId('normalized-skill-call') }
            : message.source,
          content: message.content.map((block) => {
            if (block.type === 'tool-call') return { ...block, id: ToolCallId('normalized-skill-call') }
            if (block.type === 'tool-result') return {
              ...block,
              toolCallId: ToolCallId('normalized-skill-call'),
              content: block.content.map(content => content.type === 'text'
                && (content.text === realContent || content.text === controlledContent)
                ? { ...content, text: '<skill provider content>' }
                : content),
            }
            return block
          }),
        })),
      }
    }
    const modelToolResult = (requestIndex: number, callId: string) => {
      const request = state.adapter.requests[requestIndex]
      if (request === undefined) throw new Error(`missing model request ${requestIndex}`)
      const block = request.messages.flatMap(message => message.content)
        .find(content => content.type === 'tool-result' && content.toolCallId === ToolCallId(callId))
      if (block?.type !== 'tool-result') throw new Error(`missing model result for ${callId} in request ${requestIndex}`)
      return block
    }
    expect(modelToolResult(1, 'skill-real')).toEqual({ type: 'tool-result', toolCallId: ToolCallId('skill-real'),
      content: [{ type: 'text', text: realContent }], isError: false })
    expect(modelToolResult(3, 'skill-controlled')).toEqual({ type: 'tool-result', toolCallId: ToolCallId('skill-controlled'),
      content: [{ type: 'text', text: controlledContent }], isError: false })
    expect(modelInput(0)).toEqual(modelInput(2))
    expect(modelInput(1)).toEqual(modelInput(3))

    const storage = new JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const resultEvents: SessionEvent[] = []
      for (const snapshot of await storage.list()) {
        const reader = await storage.open(SessionId(snapshot.header.id), 'read')
        try {
          resultEvents.push(...(await reader.read()).events.filter(event => event.type === 'tool/result'))
        } finally { await reader.close() }
      }
      const persistedResult = (callId: string) => resultEvents.find(event => event.type === 'tool/result'
        && event.data.message.content.some(content => content.type === 'tool-result'
          && content.toolCallId === ToolCallId(callId)))
      expect(persistedResult('skill-real')).toMatchObject({ type: 'tool/result', data: { message: { content: [modelToolResult(1, 'skill-real')] } } })
      expect(persistedResult('skill-controlled')).toMatchObject({ type: 'tool/result', data: { message: { content: [modelToolResult(3, 'skill-controlled')] } } })
    } finally { await storage.close() }

    expect(oldProviderCalls).toBe(oldProviderCallsAtReplacement)
  } finally {
    releaseRead.resolve(undefined)
    releaseCleanup.resolve(undefined)
    await Promise.allSettled([
      ...inFlight === undefined ? [] : [inFlight],
      ...replacing === undefined ? [] : [replacing],
    ])
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('keeps one schema per tool when the profile also registers the builtin run_code', async () => {
  // A profile may install `dsh-tool-code-runtime`, which registers `run_code`
  // into the model Registry. The builtin transport offers the same name when
  // `builtinTools` is on, which is the default. Both reach the request either
  // way; the caller must see one schema per name rather than a failed turn.
  const state = await fixture([textResponse('one schema per name')], {})
  let removeRunCode: (() => Promise<void>) | undefined
  try {
    removeRunCode = state.tools.registerValueTool({
      schema: { name: 'run_code', description: 'REGISTRY-RUN-CODE-MARKER',
        parameters: { type: 'object', properties: { program: { type: 'string' } }, required: ['program'], additionalProperties: false } },
      output: { schema: { type: 'string' }, render: (_call, value) => ({ content: [{ type: 'text', text: value as string }], isError: false }) },
      async execute() { return 'profile run_code' },
    })
    const invocation = new AbortController()
    await state.app.run(['go'], invocation.signal)
    const names = state.adapter.requests.flatMap(request => (request.tools ?? []).map(tool => tool.name))
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
    // The surviving `run_code` must be the Registry's, not the builtin transport's:
    // a caller reading the schema should see what the profile actually installed.
    const runCode = state.adapter.requests
      .flatMap(request => request.tools ?? [])
      .filter(tool => tool.name === 'run_code')
    expect(runCode).toHaveLength(1)
    expect(runCode[0]?.description).toBe('REGISTRY-RUN-CODE-MARKER')
  } finally {
    await removeRunCode?.()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('renders persona template variables into the logged system prompt', async () => {
  const state = await fixture([textResponse('rendered')], {
    persona: 'You are a coding agent powered by the {{model}} model.\n\nYour working directory is {{cwd}}.',
  })
  try {
    const invocation = new AbortController()
    await state.app.run(['go'], invocation.signal)
    const system = state.adapter.requests[0]?.messages.find(message => message.role === 'system')
    if (system?.role !== 'system') throw new Error('missing system message')
    const text = system.content.map(part => part.type === 'text' ? part.text : '').join('')
    // The template must reach the model already rendered: literal braces would ship the
    // placeholder itself, and the Cordis registry this replaces always interpolated.
    expect(text).not.toContain('{{')
    expect(text).toContain('powered by the fixture model')
    expect(text).toContain(`Your working directory is ${state.workspace}`)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('resumes a cold Session whose stored system prompt still carries the template placeholders', async () => {
  const persona = 'You are a coding agent powered by the {{model}} model.\n\nYour working directory is {{cwd}}.'
  const first = await fixture([textResponse('first')], { persona })
  const directory = first.directory
  let state = first
  try {
    await state.host.run(state.scope, { kind: 'persona-first' }, invocation => state.app.run(['go'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl/native'))
      .JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    let id: string | undefined
    try { id = (await storage.list())[0]?.header.id } finally { await storage.close() }
    if (id === undefined) throw new Error('missing Session id')

    // Rewrite the persisted system message back to the raw template, exactly what a Session
    // created before interpolation shipped on disk. A cold resume must still accept it.
    const file = await findSessionLog(state.sessions, id)
    const raw = await readFile(file, 'utf8')
    const reverted = raw.replace(/You are a coding agent powered by the [^\\\n]*? model\./u,
      'You are a coding agent powered by the {{model}} model.')
    expect(reverted).not.toBe(raw)
    await writeFile(file, reverted)

    await state.host.stop()
    state = await fixture([textResponse('resumed')], { persona, directory })
    await expect(state.host.run(state.scope, { kind: 'persona-cold-resume' },
      invocation => state.app.run(['--resume', id, 'again'], invocation.signal))).resolves.toBe(0)
  } finally {
    await state.host.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
