/** Standard ACP carrier over the shared native Agent and Session executor. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError,
  type AgentConnection, type NewSessionRequest, type PromptRequest, type PromptResponse,
  type SessionUpdate, type SessionNotification, type SessionConfigOption } from '@agentclientprotocol/sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createNativeHeadlessApplication, type NativeHeadlessApplication, type NativeTurnRequest } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { isImageAdmissionError, type AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/native'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeRootExecutionOperations, NativeRootForkRequest, NativeRootRouteId,
  NativeRootSessionDeletionOperations, NativeRootSessionRequest, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeScope, ResourceOwner } from '@deepseek-ai/dsh-native-runtime'
import { installNativeMcpClient, resolveNativeMcpConfig, type Config as McpConfig } from '@deepseek-ai/dsh-mcp-client/native'
import { AcpMcpConfigError, resolveAcpMcpConfigs } from '@deepseek-ai/dsh-mcp-client/acp-config'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeApprovalAnswererRequest, NativeApprovalOutcome } from '@deepseek-ai/dsh-approval-definition'
import { NativeAcpModelControls } from './model-controls.ts'

/** Profile-owned model route and turn policy. */
export interface Config {
  /** Provider route selected for every ACP Session. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Base prompt recorded in model history. */
  readonly systemPrompt: string
  /** Positive maximum model steps per turn. */
  readonly maxSteps: number
  /** Maximum unsettled permission wire requests; defaults to 32. */
  readonly maxPendingPermissions?: number
  /** MCP tool timeout in milliseconds; defaults to 60000. */
  readonly mcpToolCallTimeoutMs?: number
}

type ResolvedConfig = Config & { readonly maxPendingPermissions: number; readonly mcpToolCallTimeoutMs: number }

interface OwnedSession {
  readonly id: SessionId
  readonly executor: NativeHeadlessApplication
  readonly rootRoute: NativeRootRouteId
  readonly lifetime: AbortController
  readonly resources: ResourceOwner
  readonly scope: NativeScope
  controlTail: Promise<void>
  controls: number
  notifications: Promise<void>
  current?: { readonly abort: AbortController; readonly done: Promise<PromptResponse> }
  closing?: Promise<void>
}

interface RootExecutionWaiter {
  readonly wake: () => void
  readonly fail: (cause: unknown) => void
}

function resolveConfig(input: unknown): ResolvedConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('native ACP: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['provider', 'model', 'systemPrompt', 'maxSteps', 'maxPendingPermissions', 'mcpToolCallTimeoutMs'].includes(key)) throw new Error(`native ACP: unknown configuration field ${key}`)
  }
  for (const key of ['provider', 'model', 'systemPrompt']) {
    if (typeof fields[key] !== 'string' || fields[key].length === 0) throw new TypeError(`native ACP: ${key} must be a nonempty string`)
  }
  if (typeof fields.maxSteps !== 'number' || !Number.isSafeInteger(fields.maxSteps) || fields.maxSteps <= 0) {
    throw new TypeError('native ACP: maxSteps must be a positive integer')
  }
  const maxPendingPermissions = fields.maxPendingPermissions === undefined ? 32 : fields.maxPendingPermissions
  if (typeof maxPendingPermissions !== 'number' || !Number.isSafeInteger(maxPendingPermissions) || maxPendingPermissions <= 0) {
    throw new TypeError('native ACP: maxPendingPermissions must be a positive integer')
  }
  const mcpToolCallTimeoutMs = fields.mcpToolCallTimeoutMs === undefined ? 60_000 : fields.mcpToolCallTimeoutMs
  if (typeof mcpToolCallTimeoutMs !== 'number' || !Number.isSafeInteger(mcpToolCallTimeoutMs)
    || mcpToolCallTimeoutMs < 1 || mcpToolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError('native ACP: mcpToolCallTimeoutMs must be a positive timer-sized integer')
  }
  return { provider: fields.provider as string, model: fields.model as string,
    systemPrompt: fields.systemPrompt as string, maxSteps: fields.maxSteps, maxPendingPermissions, mcpToolCallTimeoutMs }
}

/** Standard protocol updates reconstructed solely from committed Session facts. */
function updates(event: SessionEvent): SessionUpdate[] {
  switch (event.type) {
    case 'assistant/message': return event.data.message.content.flatMap((block) => {
      if (block.type !== 'text' && block.type !== 'reasoning') return []
      return [{ sessionUpdate: block.type === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk',
        messageId: event.data.message.id, content: { type: 'text', text: block.text } }]
    })
    case 'tool/call': {
      let rawInput: unknown
      try { rawInput = JSON.parse(event.data.arguments) as unknown }
      catch (_invalidModelArguments) { rawInput = event.data.arguments }
      return [{ sessionUpdate: 'tool_call', toolCallId: event.data.callId, title: event.data.name,
        kind: 'other', status: 'in_progress', rawInput }]
    }
    case 'tool/result': {
      const result = event.data.message.content[0]
      return [{ sessionUpdate: 'tool_call_update', toolCallId: result.toolCallId,
        status: result.isError === true ? 'failed' : 'completed',
        content: result.content.flatMap(block => block.type === 'text'
          ? [{ type: 'content' as const, content: { type: 'text' as const, text: block.text } }] : []) }]
    }
    case 'command/done': return event.data.text === undefined ? [] : [{
      sessionUpdate: 'agent_message_chunk', messageId: String(event.data.commandId),
      content: { type: 'text', text: event.data.text },
    }]
    default: return [] // The merge-extensible Session map contains non-presentation facts.
  }
}

/** Owns one ACP connection and its independently cancellable native Sessions. */
export class NativeAcpApplication implements NativeApplication {
  /** ACP Program root operations routed to their exact Engine-owned workspace route. */
  readonly rootExecution: NativeRootExecutionOperations
  private readonly sessions = new Map<string, OwnedSession>()
  private readonly rootRoutes = new Map<NativeRootRouteId, OwnedSession>()
  private readonly ownedExecutors = new Set<OwnedSession>()
  private readonly rootExecutionWaiters = new Set<RootExecutionWaiter>()
  private readonly lifetime = new AbortController()
  private initialized = false
  private initializing = false
  private readonly activating = new Set<string>()
  private closing = false
  private connection: AgentConnection | undefined
  private readonly pending = new Set<Promise<unknown>>()
  private readonly permissions = new Map<SessionId, Promise<NativeApprovalOutcome>>()

  constructor(private readonly context: NativeContext, private readonly config: ResolvedConfig,
    private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {
    const storage = context.require('sessionPersistence')
    const deletions: NativeRootSessionDeletionOperations | undefined = storage.deletions === undefined ? undefined : {
      list: (request, signal) => {
        const record = this.routeOwner(request.route)
        const operations = record.executor.rootExecution.deletions
        if (operations === undefined) throw new Error('native ACP: route does not support Session deletion')
        return operations.list(request, this.routeSignal(record, signal))
      },
      delete: (request, signal) => {
        const record = this.routeOwner(request.route)
        const operations = record.executor.rootExecution.deletions
        if (operations === undefined) throw new Error('native ACP: route does not support Session deletion')
        return operations.delete(request, this.routeSignal(record, signal))
      },
      restore: (request, signal) => {
        const record = this.routeOwner(request.route)
        const operations = record.executor.rootExecution.deletions
        if (operations === undefined) throw new Error('native ACP: route does not support Session deletion')
        return operations.restore(request, this.routeSignal(record, signal))
      },
    }
    this.rootExecution = Object.freeze({
      ...deletions === undefined ? {} : { deletions },
      ready: async (signal) => {
        await this.waitForInitialization(signal)
        await Promise.all(this.routeRecords().map(record => record.executor.rootExecution.ready(this.routeSignal(record, signal))))
      },
      resolve: id => this.routeOwner(id).executor.rootExecution.resolve(id),
      workspaceRoutes: () => [...new Map(this.routeRecords()
        .flatMap(record => record.executor.rootExecution.workspaceRoutes().map(route => [route.id, route] as const))).values()],
      selectWorkspace: async (request, signal) => {
        const record = this.routeOwner(request.baseRoute)
        const route = await record.executor.rootExecution.selectWorkspace(request, this.routeSignal(record, signal))
        this.rootRoutes.set(route.id, record)
        return route
      },
      releaseWorkspace: async (id, signal) => {
        const record = this.routeOwner(id)
        await record.executor.rootExecution.releaseWorkspace(id, this.routeSignal(record, signal))
        if (id !== record.rootRoute && this.rootRoutes.get(id) === record) this.rootRoutes.delete(id)
      },
      capture: owner => this.ownerRoute(owner, true).executor.rootExecution.capture(owner),
      cancel: owner => this.ownerRoute(owner, true).executor.rootExecution.cancel(owner),
      releaseIdle: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.releaseIdle(request, this.routeSignal(record, signal))
      },
      execute: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.execute(request, this.routeSignal(record, signal))
      },
      settle: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.settle(request, this.routeSignal(record, signal))
      },
      maintenance: <T>(request: NativeRootSessionRequest,
        operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.maintenance(request, operation, this.routeSignal(record, signal))
      },
      fork: (request: NativeRootForkRequest, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.fork(request, this.routeSignal(record, signal))
      },
      selectPreset: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.selectPreset(request, this.routeSignal(record, signal))
      },
    } satisfies NativeRootExecutionOperations)
    const approval = context.optional('approval')
    if (approval !== undefined) context.own(approval.registerAnswerer(request => this.permission(request)))
  }

  private async waitForInitialization(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.assertOpen()
    if (this.initialized) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort)
        this.rootExecutionWaiters.delete(waiter)
      }
      const waiter: RootExecutionWaiter = {
        wake: () => { cleanup(); resolve() },
        fail: (cause) => {
          cleanup()
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact caller cancellation identity.
          reject(cause)
        },
      }
      const abort = (): void => { waiter.fail(signal.reason) }
      this.rootExecutionWaiters.add(waiter)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else if (this.initialized) waiter.wake()
      else if (this.closing) waiter.fail(new Error('native ACP: connection is closing'))
    })
    signal.throwIfAborted()
    this.assertOpen()
  }

  private routeOwner(id: NativeRootRouteId): OwnedSession {
    const record = this.rootRoutes.get(id)
    if (record === undefined || record.closing !== undefined || record.lifetime.signal.aborted) {
      throw new Error('native ACP: unknown or closing root route')
    }
    return record
  }

  private routeRecords(): OwnedSession[] {
    return [...new Set(this.rootRoutes.values())].filter(record => record.closing === undefined && !record.lifetime.signal.aborted)
  }

  private ownerRoute(owner: NativeActiveSessionOwner, allowClosing = false): OwnedSession {
    if (owner.invocation !== 'root') throw new Error('native ACP: active root owner has no live Session route')
    const matches = [...this.ownedExecutors].filter((record) => {
      if (!allowClosing && (record.closing !== undefined || record.lifetime.signal.aborted)) return false
      try {
        const route = record.executor.rootExecution.capture(owner)
        return this.rootRoutes.get(route.id) === record
      } catch { return false }
    })
    const [record] = matches
    if (matches.length !== 1 || record === undefined) {
      throw new Error('native ACP: active root owner has no live Session route')
    }
    return record
  }

  private interactionRoute(record: OwnedSession, agent: NativeApprovalAnswererRequest['agent']): {
    readonly interaction: NonNullable<ReturnType<NativeHeadlessApplication['interactionOwner']>>
    readonly rootOwner: NativeActiveSessionOwner
  } | undefined {
    const interaction = record.executor.interactionOwner(agent)
    if (interaction === undefined) return undefined
    const rootOwner = this.context.require('activeSessions').owners().find(owner =>
      owner.agent === interaction.displayRootAgent && owner.session.id === interaction.displayRootSessionId)
    if (rootOwner === undefined) return undefined
    try {
      if (this.ownerRoute(rootOwner) !== record) return undefined
    } catch { return undefined }
    return { interaction, rootOwner }
  }

  private routeSignal(record: OwnedSession, signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, record.lifetime.signal, this.lifetime.signal])
  }

  private permission(request: NativeApprovalAnswererRequest): Promise<NativeApprovalOutcome> | undefined {
    const callId = request.callId
    if (callId === undefined) return undefined
    for (const record of this.ownedExecutors) {
      const id = String(record.id)
      if (this.sessions.get(id) !== record || record.closing !== undefined || record.lifetime.signal.aborted) continue
      const owned = this.interactionRoute(record, request.agent)
      if (owned === undefined) continue
      const { interaction, rootOwner } = owned
      if (this.permissions.has(record.id) || this.permissions.size >= this.config.maxPendingPermissions) return Promise.resolve('unavailable')
      const connection = this.connection
      if (connection === undefined) return Promise.resolve('unavailable')
      const signal = AbortSignal.any([request.signal, record.lifetime.signal, this.lifetime.signal])
      const task = (async (): Promise<NativeApprovalOutcome> => {
        await record.notifications
        signal.throwIfAborted()
        const { outcome } = await connection.client.request(methods.client.session.requestPermission, {
          sessionId: id, toolCall: { toolCallId: callId }, options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        }, { cancellationSignal: signal })
        signal.throwIfAborted()
        const current = this.interactionRoute(record, request.agent)
        if (this.sessions.get(id) !== record || current?.rootOwner !== rootOwner
          || current.interaction.session !== interaction.session || current.interaction.displayRootAgent !== interaction.displayRootAgent
          || current.interaction.displayRootSessionId !== interaction.displayRootSessionId) return 'cancelled'
        return outcome.outcome === 'cancelled' ? 'cancelled' : outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
      })()
      this.permissions.set(record.id, task)
      const release = (): void => { this.permissions.delete(record.id) }
      void task.then(release, release)
      return task
    }
    return undefined
  }

  /**
   * Serve ACP until transport EOF or Host cancellation, then drain owned work.
   * @param args - unsupported application arguments.
   * @param signal - Host process lifetime.
   * @returns zero after all accepted Session work has settled.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (args.length > 0) throw new Error('native ACP: task arguments are unsupported')
    const app = agent({ name: 'redspark-harness-native-acp' })
      .onRequest(methods.agent.initialize, ({ signal: requestSignal }) => this.track((async () => {
        if (this.initialized || this.initializing) throw RequestError.invalidRequest(undefined, 'already initialized')
        this.initializing = true
        try {
          await this.context.require('model').resolveModel?.(this.config.provider, this.config.model, requestSignal)
          this.assertOpen()
          this.initialized = true
          for (const waiter of [...this.rootExecutionWaiters]) waiter.wake()
        } finally { this.initializing = false }
        return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'redspark-harness-native-acp', version: '0.0.1' },
          agentCapabilities: { promptCapabilities: { image: this.context.optional('attachments') !== undefined
            && this.context.optional('modelDirectory') !== undefined, audio: false, embeddedContext: false },
          mcpCapabilities: { http: this.context.optional('tools') !== undefined }, sessionCapabilities: { close: {}, list: {}, resume: {} } }, authMethods: [] }
      })()))
      .onRequest(methods.agent.authenticate, () => ({}))
      .onRequest(methods.agent.session.new, ({ params, signal: requestSignal }) => this.track(this.newSession(params, requestSignal)))
      .onRequest(methods.agent.session.resume, ({ params, signal: requestSignal }) => this.track((async () => {
        this.ready()
        const cwd = this.workspace(params.cwd)
        const servers = this.resolveServers(params.mcpServers ?? [], cwd)
        if (this.sessions.has(params.sessionId) || this.activating.has(params.sessionId)) throw RequestError.invalidParams(undefined, 'session is already active')
        this.activating.add(params.sessionId)
        const id = SessionId(params.sessionId)
        try {
          const handle = await this.context.require('sessionPersistence').open(id, 'read', { signal: requestSignal })
          try {
            if (handle.header.parentSession !== undefined || handle.header.origin === 'subagent' || handle.header.cwd !== cwd) {
              throw RequestError.invalidParams(undefined, 'session is not resumable in this workspace')
            }
            const events = await handle.read(undefined, undefined, { signal: requestSignal })
            for (const event of events.events) {
              for (const update of updates(event)) await this.notify({ sessionId: params.sessionId, update })
            }
          } finally { await handle.close() }
          const record = this.createExecutor(params.sessionId, cwd)
          try {
            const configOptions = await this.activate(record, params.sessionId, servers, requestSignal)
            this.sessions.set(params.sessionId, record)
            await this.notifyAvailableCommands(record, params.sessionId)
            return { configOptions }
          } catch (error: unknown) {
            if (this.ownedExecutors.has(record)) {
              try { await this.releaseSession(record); this.sessions.delete(params.sessionId) }
              catch (cleanup: unknown) {
                this.sessions.set(params.sessionId, record)
                throw new AggregateError([error, cleanup], 'native ACP Session resume cleanup failed')
              }
            }
            throw error
          }
        } finally { this.activating.delete(params.sessionId) }
      })()))
      .onRequest(methods.agent.session.list, ({ params, signal: requestSignal }) => this.track((async () => {
        this.ready()
        if (params.cursor !== undefined && params.cursor !== null) throw RequestError.invalidParams(undefined, 'native ACP list has no pagination cursor')
        if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) throw RequestError.invalidParams(undefined, 'cwd must be absolute')
        const stored = await this.context.require('sessionPersistence').list({ signal: requestSignal })
        return { sessions: stored.flatMap(({ header }) => header.cwd === undefined || header.parentSession !== undefined
          || header.origin === 'subagent' || (params.cwd !== undefined && params.cwd !== null && resolve(params.cwd) !== header.cwd)
          ? [] : [{ sessionId: String(header.id), cwd: header.cwd, updatedAt: new Date(header.createdAt).toISOString() }]) }
      })()))
      .onRequest(methods.agent.session.prompt, ({ params, signal: requestSignal }) => this.track(this.prompt(params, requestSignal)))
      .onRequest(methods.agent.session.setConfigOption, ({ params, signal: requestSignal }) => this.track((async () => {
        this.ready()
        const record = this.sessions.get(params.sessionId)
        if (record === undefined) throw RequestError.invalidParams(undefined, 'unknown session')
        if (record.closing !== undefined) throw RequestError.invalidRequest(undefined, 'session is closing')
        const selection = this.context.optional('modelSelection')
        const directory = this.context.optional('modelDirectory')
        if (selection === undefined || directory === undefined) throw RequestError.invalidParams(undefined, 'model configuration is unavailable')
        const signal = AbortSignal.any([requestSignal, record.lifetime.signal, this.lifetime.signal])
        // The preceding prompt's protocol request reports its own execution failure.
        const previous = Promise.all([record.controlTail, record.current?.done.catch(() => undefined)]).then(() => undefined)
        record.controls += 1
        const operation = (async () => {
          await this.waitControl(previous, signal)
          const configOptions = await this.modelOperation(record, params.sessionId, signal,
            (control, owner, admitted) => control.set(owner, params.configId, params.value, admitted))
          await this.notify({ sessionId: params.sessionId, update: { sessionUpdate: 'config_option_update', configOptions } })
          return { configOptions }
        })()
        record.controlTail = Promise.allSettled([previous, operation]).then(() => undefined)
        try { return await operation } finally { record.controls -= 1 }
      })()))
      .onRequest(methods.agent.session.close, ({ params }) => this.track(this.closeSession(params.sessionId)))
      .onNotification(methods.agent.session.cancel, ({ params }) => {
        this.sessions.get(params.sessionId)?.current?.abort.abort(new Error('ACP client cancelled'))
      })
    const connection = app.connect(ndJsonStream(
      Writable.toWeb(this.output) as WritableStream<Uint8Array>,
      Readable.toWeb(this.input) as ReadableStream<Uint8Array>,
    ))
    this.connection = connection
    const cancel = (): void => { connection.close(signal.reason) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      await connection.closed
      return 0
    } finally {
      this.closing = true
      this.lifetime.abort(new Error('ACP transport closed'))
      for (const waiter of [...this.rootExecutionWaiters]) waiter.fail(new Error('native ACP: connection is closing'))
      connection.close(this.lifetime.signal.reason)
      for (const record of this.sessions.values()) record.current?.abort.abort(this.lifetime.signal.reason)
      await Promise.allSettled([...this.pending])
      await Promise.allSettled([...this.permissions.values()])
      const results = await Promise.allSettled([...this.ownedExecutors].map(record => this.releaseSession(record)))
      this.sessions.clear()
      this.rootRoutes.clear()
      signal.removeEventListener('abort', cancel)
      connection.close()
      this.input.pause()
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'native ACP Session teardown failed')
    }
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task)
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task))
    return task
  }

  private assertOpen(): void {
    if (this.closing || this.lifetime.signal.aborted) throw RequestError.internalError(undefined, 'ACP connection is closing')
  }

  private ready(): void {
    this.assertOpen()
    if (!this.initialized) throw RequestError.invalidRequest(undefined, 'initialize first')
  }

  private workspace(cwd: string): string {
    if (!isAbsolute(cwd)) throw RequestError.invalidParams(undefined, 'cwd must be absolute')
    return resolve(cwd)
  }

  private resolveServers(servers: NewSessionRequest['mcpServers'], cwd: string): McpConfig[] {
    try {
      const configs = resolveAcpMcpConfigs(servers, cwd, input => resolveNativeMcpConfig({ ...input,
        toolCallTimeoutMs: this.config.mcpToolCallTimeoutMs }))
      if (configs.length > 0 && this.context.optional('tools') === undefined) {
        throw new AcpMcpConfigError('mcpServers require a native tools Provider')
      }
      return configs
    } catch (error: unknown) {
      if (error instanceof AcpMcpConfigError) throw RequestError.invalidParams(undefined, error.message)
      throw error
    }
  }

  private createExecutor(id: string, cwd: string): OwnedSession {
    const { maxPendingPermissions: _permissionCapacity, mcpToolCallTimeoutMs: _mcpTimeout, ...turn } = this.config
    const resources = new ResourceOwner()
    const scope = new NativeScope(this.context.scope)
    const rootRoute = brandString<NativeRootRouteId>(`acp:${id}`)
    const execution = this.context.optional('sessionExecution')
    const authority = { active: this.context.require('activeSessions'), ...(execution === undefined ? {} : { execution }) }
    const record: OwnedSession = { id: SessionId(id), rootRoute,
      executor: createNativeHeadlessApplication(this.context, { ...turn, cwd, rootRouteId: rootRoute }, scope, authority),
      resources, scope, lifetime: resources.controller, controlTail: Promise.resolve(), controls: 0,
      notifications: Promise.resolve() }
    this.rootRoutes.set(rootRoute, record)
    this.ownedExecutors.add(record)
    return record
  }

  private async activate(record: OwnedSession, id: string, servers: readonly McpConfig[],
    signal: AbortSignal, freshCwd?: string): Promise<SessionConfigOption[]> {
    const admitted = AbortSignal.any([signal, this.lifetime.signal, record.lifetime.signal])
    const cancel = (): void => { record.lifetime.abort(admitted.reason) }
    admitted.addEventListener('abort', cancel, { once: true })
    if (admitted.aborted) cancel()
    try {
      for (const config of servers) {
        admitted.throwIfAborted()
        const tools = this.context.optional('tools')
        if (tools === undefined) throw RequestError.invalidParams(undefined, 'mcpServers require a native tools Provider')
        await installNativeMcpClient({ logger: { info: console.error, warn: console.warn, error: console.error },
          tools, attachments: this.context.optional('attachments'),
          model: this.context.require('model'), scope: record.scope, signal: record.lifetime.signal,
          effect: dispose => record.resources.effect(dispose) }, config)
      }
      admitted.throwIfAborted()
      const options = await this.modelOperation(record, id, admitted,
        (control, owner, admitted) => control.options(owner, admitted), freshCwd === undefined)
      this.assertOpen()
      return options
    } catch (error: unknown) {
      try { await this.releaseSession(record) }
      catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'native ACP model activation cleanup failed') }
      throw error
    } finally { admitted.removeEventListener('abort', cancel) }
  }

  private async releaseSession(record: OwnedSession): Promise<void> {
    record.lifetime.abort(new Error('ACP Session released'))
    const failures: unknown[] = []
    const owner = this.context.require('activeSessions').owners().find(candidate => candidate.session.id === record.id)
    if (owner !== undefined) {
      try {
        if (this.rootExecution.capture(owner).id !== record.rootRoute) throw new Error('native ACP: root owner route changed before release')
        await this.rootExecution.cancel(owner)
      } catch (error: unknown) { failures.push(error) }
    }
    for (const release of [() => record.executor.dispose(), () => record.resources.dispose()]) {
      try { await release() } catch (error: unknown) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'native ACP Session resource cleanup failed')
    this.ownedExecutors.delete(record)
    for (const [route, owner] of this.rootRoutes) if (owner === record) this.rootRoutes.delete(route)
  }

  private modelOperation(record: OwnedSession, id: string, signal: AbortSignal,
    operation: (control: NativeAcpModelControls, owner: NativeActiveSessionOwner,
      signal: AbortSignal) => Promise<SessionConfigOption[]>, resume = true): Promise<SessionConfigOption[]> {
    const selection = this.context.optional('modelSelection')
    const directory = this.context.optional('modelDirectory')
    const request = { route: record.rootRoute, id: SessionId(id), resume }
    if (selection === undefined || directory === undefined) {
      return resume ? Promise.resolve([]) : this.rootExecution.maintenance(request, () => Promise.resolve([]), signal)
    }
    const control = new NativeAcpModelControls(selection, directory, this.config)
    return this.rootExecution.maintenance(request, (owner, admitted) => {
      const execution = this.context.require('agents').execution(owner.agent)
      return execution.status === 'maintenance' ? operation(control, owner, admitted)
        : execution.runMaintenance(agentSignal => operation(control, owner, AbortSignal.any([agentSignal, admitted])))
    }, signal)
  }

  private async waitControl(previous: Promise<void>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    let abort: (() => void) | undefined
    try {
      await Promise.race([previous, new Promise<never>((_resolve, reject) => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact caller cancellation identity.
        abort = () => { reject(signal.reason) }
        signal.addEventListener('abort', abort, { once: true })
      })])
      signal.throwIfAborted()
    } finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
  }

  private async newSession(params: NewSessionRequest, signal: AbortSignal):
  Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    this.ready()
    const cwd = this.workspace(params.cwd)
    const servers = this.resolveServers(params.mcpServers, cwd)
    const fs = this.context.require('fs')
    const info = await fs.stat(await fs.resolve('.', { cwd, signal }), signal)
    if (info?.type !== 'directory') throw RequestError.invalidParams(undefined, 'cwd must be a directory')
    const id = SessionId(randomUUID())
    const record = this.createExecutor(id, cwd)
    try {
      const configOptions = await this.activate(record, id, servers, signal, cwd)
      this.sessions.set(id, record)
      await this.notifyAvailableCommands(record, id)
      return { sessionId: id, configOptions }
    } catch (error: unknown) {
      if (this.ownedExecutors.has(record)) {
        try { await this.releaseSession(record); this.sessions.delete(id) }
        catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'native ACP Session creation cleanup failed') }
      }
      throw error
    }
  }

  private async notify(notification: SessionNotification): Promise<void> {
    const connection = this.connection
    if (connection === undefined) throw new Error('native ACP: no connection')
    await connection.client.notify(methods.client.session.update, notification)
  }

  private async notifyAvailableCommands(record: OwnedSession, sessionId: string): Promise<void> {
    const commands: NativeCommandOperations | undefined = this.context.optional('commands')
    if (commands === undefined) return
    await this.withRootCommandOwner(record, record.lifetime.signal, async (owner) => {
      const availableCommands = commands.list(owner.agent.scope).map(({ name, description, input }) => ({ name, description,
        ...input === undefined ? {} : { input: { hint: input.hint } } }))
      await this.notify({ sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands } })
    })
  }

  private withRootCommandOwner<T>(record: OwnedSession, signal: AbortSignal,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.rootExecution.maintenance({ route: record.rootRoute, id: record.id, resume: true }, (owner, admitted) => {
      if (owner.invocation !== 'root' || this.rootExecution.capture(owner).id !== record.rootRoute) {
        throw new Error('native ACP: command requires this Session root owner')
      }
      return operation(owner, admitted)
    }, signal)
  }

  private async dispatchCommand(record: OwnedSession, line: string, signal: AbortSignal): Promise<boolean> {
    const commands: NativeCommandOperations | undefined = this.context.optional('commands')
    const parsed = commands?.parse(line)
    if (commands === undefined || parsed === undefined) return false
    return this.withRootCommandOwner(record, signal, async (owner, admitted) => {
      if (!commands.list(owner.agent.scope).some(command => command.name === parsed.name)) return false
      const release = owner.onEvent((event) => {
        for (const update of updates(event)) {
          record.notifications = record.notifications.then(() => this.notify({ sessionId: String(record.id), update }))
          void record.notifications.catch(() => {}) // The prompt awaits and reports this transport failure after durable settlement.
        }
      })
      try {
        const result = await commands.dispatch({ agent: owner.agent, session: owner.session, line, attachments: [], signal: admitted })
        if (result === undefined) throw new Error(`native ACP: command /${parsed.name} is no longer available`)
        return true
      } finally { release() }
    })
  }

  private async prompt(params: PromptRequest, requestSignal: AbortSignal): Promise<PromptResponse> {
    this.ready()
    const record = this.sessions.get(params.sessionId)
    if (record === undefined) throw RequestError.invalidParams(undefined, 'unknown session')
    if (record.closing !== undefined) throw RequestError.invalidRequest(undefined, 'session is closing')
    if (record.current !== undefined) throw RequestError.invalidRequest(undefined, 'session prompt is already running')
    if (record.controls !== 0) throw RequestError.invalidRequest(undefined, 'session configuration is in progress')
    if (params.prompt.length === 0) throw RequestError.invalidParams(undefined, 'native ACP prompt must be nonempty')
    const attachments = this.context.optional('attachments')
    const parts: AttachmentAdmissionPart[] = []
    for (const block of params.prompt) {
      if (block.type === 'text' || block.type === 'resource_link') {
        const text = block.type === 'text' ? block.text
          : `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`
        const prior = parts.at(-1)
        if (prior?.type === 'text') parts[parts.length - 1] = { type: 'text', text: prior.text + text }
        else parts.push({ type: 'text', text })
      } else if (block.type === 'image') {
        const mediaType = attachments?.imageLimits.mediaTypes.find(type => type === block.mimeType)
        if (mediaType === undefined) throw RequestError.invalidParams(undefined, 'native ACP image format is not configured')
        parts.push({ type: 'image', data: block.data, mediaType })
      } else throw RequestError.invalidParams(undefined, 'native ACP accepts text, resource links and configured raster image formats only')
    }
    const abort = new AbortController()
    const signal = AbortSignal.any([requestSignal, abort.signal, this.lifetime.signal])
    const done = Promise.resolve().then(async (): Promise<PromptResponse> => {
      let stopReason: PromptResponse['stopReason'] = 'end_turn'
      record.notifications = Promise.resolve()
      let exitCode: number
      try {
        const commandLine = params.prompt.length === 1 && params.prompt[0]?.type === 'text' ? params.prompt[0].text : undefined
        if (commandLine !== undefined && await this.dispatchCommand(record, commandLine, signal)) {
          exitCode = 0
        } else {
          const hasImage = parts.some(part => part.type === 'image')
          let input: Pick<NativeTurnRequest, 'message' | 'prepareMessage'>
          if (hasImage) {
            const directory = this.context.optional('modelDirectory')
            if (directory === undefined) throw RequestError.invalidParams(undefined, 'native ACP images require a model directory')
            if (attachments === undefined) throw RequestError.invalidParams(undefined, 'native ACP images require attachment storage')
            input = { prepareMessage: async (model, admitted) => {
              const info = await directory.resolve(model.provider, model.model, admitted)
              if (!info.inputModalities?.includes('image')) throw RequestError.invalidParams(undefined, 'selected model does not declare image input')
              admitted.throwIfAborted()
              const content = await attachments.admitPromptContent(parts)
              admitted.throwIfAborted()
              return createUserMessage({ content, source: { kind: 'user' } })
            } }
          } else {
            signal.throwIfAborted()
            const content = attachments === undefined
              ? parts.map((part) => {
                if (part.type !== 'text') throw RequestError.invalidParams(undefined, 'native ACP images require attachment storage')
                return part
              }) : await attachments.admitPromptContent(parts)
            input = { message: createUserMessage({ content, source: { kind: 'user' } }) }
          }
          signal.throwIfAborted()
          const result = await this.rootExecution.execute({ route: record.rootRoute,
            id: SessionId(params.sessionId), resume: true,
            ...input, onEvent: (event) => {
              for (const update of updates(event)) {
                record.notifications = record.notifications.then(() => this.notify({ sessionId: params.sessionId, update }))
                void record.notifications.catch(() => {}) // The prompt awaits and reports this transport failure after durable settlement.
              }
              if (event.type === 'turn/end') {
                if (event.data.reason.kind === 'max-tokens') stopReason = 'max_tokens'
                else if (event.data.reason.kind === 'interrupted') stopReason = 'cancelled'
              }
            } }, signal)
          exitCode = result.exitCode
        }
      } catch (error: unknown) {
        if (isImageAdmissionError(error)) throw RequestError.invalidParams(undefined, error.message)
        if (!signal.aborted || error !== signal.reason) throw error
        exitCode = 1
      }
      await record.notifications
      if (abort.signal.aborted || requestSignal.aborted) return { stopReason: 'cancelled' }
      if (exitCode !== 0) throw RequestError.internalError(undefined, 'native ACP turn failed; inspect Session log')
      return { stopReason }
    })
    record.current = { abort, done }
    try { return await done } finally { if (record.current.done === done) delete record.current }
  }

  private async closeSession(id: string): Promise<Record<string, never>> {
    this.ready()
    const record = this.sessions.get(id)
    if (record === undefined) throw RequestError.invalidParams(undefined, 'unknown session')
    record.closing ??= Promise.resolve().then(async () => {
      record.current?.abort.abort(new Error('ACP Session closed'))
      record.lifetime.abort(new Error('ACP Session closed'))
      await record.current?.done.catch(() => {}) // Prompt failure is returned by its own protocol request.
      await record.controlTail
      await this.releaseSession(record)
      if (this.sessions.get(id) === record) this.sessions.delete(id)
    })
    await record.closing
    return {}
  }
}

/** Host installation for the explicitly selected native-acp profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-acp', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentInstructions', 'modelSelection',
    'sessionExecution', 'agentPresets', 'workspaceRegistry', 'attachments', 'modelDirectory', 'commands'],
  provides: ['application', 'rootExecution'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const application = new NativeAcpApplication(context, config)
      context.provide('application', application)
      context.provide('rootExecution', application.rootExecution)
    }
  },
}
