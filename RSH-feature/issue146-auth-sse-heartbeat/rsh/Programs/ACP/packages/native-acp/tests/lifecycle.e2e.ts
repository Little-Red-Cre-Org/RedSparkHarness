/** ACP cancellation and EOF drain through the built public launcher. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { execa } from 'execa'
import { expect, it, vi } from 'vitest'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { startHttpMcpFixture } from '../../../../../Modules/Official/mcp/mcp-client/tests/http-fixture.ts'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeActiveSessionOperations, NativeRootExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { NativeApprovalRequestId } from '@deepseek-ai/dsh-native-approval'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import type { AttachmentOperations, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/native'
import { NATIVE_ACP_SUBAGENT_METADATA_KEY, readNativeAcpSubagentPermissionRequest } from '@deepseek-ai/dsh-acp-protocol'
import { plugin as approvalPlugin } from '@deepseek-ai/dsh-native-approval/native'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { MockAdapter, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin as carrierPlugin, NativeAcpApplication } from '../src/native.ts'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const instructionPrompt = 'ACP_INSTRUCTIONS_FIRST_TURN_3af85d'
const resumedInstructionPrompt = 'ACP_INSTRUCTIONS_COLD_RESTORE_3af85d'
const workspaceInstruction = 'ACP_WORKSPACE_INSTRUCTIONS_3af85d'
const globalInstruction = 'ACP_GLOBAL_INSTRUCTIONS_3af85d'

interface McpFixtureStart {
  event: 'start'
  pid: number
  nonce: string
}

async function readMcpFixtureStarts(path: string): Promise<McpFixtureStart[]> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(line => line.length > 0)
  return lines.map((line) => {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null
      || !('event' in value) || value.event !== 'start'
      || !('pid' in value) || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid < 1
      || !('nonce' in value) || typeof value.nonce !== 'string' || value.nonce.length === 0) {
      throw new Error(`invalid MCP fixture start record: ${line}`)
    }
    return { event: value.event, pid: value.pid, nonce: value.nonce }
  })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

function modelRequestText(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('messages' in value) || !Array.isArray(value.messages)) return ''
  return value.messages.flatMap((message: unknown) => {
    if (typeof message !== 'object' || message === null || !('role' in message) || message.role !== 'user' || !('content' in message)) return []
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((block: unknown) => typeof block === 'object' && block !== null
      && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : [])
  }).join('\n')
}

function launchAcp(home: string, patch: string) {
  return execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-acp', '--patch', patch], {
    cwd: home, env: { DSH_HOME: home, NATIVE_ACP_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
}

async function failedClose(home: string): Promise<void> {
  const scope = new NativeScope()
  const input = new PassThrough()
  const output = new PassThrough()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const failure = new Error('ACP retained writer close failed')
  const imageReadRejection = new Error('ACP image read failed after admission')
  const promptFailure = new Error('ACP model failed after image output')
  const tiedCreatedAt = Date.UTC(2026, 0, 1)
  let failClose = false
  let tieSessionTimes = false
  const cursorSessionIds = new Map<string, string>()
  const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError ? error.errors.flatMap(causes) : [error]
  const modelScript: ConstructorParameters<typeof MockAdapter>[0] = []
  const model = new MockAdapter(modelScript)
  const imageRef: ImageAttachmentRef = { attachmentId: 'acp-image-barrier' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png', bytes: 2, width: 1, height: 1 }
  let imageReadEntered = Promise.withResolvers<undefined>()
  let imageReadRelease = Promise.withResolvers<undefined>()
  let imageReadAborted = Promise.withResolvers<undefined>()
  let imageReadFailure: Error | undefined
  let attachmentProviderReleased = false
  let imageCallSequence = 0
  const unretainedOwners = new Set<SessionId>()
  const armImageRead = (readFailure?: Error): void => {
    imageReadEntered = Promise.withResolvers<undefined>()
    imageReadRelease = Promise.withResolvers<undefined>()
    imageReadAborted = Promise.withResolvers<undefined>()
    imageReadFailure = readFailure
  }
  const assistantImageResponse = (withUnknownTool = false): StreamChunk[] => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'image' },
      { type: 'block-end', index: 0, block: { type: 'image', attachment: imageRef } },
    ]
    if (withUnknownTool) {
      const callId = ToolCallId(`acp-image-call-${++imageCallSequence}`)
      chunks.push({ type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: callId, name: 'unregistered_fixture_tool', arguments: '{}' } })
    }
    chunks.push({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: withUnknownTool ? 'tool-calls' : 'stop' } })
    return chunks
  }
  const attachmentProvider: NativePlugin = { apiVersion: 1, name: 'acp-image-read-barrier', targets: ['host'],
    requires: [], provides: ['attachments'], resolve: () => (context) => {
      const operations = {
        imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024, maxImagePixels: 1,
          maxImageDimension: 1, mediaTypes: ['image/png'] as const },
        admitPromptContent: async (content: readonly unknown[]) => content,
        readImage: async (ref: ImageAttachmentRef, signal?: AbortSignal) => {
          const entered = imageReadEntered
          const releaseRead = imageReadRelease
          const aborted = imageReadAborted
          const readFailure = imageReadFailure
          entered.resolve(undefined)
          if (signal?.aborted) aborted.resolve(undefined)
          else signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
          await releaseRead.promise
          if (readFailure !== undefined) throw readFailure
          if (signal?.aborted) throw signal.reason
          return { ref, data: Uint8Array.of(1, 2) }
        },
      }
      context.provide('attachments', operations as unknown as AttachmentOperations)
      context.own(() => { attachmentProviderReleased = true })
    } }
  let app: NativeAcpApplication | undefined
  let rootExecution: NativeRootExecutionOperations | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let approval: NativeApprovalServiceDefinition | undefined
  const permissionRequests: Record<string, unknown>[] = []
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'close-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => {
      context.provide('model', model)
    } }
  const capture: NativePlugin = { apiVersion: 1, name: 'close-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'activeSessions', 'rootExecution', 'approval'], provides: [], resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeAcpApplication)) throw new Error('ACP close carrier missing')
      app = application
      rootExecution = context.require('rootExecution')
      activeSessions = context.require('activeSessions')
      approval = context.require('approval')
      context.effect(activeSessions.onAttached(async (owner) => {
        if (!unretainedOwners.has(owner.session.id)) context.own(owner.retain())
      }))
      const storage = context.require('sessionPersistence')
      const list = storage.list.bind(storage)
      const listSpy = vi.spyOn(storage, 'list').mockImplementation(async (...args) => {
        const sessions = await list(...args)
        return tieSessionTimes
          ? sessions.filter(session => cursorSessionIds.has(String(session.header.id))).map((session) => {
            const sessionId = cursorSessionIds.get(String(session.header.id))
            if (sessionId === undefined) throw new Error('cursor fixture lost a Session id')
            return { ...session, header: { ...session.header, id: SessionId(sessionId), createdAt: tiedCreatedAt } }
          })
          : sessions
      })
      const create = storage.create.bind(storage)
      const createSpy = vi.spyOn(storage, 'create').mockImplementation(async (...args) => {
        const writer = await create(...args)
        const close = writer.close.bind(writer)
        vi.spyOn(writer, 'close').mockImplementation(async (...closeArgs) => {
          if (!failClose) return close(...closeArgs)
          entered.resolve(undefined)
          await release.promise
          await close(...closeArgs)
          throw failure
        })
        return writer
      })
      const open = storage.open.bind(storage)
      const spy = vi.spyOn(storage, 'open').mockImplementation(async (...args) => {
        const writer = await open(...args)
        if (args[1] === 'write') {
          const close = writer.close.bind(writer)
          vi.spyOn(writer, 'close').mockImplementation(async (...closeArgs) => {
            if (!failClose) return close(...closeArgs)
            entered.resolve(undefined)
            await release.promise
            await close(...closeArgs)
            throw failure
          })
        }
        return writer
      })
      context.own(() => { listSpy.mockRestore(); createSpy.mockRestore(); spy.mockRestore() })
    } }
  const carrier: NativePlugin = { ...carrierPlugin, resolve: () => (context) => {
    const application = new NativeAcpApplication(context, { provider: 'mock', model: 'mock',
      systemPrompt: 'ACP retained close.', maxSteps: 2, maxPendingPermissions: 32, mcpToolCallTimeoutMs: 60_000,
      sessionListPageSize: 1 }, input, output)
    context.provide('application', application)
    context.provide('rootExecution', application.rootExecution)
  } }
  const host = new NativeHost(resolveInstallation([
    { plugin: carrier, scope, config: undefined }, { plugin: modelProvider, scope, config: undefined },
    { plugin: capture, scope, config: undefined }, { plugin: attachmentProvider, scope, config: undefined },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined }, { plugin: approvalPlugin, scope, config: { policy: 'ask' } },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: home } },
    { plugin: persistencePlugin, scope, config: { root: join(home, 'failed-close-sessions'), compression: 'none' } },
  ], 'host'))
  await host.start()
  if (app === undefined) throw new Error('ACP close carrier did not start')
  const application = app
  const done = host.run(scope, { kind: 'test' }, invocation => application.run([], invocation.signal)).catch((error: unknown) => error)
  const transport = new JsonRpcLineTransport(output, input)
  transport.onRequest(async (method, params) => {
    if (method !== 'session/request_permission') throw new Error(`unexpected ACP request ${method}`)
    permissionRequests.push(params)
    return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
  })
  transport.start()
  const requestSignal = (): AbortSignal => AbortSignal.timeout(10_000)
  try {
    if (rootExecution === undefined) throw new Error('ACP root execution service was not installed')
    const rootOperations = rootExecution
    const ready = rootOperations.ready(requestSignal())
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, requestSignal())
    await ready
    const created = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    let owner = activeSessions?.owners().find(candidate => candidate.session.id === created.sessionId)
    if (owner === undefined) throw new Error('ACP root owner was not attached')
    const route = rootOperations.capture(owner)
    expect(route).toMatchObject({ id: `acp:${created.sessionId}`, configuration: { cwd: home } })
    expect(rootOperations.workspaceRoutes()).toEqual([])
    expect('createWorkspaceRoute' in rootOperations).toBe(false)
    await expect(rootOperations.releaseIdle({ route: route.id, id: owner.session.id, expectedOwner: owner }, requestSignal()))
      .rejects.toThrow('native-headless: idle retirement route or Agent identity changed')
    const secondCwd = join(home, 'other-workspace')
    await mkdir(secondCwd)
    const second = await transport.request('session/new', { cwd: secondCwd, mcpServers: [] }, requestSignal()) as { sessionId: string }
    const secondOwner = activeSessions?.owners().find(candidate => candidate.session.id === second.sessionId)
    if (secondOwner === undefined) throw new Error('second ACP root owner was not attached')
    const secondRoute = rootOperations.capture(secondOwner)
    expect(secondRoute).toMatchObject({ id: `acp:${second.sessionId}`, configuration: { cwd: secondCwd } })
    await transport.request('session/close', { sessionId: second.sessionId }, requestSignal())
    expect(() => rootOperations.capture(secondOwner)).toThrow('active root owner has no live Session route')
    expect(rootOperations.capture(owner)).toBe(route)

    const cursorIds = new Map([[created.sessionId, '\u{10000}'], [second.sessionId, '\uE000']])
    for (const [id, alias] of cursorIds) cursorSessionIds.set(id, alias)
    tieSessionTimes = true
    const firstPage = await transport.request('session/list', {}, requestSignal()) as {
      sessions: readonly { sessionId: string; updatedAt: string }[]
      nextCursor?: string
    }
    const orderedCursorIds = ['\uE000', '\u{10000}']
    expect(firstPage.sessions.map(session => session.sessionId)).toEqual([orderedCursorIds[0]])
    expect(firstPage.sessions[0]?.updatedAt).toBe(new Date(tiedCreatedAt).toISOString())
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    const firstId = [...cursorIds].find(([, alias]) => alias === orderedCursorIds[0])?.[0]
    if (firstId === undefined) throw new Error('cursor fixture has no first Session')
    const firstWasOpen = activeSessions?.owners().some(candidate => candidate.session.id === firstId) === true
    if (firstWasOpen) await transport.request('session/close', { sessionId: firstId }, requestSignal())
    await transport.request('session/resume', {
      sessionId: firstId, cwd: firstId === created.sessionId ? home : secondCwd, mcpServers: [],
    }, requestSignal())
    const nextPage = await transport.request('session/list', { cursor: firstPage.nextCursor }, requestSignal()) as {
      sessions: readonly { sessionId: string; updatedAt: string }[]
      nextCursor?: string
    }
    expect(nextPage.sessions.map(session => session.sessionId)).toEqual([orderedCursorIds[1]])
    expect(nextPage.sessions[0]?.updatedAt).toBe(new Date(tiedCreatedAt).toISOString())
    expect(nextPage.nextCursor).toBeUndefined()
    const resumedRoute = firstId === created.sessionId ? route : secondRoute
    await rootOperations.maintenance({ route: resumedRoute.id, id: SessionId(firstId), resume: true }, async () => {}, requestSignal())
    const resumedOwner = activeSessions?.owners().find(candidate => candidate.session.id === firstId)
    if (resumedOwner === undefined) throw new Error('cursor Session did not resume')
    tieSessionTimes = false
    cursorSessionIds.clear()
    if (firstId === created.sessionId) owner = resumedOwner
    else await transport.request('session/close', { sessionId: firstId }, requestSignal())

    const freshId = SessionId('review-provider-fresh-root')
    await rootOperations.maintenance({ route: route.id, id: freshId, resume: false }, async (fresh) => {
      // Seed the fork boundary through the exact Engine owner and its only writer.
      fresh.append('turn/start', { turn: 1 })
      fresh.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await fresh.flush()
    }, requestSignal())
    const freshOwner = activeSessions?.owners().find(candidate => candidate.session.id === freshId)
    if (freshOwner === undefined) throw new Error('Provider-created fresh root owner was not attached')
    expect(rootOperations.capture(freshOwner)).toBe(route)
    if (approval === undefined) throw new Error('native approval Provider was not installed')
    await expect(approval.request({ id: NativeApprovalRequestId('provider-fresh-permission'), agent: freshOwner.agent,
      toolName: 'write_file', callId: ToolCallId('provider-fresh-call'), signal: requestSignal() })).resolves.toMatchObject({ outcome: 'allowed-once' })
    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0]).toMatchObject({ sessionId: created.sessionId,
      toolCall: { toolCallId: 'provider-fresh-call' },
      _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: { version: 1, permissionRequest: {
        sessionId: String(freshId), requestId: 'provider-fresh-permission',
        toolName: 'write_file', toolCallId: 'provider-fresh-call',
      } } } })
    const lookalikeOwner = { ...freshOwner }
    expect(() => rootOperations.capture(lookalikeOwner)).toThrow('active root owner has no live Session route')
    expect(() => rootOperations.cancel(lookalikeOwner)).toThrow('active root owner has no live Session route')
    const delegatedOwner = { ...freshOwner, invocation: 'delegated' as const }
    expect(() => rootOperations.capture(delegatedOwner)).toThrow('active root owner has no live Session route')
    expect(() => rootOperations.cancel(delegatedOwner)).toThrow('active root owner has no live Session route')
    await rootOperations.cancel(freshOwner)
    expect(() => rootOperations.capture(freshOwner)).toThrow('active root owner has no live Session route')
    expect(rootOperations.capture(owner)).toBe(route)

    const forkId = SessionId('review-provider-fork-root')
    await rootOperations.fork({ route: route.id, source: freshId, id: forkId }, requestSignal())
    const forkOwner = activeSessions?.owners().find(candidate => candidate.session.id === forkId)
    if (forkOwner === undefined) throw new Error('Provider-created fork owner was not attached')
    expect(rootOperations.capture(forkOwner)).toBe(route)
    await rootOperations.cancel(forkOwner)
    expect(rootOperations.capture(owner)).toBe(route)

    const cold = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    const coldOwner = activeSessions?.owners().find(candidate => candidate.session.id === cold.sessionId)
    if (coldOwner === undefined) throw new Error('cold-recovery ACP owner was not attached')
    coldOwner.append('turn/start', { turn: 1 })
    await coldOwner.flush()
    await transport.request('session/close', { sessionId: cold.sessionId }, requestSignal())
    await transport.request('session/resume', { sessionId: cold.sessionId, cwd: home, mcpServers: [] }, requestSignal())
    modelScript.push(textResponse('Cold recovery completed.'))
    const modelCountBeforeColdPrompt = model.requests.length
    unretainedOwners.add(SessionId(cold.sessionId))
    await expect(transport.request('session/prompt', { sessionId: cold.sessionId,
      prompt: [{ type: 'text', text: 'continue after recovery' }] }, requestSignal())).resolves.toEqual({ stopReason: 'end_turn' })
    expect(model.requests).toHaveLength(modelCountBeforeColdPrompt + 1)
    await transport.request('session/close', { sessionId: cold.sessionId }, requestSignal())

    armImageRead(imageReadRejection)
    const executionFailureEntered = Promise.withResolvers<undefined>()
    modelScript.push(assistantImageResponse(true), () => {
      executionFailureEntered.resolve(undefined)
      throw promptFailure
    })
    let failedPromptSettled = false
    const failedPrompt = transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'image followed by execution failure' }] }, requestSignal()).then(
      (value) => { failedPromptSettled = true; return { value } },
      (error: unknown) => { failedPromptSettled = true; return { error } },
    )
    await imageReadEntered.promise
    await executionFailureEntered.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(failedPromptSettled).toBe(false)
    expect(attachmentProviderReleased).toBe(false)
    imageReadRelease.resolve(undefined)
    const failedPromptResult = await failedPrompt
    if (!('error' in failedPromptResult)) throw new Error('prompt lost its model and image projection failures')
    expect(failedPromptResult.error).toBeInstanceOf(Error)
    expect(model.requests).toHaveLength(modelCountBeforeColdPrompt + 3)

    const cancelSession = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    armImageRead()
    modelScript.push(assistantImageResponse())
    let cancelledPromptSettled = false
    const cancelledPrompt = transport.request('session/prompt', { sessionId: cancelSession.sessionId,
      prompt: [{ type: 'text', text: 'image followed by ACP cancel' }] }, requestSignal()).then(
      (value) => { cancelledPromptSettled = true; return value },
      (error: unknown) => { cancelledPromptSettled = true; throw error },
    )
    await imageReadEntered.promise
    transport.notify('session/cancel', { sessionId: cancelSession.sessionId })
    await imageReadAborted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(cancelledPromptSettled).toBe(false)
    expect(attachmentProviderReleased).toBe(false)
    imageReadRelease.resolve(undefined)
    await expect(cancelledPrompt).resolves.toMatchObject({ stopReason: 'cancelled' })
    await transport.request('session/close', { sessionId: cancelSession.sessionId }, requestSignal())

    const closingSession = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    armImageRead()
    modelScript.push(assistantImageResponse())
    let closingPromptSettled = false
    const closingPrompt = transport.request('session/prompt', { sessionId: closingSession.sessionId,
      prompt: [{ type: 'text', text: 'image followed by session close' }] }, requestSignal()).then(
      (value) => { closingPromptSettled = true; return value },
      (error: unknown) => { closingPromptSettled = true; throw error },
    )
    await imageReadEntered.promise
    let closeSettled = false
    const closingRequest = transport.request('session/close', { sessionId: closingSession.sessionId }, requestSignal()).then(
      (value) => { closeSettled = true; return value },
      (error: unknown) => { closeSettled = true; throw error },
    )
    await imageReadAborted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closingPromptSettled).toBe(false)
    expect(closeSettled).toBe(false)
    expect(attachmentProviderReleased).toBe(false)
    imageReadRelease.resolve(undefined)
    await expect(closingPrompt).resolves.toMatchObject({ stopReason: 'cancelled' })
    await closingRequest
    expect(model.requests).toHaveLength(modelCountBeforeColdPrompt + 5)

    const closeFailureSession = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    if (!activeSessions?.owners().some(candidate => candidate.session.id === closeFailureSession.sessionId)) {
      throw new Error('writer-close failure fixture owner was not attached')
    }
    failClose = true
    const closing = transport.request('session/close', { sessionId: closeFailureSession.sessionId }, requestSignal()).catch((error: unknown) => error)
    await entered.promise
    const rejected = async (): Promise<void> => {
      await expect(transport.request('session/resume', { sessionId: closeFailureSession.sessionId, cwd: home, mcpServers: [] }, requestSignal()))
        .rejects.toThrow('session is already active')
      await expect(transport.request('session/prompt', { sessionId: closeFailureSession.sessionId, prompt: [{ type: 'text', text: 'late input' }] }, requestSignal()))
        .rejects.toThrow('session is closing')
      await expect(transport.request('session/set_config_option', { sessionId: closeFailureSession.sessionId, configId: 'model', value: 'late' }, requestSignal()))
        .rejects.toThrow('session is closing')
    }
    await rejected()
    release.resolve(undefined)
    expect(await closing).toBeInstanceOf(Error)
    await rejected()
    expect(model.requests).toHaveLength(modelCountBeforeColdPrompt + 5)

    const eofSession = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    armImageRead()
    modelScript.push(assistantImageResponse())
    let eofSettled = false
    let eofPromptSettled = false
    void done.then(() => { eofSettled = true }, () => { eofSettled = true })
    void transport.request('session/prompt', { sessionId: eofSession.sessionId,
      prompt: [{ type: 'text', text: 'image followed by ACP EOF' }] }, requestSignal())
      .then(() => { eofPromptSettled = true }, () => { eofPromptSettled = true })
    await imageReadEntered.promise
    input.end()
    await imageReadAborted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(eofSettled).toBe(false)
    expect(eofPromptSettled).toBe(false)
    expect(attachmentProviderReleased).toBe(false)
    imageReadRelease.resolve(undefined)
    expect(causes(await done)).toContain(failure)
  } finally {
    release.resolve(undefined)
    imageReadRelease.resolve(undefined)
    input.end()
    await done
    try { await host.stop() } catch (error) { expect(causes(error)).toContain(failure) }
    transport.close()
    input.destroy()
    output.destroy()
  }
}

it('admits ordered ACP images, rejects malformed data, restores history and drains cancellation and EOF', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-acp-lifecycle-'))
  const instructionWorkspace = join(home, 'instruction-workspace')
  await mkdir(join(instructionWorkspace, '.git'), { recursive: true })
  await writeFile(join(instructionWorkspace, 'AGENTS.md'), `# Workspace fixture\n${workspaceInstruction}\n`)
  await writeFile(join(home, 'AGENTS.md'), `# Isolated global fixture\n${globalInstruction}\n`)
  const entered = Promise.withResolvers<undefined>()
  let toolTurn = false
  let mcpCall: { name: string; arguments: string } | undefined
  let permissionEntered = Promise.withResolvers<undefined>()
  let permissionRelease = Promise.withResolvers<undefined>()
  let permissionSettled = Promise.withResolvers<undefined>()
  let holdPermission = false
  const permissionRequests: Record<string, unknown>[] = []
  const mcpLifecycleFile = join(home, 'mcp-fixture-starts.jsonl')
  await writeFile(mcpLifecycleFile, '')
  let lastUpdate: unknown
  const sessionUpdates: unknown[] = []
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages: readonly { role: string; content?: unknown }[] }
      requests.push(payload)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (JSON.stringify(payload.messages).includes(instructionPrompt)) {
        response.end([
          { choices: [{ delta: { role: 'assistant', content: 'ACP workspace guidance received.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      if (toolTurn) {
        const imageResultReturned = mcpCall?.name === 'mcp__fixture__image'
          && payload.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('Here is an image:'))
        const events = payload.messages.at(-1)?.role === 'tool' || imageResultReturned
          ? [{ choices: [{ delta: { role: 'assistant', content: 'permission tool settled' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] }]
          : [{ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'permission-call', type: 'function',
            function: mcpCall ?? { name: 'write_file', arguments: JSON.stringify({ path: 'permission.txt', content: 'forbidden' }) } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":"partial"}}]}\n\n')
      entered.resolve(undefined)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('model endpoint did not bind')
  const patch = join(home, 'model.patch.json')
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'ACP lifecycle fixture', maxSteps: 2,
      sessionListPageSize: 1 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_ACP_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
  ] }))
  let child = launchAcp(home, patch)
  let transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  const bindTransport = (current: JsonRpcLineTransport): void => {
    current.onNotification((method, params) => { if (method === 'session/update') {
      lastUpdate = params.update
      sessionUpdates.push(params.update)
    } })
    current.onRequest(async (method, params) => {
      expect(method).toBe('session/request_permission')
      expect(lastUpdate).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 'permission-call' })
      expect(params.options).toMatchObject([{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }])
      permissionRequests.push(params)
      if (!holdPermission) return { outcome: { outcome: 'selected', optionId: 'unknown-grant' } }
      permissionEntered.resolve(undefined)
      try {
        await permissionRelease.promise
        return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
      } finally { permissionSettled.resolve(undefined) }
    })
  }
  bindTransport(transport)
  transport.start()
  const requestSignal = (): AbortSignal => AbortSignal.timeout(20_000)
  let instructionSessionId: string | undefined
  const http = await startHttpMcpFixture()
  try {
    expect(await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {},
      _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: { version: 1, permissionRelay: true } } }, requestSignal()))
      .toMatchObject({ agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: false } },
        _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: {
          version: 1, capabilities: { permissionRequestIdentity: true, maxSteps: true, maxTokens: true, permissionModes: ['deny', 'parent-relay'] },
        } } })
    const acceptedPolicy = { version: 1, maxSteps: 2, permissionMode: 'parent-relay' } as const
    const created = await transport.request('session/new', { cwd: home, mcpServers: [],
      _meta: { [NATIVE_ACP_SUBAGENT_METADATA_KEY]: acceptedPolicy } }, requestSignal()) as {
      sessionId: string
      _meta?: Record<string, unknown>
    }
    expect(created._meta).toEqual({ [NATIVE_ACP_SUBAGENT_METADATA_KEY]: acceptedPolicy })
    expect(sessionUpdates.at(-1)).toMatchObject({ sessionUpdate: 'available_commands_update',
      availableCommands: expect.arrayContaining([{ name: 'compact', description: 'Compact older conversation history' }]) as unknown })
    const requestsBeforeCompact = requests.length
    expect(await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: '/compact' }] }, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    expect(requests).toHaveLength(requestsBeforeCompact)
    expect(sessionUpdates.at(-1)).toMatchObject({ sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'No compactable history yet.' } })
    await expect(transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'image', mimeType: 'image/png', data: 'not-base64' }] }, requestSignal())).rejects.toThrow()
    expect(requests).toHaveLength(0)
    const image = (await readFile(join(root, 'snapshots/native-sdk/text-turn/image.png'))).toString('base64')
    const params = { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'wait until cancelled' },
      { type: 'image', mimeType: 'image/png', data: image }] }
    const prompt = transport.request('session/prompt', params, requestSignal())
    void prompt.catch(() => {}) // The later assertion owns failures; teardown must not create an unhandled rejection.
    await entered.promise
    const sent = requests[0] as { messages: readonly { role: string; content: readonly Record<string, unknown>[] }[] }
    const user = sent.messages.find(message => message.role === 'user')
    expect(user?.content[0]).toEqual({ type: 'text', text: 'wait until cancelled' })
    const imagePart = user?.content.find(part => part.type === 'image_url')
    expect(imagePart?.image_url).toHaveProperty('url', expect.stringMatching(/^data:image\/png;base64,/))
    await expect(transport.request('session/prompt', params, requestSignal())).rejects.toThrow('session prompt is already running')
    const configured = transport.request('session/set_config_option', { sessionId: created.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, requestSignal())
    void configured.catch(() => {}) // Its assertion owns the protocol result after prompt drain.
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await prompt).toMatchObject({ stopReason: 'cancelled' })
    expect(await configured).toMatchObject({ configOptions: [{ id: 'model', currentValue: JSON.stringify(['fixture', 'fixture-model']) }] })
    toolTurn = true
    const permissionParams = { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'ask before writing permission.txt' }] }
    expect(await transport.request('session/prompt', permissionParams, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    await expect(readFile(join(home, 'permission.txt'))).rejects.toHaveProperty('code', 'ENOENT')
    holdPermission = true
    const cancelledPermission = transport.request('session/prompt', permissionParams, requestSignal())
    void cancelledPermission.catch(() => {}) // Its assertion owns the cancelled prompt response.
    await permissionEntered.promise
    transport.notify('session/cancel', { sessionId: created.sessionId })
    await transport.flush()
    expect(await cancelledPermission).toMatchObject({ stopReason: 'cancelled' })
    await transport.request('session/close', { sessionId: created.sessionId }, requestSignal())
    await transport.request('session/resume', { sessionId: created.sessionId, cwd: home, mcpServers: [] }, requestSignal())
    expect(sessionUpdates.at(-1)).toMatchObject({ sessionUpdate: 'available_commands_update',
      availableCommands: expect.arrayContaining([{ name: 'compact', description: 'Compact older conversation history' }]) as unknown })
    expect(await transport.request('session/prompt', permissionParams, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    expect(permissionRequests).toHaveLength(2)
    permissionRelease.resolve(undefined)
    await permissionSettled.promise
    await expect(readFile(join(home, 'permission.txt'))).rejects.toHaveProperty('code', 'ENOENT')
    const stdioServers = [{ name: 'fixture', command: process.execPath,
      args: [join(root, 'rsh/Modules/Official/mcp/mcp-client/tests/fixture-server.ts')],
      env: [{ name: 'MCP_FIXTURE_LIFECYCLE_FILE', value: mcpLifecycleFile }] }]
    await expect(transport.request('session/new', { cwd: home, mcpServers: [{ ...stdioServers[0],
      command: join(home, 'missing-mcp-server') }] }, requestSignal())).rejects.toMatchObject({
      name: 'JsonRpcResponseError', code: -32603, message: 'Internal error',
      data: { details: 'mcp-client(fixture): initial connection or tool synchronization failed' },
    })
    const stdioSession = await transport.request('session/new', { cwd: home, mcpServers: stdioServers }, requestSignal()) as { sessionId: string }
    await vi.waitFor(async () => { expect(await readMcpFixtureStarts(mcpLifecycleFile)).toHaveLength(1) },
      { timeout: 5_000, interval: 10 })
    const [firstMcpStart] = await readMcpFixtureStarts(mcpLifecycleFile)
    if (firstMcpStart === undefined) throw new Error('ACP MCP server did not publish its PID')
    expect(isProcessAlive(firstMcpStart.pid)).toBe(true)
    const httpSession = await transport.request('session/new', { cwd: home, mcpServers: [{ type: 'http', name: 'fixture',
      url: http.url, headers: [{ name: 'Authorization', value: 'Bearer native-acp-test' }] }] }, requestSignal()) as { sessionId: string }
    const firstPage = await transport.request('session/list', { cwd: home }, requestSignal()) as {
      sessions: readonly { sessionId: string }[]
      nextCursor?: string
    }
    expect(firstPage.sessions).toHaveLength(1)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    await expect(transport.request('session/list', { cursor: '%%%' }, requestSignal())).rejects.toThrow('session/list cursor is invalid')
    const listed = [...firstPage.sessions]
    let cursor = firstPage.nextCursor
    while (cursor !== undefined) {
      const page = await transport.request('session/list', { cwd: home, cursor }, requestSignal()) as {
        sessions: readonly { sessionId: string }[]
        nextCursor?: string
      }
      expect(page.sessions).toHaveLength(1)
      listed.push(...page.sessions)
      cursor = page.nextCursor
    }
    const expectedSessionIds = [created.sessionId, stdioSession.sessionId, httpSession.sessionId]
    expect(new Set(listed.map(session => session.sessionId))).toEqual(new Set(expectedSessionIds))
    expect(listed).toHaveLength(3)
    const mcpPrompt = async (sessionId: string, expected: string, absent: string): Promise<void> => {
      const before = requests.length
      expect(await transport.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'use selected MCP tool' }] }, requestSignal()))
        .toMatchObject({ stopReason: 'end_turn' })
      const request = requests[before] as { tools: readonly { function: { name: string } }[] }
      const names = request.tools.map(tool => tool.function.name)
      expect(names).toContain(expected)
      expect(names).not.toContain(absent)
      const next = requests[before + 1] as { messages: readonly { role: string; content: string }[] }
      expect(next.messages.filter(message => message.role === 'tool').at(-1)?.content).toContain(expected.endsWith('add') ? '5' : 'pong')
    }
    mcpCall = { name: 'mcp__fixture__add', arguments: JSON.stringify({ a: 2, b: 3 }) }
    await mcpPrompt(stdioSession.sessionId, 'mcp__fixture__add', 'mcp__fixture__ping')
    mcpCall = { name: 'mcp__fixture__image', arguments: '{}' }
    const updatesBeforeImageTool = sessionUpdates.length
    expect(await transport.request('session/prompt', { sessionId: stdioSession.sessionId,
      prompt: [{ type: 'text', text: 'use selected MCP tool' }] }, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    const imageToolUpdate = sessionUpdates.slice(updatesBeforeImageTool).find((update: unknown) =>
      (update as { sessionUpdate?: string }).sessionUpdate === 'tool_call_update'
      && JSON.stringify(update).includes('"type":"image"'))
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
    const imageToolUpdateContent = isRecord(imageToolUpdate) ? imageToolUpdate.content : undefined
    const hasImagePayload = Array.isArray(imageToolUpdateContent) && imageToolUpdateContent.some((block: unknown) =>
      isRecord(block) && block.type === 'content' && isRecord(block.content)
      && block.content.type === 'image' && block.content.mimeType === 'image/png')
    expect(hasImagePayload).toBe(true)
    await transport.request('session/close', { sessionId: stdioSession.sessionId }, requestSignal())
    expect(isProcessAlive(firstMcpStart.pid)).toBe(false)
    mcpCall = { name: 'mcp__fixture__ping', arguments: '{}' }
    await mcpPrompt(httpSession.sessionId, 'mcp__fixture__ping', 'mcp__fixture__add')
    expect(http.authorization).toContain('Bearer native-acp-test')
    await transport.request('session/resume', { sessionId: stdioSession.sessionId, cwd: home, mcpServers: stdioServers }, requestSignal())
    await vi.waitFor(async () => { expect(await readMcpFixtureStarts(mcpLifecycleFile)).toHaveLength(2) },
      { timeout: 5_000, interval: 10 })
    const [, resumedMcpStart] = await readMcpFixtureStarts(mcpLifecycleFile)
    if (resumedMcpStart === undefined) throw new Error('resumed ACP MCP server did not publish its PID')
    expect(resumedMcpStart.nonce).not.toBe(firstMcpStart.nonce)
    expect(isProcessAlive(resumedMcpStart.pid)).toBe(true)
    mcpCall = { name: 'mcp__fixture__add', arguments: JSON.stringify({ a: 2, b: 3 }) }
    await mcpPrompt(stdioSession.sessionId, 'mcp__fixture__add', 'mcp__fixture__ping')
    await transport.request('session/close', { sessionId: stdioSession.sessionId }, requestSignal())
    expect(isProcessAlive(resumedMcpStart.pid)).toBe(false)
    await transport.request('session/close', { sessionId: httpSession.sessionId }, requestSignal())
    mcpCall = undefined
    const instructionsSession = await transport.request('session/new', { cwd: instructionWorkspace, mcpServers: [] }, requestSignal()) as { sessionId: string }
    instructionSessionId = instructionsSession.sessionId
    const firstInstructionRequest = requests.length
    expect(await transport.request('session/prompt', { sessionId: instructionsSession.sessionId,
      prompt: [{ type: 'text', text: instructionPrompt }] }, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    expect(requests).toHaveLength(firstInstructionRequest + 1)
    expect(modelRequestText(requests[firstInstructionRequest])).toContain(workspaceInstruction)
    expect(modelRequestText(requests[firstInstructionRequest])).toContain(globalInstruction)
    await transport.request('session/close', { sessionId: instructionsSession.sessionId }, requestSignal())
    permissionEntered = Promise.withResolvers<undefined>()
    permissionRelease = Promise.withResolvers<undefined>()
    permissionSettled = Promise.withResolvers<undefined>()
    const fresh = await transport.request('session/new', { cwd: home, mcpServers: [] }, requestSignal()) as { sessionId: string }
    const pending = transport.request('session/prompt', { ...permissionParams, sessionId: fresh.sessionId }, requestSignal()).catch((error: unknown) => error)
    await permissionEntered.promise
    const closingSelection = transport.request('session/set_config_option', { sessionId: fresh.sessionId,
      configId: 'model', value: JSON.stringify(['fixture', 'fixture-model']) }, requestSignal()).catch((error: unknown) => error)
    child.stdin.end()
    const exit = await child
    expect(exit.timedOut).toBe(false)
    expect(exit.signal).toBeUndefined()
    expect(exit.exitCode, exit.stderr).toBe(0)
    const firstProcessPid = child.pid
    transport.close()
    await pending
    expect(await closingSelection).toBeInstanceOf(Error)

    child = launchAcp(home, patch)
    expect(child.pid).toBeDefined()
    expect(child.pid).not.toBe(firstProcessPid)
    transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    bindTransport(transport)
    transport.start()
    expect(await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, requestSignal()))
      .toMatchObject({ agentCapabilities: { promptCapabilities: { image: true, audio: false, embeddedContext: false } } })
    await transport.request('session/resume', { sessionId: instructionSessionId, cwd: instructionWorkspace, mcpServers: [] }, requestSignal())
    const beforeColdPrompt = requests.length
    expect(await transport.request('session/prompt', { sessionId: instructionSessionId,
      prompt: [{ type: 'text', text: resumedInstructionPrompt }] }, requestSignal())).toMatchObject({ stopReason: 'end_turn' })
    expect(requests).toHaveLength(beforeColdPrompt + 1)
    expect(modelRequestText(requests[beforeColdPrompt])).toContain(workspaceInstruction)
    expect(modelRequestText(requests[beforeColdPrompt])).toContain(globalInstruction)
    expect(modelRequestText(requests[beforeColdPrompt])).toContain(resumedInstructionPrompt)
    await transport.request('session/close', { sessionId: instructionSessionId }, requestSignal())
    child.stdin.end()
    const coldExit = await child
    expect(coldExit.timedOut).toBe(false)
    expect(coldExit.signal).toBeUndefined()
    expect(coldExit.exitCode, coldExit.stderr).toBe(0)
    transport.close()

    const paths = await readdir(join(home, 'sessions'), { recursive: true })
    const logs = await Promise.all(paths.filter(path => path.endsWith('session.v3.jsonl')).map(path => readFile(join(home, 'sessions', path), 'utf8')))
    expect(logs).toHaveLength(5)
    const previous = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === created.sessionId)
    if (previous === undefined) throw new Error('durable ACP Session missing')
    const current = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === fresh.sessionId)
    if (current === undefined) throw new Error('durable fresh ACP Session missing')
    const events = [previous, current].flatMap(log => log.trim().split('\n').slice(1)
      .map(line => JSON.parse(line) as {
        type: string
        data: {
          id?: string
          callId?: string
          reason?: { kind: string }
          version?: number
          maxSteps?: number
          permission?: { mode: string; authority?: string }
        }
      }))
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(5)
    expect(events.filter(event => event.type === 'execution/policy')).toMatchObject([{
      data: { version: 1, maxSteps: 2, permission: { mode: 'require-approval', authority: 'session-owner' } },
    }])
    const askedEvents = events.filter(event => event.type === 'native-approval/asked')
    const askedIds = askedEvents.map(event => event.data.id)
    const decidedIds = events.filter(event => event.type === 'native-approval/decided').map(event => event.data.id)
    const relayedPermissions = permissionRequests.map((request) => {
      const metadata = readNativeAcpSubagentPermissionRequest(request._meta)
      if (metadata === undefined) throw new Error('ACP permission request omitted native identity metadata')
      return metadata
    })
    expect(decidedIds).toEqual(askedIds)
    const askedRequests = askedEvents.map(event => ({ id: event.data.id, callId: event.data.callId }))
    for (const request of relayedPermissions) {
      expect(askedRequests).toContainEqual({ id: request.requestId, callId: request.toolCallId })
    }
    expect(relayedPermissions.map(request => request.sessionId)).toEqual(permissionRequests.map(request => request.sessionId))
    expect(events.filter(event => event.type === 'native-approval/decided').map(event => event.data))
      .toMatchObject([{ outcome: 'rejected' }, { outcome: 'cancelled' }, { outcome: 'unavailable' }, { outcome: 'cancelled' }])
    expect(events.filter(event => event.type === 'model/selection')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('turn/end')
    const instructionLog = logs.find(log => (JSON.parse(log.split('\n')[0]!) as { id: string }).id === instructionSessionId)
    if (instructionLog === undefined) throw new Error('durable ACP instructions Session missing')
    const instructionEvents = instructionLog.trim().split('\n').slice(1).map(line => JSON.parse(line) as {
      type: string
      data: { source?: { kind?: string }; content?: unknown }
    }).filter(event => event.type === 'user/message' && event.data.source?.kind === 'agent-instructions')
    expect(instructionEvents).toHaveLength(1)
    const instructionText = Array.isArray(instructionEvents[0]?.data.content)
      ? (instructionEvents[0].data.content as { type?: unknown; text?: unknown }[])
        .flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
      : ''
    expect(instructionText).toContain(workspaceInstruction)
    expect(instructionText).toContain(globalInstruction)
    const instructionRequests = requests.filter(value => JSON.stringify(value).includes(instructionPrompt)) as {
      messages: readonly { role: string; content: unknown }[]
    }[]
    expect(instructionRequests).toHaveLength(2)
    for (const request of instructionRequests) {
      const text = modelRequestText(request)
      expect(text).toContain(instructionText)
      expect(text.split(instructionText)).toHaveLength(2)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    permissionRelease.resolve(undefined)
    child.stdin.end()
    const exit = await child
    throw new Error(`${message}\nACP launcher stderr:\n${exit.stderr}`, { cause: error })
  } finally {
    permissionRelease.resolve(undefined)
    transport.close()
    child.stdin.end()
    await child
    await http.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    for (const start of await readMcpFixtureStarts(mcpLifecycleFile)) {
      await vi.waitFor(() => { expect(isProcessAlive(start.pid)).toBe(false) }, { timeout: 5_000, interval: 10 })
    }
    await rm(home, { recursive: true, force: true })
  }
})

it('routes fresh and forked Provider roots through their exact ACP Session route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-acp-root-owner-'))
  try { await failedClose(home) } finally { await rm(home, { recursive: true, force: true }) }
})
