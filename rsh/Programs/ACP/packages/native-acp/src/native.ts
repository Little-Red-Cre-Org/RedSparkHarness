/** Standard ACP carrier over the shared native Agent and Session executor. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError,
  type AgentConnection, type NewSessionRequest, type PromptRequest, type PromptResponse,
  type SessionNotification, type SessionConfigOption } from '@agentclientprotocol/sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createNativeHeadlessApplication, type NativeHeadlessApplication, type NativeTurnRequest } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, resolveCallConfigWithModel } from '@deepseek-ai/dsh-llm/native'
import { isImageAdmissionError, type AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/native'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { SessionId, Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { nativeSessionExecutionPolicy, type NativeSessionExecutionPolicy, type NativeSessionOwnerApproval } from '@deepseek-ai/dsh-native-session-execution'
import { NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION, nativeAcpSubagentPermissionRequestMetadata, nativeAcpSubagentPolicyMetadata,
  nativeAcpSubagentServerMetadata, readNativeAcpSubagentClientCapabilities,
  readNativeAcpSubagentPolicy,
  type NativeAcpSubagentClientCapabilities, type NativeAcpSubagentPolicy,
  type NativeAcpSubagentServerCapabilities } from '@deepseek-ai/dsh-acp-protocol'
import type { NativeRootExecutionOperations, NativeRootForkRequest, NativeRootRouteId,
  NativeRootSessionDeletionOperations, NativeRootSessionRequest, NativeRootStagedFileOperations,
  NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
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
import type {} from '@deepseek-ai/dsh-token-meter/native'
import type { NativeApprovalAnswererRequest, NativeApprovalOutcome } from '@deepseek-ai/dsh-approval-definition'
import { NativeAcpModelControls } from './model-controls.ts'
import { nativeAcpUpdates, nativeAcpUsageUpdate } from './presentation.ts'

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
  /** Optional profile maximum tokens per model request. */
  readonly maxTokens?: number
  /** Whether the Native builtin tool Provider is enabled for this process. */
  readonly builtinTools?: boolean
  /** Exact model-visible tool names admitted by this profile. */
  readonly allowedTools?: readonly string[]
  /** Parent-authorized filesystem root for builtin write_file calls. */
  readonly workspaceWriteRoot?: string
  /** Maximum unsettled permission wire requests; defaults to 32. */
  readonly maxPendingPermissions?: number
  /** MCP tool timeout in milliseconds; defaults to 60000. */
  readonly mcpToolCallTimeoutMs?: number
  /** Maximum resumable Sessions returned by one session/list page; defaults to 100. */
  readonly sessionListPageSize?: number
}

type ResolvedConfig = Config & {
  readonly maxPendingPermissions: number
  readonly mcpToolCallTimeoutMs: number
  readonly sessionListPageSize: number
}

const DEFAULT_SESSION_LIST_PAGE_SIZE = 100

function resolveAllowedTools(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  const message = 'native ACP: allowedTools must be an array of unique nonempty names'
  if (!Array.isArray(value)) throw new TypeError(message)
  const names = value.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
  if (names.length !== value.length || new Set(names).size !== names.length) throw new TypeError(message)
  return Object.freeze(names)
}

interface OwnedSession {
  readonly id: SessionId
  readonly executor: NativeHeadlessApplication
  readonly rootRoute: NativeRootRouteId
  readonly lifetime: AbortController
  readonly resources: ResourceOwner
  readonly scope: NativeScope
  readonly policy?: NativeAcpSubagentPolicy
  controlTail: Promise<void>
  controls: number
  notifications: Promise<void>
  notificationFailures: unknown[]
  current?: { readonly abort: AbortController; readonly done: Promise<PromptResponse> }
  closing?: Promise<void>
}

interface RootExecutionWaiter {
  readonly wake: () => void
  readonly fail: (cause: unknown) => void
}

interface SessionListCursor {
  readonly createdAt: number
  readonly sessionId: string
}

function resolveConfig(input: unknown): ResolvedConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('native ACP: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['provider', 'model', 'systemPrompt', 'maxSteps', 'maxTokens', 'builtinTools', 'allowedTools',
      'workspaceWriteRoot', 'maxPendingPermissions', 'mcpToolCallTimeoutMs', 'sessionListPageSize'].includes(key)) {
      throw new Error(`native ACP: unknown configuration field ${key}`)
    }
  }
  for (const key of ['provider', 'model', 'systemPrompt']) {
    if (typeof fields[key] !== 'string' || fields[key].length === 0) throw new TypeError(`native ACP: ${key} must be a nonempty string`)
  }
  if (typeof fields.maxSteps !== 'number' || !Number.isSafeInteger(fields.maxSteps) || fields.maxSteps <= 0) {
    throw new TypeError('native ACP: maxSteps must be a positive integer')
  }
  const maxTokens = fields.maxTokens
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new TypeError('native ACP: maxTokens must be a positive integer')
  }
  const builtinTools = fields.builtinTools
  if (builtinTools !== undefined && typeof builtinTools !== 'boolean') {
    throw new TypeError('native ACP: builtinTools must be a boolean')
  }
  const allowedTools = resolveAllowedTools(fields.allowedTools)
  const workspaceWriteRoot = fields.workspaceWriteRoot
  if (workspaceWriteRoot !== undefined && (typeof workspaceWriteRoot !== 'string' || workspaceWriteRoot.length === 0
    || !isAbsolute(workspaceWriteRoot))) {
    throw new TypeError('native ACP: workspaceWriteRoot must be an absolute path')
  }
  if (allowedTools?.includes('write_file') && workspaceWriteRoot === undefined) {
    throw new TypeError('native ACP: allowed write_file requires workspaceWriteRoot')
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
  const sessionListPageSize = fields.sessionListPageSize === undefined ? DEFAULT_SESSION_LIST_PAGE_SIZE : fields.sessionListPageSize
  if (typeof sessionListPageSize !== 'number' || !Number.isSafeInteger(sessionListPageSize) || sessionListPageSize <= 0) {
    throw new TypeError('native ACP: sessionListPageSize must be a positive safe integer')
  }
  return { provider: fields.provider as string, model: fields.model as string,
    systemPrompt: fields.systemPrompt as string, maxSteps: fields.maxSteps,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(builtinTools === undefined ? {} : { builtinTools }),
    ...allowedTools === undefined ? {} : { allowedTools },
    ...workspaceWriteRoot === undefined ? {} : { workspaceWriteRoot: resolve(workspaceWriteRoot) },
    maxPendingPermissions, mcpToolCallTimeoutMs, sessionListPageSize }
}

function effectivePolicy(requested: NativeAcpSubagentPolicy | undefined, profile: ResolvedConfig,
  relayAvailable: boolean): NativeAcpSubagentPolicy | undefined {
  if (requested === undefined) return undefined
  if (requested.permissionMode === 'parent-relay' && !relayAvailable) {
    throw RequestError.invalidParams(undefined, 'native ACP parent permission relay is unavailable')
  }
  const maxSteps = Math.min(requested.maxSteps, profile.maxSteps)
  const requestedTokens = requested.maxTokens
  const maxTokens = requestedTokens === undefined ? profile.maxTokens
    : profile.maxTokens === undefined ? requestedTokens : Math.min(requestedTokens, profile.maxTokens)
  return { version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION, maxSteps,
    ...(maxTokens === undefined ? {} : { maxTokens }), permissionMode: requested.permissionMode }
}

function assertRestorablePolicy(policy: NativeAcpSubagentPolicy, profile: ResolvedConfig,
  relayAvailable: boolean): void {
  if (policy.maxSteps > profile.maxSteps
    || policy.maxTokens === undefined && profile.maxTokens !== undefined
    || policy.maxTokens !== undefined && profile.maxTokens !== undefined && policy.maxTokens > profile.maxTokens) {
    throw RequestError.invalidParams(undefined, 'native ACP Session limits are no longer permitted by this profile')
  }
  if (policy.permissionMode === 'parent-relay' && !relayAvailable) {
    throw RequestError.invalidParams(undefined, 'native ACP Session permission relay is no longer available')
  }
}

function executionPolicy(policy: NativeAcpSubagentPolicy): NativeSessionExecutionPolicy {
  return { version: 1, maxSteps: policy.maxSteps,
    ...(policy.maxTokens === undefined ? {} : { maxTokens: policy.maxTokens }),
    permission: policy.permissionMode === 'deny' ? { mode: 'deny' }
      : { mode: 'require-approval', authority: 'session-owner' } }
}

function acpPolicy(policy: NativeSessionExecutionPolicy): NativeAcpSubagentPolicy {
  return { version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION, maxSteps: policy.maxSteps,
    ...(policy.maxTokens === undefined ? {} : { maxTokens: policy.maxTokens }),
    permissionMode: policy.permission.mode === 'deny' ? 'deny' : 'parent-relay' }
}

/** Decode the compatibility bridge's canonical newest-first continuation key. */
function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | undefined {
  if (value === undefined || value === null) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('session/list cursor is invalid')
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    const createdAt: unknown = Array.isArray(decoded) ? decoded[0] : undefined
    const sessionId: unknown = Array.isArray(decoded) ? decoded[1] : undefined
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof createdAt !== 'number'
      || !Number.isSafeInteger(createdAt) || createdAt < 0 || typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('invalid cursor fields')
    }
    if (Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url') !== value) throw new Error('non-canonical cursor')
    return { createdAt, sessionId }
  } catch (_invalidCursor) {
    throw new Error('session/list cursor is invalid')
  }
}

/** Encode the last returned key using the compatibility bridge's stable wire format. */
function encodeSessionListCursor(entry: SessionListCursor): string {
  return Buffer.from(JSON.stringify([entry.createdAt, entry.sessionId]), 'utf8').toString('base64url')
}

/** Test whether a stored Session follows the cursor in newest-first list order. */
function isAfterSessionListCursor(entry: SessionListCursor, cursor: SessionListCursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && compareSessionIds(entry.sessionId, cursor.sessionId) > 0)
}

/** Compare opaque Session ids by UTF-8 bytes without process-locale ordering. */
function compareSessionIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
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
  private subagentClientCapabilities: NativeAcpSubagentClientCapabilities | undefined
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
    const stagedFiles: NativeRootStagedFileOperations = {
      stageStream: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.stagedFiles.stageStream(request, this.routeSignal(record, signal))
      },
      stageEncoded: (request, signal) => {
        const record = this.routeOwner(request.route)
        return record.executor.rootExecution.stagedFiles.stageEncoded(request, this.routeSignal(record, signal))
      },
      prepare: (request) => {
        const record = this.ownerRoute(request.owner)
        return record.executor.rootExecution.stagedFiles.prepare({ ...request,
          signal: this.routeSignal(record, request.signal) })
      },
      enqueue: (request) => {
        const record = this.ownerRoute(request.owner)
        return record.executor.rootExecution.stagedFiles.enqueue({ ...request,
          signal: this.routeSignal(record, request.signal) })
      },
    }
    this.rootExecution = Object.freeze({
      stagedFiles,
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
      const rejectReason: (reason: unknown) => void = reject
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort)
        this.rootExecutionWaiters.delete(waiter)
      }
      const waiter: RootExecutionWaiter = {
        wake: () => { cleanup(); resolve() },
        fail: (cause) => {
          cleanup()
          rejectReason(cause)
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

  private ownerApproval(record: OwnedSession, owner: NativeActiveSessionOwner): NativeSessionOwnerApproval | undefined {
    if (record.policy?.permissionMode !== 'parent-relay') return undefined
    if (owner.invocation !== 'root' || owner.session.id !== record.id || !owner.writerAvailable
      || owner.rootOperations === undefined || record.closing !== undefined
      || this.sessions.get(String(record.id)) !== record
      || !this.context.require('activeSessions').owners().some(candidate => candidate === owner)
      || this.ownerRoute(owner) !== record) {
      throw new Error('native ACP: current Session owner cannot authorize parent approval')
    }
    const lifetime = AbortSignal.any([record.lifetime.signal, owner.rootOperations.signal])
    return {
      agent: owner.agent,
      session: owner.session,
      lifetime,
      authorize: (request) => {
        request.signal.throwIfAborted()
        lifetime.throwIfAborted()
        if (record.closing !== undefined || this.sessions.get(String(record.id)) !== record
          || !owner.writerAvailable
          || !this.context.require('activeSessions').owners().some(candidate => candidate === owner)) {
          return Promise.resolve('unavailable')
        }
        try {
          if (this.ownerRoute(owner) !== record) return Promise.resolve('unavailable')
        } catch { return Promise.resolve('unavailable') }
        const pending = this.permission({ id: request.id, agent: owner.agent,
          callId: request.callId, toolName: request.toolName, ...request.reason === undefined ? {} : { reason: request.reason },
          policy: 'ask', signal: request.signal }) ?? Promise.resolve('unavailable')
        return new Promise<NativeApprovalOutcome>((resolve, reject) => {
          const rejectReason: (reason: unknown) => void = reject
          let settled = false
          const complete = (outcome: NativeApprovalOutcome): void => {
            if (settled) return
            settled = true
            request.signal.removeEventListener('abort', onAbort)
            resolve(outcome)
          }
          const fail = (error: unknown): void => {
            if (settled) return
            settled = true
            request.signal.removeEventListener('abort', onAbort)
            rejectReason(error)
          }
          const onAbort = (): void => { complete('cancelled') }
          request.signal.addEventListener('abort', onAbort, { once: true })
          if (request.signal.aborted) onAbort()
          void pending.then(complete, fail)
        })
      },
    }
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
      if (record.policy?.permissionMode === 'deny') return Promise.resolve('rejected')
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
          _meta: nativeAcpSubagentPermissionRequestMetadata({ sessionId: String(interaction.session.id), requestId: String(request.id),
            toolName: request.toolName, toolCallId: String(callId) }),
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
      .onRequest(methods.agent.initialize, ({ params, signal: requestSignal }) => this.track((async () => {
        if (this.initialized || this.initializing) throw RequestError.invalidRequest(undefined, 'already initialized')
        this.initializing = true
        try {
          const clientCapabilities = readNativeAcpSubagentClientCapabilities(params._meta)
          await this.context.require('model').resolveModel?.(this.config.provider, this.config.model, requestSignal)
          this.assertOpen()
          this.subagentClientCapabilities = clientCapabilities
          this.initialized = true
          for (const waiter of [...this.rootExecutionWaiters]) waiter.wake()
        } finally { this.initializing = false }
        const permissionModes: NativeAcpSubagentServerCapabilities['permissionModes'] =
          this.parentRelayAvailable() ? ['deny', 'parent-relay'] : ['deny']
        return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'redspark-harness-native-acp', version: '0.0.1' },
          agentCapabilities: { promptCapabilities: { image: this.context.optional('attachments') !== undefined
            && this.context.optional('modelDirectory') !== undefined, audio: false, embeddedContext: false },
          mcpCapabilities: { http: this.context.optional('tools') !== undefined }, sessionCapabilities: { close: {}, list: {}, resume: {} } },
          authMethods: [], _meta: nativeAcpSubagentServerMetadata({ permissionRequestIdentity: true,
            maxSteps: true, maxTokens: true, permissionModes }) }
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
        let policy: NativeAcpSubagentPolicy | undefined
        try {
          const handle = await this.context.require('sessionPersistence').open(id, 'read', { signal: requestSignal })
          try {
            if (handle.header.parentSession !== undefined || handle.header.origin === 'subagent' || handle.header.cwd !== cwd) {
              throw RequestError.invalidParams(undefined, 'session is not resumable in this workspace')
            }
            const events = await handle.read(undefined, undefined, { signal: requestSignal })
            const acceptedPolicy = nativeSessionExecutionPolicy(events.events)
            if (acceptedPolicy !== undefined) {
              policy = acpPolicy(acceptedPolicy)
              assertRestorablePolicy(policy, this.config, this.parentRelayAvailable())
            }
            await this.assertOutputTokenLimit(policy?.maxTokens ?? this.config.maxTokens, requestSignal)
            const restored = Session.fromRestore(id, events.events, handle.header, handle.inheritedEventCount, events.eventState)
            const meterAvailable = this.context.optional('tokenMeter') !== undefined
            for (const event of events.events) {
              const eventSession = event.type === 'assistant/message' && event.data.usage !== undefined
                && meterAvailable
                ? Session.fromRestore(id, structuredClone(events.events.slice(0, event.seq + 1)), handle.header,
                  handle.inheritedEventCount, 'detached')
                : restored
              const usage = event.type === 'assistant/message' && event.data.usage !== undefined
                && meterAvailable
                ? nativeAcpUsageUpdate(this.context, eventSession, event) : undefined
              for (const update of await nativeAcpUpdates(this.context, event, requestSignal, usage)) {
                await this.notify({ sessionId: params.sessionId, update })
              }
            }
          } finally { await handle.close() }
          const record = this.createExecutor(params.sessionId, cwd, policy)
          try {
            const configOptions = await this.activate(record, params.sessionId, servers, requestSignal)
            this.sessions.set(params.sessionId, record)
            await this.notifyAvailableCommands(record, params.sessionId)
            return { configOptions, ...(policy === undefined ? {} : { _meta: nativeAcpSubagentPolicyMetadata(policy) }) }
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
        if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) throw RequestError.invalidParams(undefined, 'cwd must be absolute')
        let cursor: SessionListCursor | undefined
        try { cursor = decodeSessionListCursor(params.cursor) }
        catch { throw RequestError.invalidParams(undefined, 'session/list cursor is invalid') }
        const stored = await this.context.require('sessionPersistence').list({ signal: requestSignal })
        const entries = stored.flatMap(({ header }) => header.cwd === undefined || header.parentSession !== undefined
          || header.origin === 'subagent' || (params.cwd !== undefined && params.cwd !== null && resolve(params.cwd) !== header.cwd)
          ? [] : [{ sessionId: String(header.id), cwd: header.cwd, createdAt: header.createdAt }])
          .sort((left, right) => right.createdAt - left.createdAt || compareSessionIds(left.sessionId, right.sessionId))
        const remaining = cursor === undefined ? entries : entries.filter(entry => isAfterSessionListCursor(entry, cursor))
        const page = remaining.slice(0, this.config.sessionListPageSize)
        const next = remaining.length > page.length ? page.at(-1) : undefined
        return { sessions: page.map(({ sessionId, cwd, createdAt }) => ({ sessionId, cwd,
          updatedAt: new Date(createdAt).toISOString() })),
        ...next === undefined ? {} : { nextCursor: encodeSessionListCursor(next) } }
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

  private parentRelayAvailable(): boolean {
    return this.subagentClientCapabilities?.permissionRelay === true && this.context.optional('approval') !== undefined
  }

  private async assertOutputTokenLimit(maxTokens: number | undefined, signal: AbortSignal): Promise<void> {
    const model = this.context.require('model')
    if (model.prepareCall === undefined) {
      throw RequestError.invalidParams(undefined, 'native ACP cannot verify maxTokens for the selected model route')
    }
    const prepared = await model.prepareCall(this.config.provider, this.config.model, signal)
    if (prepared.model.provider !== this.config.provider || prepared.model.id !== this.config.model) {
      throw RequestError.internalError(undefined, 'native ACP model preparation returned a different route')
    }
    const resolved = resolveCallConfigWithModel({ provider: this.config.provider, model: this.config.model,
      ...(maxTokens === undefined ? {} : { maxTokens }) }, prepared.model)
    if (resolved.maxTokens !== undefined
      && !await prepared.supportsOutputTokenLimit(resolved.maxTokens, resolved.reasoningEffort)) {
      throw RequestError.invalidParams(undefined, 'native ACP selected model route cannot enforce maxTokens')
    }
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

  private createExecutor(id: string, cwd: string, policy?: NativeAcpSubagentPolicy): OwnedSession {
    const { maxPendingPermissions: _permissionCapacity, mcpToolCallTimeoutMs: _mcpTimeout,
      maxTokens: _profileTokens, sessionListPageSize: _listPageSize, ...turn } = this.config
    const resources = new ResourceOwner()
    const scope = new NativeScope(this.context.scope)
    const rootRoute = brandString<NativeRootRouteId>(`acp:${id}`)
    const execution = this.context.optional('sessionExecution')
    const authority = { active: this.context.require('activeSessions'), ...(execution === undefined ? {} : { execution }) }
    const maxTokens = policy === undefined ? this.config.maxTokens : policy.maxTokens
    const record: OwnedSession = { id: SessionId(id), rootRoute,
      executor: createNativeHeadlessApplication(this.context, { ...turn, maxSteps: policy?.maxSteps ?? this.config.maxSteps,
        ...(maxTokens === undefined ? {} : { maxTokens }), cwd, rootRouteId: rootRoute }, scope, authority),
      resources, scope, lifetime: resources.controller, controlTail: Promise.resolve(), controls: 0,
      notifications: Promise.resolve(), notificationFailures: [], ...(policy === undefined ? {} : { policy }) }
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
    const connection = this.connection
    const failures: unknown[] = []
    for (const error of await this.drainNotifications(record)) {
      if (error !== record.lifetime.signal.reason && error !== this.lifetime.signal.reason
        && !(connection?.signal.aborted && error === connection.signal.reason)) failures.push(error)
    }
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

  private async drainNotifications(record: OwnedSession): Promise<unknown[]> {
    while (true) {
      const pending = record.notifications
      try { await pending } catch (error: unknown) { record.notificationFailures.push(error) }
      if (record.notifications !== pending) continue
      return record.notificationFailures.splice(0)
    }
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
        const rejectReason: (reason: unknown) => void = reject
        abort = () => {
          rejectReason(signal.reason)
        }
        signal.addEventListener('abort', abort, { once: true })
      })])
      signal.throwIfAborted()
    } finally { if (abort !== undefined) signal.removeEventListener('abort', abort) }
  }

  private async newSession(params: NewSessionRequest, signal: AbortSignal):
  Promise<{ sessionId: string; configOptions: SessionConfigOption[]; _meta?: Record<string, unknown> }> {
    this.ready()
    const policy = effectivePolicy(readNativeAcpSubagentPolicy(params._meta), this.config, this.parentRelayAvailable())
    await this.assertOutputTokenLimit(policy?.maxTokens ?? this.config.maxTokens, signal)
    const cwd = this.workspace(params.cwd)
    const servers = this.resolveServers(params.mcpServers, cwd)
    const fs = this.context.require('fs')
    const info = await fs.stat(await fs.resolve('.', { cwd, signal }), signal)
    if (info?.type !== 'directory') throw RequestError.invalidParams(undefined, 'cwd must be a directory')
    const id = SessionId(randomUUID())
    const record = this.createExecutor(id, cwd, policy)
    try {
      const configOptions = await this.activate(record, id, servers, signal, cwd)
      if (policy !== undefined) await this.persistPolicy(record, policy, signal)
      this.sessions.set(id, record)
      await this.notifyAvailableCommands(record, id)
      return { sessionId: id, configOptions, ...(policy === undefined ? {} : { _meta: nativeAcpSubagentPolicyMetadata(policy) }) }
    } catch (error: unknown) {
      if (this.ownedExecutors.has(record)) {
        try { await this.releaseSession(record); this.sessions.delete(id) }
        catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'native ACP Session creation cleanup failed') }
      }
      throw error
    }
  }

  private async persistPolicy(record: OwnedSession, policy: NativeAcpSubagentPolicy, signal: AbortSignal): Promise<void> {
    await this.rootExecution.maintenance({ route: record.rootRoute, id: record.id, resume: true }, async (owner, admitted) => {
      if (owner.invocation !== 'root' || this.rootExecution.capture(owner).id !== record.rootRoute) {
        throw new Error('native ACP: policy requires this Session root owner')
      }
      admitted.throwIfAborted()
      if (nativeSessionExecutionPolicy(await owner.readEvents({ signal: admitted })) !== undefined) {
        throw new Error('native ACP: Session execution policy is already recorded')
      }
      owner.appendBatch([{ type: 'execution/policy', data: executionPolicy(policy) }])
      await owner.flush()
    }, signal)
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

  private sessionFor(record: OwnedSession): Session {
    const owner = this.context.require('activeSessions').owners().find(candidate => candidate.invocation === 'root'
      && candidate.session.id === record.id && this.rootExecution.capture(candidate).id === record.rootRoute)
    if (owner === undefined) throw new Error('native ACP: event has no matching root Session owner')
    return owner.session
  }

  private enqueueUpdates(record: OwnedSession, event: SessionEvent, signal: AbortSignal, session?: Session): void {
    const connection = this.connection
    const usage = event.type === 'assistant/message' && event.data.usage !== undefined && this.context.optional('tokenMeter') !== undefined
      ? nativeAcpUsageUpdate(this.context, session ?? this.sessionFor(record), event) : undefined
    record.notifications = record.notifications.then(async () => {
      for (const update of await nativeAcpUpdates(this.context, event, signal, usage)) {
        try { await this.notify({ sessionId: String(record.id), update }) }
        catch (error: unknown) {
          if (signal.aborted && connection?.signal.aborted && signal.reason === connection.signal.reason) throw signal.reason
          throw error
        }
      }
    })
      .catch((error: unknown) => { record.notificationFailures.push(error) })
  }

  private async dispatchCommand(record: OwnedSession, line: string, signal: AbortSignal): Promise<boolean> {
    const commands: NativeCommandOperations | undefined = this.context.optional('commands')
    const parsed = commands?.parse(line)
    if (commands === undefined || parsed === undefined) return false
    return this.withRootCommandOwner(record, signal, async (owner, admitted) => {
      if (!commands.list(owner.agent.scope).some(command => command.name === parsed.name)) return false
      const release = owner.onEvent((event) => {
        this.enqueueUpdates(record, event, admitted, owner.session)
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
      let startedPromptTurn = false
      let exitCode = 1
      let operationFailure: { error: unknown } | undefined
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
            input = { prepareMessage: async (model, _owner, admitted) => {
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
            ...input, ...(record.policy?.permissionMode === 'parent-relay'
              ? { issueOwnerApproval: (owner: NativeActiveSessionOwner) => this.ownerApproval(record, owner) } : {}), onEvent: (event) => {
              this.enqueueUpdates(record, event, signal)
              if (event.type === 'turn/start') startedPromptTurn = true
              if (event.type === 'turn/end' && startedPromptTurn) {
                if (event.data.reason.kind === 'max-tokens') stopReason = 'max_tokens'
                else if (event.data.reason.kind === 'interrupted') stopReason = 'cancelled'
              }
            } }, signal)
          exitCode = result.exitCode
        }
      } catch (error: unknown) {
        if (isImageAdmissionError(error)) operationFailure = { error: RequestError.invalidParams(undefined, error.message) }
        else if (!signal.aborted || error !== signal.reason) operationFailure = { error }
        else exitCode = 1
      }
      const notificationFailures = (await this.drainNotifications(record))
        .filter(error => !signal.aborted || error !== signal.reason)
      if (operationFailure !== undefined && notificationFailures.length > 0) {
        throw new AggregateError([operationFailure.error, ...notificationFailures], 'native ACP prompt and notification delivery failed')
      }
      if (operationFailure !== undefined) throw operationFailure.error
      if (notificationFailures.length === 1) throw notificationFailures[0]
      if (notificationFailures.length > 1) throw new AggregateError(notificationFailures, 'native ACP notification delivery failed')
      if (signal.aborted) return { stopReason: 'cancelled' }
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
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'tmuxContext', 'agentInstructions', 'modelSelection',
    'sessionExecution', 'agentPresets', 'workspaceRegistry', 'attachments', 'modelDirectory', 'commands', 'requestContexts', 'tokenMeter'],
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
