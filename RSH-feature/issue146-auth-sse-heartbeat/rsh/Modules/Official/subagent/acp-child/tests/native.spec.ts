import { PassThrough, Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/native'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '@deepseek-ai/dsh-native-subagent/native'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { nativeAcpSubagentPermissionRequestMetadata, nativeAcpSubagentPolicyMetadata,
  nativeAcpSubagentServerMetadata } from '@deepseek-ai/dsh-acp-protocol'
import { plugin } from '../src/native.ts'
import type { NativeAcpChildRuntime, NativeAcpChildRuntimeRequest } from '../src/runtime.ts'

const provider = 'fixture-provider'
const model = 'fixture-model'
const route = JSON.stringify([provider, model])
const childSessionId = 'acp-child-session'
const nativeSessionId = 'native-child-session'
const callId = 'write-call-1'
const policy = { version: 1, maxSteps: 2, maxTokens: 64, permissionMode: 'parent-relay' } as const

interface FixtureOptions {
  readonly permissionOptions?: RequestPermissionRequest['options']
  readonly holdPrompt?: boolean
  readonly holdCancelWrite?: boolean
  readonly holdShutdown?: boolean
  readonly stderrBytes?: number
  readonly earlySessionId?: string
  readonly enforcement?: NativeAcpChildRuntime['enforcement']
}

function deferred<T = void>(): PromiseWithResolvers<T> {
  return Promise.withResolvers<T>()
}

function createFixture(options: FixtureOptions = {}) {
  const clientToAgent = new PassThrough()
  const agentToClient = new PassThrough()
  const stderr = new PassThrough()
  const cancelWriteEntered = deferred()
  const releaseCancelWrite = deferred()
  const promptStarted = deferred()
  const releasePrompt = deferred()
  const shutdownStarted = deferred()
  const releaseShutdown = deferred()
  const cancelReceived = deferred()
  let heldCancelWrite = false
  let shutdownCount = 0
  let disposeCount = 0
  let approvalCount = 0
  let launchRequest: NativeAcpChildRuntimeRequest | undefined
  let driver: NativeExternalSubagentDriver | undefined

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (options.holdCancelWrite && bytes.toString().includes('"method":"session/cancel"')) {
        heldCancelWrite = true
        cancelWriteEntered.resolve()
        void releaseCancelWrite.promise.then(() => {
          clientToAgent.write(bytes, callback)
        }, (error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)))
        })
        return
      }
      clientToAgent.write(bytes, callback)
    },
  })

  const server = agent()
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [],
      agentInfo: { name: 'test-acp-agent', version: '1' },
      _meta: nativeAcpSubagentServerMetadata({
        permissionRequestIdentity: true,
        maxSteps: true,
        maxTokens: true,
        permissionModes: ['deny', 'parent-relay'],
      }),
    }))
    .onRequest(methods.agent.session.new, async ({ client: peerClient }) => {
      await peerClient.notify(methods.client.session.update, { sessionId: options.earlySessionId ?? childSessionId,
        update: { sessionUpdate: 'available_commands_update', availableCommands: [] } })
      return {
        sessionId: childSessionId,
        configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: route,
          options: [{ value: route, name: 'Fixture model' }] }],
        _meta: nativeAcpSubagentPolicyMetadata(policy),
      }
    })
    .onRequest(methods.agent.session.prompt, async ({ client: peerClient }) => {
      promptStarted.resolve()
      if (options.holdPrompt) {
        await releasePrompt.promise
        return { stopReason: 'cancelled' }
      }
      await peerClient.notify(methods.client.session.update, { sessionId: childSessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: callId, title: 'Write file', name: 'write_file', kind: 'edit', status: 'pending' } })
      let permission: RequestPermissionResponse
      try {
        permission = await peerClient.request(methods.client.session.requestPermission, {
          sessionId: childSessionId,
          toolCall: { toolCallId: callId, title: 'Write file', name: 'write_file', kind: 'edit', status: 'pending' },
          options: options.permissionOptions ?? [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
          ],
          _meta: nativeAcpSubagentPermissionRequestMetadata({ sessionId: nativeSessionId,
            requestId: 'approval-request-1', toolName: 'write_file', toolCallId: callId }),
        })
      } catch {
        return { stopReason: 'cancelled' }
      }
      if (permission.outcome.outcome !== 'selected' || permission.outcome.optionId !== 'allow-once') {
        return { stopReason: 'cancelled' }
      }
      await peerClient.notify(methods.client.session.update, { sessionId: childSessionId,
        update: { sessionUpdate: 'agent_message_chunk', messageId: 'assistant-message-1', content: { type: 'text', text: 'Write approved.' } } })
      return { stopReason: 'end_turn' }
    })
    .onNotification(methods.agent.session.cancel, () => {
      cancelReceived.resolve()
      releasePrompt.resolve()
    })
  const peer = server.connect(ndJsonStream(
    Writable.toWeb(agentToClient) as WritableStream<Uint8Array>,
    Readable.toWeb(clientToAgent) as ReadableStream<Uint8Array>,
  ))

  const base: NativePlugin = {
    apiVersion: 1, name: 'acp-child-test-base', targets: ['host'], requires: [],
    provides: ['credentials', 'acpChildRuntimeLauncher'],
    resolve: () => (context) => {
      context.provide('credentials', { resolve: async (ref: CredentialRef) => ref === credentialRef('FIXTURE_ACP_KEY')
        ? { value: 'fixture-secret', source: 'test' } : undefined } as never)
      context.provide('acpChildRuntimeLauncher', {
        async launch(request: NativeAcpChildRuntimeRequest): Promise<NativeAcpChildRuntime> {
          launchRequest = request
          if (options.stderrBytes !== undefined) stderr.write(Buffer.alloc(options.stderrBytes))
          return {
            child: { stdin, stdout: agentToClient, stderr, done: Promise.resolve() } as never,
            enforcement: options.enforcement ?? 'full',
            async shutdown() {
              shutdownCount += 1
              shutdownStarted.resolve()
              if (options.holdShutdown) await releaseShutdown.promise
              peer.close(new Error('test process shutdown'))
              if (!stderr.destroyed) stderr.end()
            },
            async dispose() { disposeCount += 1 },
          }
        },
      })
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'acp-child-test-capture', targets: ['host'], requires: ['externalSubagentDriver'], provides: [],
    resolve: () => (context) => { driver = context.require('externalSubagentDriver') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin, scope, config: { providerName: 'test-acp-child', providers: { [provider]: { apiKeyEnv: 'FIXTURE_ACP_KEY' } } } },
    { plugin: base, scope, config: undefined },
  ], 'host'))

  const request = (): NativeExternalSubagentRequest => {
    const parentSessionId = SessionId('parent-session')
    const id = 'external-operation-1' as NativeExternalSubagentRequest['id']
    return {
      id,
      parentSessionId,
      rootSessionId: parentSessionId,
      parentEpoch: 'parent-epoch-1',
      rootEpoch: 'root-epoch-1',
      parentDepth: 0,
      maxDepth: 1,
      limits: { maxSteps: 2, maxTokens: 64 },
      authority: {
        toolNames: ['read_file', 'write_file'], programToolNames: [], builtinToolNames: ['read_file', 'write_file'],
        approvalRequired: true,
        sandboxPolicy: { mode: 'workspace-write', workspaceRoot: 'C:/fixture', sessionId: parentSessionId },
      },
      label: 'Write one fixture file',
      cwd: 'C:/fixture',
      prompt: [{ type: 'text', text: 'Write one fixture file.' }],
      route: { provider, model, overrides: {} },
      model: {} as NativeExternalSubagentRequest['model'],
      approval: {
        operationId: id,
        async request(input) {
          approvalCount += 1
          expect(input).toMatchObject({ operationId: id, requestId: 'approval-request-1', toolName: 'write_file', callId })
          return 'allowed-once'
        },
      },
    }
  }

  return {
    host,
    request,
    cancelWriteEntered: cancelWriteEntered.promise,
    releaseCancelWrite: releaseCancelWrite.resolve,
    promptStarted: promptStarted.promise,
    releasePrompt: releasePrompt.resolve,
    shutdownStarted: shutdownStarted.promise,
    releaseShutdown: releaseShutdown.resolve,
    cancelReceived: cancelReceived.promise,
    get heldCancelWrite() { return heldCancelWrite },
    get shutdownCount() { return shutdownCount },
    get disposeCount() { return disposeCount },
    get approvalCount() { return approvalCount },
    get stderrBufferedBytes() { return stderr.readableLength },
    failStderr() { stderr.destroy(new Error('fixture stderr failure')) },
    get launchRequest() { return launchRequest },
    get driver() {
      if (driver === undefined) throw new Error('test composition did not expose the ACP child driver')
      return driver
    },
  }
}

const permissionCases: {
  readonly name: string
  readonly options: RequestPermissionRequest['options']
  readonly approved: boolean
  readonly enforcement: NativeAcpChildRuntime['enforcement']
}[] = [
  { name: 'matching one-shot choices', options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  ], approved: true, enforcement: 'partial' },
  { name: 'an allow-always kind', options: [
    { optionId: 'allow-once', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  ], approved: false, enforcement: 'full' },
  { name: 'duplicate option IDs', options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    { optionId: 'allow-once', name: 'Also allow', kind: 'allow_once' },
  ], approved: false, enforcement: 'full' },
  { name: 'ambiguous one-shot kinds', options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-once-alt', name: 'Also allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  ], approved: false, enforcement: 'full' },
]

it.each(permissionCases)('relays only $name', async ({ options, approved, enforcement }) => {
  const fixture = createFixture({ permissionOptions: options, stderrBytes: 1024 * 1024, enforcement })
  await fixture.host.start()
  try {
    const run = await fixture.driver.start(fixture.request(), new AbortController().signal)
    const result = run.result
    if (approved) {
      await expect(result).resolves.toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: 'Write approved.' }] })
      expect(fixture.approvalCount).toBe(1)
      expect(fixture.launchRequest).toMatchObject({ provider, model, permissionMode: 'parent-relay',
        builtinTools: ['read_file', 'write_file'], allowedTools: ['read_file', 'write_file'],
        workspaceWriteRoot: 'C:/fixture', environment: { FIXTURE_ACP_KEY: 'fixture-secret' } })
      expect(fixture.launchRequest?.providerProfile).toEqual({ apiKeyEnv: 'FIXTURE_ACP_KEY' })
    } else {
      await expect(result).rejects.toThrow(/one-shot permission choices/)
      expect(fixture.approvalCount).toBe(0)
    }
    await fixture.shutdownStarted
    expect(fixture.shutdownCount).toBe(1)
    expect(fixture.disposeCount).toBe(1)
    expect(fixture.stderrBufferedBytes).toBe(0)
  } finally {
    await fixture.host.stop()
  }
})

it('rejects an early session update that does not match the created ACP Session', async () => {
  const fixture = createFixture({ earlySessionId: 'unrelated-acp-session' })
  await fixture.host.start()
  try {
    await expect(fixture.driver.start(fixture.request(), new AbortController().signal))
      .rejects.toThrow('dsh-acp-child received an update for an unknown ACP Session')
    expect(fixture.shutdownCount).toBe(1)
    expect(fixture.disposeCount).toBe(1)
  } finally {
    await fixture.host.stop()
  }
})

it('fails the run and settles the child when its stderr stream errors', async () => {
  const fixture = createFixture({ holdPrompt: true })
  await fixture.host.start()
  try {
    const run = await fixture.driver.start(fixture.request(), new AbortController().signal)
    const result = run.result
    void result.catch(() => {})
    await fixture.promptStarted
    fixture.failStderr()
    await expect(result).rejects.toThrow('dsh-acp-child prompt and cleanup failed')
    expect(fixture.shutdownCount).toBe(1)
    expect(fixture.disposeCount).toBe(1)
  } finally {
    await fixture.host.stop()
  }
})

it('starts range shutdown before a backpressured cancel write and drains cleanup once', async () => {
  const fixture = createFixture({ holdPrompt: true, holdCancelWrite: true, holdShutdown: true })
  await fixture.host.start()
  const controller = new AbortController()
  try {
    const run = await fixture.driver.start(fixture.request(), controller.signal)
    const result = run.result
    void result.catch(() => {})
    await fixture.promptStarted
    controller.abort(new Error('test cancellation'))
    await fixture.cancelWriteEntered
    expect(fixture.heldCancelWrite).toBe(true)
    await fixture.shutdownStarted
    expect(fixture.shutdownCount).toBe(1)
    expect(fixture.disposeCount).toBe(0)
    fixture.releaseCancelWrite()
    await fixture.cancelReceived
    fixture.releaseShutdown()
    await expect(result).resolves.toMatchObject({ stopReason: 'aborted' })
    await run.dispose()
    expect(fixture.shutdownCount).toBe(1)
    expect(fixture.disposeCount).toBe(1)
  } finally {
    fixture.releaseCancelWrite()
    fixture.releasePrompt()
    fixture.releaseShutdown()
    await fixture.host.stop()
  }
})
