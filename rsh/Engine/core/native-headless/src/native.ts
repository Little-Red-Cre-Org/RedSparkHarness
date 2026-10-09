/** Native headless Agent authority over the existing Session and filesystem interfaces. */
import { randomUUID } from 'node:crypto'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ResourceOwner } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentExecution, InboxTarget } from '@deepseek-ai/dsh-native-agent'
import type { NativeAgentPresetOperations, NativeAgentPresetLease } from '@deepseek-ai/dsh-agent-presets/native'
import { foldNativeAgentPresetFacts, type NativeAgentPresetSelectionRequest, type NativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { WorkspaceRegistryRuntime } from '@deepseek-ai/dsh-workspace/native'
import type { NativeSessionConfiguration, NativeSessionDelegation, NativeSessionExecutionOperations,
  NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootSessionOperations, NativeProgramInteractionOwner,
  NativeRootExecutionOperations, NativeRootRoute, NativeRootRouteId, NativeRootForkRequest } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeStepAdmissionCommitCheck } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import { NativeContinuationSession } from './continuation-session.ts'
import { NativeContinuationRuntime } from './continuation-runtime.ts'
import { NativeContinuationActivation } from './continuation-activation.ts'
import { NativeProgramActiveSession } from './continuation-active-session.ts'
import { NativeWorkspaceRoutes, resolveWorkspaceRouteConfiguration, type NativeWorkspaceRouteConfiguration } from './workspace-routes.ts'
import { SessionPersistenceNotFoundError, type SessionDeletionId, type SessionDeletionReceipt } from '@deepseek-ai/dsh-session-persistence/native'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/native'
import type { StreamChunk, MessageId, LlmCallConfig } from '@deepseek-ai/dsh-llm/native'
import { isAbsolute, resolve } from 'node:path'
import { NativeScope, type NativeApplication, type NativeContext, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import { FsError, type FsTarget, type FsWriteIntent } from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-time-context/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type { NativeModelExecution } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeToolApproval, NativeToolApprovalRequest, NativeToolExecution, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import {
  NativeApprovalRequestId,
  sessionApprovalPolicy,
  type NativeApprovalOutcome,
  type NativeApprovalServiceDefinition,
} from '@deepseek-ai/dsh-approval-definition'
import type { NativeCodeRuntime } from '@deepseek-ai/dsh-code-runtime-definition'
import type { NativeAgentInstructions } from '@deepseek-ai/dsh-agent-instructions/native'
import type { NativeTimeContext } from '@deepseek-ai/dsh-native-time-context'
import {
  ReasoningEffortId, HarnessError, createSystemMessage, createToolResultMessage, createUserMessage,
  callConfigEquals, type ContentBlock, type GenerateOptions, type ToolCallBlock, type ToolSchema, type UserMessage,
} from '@deepseek-ai/dsh-llm/native'
import { interruptedTurnClosers, SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq, type SessionEvent, type TurnEndCancelCause } from '@deepseek-ai/dsh-session/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'

interface NativeRootForkSeed {
  readonly source: SessionId
  readonly agentPreset?: string
  readonly events: readonly SessionEvent[]
}

/** One identified user turn accepted by the native Session executor. */
export interface NativeTurnRequest {
  readonly id: ReturnType<typeof SessionId>
  readonly resume: boolean
  /** Program-selected immutable route; direct calls use their existing bound route or configured base. */
  readonly route?: NativeRootRouteId
  /** Root admission classification persisted before the active owner is published. */
  readonly rootOrigin?: 'scheduled'
  /** Explicit composition for a fresh root; resume and fork use accepted history. */
  readonly preset?: string
  readonly message?: UserMessage
  /**
   * Prepare root input instead of message while the original Agent owns execution and the Session writer.
   * @param model - next durable selection, or the selected root route's explicit model defaults.
   * @param signal - composed caller, Agent and Program cancellation.
   * @returns identified user input; rejection admits no input or model request.
   */
  readonly prepareMessage?: (model: Readonly<Pick<LlmCallConfig, 'provider' | 'model'>>, signal: AbortSignal) => Promise<UserMessage>
  /** Observe accepted model chunks without assigning process output to the executor. */
  readonly onChunk?: (chunk: StreamChunk) => void
  /** Observe Session events after backend append; a failure interrupts the turn. */
  readonly onEvent?: (event: SessionEvent) => void
}

/** A fresh delegated turn executed under the exact active parent Session. */
export interface NativeDelegatedTurnRequest extends Omit<NativeTurnRequest, 'resume' | 'preset' | 'route' | 'prepareMessage'>, Pick<NativeSessionDelegation, 'prepare' | 'initialize' | 'onReady' | 'lifetime'> {
  readonly parent: Session
  /** Fully resolved child route, prompt and budgets; the workspace must match the parent. */
  readonly config: Readonly<Config>
  /** Absolute delegation-depth cap selected by the caller's policy. */
  readonly maxDepth: number
}

/** Turn result available after durable settlement; explicit residency may retain its writer. */
export interface NativeTurnResult {
  readonly exitCode: number
  readonly answer?: string
}

/** Resolve typed Program routing without parsing another Program's additional configuration fields. */
function resolveRootRoute(config: ResolvedConfig): Readonly<NativeRootRoute> {
  const { cwd, provider, model, systemPrompt, maxSteps, builtinTools, reasoningEffort, maxTokens } = config
  return Object.freeze({
    id: config.rootRouteId === undefined ? brandString<NativeRootRouteId>('root') : config.rootRouteId,
    ...config.workspaceRoutes === undefined ? {} : { workspaceSelection: true as const },
    configuration: Object.freeze({ cwd, provider, model, systemPrompt, maxSteps, builtinTools,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
      ...maxTokens === undefined ? {} : { maxTokens } }),
  })
}
/** Explicit headless request and workspace policy. */
export interface Config extends NativeSessionConfiguration {
  /** Stable identity of this Program configuration. */
  readonly rootRouteId?: NativeRootRouteId
  /** Explicit admission limits for existing Workspace directory selection. */
  readonly workspaceRoutes?: NativeWorkspaceRouteConfiguration
  cwd: string
  provider: string
  model: string
  systemPrompt: string
  maxSteps: number
  /** Enable fixed file/code tools independently of registry tools; defaults to true. */
  builtinTools?: boolean
  /** Restrict model-visible and executable tools without installing or granting a capability. */
  allowedTools?: readonly string[]
  /** Optional narrower write boundary for native SDK children; reads remain bounded by cwd. */
  workspaceWriteRoot?: string
}

interface ResolvedConfig extends Config {
  builtinTools: boolean
}

interface ActiveOwnerRegistration {
  readonly owner: NativeProgramActiveSession
  readonly release: () => Promise<void>
  cleanup?: Promise<void>
}

const TOOL_SCHEMAS: ToolSchema[] = [
  { name: 'read_file', description: 'Read a UTF-8 file within the selected workspace.', parameters: {
    type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
  } },
  { name: 'write_file', description: 'Create or replace a UTF-8 file within the selected workspace.', parameters: {
    type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'], additionalProperties: false,
  } },
]

const CODE_TOOL_SCHEMA: ToolSchema = {
  name: 'run_code', description: 'Run one TypeScript program in an isolated worker thread.', parameters: {
    type: 'object', properties: { program: { type: 'string' } }, required: ['program'], additionalProperties: false,
  },
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`native-headless: ${name} must be a nonempty string`)
  return value
}

function allowedToolNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  const message = 'native-headless: allowedTools must be an array of unique non-empty names'
  if (!Array.isArray(value)) throw new Error(message)
  const names = value.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
  if (names.length !== value.length || new Set(names).size !== names.length) throw new Error(message)
  return names
}

/** Validate native Program turn settings.
 * @param input - profile settings.
 * @returns explicit workspace, model and execution limits.
 */
export function resolveNativeHeadlessConfig(input: unknown): ResolvedConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native-headless: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['cwd', 'provider', 'model', 'systemPrompt', 'maxSteps', 'builtinTools', 'rootRouteId', 'workspaceRoutes', 'maxTokens', 'reasoningEffort', 'allowedTools', 'workspaceWriteRoot'].includes(key)) throw new Error(`native-headless: unknown configuration field ${key}`)
  }
  const cwd = nonempty(fields.cwd, 'cwd')
  if (!isAbsolute(cwd)) throw new Error('native-headless: cwd must be absolute')
  const maxSteps = fields.maxSteps === undefined ? 4 : fields.maxSteps
  if (typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
    throw new Error('native-headless: maxSteps must be a positive integer')
  }
  const builtinTools = fields.builtinTools === undefined ? true : fields.builtinTools
  if (typeof builtinTools !== 'boolean') throw new Error('native-headless: builtinTools must be a boolean')
  const rootRouteId = fields.rootRouteId === undefined ? undefined : brandString<NativeRootRouteId>(nonempty(fields.rootRouteId, 'rootRouteId'))
  const workspaceRoutes = fields.workspaceRoutes === undefined ? undefined : resolveWorkspaceRouteConfiguration(fields.workspaceRoutes)
  const maxTokens = fields.maxTokens
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error('native-headless: maxTokens must be a positive integer')
  }
  const reasoningEffort = fields.reasoningEffort === undefined ? undefined : ReasoningEffortId(nonempty(fields.reasoningEffort, 'reasoningEffort'))
  const allowedTools = allowedToolNames(fields.allowedTools)
  const workspaceWriteRoot = fields.workspaceWriteRoot === undefined ? undefined : nonempty(fields.workspaceWriteRoot, 'workspaceWriteRoot')
  if (workspaceWriteRoot !== undefined && !isAbsolute(workspaceWriteRoot)) throw new Error('native-headless: workspaceWriteRoot must be absolute')
  return {
    ...rootRouteId === undefined ? {} : { rootRouteId },
    ...workspaceRoutes === undefined ? {} : { workspaceRoutes },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
    ...allowedTools === undefined ? {} : { allowedTools: Object.freeze([...allowedTools]) },
    ...workspaceWriteRoot === undefined ? {} : { workspaceWriteRoot: resolve(workspaceWriteRoot) },
    cwd: resolve(cwd), provider: nonempty(fields.provider, 'provider'), model: nonempty(fields.model, 'model'),
    systemPrompt: nonempty(fields.systemPrompt, 'systemPrompt'), maxSteps, builtinTools,
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('tool arguments must be a JSON object')
  return value as Record<string, unknown>
}

function toolArguments(raw: string, name: string): { path: string; content?: string } {
  const value = object(JSON.parse(raw) as unknown)
  for (const key of Object.keys(value)) {
    if (key !== 'path' && (name !== 'write_file' || key !== 'content')) throw new Error(`unexpected tool argument ${key}`)
  }
  const path = nonempty(value.path, 'tool path')
  if (name === 'write_file') {
    if (typeof value.content !== 'string') throw new Error('native-headless: tool content must be a string')
    return { path, content: value.content }
  }
  return { path }
}

/** Settlement policies observe the model's raw argument text when it is not valid JSON. */
function settlementArguments(raw: string): unknown {
  try { return JSON.parse(raw) as unknown }
  catch (_invalidJson: unknown) { return raw }
}

function codeProgram(raw: string): string {
  const value = object(JSON.parse(raw) as unknown)
  for (const key of Object.keys(value)) {
    if (key !== 'program') throw new Error(`unexpected run_code argument ${key}`)
  }
  if (typeof value.program !== 'string') throw new Error('native-headless: run_code program must be a string')
  return value.program
}

function cancellationCause(value: unknown): TurnEndCancelCause {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'disposed' }
  const cause = value as Record<string, unknown>
  switch (cause.kind) {
    case 'user':
    case 'parent':
    case 'disposed':
      return { kind: cause.kind }
    case 'hook':
      return typeof cause.reason === 'string' ? { kind: 'hook', reason: cause.reason } : { kind: 'disposed' }
    default:
      return { kind: 'disposed' }
  }
}

function parseArgs(args: readonly string[]): { prompt: string; resume?: ReturnType<typeof SessionId> } {
  if (args[0] === '--resume') {
    if (args[1] === undefined || args[1].length === 0) throw new Error('native-headless: --resume needs a Session id')
    return { resume: SessionId(args[1]), prompt: args.slice(2).join(' ') }
  }
  return { prompt: args.join(' ') }
}

/** Failure used only to project a closed approval outcome into one tool result. */
class NativeApprovalRejection extends Error {
  constructor(readonly outcome: Exclude<NativeApprovalOutcome, 'allowed-once'>, toolName: string) {
    super(`native-headless: tool ${toolName} approval ${outcome}`)
    this.name = 'NativeApprovalRejection'
  }
}

/** One profile-owned application; the host cancels admitted work before releasing its Providers. */
export class NativeHeadlessApplication implements NativeApplication {
  /** Exact Program operations over its own Agent and Session writers. */
  readonly rootExecution: NativeRootExecutionOperations
  private readonly executions = new Map<ReturnType<typeof SessionId>, {
    execution: NativeAgentExecution
    unregister: () => Promise<void>
    interactionRoot: NativeAgent
    presetLease?: NativeAgentPresetLease
    route: Readonly<NativeRootRoute>
  }>()
  private readonly rootOwnerBindings = new WeakMap<NativeActiveSessionOwner, {
    readonly agent: NativeAgent
    readonly sessionId: SessionId
    readonly route: Readonly<NativeRootRoute>
    retirement?: Promise<void>
  }>()
  private readonly idleRetirements = new Map<SessionId, {
    readonly owner: NativeActiveSessionOwner
    readonly route: Readonly<NativeRootRoute>
    readonly promise: Promise<void>
  }>()
  private readonly retiringSessions = new Map<SessionId, NativeRootRouteId>()
  private readonly workspaceRoutes: NativeWorkspaceRoutes
  private readonly routeAdmissions = new Map<SessionId, Readonly<NativeRootRoute>>()
  private readonly storageMutations = new Map<SessionId, { readonly route: Readonly<NativeRootRoute>; readonly done: Promise<unknown> }>()
  private readonly storageRequests = new Set<Promise<unknown>>()
  private readonly storageCleanupFailures: unknown[] = []
  private readonly presetSelections = new Set<SessionId>()
  private readonly rootAdmissions = new Map<SessionId, Promise<void>>()
  private readonly presetCleanups = new Set<Promise<void>>()
  private readonly presetCleanupFailures: unknown[] = []
  private disposal: Promise<void> | undefined
  private readonly activeSessions = new Map<ReturnType<typeof SessionId>, Session>()
  private readonly continuationOwners = new Map<ReturnType<typeof SessionId>, NativeContinuationSession>()
  private readonly seededContinuations = new WeakSet<NativeContinuationSession>()
  private readonly continuationRuntime: NativeContinuationRuntime
  private readonly noticeWakes = new Set<Promise<NativeTurnResult>>()
  private readonly noticeFailures: unknown[] = []
  private readonly activeOwners = new WeakMap<NativeContinuationSession, ActiveOwnerRegistration>()
  private readonly rootEpochs = new Map<SessionId, { owner: NativeContinuationSession; activation: NativeContinuationActivation }>()
  private readonly settledRoots = new WeakMap<NativeAgentExecution, NativeTurnResult>()
  private readonly rootChunkObservers = new WeakMap<NativeContinuationSession, Set<(chunk: StreamChunk) => void>>()
  private readonly rootOperations = new Map<Promise<unknown>, NativeAgent>()
  private readonly rootForks = new Set<Promise<SessionId>>()
  private readonly operationCancellation = new AbortController()
  private readonly currentTurns = new Map<NativeContinuationSession, { release?: () => void }>()

  constructor(
    private readonly context: NativeContext,
    private readonly fs: import('@deepseek-ai/dsh-fs/native').FileSystemOperations,
    private readonly storage: NativeSessionPersistenceOperations,
    private readonly modelExecution: NativeModelExecution,
    private readonly config: ResolvedConfig,
    private readonly agents: NativeAgentRegistry,
    private readonly tools: NativeToolRegistry | undefined,
    private readonly promptSections: NativePromptRegistry | undefined,
    private readonly sandboxPolicy: NativeSandboxPolicy | undefined,
    private readonly approval: NativeApprovalServiceDefinition | undefined,
    private readonly codeRuntime: NativeCodeRuntime | undefined,
    private readonly timeContext: NativeTimeContext | undefined,
    private readonly sessionExecution?: NativeSessionExecutionOperations,
    private readonly activeSessionRegistry?: NativeActiveSessionOperations,
    private readonly modelSelection?: NativeModelSelectionOperations,
    private readonly agentPresets?: NativeAgentPresetOperations,
    workspaceRegistry?: WorkspaceRegistryRuntime,
    private readonly executionScope: NativeScope = context.scope,
    private readonly agentInstructions?: NativeAgentInstructions,
  ) {
    const route = resolveRootRoute(config)
    this.workspaceRoutes = new NativeWorkspaceRoutes(route, config.workspaceRoutes, workspaceRegistry, fs, sandboxPolicy, context.signal,
      id => [...this.executions.values()].some(owned => owned.route.id === id)
        || [...this.routeAdmissions.values()].some(admitted => admitted.id === id)
        || [...this.storageMutations.values()].some(mutation => mutation.route.id === id))
    const resolveRoute: NativeRootExecutionOperations['resolve'] = (id) => {
      if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
      return this.workspaceRoutes.resolve(id)
    }
    const captureRoot = (owner: NativeActiveSessionOwner) => {
      const resident = this.continuationOwners.get(owner.session.id)
      const owned = this.executions.get(owner.session.id)
      if (owned?.execution.agent !== owner.agent || owner.invocation !== 'root' || !owner.writerAvailable || resident === undefined
        || this.activeOwners.get(resident)?.owner !== owner || this.agents.get(owner.agent.id) !== owner.agent) {
        throw new Error('native-headless: root route requires the exact attached root owner')
      }
      return owned
    }
    this.rootExecution = Object.freeze({
      ...storage.deletions === undefined ? {} : { deletions: {
        list: (request: { readonly route: NativeRootRouteId; readonly limit: number }, signal: AbortSignal) =>
          this.trackStorageRequest(() => this.listStoredDeletions(request, signal)),
        delete: (request: { readonly route: NativeRootRouteId; readonly id: SessionId }, signal: AbortSignal) =>
          this.trackStorageRequest(() => this.deleteStoredSession(request, signal)),
        restore: (request: { readonly route: NativeRootRouteId; readonly id: SessionDeletionId }, signal: AbortSignal) =>
          this.trackStorageRequest(() => this.restoreStoredSession(request, signal)),
      } },
      ready: (signal: AbortSignal) => Promise.resolve().then(() => {
        signal.throwIfAborted()
        this.context.signal.throwIfAborted()
        if (this.disposal !== undefined) throw new Error('native-headless: application is disposed')
      }),
      resolve: resolveRoute,
      workspaceRoutes: () => this.workspaceRoutes.list(),
      selectWorkspace: (request, signal) => this.workspaceRoutes.select(request.baseRoute, request.workspaceId, signal),
      ...config.workspaceRoutes === undefined ? {} : {
        createWorkspaceRoute: (request: { readonly baseRoute: NativeRootRouteId; readonly path: string }, signal: AbortSignal) => {
          resolveRoute(request.baseRoute)
          return this.workspaceRoutes.createWorkspace(request.baseRoute, request.path, signal)
        },
      },
      releaseWorkspace: (id, signal) => Promise.resolve().then(() => {
        signal.throwIfAborted()
        this.workspaceRoutes.release(id)
        for (const [sessionId, retirement] of this.idleRetirements) {
          if (retirement.route.id === id) {
            this.idleRetirements.delete(sessionId)
          }
        }
        for (const [sessionId, route] of this.retiringSessions) {
          if (route === id) this.retiringSessions.delete(sessionId)
        }
      }),
      capture: (owner: NativeActiveSessionOwner) => captureRoot(owner).route,
      cancel: (owner: NativeActiveSessionOwner) => captureRoot(owner).unregister(),
      releaseIdle: (request, signal) => {
        try { return this.releaseIdleRoot(request, signal) }
        catch (error: unknown) {
          return Promise.reject(error instanceof Error ? error : new Error('native-headless: idle retirement failed', { cause: error }))
        }
      },
      execute: (request, signal) => {
        resolveRoute(request.route)
        return this.executeRootTurn(request, signal)
      },
      settle: (request, signal) => {
        resolveRoute(request.route)
        if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
        return this.waitRootSettlement(request.id, signal)
      },
      maintenance: (request, operation, signal) => {
        resolveRoute(request.route)
        return this.executeSessionOperation(request, operation, signal)
      },
      fork: (request, signal) => {
        resolveRoute(request.route)
        const pending = this.forkRootSession(request, signal)
        this.rootForks.add(pending)
        void pending.then(() => { this.rootForks.delete(pending) }, () => { this.rootForks.delete(pending) })
        return pending
      },
      selectPreset: (request, signal) => {
        resolveRoute(request.route)
        return this.selectRootPreset(request, signal)
      },
    } satisfies NativeRootExecutionOperations)
    this.continuationRuntime = new NativeContinuationRuntime({
      storage, agents, configuration: agent => this.executionConfig(agent), lifetime: context.signal,
      observe: async (id, signal) => {
        const owner = this.continuationOwners.get(id)
        if (owner === undefined) return undefined
        if (owner.isClosing) { await owner.close(); return undefined }
        const stored = await owner.read(signal)
        return { header: owner.session.header, events: stored.events,
          inheritedEventCount: owner.writer.inheritedEventCount, defaults: { ...this.executionConfigFor(id) } }
      },
      closing: owner => this.releaseActiveOwner(owner),
      acquire: (id, scope, parent) => this.withExecution(id, (execution) => {
        const owned = this.executions.get(id)
        if (owned === undefined) throw new Error('native-headless: acquired continuation Agent is not registered')
        return Promise.resolve({ execution, preset: owned.presetLease?.id ?? null, release: async () => {
          try { await owned.unregister() } finally {
            if (this.executions.get(id) === owned) this.executions.delete(id)
            this.continuationOwners.delete(id)
          }
        } })
      }, scope, parent),
      run: (request, owner, agent, initial, ready, signal) => {
        const { initialize, ...turnRequest } = request
        return this.runTurn({ ...turnRequest, resume: !initial,
          ...initial && initialize !== undefined ? { initialize } : {}, onReady: () => { ready() } },
        request.id, agent, signal, { ...config, ...request.config }, undefined, owner, 'delegated')
      },
      maintenance: (request, owner, agent, operation, signal) => {
        const live = this.activeOwners.get(owner)?.owner
        if (live !== undefined) return this.runAttachedSessionOperation(live, operation, signal, 'delegated')
        return this.agents.execution(agent).runMaintenance(async (admitted) => {
          const maintenanceSignal = AbortSignal.any([admitted, signal])
          maintenanceSignal.throwIfAborted()
          let result: { value: Awaited<ReturnType<typeof operation>> } | undefined
          await this.runTurn({ ...request, resume: true }, request.id, agent, maintenanceSignal,
            this.executionConfig(agent), undefined, owner, 'delegated', false, async (active, activeSignal) => {
              result = { value: await operation(active, activeSignal) }
            })
          if (result === undefined) throw new Error('native-headless: delegated maintenance did not run')
          return result.value
        })
      },
      deliver: (sender, session, id, message, target, wake, signal) =>
        this.deliverContinuationInput(sender, session, id, message, target, wake, signal),
    })
  }

  private async target(path: string, root: FsTarget, signal: AbortSignal, cwd: string): Promise<FsTarget> {
    const target = await this.fs.resolve(path, { cwd, signal })
    if (!this.fs.contains(root, target)) throw new FsError(`path outside workspace: ${path}`, 'FS_SANDBOX_DENIED')
    return target
  }

  private async execute(call: ToolCallBlock, root: FsTarget, actor: object, session: Session,
    signal: AbortSignal, cwd: string, workspaceWriteRoot?: string): Promise<string> {
    if (call.name !== 'read_file' && call.name !== 'write_file') throw new Error(`unknown tool ${call.name}`)
    const args = toolArguments(call.arguments, call.name)
    const target = await this.target(args.path, root, signal, cwd)
    if (call.name === 'read_file') {
      const info = await this.fs.stat(target, signal)
      if (info === undefined) {
        this.context.events.emit(this.context.scope, 'fs/observed', target, { kind: 'absent' }, actor)
        throw new FsError(`file not found: ${args.path}`, 'FS_NOT_FOUND')
      }
      const text = await this.fs.readText(target, signal)
      this.context.events.emit(this.context.scope, 'fs/observed', target, { kind: 'present', version: info.version }, actor)
      return text
    }
    if (workspaceWriteRoot !== undefined) {
      const writeRoot = await this.fs.resolve(workspaceWriteRoot, { cwd, signal })
      if (!this.fs.contains(writeRoot, target)) throw new FsError(`write path outside authorized root: ${args.path}`, 'FS_SANDBOX_DENIED')
    }
    const intent = await this.context.events.waterfall(
      this.context.scope, 'fs/write-intent', (): FsWriteIntent => ({ kind: 'createIfAbsent' }), target, actor,
    )
    const outcome = await this.fs.writeText(target, args.content ?? '', intent, signal, this.sandboxPolicy?.resolve({ session }))
    this.context.events.emit(this.context.scope, 'fs/observed', target, { kind: 'present', version: outcome.version }, actor)
    return `${outcome.operation}: ${args.path}`
  }

  /** Run code through the profile-selected Provider and convert a program failure into one tool failure. */
  private async executeCode(call: ToolCallBlock, signal: AbortSignal): Promise<{ text: string; error?: { name: string; code: string } }> {
    const runtime = this.codeRuntime
    if (runtime === undefined) throw new Error('native-headless: run_code requires a code runtime')
    const result = await runtime.run({ program: codeProgram(call.arguments), bindings: [], signal })
    if (result.error === undefined) return { text: JSON.stringify(result) }
    return {
      text: JSON.stringify(result),
      error: { name: 'NativeCodeRuntimeError', code: `CODE_RUNTIME_${result.error.kind.toUpperCase().replaceAll('-', '_')}` },
    }
  }

  /** Execute one turn after its native Agent lifecycle is visible. */
  private async runTurn(
    request: NativeTurnRequest & Pick<NativeSessionDelegation, 'initialize' | 'onReady'>,
    id: ReturnType<typeof SessionId>,
    agent: NativeAgent,
    signal: AbortSignal,
    config: Readonly<Config>,
    lineage?: { readonly parentSession: ReturnType<typeof SessionId>; readonly delegationDepth: number },
    resident?: NativeContinuationSession,
    invocation: 'root' | 'delegated' = 'root',
    rootDriven = false,
    operation?: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<void>,
    rootObservation?: { release?: () => void; epoch?: NativeContinuationActivation },
    forkSeed?: NativeRootForkSeed,
  ): Promise<NativeTurnResult> {
    const promptContext = config.allowedTools === undefined ? undefined : { allowedTools: config.allowedTools }
    const additions = await this.promptSections?.render(agent.scope, promptContext) ?? ''
    const systemPrompt = additions === '' ? config.systemPrompt : `${config.systemPrompt}\n\n${additions}`
    const root = await this.fs.resolve(config.cwd, { signal })
    const rootInfo = await this.fs.stat(root, signal)
    if (rootInfo?.type !== 'directory') throw new Error('native-headless: cwd must be a directory')
    const constructorEvents: SessionEvent[] = []
    const creationPreset = this.executions.get(id)?.presetLease?.id
    const fresh = resident === undefined && !request.resume ? Session.create(id, forkSeed?.events, {
      version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: config.cwd, isSeeded: forkSeed !== undefined,
      delegationDepth: lineage?.delegationDepth ?? 0,
      ...creationPreset === undefined ? {} : { agentPreset: creationPreset },
      ...lineage === undefined ? {} : { parentSession: lineage.parentSession, origin: 'subagent' },
      ...forkSeed === undefined ? {} : { parentSession: forkSeed.source },
    }, forkSeed === undefined ? undefined : SessionLogOffset(forkSeed.events.length),
    (event) => { constructorEvents.push(event) }) : undefined
    if (fresh !== undefined && forkSeed !== undefined) {
      const priorSystem = fresh.deriveMessages().findLast(message => message.role === 'system')
      if (priorSystem !== undefined && (priorSystem.content[0]?.type !== 'text' || priorSystem.content[0].text !== systemPrompt)) {
        throw new Error('native-headless: fork source systemPrompt differs from profile configuration')
      }
    }
    const writer = resident?.writer ?? (fresh !== undefined
      ? await this.storage.create(fresh.header, { signal, inheritedEventCount: fresh.inheritedEventCount })
      : await this.storage.open(id, 'write', { signal }))
    let session: Session
    let releaseExecution: (() => Promise<void>) | undefined
    const pending: SessionEvent[] = []
    let restoredPrefix: SessionEvent[] = []
    let owner: NativeContinuationSession
    let releaseObservation: (() => void) | undefined
    let seedResident = false
    let activeOwner: NativeProgramActiveSession | undefined
    let turnOwnership: { release?: () => void } | undefined
    let acceptedPreset: string | null = null
    let closersToAppend: SessionEvent[] = []
    let turn = 1
    let settledAnswer: string | undefined
    let concludedByTool = false
    let admissionInvalidated = false
    let exitCode = 1
    let turnFailure: { error: unknown } | undefined
    let eventObserverFailed = false
    const notifyEvent = (event: SessionEvent): void => {
      if (eventObserverFailed || request.onEvent === undefined) return
      try {
        request.onEvent(event)
      } catch (error: unknown) {
        eventObserverFailed = true
        throw error
      }
    }
    try {
      if (resident !== undefined) {
        session = resident.session
        const stored = await writer.read(0, Number.MAX_SAFE_INTEGER, { signal })
        acceptedPreset = foldNativeAgentPresetFacts(session.header, stored.events).preset
        const lastTurn = stored.events.findLast(event => event.type === 'turn/end')
        turn = lastTurn?.type === 'turn/end' ? lastTurn.data.turn + 1 : 1
        seedResident = !this.seededContinuations.has(resident)
        if (seedResident) {
          this.timeContext?.seed(session, stored.events)
          this.agentInstructions?.seed(session, stored.events)
          this.seededContinuations.add(resident)
        }
      } else if (fresh !== undefined) {
        session = fresh
        restoredPrefix = forkSeed === undefined ? [] : [...forkSeed.events, ...constructorEvents]
        pending.push(...restoredPrefix)
        acceptedPreset = foldNativeAgentPresetFacts(session.header, restoredPrefix).preset
        const lastTurn = restoredPrefix.findLast(event => event.type === 'turn/end')
        turn = lastTurn?.type === 'turn/end' ? lastTurn.data.turn + 1 : 1
        this.timeContext?.seed(session, restoredPrefix)
        this.agentInstructions?.seed(session, restoredPrefix)
      } else {
        const stored = await writer.read(0, Number.MAX_SAFE_INTEGER, { signal })
        const closers = interruptedTurnClosers(stored.events)
        closersToAppend = closers
        const repaired = [...stored.events, ...closers]
        const lastTurn = repaired.findLast(event => event.type === 'turn/end')
        turn = lastTurn?.type === 'turn/end' ? lastTurn.data.turn + 1 : 1
        session = Session.fromRestore(id, repaired, writer.header, writer.inheritedEventCount, stored.eventState,
          (event) => { pending.push(event) })
        this.timeContext?.seed(session, repaired)
        this.agentInstructions?.seed(session, stored.events)
        restoredPrefix = [...repaired, ...pending]
        acceptedPreset = foldNativeAgentPresetFacts(session.header, restoredPrefix).preset
      }
      if (this.agentPresets !== undefined) {
        if (acceptedPreset !== (this.executions.get(id)?.presetLease?.id ?? null)) {
          throw new Error('native-headless: Session preset changed after Agent admission')
        }
      } else if (acceptedPreset !== null) {
        throw new Error('native-headless: historical preset requires the Agent preset Registry')
      }
      if (request.resume) {
        const priorSystem = session.deriveMessages().findLast(message => message.role === 'system')
        if (priorSystem !== undefined && (priorSystem.content[0]?.type !== 'text' || priorSystem.content[0].text !== systemPrompt)) {
          throw new Error('native-headless: resumed Session systemPrompt differs from profile configuration')
        }
      }
      this.activeSessions.set(id, session)
      const allowed = (name: string): boolean => config.allowedTools === undefined || config.allowedTools.includes(name)
      const modelTools = this.tools?.modelSchemas(agent.scope).map(schema => schema.name).filter(allowed) ?? []
      const builtinTools = config.builtinTools
        ? ['read_file', 'write_file', ...(this.codeRuntime === undefined ? [] : ['run_code'])].filter(allowed)
        : []
      const resolvedSandbox = this.sandboxPolicy?.resolve({ session })
      const toolNames = [...new Set([...builtinTools, ...modelTools])]
      if (resolvedSandbox?.mode === 'read-only') {
        const readOnlyTools = toolNames.filter(name => name === 'read_file')
        toolNames.splice(0, toolNames.length, ...readOnlyTools)
      }
      const builtinToolNames = resolvedSandbox?.mode === 'read-only'
        ? builtinTools.filter(name => name === 'read_file') : [...builtinTools]
      releaseExecution = this.sessionExecution?.register({ agent, session, config,
        delegationAuthority: {
          toolNames: Object.freeze(toolNames),
          builtinToolNames: Object.freeze(builtinToolNames),
          ...(resolvedSandbox === undefined ? {} : { sandboxPolicy: {
            mode: resolvedSandbox.mode, workspaceRoot: resolvedSandbox.workspaceRoot,
            sessionId: session.id,
          } }),
          approvalRequired: this.approval !== undefined,
        },
        continuations: this.continuationRuntime.forParent(agent, session),
        delegate: (child, childSignal) => this.executeDelegatedTurn({ ...child, parent: session }, childSignal),
      })
      const record = (event: SessionEvent): void => {
        this.timeContext?.record(session, event)
      }
      const track = (event: SessionEvent): void => { owner.track(event) }
      const persist = (): Promise<void> => owner.persist()
      if (request.resume) {
        if (session.header.cwd !== config.cwd) {
          throw new Error('native-headless: resumed Session workspace differs from profile configuration')
        }
        if (closersToAppend.length > 0) {
          await writer.append(closersToAppend, { signal })
          for (const event of closersToAppend) notifyEvent(event)
        }
      }
      owner = resident ?? NativeContinuationSession.adopt(session, writer, restoredPrefix, pending)
      this.continuationOwners.set(id, owner)
      if (resident === undefined || seedResident) owner.onTrack(record)
      this.seededContinuations.add(owner)
      if (forkSeed !== undefined) await owner.discard()
      releaseObservation = owner.onEvent(notifyEvent)
      const rootOrigin = await this.admitRootOrigin(owner, request.rootOrigin, invocation,
        this.activeOwners.get(owner)?.owner)
      if (rootObservation !== undefined) {
        const releaseEvents = releaseObservation
        const observers = this.rootChunkObservers.get(owner) ?? new Set<(chunk: StreamChunk) => void>()
        this.rootChunkObservers.set(owner, observers)
        if (request.onChunk !== undefined) observers.add(request.onChunk)
        rootObservation.release = () => {
          releaseEvents()
          if (request.onChunk !== undefined) observers.delete(request.onChunk)
          if (observers.size === 0) this.rootChunkObservers.delete(owner)
        }
        releaseObservation = undefined
      }
      turnOwnership = {}
      this.currentTurns.set(owner, turnOwnership)
      const rootEpoch = this.rootEpochs.get(id)
      if (rootEpoch !== undefined) turnOwnership.release = rootEpoch.activation.retainChild()
      activeOwner = await this.ensureActiveOwner(owner, agent, invocation, config, rootOrigin)
      const schemas = [
        ...(config.builtinTools ? [...TOOL_SCHEMAS, ...(this.codeRuntime === undefined ? [] : [CODE_TOOL_SCHEMA])]
          .filter(schema => config.allowedTools === undefined || config.allowedTools.includes(schema.name)) : []),
        ...(this.tools?.modelSchemas(agent.scope) ?? [])
          .filter(schema => config.allowedTools === undefined || config.allowedTools.includes(schema.name)),
      ].map(schema => structuredClone(schema))
      if (new Set(schemas.map(schema => schema.name)).size !== schemas.length) {
        throw new Error('native-headless: duplicate tool schema')
      }
      await persist()
      if (operation !== undefined) {
        if (activeOwner === undefined) throw new Error('native-headless: Session operation requires the active Session Provider')
        try {
          await operation(activeOwner, signal)
        } catch (error: unknown) {
          await persist()
          await writer.flush()
          await activeOwner.settled(signal.aborted
            ? { kind: 'aborted', reason: cancellationCause(signal.reason) }
            : { kind: 'error', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } })
          throw error
        }
        await persist()
        await writer.flush()
        await activeOwner.settled({ kind: 'completed' })
        return { exitCode: 0 }
      }
      let message = request.message
      if (request.prepareMessage !== undefined) {
        if (activeOwner === undefined || invocation !== 'root') throw new Error('native-headless: input preparation requires the active root owner')
        const selected = (await this.modelSelection?.state(activeOwner, signal))?.next ?? config
        signal.throwIfAborted()
        message = await request.prepareMessage({ provider: selected.provider, model: selected.model }, signal)
        signal.throwIfAborted()
      }
      if (message !== undefined) {
        track(session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] }))
        await persist()
      }
      track(session.append('turn/start', { turn }))
      let reason: import('@deepseek-ai/dsh-session/native').TurnEndReason = { kind: 'completed' }
      try {
        const prepare = async () => {
          let selection: Awaited<ReturnType<NativeModelSelectionOperations['capture']>> | undefined
          if (invocation === 'root' && this.modelSelection !== undefined) {
            if (activeOwner === undefined) throw new Error('native-headless: model selection requires the active Session Provider')
            selection = await this.modelSelection.capture(activeOwner, config, signal)
          }
          const preparedStep = await this.modelExecution.prepareStep(selection?.requestedConfig ?? config, signal)
          signal.throwIfAborted()
          return { selection, preparedStep }
        }
        const admit = async (step: number) => {
          if (activeOwner === undefined) {
            const prepared = await prepare()
            return { inputs: await owner.claim(step === 1 ? 'next-turn' : 'next-step'), commitChecks: [], ...prepared }
          }
          const candidates = [...owner.messages('next-step'), ...step === 1 ? owner.messages('next-turn').slice(0, 1) : []]
          const commitChecks: NativeStepAdmissionCommitCheck[] = []
          let registrationOpen = true
          let decision: Awaited<ReturnType<NativeProgramActiveSession['admission']['decide']>>
          try {
            decision = await activeOwner.admission.decide({ owner: activeOwner, turn, step, candidates, signal,
              registerCommitCheck: (check) => {
                if (!registrationOpen) throw new Error('native-headless: admission commit checks must register before admission settles')
                commitChecks.push(check)
              } })
          } finally { registrationOpen = false }
          signal.throwIfAborted()
          if (decision.kind === 'reject') {
            await owner.remove(decision.discard, 'canceled', signal)
            reason = { kind: 'blocked' }
            return undefined
          }
          const prepared = await prepare()
          return { inputs: decision.messages, commitChecks, ...prepared }
        }
        const initialInputs = await admit(1)
        request.initialize?.((type, data, ...options) => {
          const event = session.append(type, data, ...options)
          track(event as SessionEvent)
          return event
        })
        await persist()
        request.onReady?.(agent)
        for (let step = 1; step <= config.maxSteps; step++) {
          signal.throwIfAborted()
          const admitted = step === 1 ? initialInputs : await admit(step)
          if (admitted === undefined) break
          const { inputs, selection, preparedStep, commitChecks } = admitted
          const stepConfig = preparedStep.config
          const instructionContext = await this.agentInstructions?.prepare(session, inputs, signal)
          signal.throwIfAborted()
          if (activeOwner !== undefined) {
            const admittedIds = new Set(inputs.map(input => input.id))
            const rejected = new Set<MessageId>()
            for (const check of commitChecks) {
              const rejectedByCheck: unknown = check()
              if (!Array.isArray(rejectedByCheck)) {
                if (typeof rejectedByCheck === 'object' && rejectedByCheck !== null && 'then' in rejectedByCheck) {
                  // Observe a rejected async check after refusing its result synchronously.
                  void Promise.resolve(rejectedByCheck).then(undefined, () => undefined)
                }
                throw new Error('native-headless: admission commit check must return message ids synchronously')
              }
              for (const messageId of rejectedByCheck as MessageId[]) {
                if (!admittedIds.has(messageId)) throw new Error('native-headless: admission commit check rejected an unadmitted message')
                rejected.add(messageId)
              }
            }
            if (rejected.size > 0) {
              await owner.remove([...rejected], 'canceled', signal)
              admissionInvalidated = true
              exitCode = 0
              break
            }
            owner.removePending(inputs.map(input => input.id), undefined)
          }
          track(session.append('step/start', { turn, step }))
          if (step === 1) {
            if (session.deriveMessages().every(message => message.role !== 'system')) {
              track(session.append('system/message', { turn, step, message: createSystemMessage(systemPrompt, 'native-headless') }, { surfaceOp: 'append' }))
            }
          }
          for (const input of inputs) {
            track(session.append('user/message', input, { surfaceOp: 'append' }))
          }
          if (selection?.notice !== undefined) track(session.append('user/message', selection.notice, { surfaceOp: 'append' }))
          if (instructionContext !== undefined) {
            track(session.append('user/message', instructionContext, { surfaceOp: 'append' }))
          }
          const timeContext = this.timeContext?.prepare({ session, turn, step })
          if (timeContext !== undefined) {
            track(session.append('user/message', timeContext, { surfaceOp: 'append' }))
          }
          const priorHeader = session.requestHeader()
          if (priorHeader === undefined || step === 1 && request.resume || !callConfigEquals(priorHeader.config, stepConfig)) {
            track(session.append('request/header', {
              header: { config: { ...stepConfig }, ...schemas.length === 0 ? {} : { tools: schemas } },
              reason: priorHeader === undefined ? 'initial' : 'resume',
            }))
          }
          const priorContext = session.requestContext()
          const contextWindow = preparedStep.modelInfo?.context?.contextWindow
          if (priorContext?.provider !== stepConfig.provider || priorContext.model !== stepConfig.model
            || priorContext.contextWindow !== contextWindow) {
            track(session.append('request/context', { provider: stepConfig.provider, model: stepConfig.model,
              ...contextWindow === undefined ? {} : { contextWindow } }))
          }
          await persist()
          const options: GenerateOptions = {
            ...stepConfig, messages: session.deriveMessages(), tools: schemas, sessionId: id, signal,
          }
          const { message, finish } = await this.modelExecution.execute({
            session, turn, step, options, prepared: preparedStep, append: track, persist,
            rebuildOptions: () => ({ ...stepConfig, messages: session.deriveMessages(), tools: schemas, sessionId: id, signal }),
            onChunk: (chunk) => {
              request.onChunk?.(chunk)
              for (const observe of this.rootChunkObservers.get(owner) ?? []) {
                if (observe !== request.onChunk) observe(chunk)
              }
            },
          })
          const calls = message.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
          if (finish.kind === 'max-tokens') {
            if (calls.length > 0) throw new Error('native-headless: truncated tool call')
            reason = { kind: 'max-tokens' }
          }
          concludedByTool = false
          const actor = agent
          for (const call of calls) {
            track(session.append('tool/call', { turn, step, callId: call.id, name: call.name, arguments: call.arguments }))
            const toolCallSeq = SessionSeq(session.seq - 1)
            await persist()
            let content: ContentBlock[]
            let isError = false
            let error: { name: string; code: string } | undefined
            let meta: JsonValue | undefined
            let additionalContexts: readonly UserMessage[] = []
            let execution: NativeToolExecution | undefined
            try {
              if (config.allowedTools !== undefined && !config.allowedTools.includes(call.name)) {
                throw new HarnessError(`native-headless: tool ${call.name} is outside this Session's allowedTools`, 'TOOL_DENIED')
              }
              const requestApproval = async (requested: NativeToolApprovalRequest): Promise<NativeApprovalOutcome> => {
                if (requested.agent !== agent || requested.session !== session) {
                  throw new Error('native-headless: approval invocation belongs to a different Agent or Session')
                }
                const service = this.approval
                if (service === undefined) throw new Error('native-headless: no approval authority')
                const approvalId = NativeApprovalRequestId(randomUUID())
                const sessionPolicy = sessionApprovalPolicy(session)
                track(session.append('native-approval/asked', {
                  id: approvalId, toolName: requested.toolName, callId: requested.callId,
                  ...requested.reason === undefined ? {} : { reason: requested.reason },
                }))
                await persist()
                await writer.flush()
                const approvalSignal = AbortSignal.any([signal, requested.signal])
                const decision = invocation === 'delegated'
                  ? { id: approvalId, policy: 'never' as const, outcome: 'rejected' as const }
                  : await service.request({
                    id: approvalId, agent, ...sessionPolicy === undefined ? {} : { sessionPolicy },
                    toolName: requested.toolName, callId: requested.callId,
                    ...requested.reason === undefined ? {} : { reason: requested.reason },
                    signal: approvalSignal,
                  })
                track(session.append('native-approval/decided', decision))
                await persist()
                await writer.flush()
                approvalSignal.throwIfAborted()
                return decision.outcome
              }
              const authorize = async (requested: NativeToolApproval): Promise<void> => {
                const outcome = await requestApproval({ agent, session, callId: call.id, toolName: call.name, signal, ...requested })
                if (outcome !== 'allowed-once') throw new NativeApprovalRejection(outcome, call.name)
              }
              if (config.builtinTools && (call.name === 'read_file' || call.name === 'write_file')) {
                if (call.name === 'write_file' && this.approval !== undefined) {
                  await authorize({ reason: 'Writing a file changes the selected workspace.' })
                }
                content = [{ type: 'text', text: await this.execute(call, root, actor, session, signal, config.cwd, config.workspaceWriteRoot) }]
              } else if (config.builtinTools && call.name === 'run_code' && this.codeRuntime !== undefined) {
                const outcome = await this.executeCode(call, signal)
                content = [{ type: 'text', text: outcome.text }]
                if (outcome.error !== undefined) {
                  isError = true
                  error = outcome.error
                }
              } else {
                if (this.tools === undefined) throw new Error(`unknown tool ${call.name}`)
                execution = {
                  agent, callId: call.id, name: call.name, arguments: JSON.parse(call.arguments) as unknown, session, signal,
                  appendEvent: async (type, data, ...opts) => {
                    signal.throwIfAborted()
                    const event = session.append(type, data, ...opts)
                    track(event as SessionEvent)
                    await persist()
                    return event
                  },
                  ...this.approval === undefined ? {} : { approvalAuthority: {
                    request: requestApproval,
                    authorize: async (requested: NativeToolApprovalRequest): Promise<void> => {
                      const outcome = await requestApproval(requested)
                      if (outcome !== 'allowed-once') throw new NativeApprovalRejection(outcome, requested.toolName)
                    },
                  } },
                }
                const result = await this.tools.executeModelCall(execution)
                content = [...result.content]
                isError = result.isError
                meta = result.meta
                additionalContexts = structuredClone(result.additionalContexts ?? [])
                if (!result.isError && result.concludesTurn === true) concludedByTool = true
                error = result.error === undefined ? undefined : { ...result.error }
              }
            } catch (failure: unknown) {
              if (signal.aborted) throw failure
              content = [{ type: 'text', text: failure instanceof Error ? failure.message : String(failure) }]
              isError = true
              error = {
                name: failure instanceof Error ? failure.name : 'Error',
                code: failure instanceof FsError ? failure.code
                  : failure instanceof NativeApprovalRejection ? `APPROVAL_${failure.outcome.toUpperCase()}`
                    : failure instanceof HarnessError ? failure.code : 'UNKNOWN',
              }
            }
            track(session.append('tool/result', {
              turn, step, message: createToolResultMessage({ callId: call.id, content, isError }),
              ...error === undefined ? {} : { error },
              ...meta === undefined ? {} : { meta },
            }, { surfaceOp: 'append', sourceEventSeqs: [toolCallSeq] }))
            await persist()
            const recorded = { content, isError, ...error === undefined ? {} : { error }, ...meta === undefined ? {} : { meta } }
            if (execution !== undefined) this.tools?.acceptResult(execution, recorded)
            const settlementContexts = this.tools?.settlementContexts({
              agent, session, callId: call.id, name: call.name,
              arguments: execution === undefined ? settlementArguments(call.arguments) : execution.arguments, result: recorded,
            }) ?? []
            for (const context of [...settlementContexts, ...additionalContexts]) {
              track(session.append('user/message', context, { surfaceOp: 'append' }))
              await persist()
            }
          }
          track(session.append('step/end', { turn, step }))
          await persist()
          if (calls.length === 0 || concludedByTool) {
            settledAnswer = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
            exitCode = 0
            break
          }
        }
        if (reason.kind === 'completed' && settledAnswer === undefined && !concludedByTool && !admissionInvalidated) {
          reason = { kind: 'error', error: { code: 'STEP_LIMIT', message: 'native-headless: model step limit reached' } }
        }
      } catch (error: unknown) {
        reason = signal.aborted
          ? { kind: 'aborted', reason: cancellationCause(signal.reason) }
          : { kind: 'error', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } }
        throw error
      } finally {
        if (reason.kind === 'completed' || reason.kind === 'max-tokens' || reason.kind === 'error' && reason.error.code === 'STEP_LIMIT') {
          track(session.append('turn/end', { turn, reason }))
          await persist()
        } else {
          await owner.repair(reason)
        }
        await writer.flush()
        await activeOwner?.settled(reason)
      }
    } catch (error: unknown) {
      turnFailure = { error }
      throw error
    } finally {
      const failures: unknown[] = []
      try { releaseObservation?.() } catch (error: unknown) { failures.push(error) }
      try { await releaseExecution?.() } catch (error: unknown) { failures.push(error) }
      try {
        const current = this.continuationOwners.get(id)
        const rootEpoch = this.rootEpochs.get(id)
        if (rootObservation !== undefined && rootEpoch !== undefined) rootObservation.epoch = rootEpoch.activation
        try { turnOwnership?.release?.() } catch (error: unknown) { failures.push(error) }
        if (current !== undefined) this.currentTurns.delete(current)
        if (rootEpoch !== undefined) {
          if (!rootDriven && !rootEpoch.activation.isRetained && !rootEpoch.owner.hasPending) await rootEpoch.activation.done
        } else if (resident === undefined) {
          if (current !== undefined) {
            try { await this.releaseActiveOwner(current) } catch (error: unknown) { failures.push(error) }
          }
          if (current === undefined) await writer.close()
          else await current.close()
        }
      } catch (error: unknown) { failures.push(error) } finally {
        this.activeSessions.delete(id)
        if (resident === undefined && !this.rootEpochs.has(id)) this.continuationOwners.delete(id)
      }
      if (failures.length > 0) throw new AggregateError([
        ...turnFailure === undefined ? [] : [turnFailure.error], ...failures,
      ], 'native-headless: turn cleanup failed')
    }
    return { exitCode, ...settledAnswer === undefined ? {} : { answer: settledAnswer } }
  }

  /** Run the explicit root request and wait for its writer settlement. */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    const request = parseArgs(args)
    const id = request.resume ?? SessionId(randomUUID())
    const result = await this.executeRootTurn({ id, resume: request.resume !== undefined,
      ...request.prompt.length === 0 ? {} : {
        message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: request.prompt }] }),
      },
    }, signal)
    if (result.answer !== undefined) process.stdout.write(result.answer + '\n')
    return result.exitCode
  }

  /**
   * Execute a root input and wait for all capability-retained work in its epoch.
   * @param request - identified input and observers retained through durable root settlement.
   * @param signal - cancellation closes and drains the selected root epoch.
   * @returns the final root answer after writer release; ordinary turns retain their existing result.
   * @throws AggregateError preserving execution and owned cleanup failures when cleanup fails.
   */
  async executeRootTurn(request: NativeTurnRequest, signal: AbortSignal): Promise<NativeTurnResult> {
    const observation: { release?: () => void; epoch?: NativeContinuationActivation } = {}
    try {
      let result: NativeTurnResult
      try { result = await this.executeTurnAdmitted(request, signal, observation) }
      catch (error: unknown) {
        if (observation.epoch !== undefined) {
          try { await observation.epoch.close() }
          catch (cleanup: unknown) {
            throw new AggregateError([error, cleanup], 'native-headless: root execution and epoch cleanup failed')
          }
        }
        throw error
      }
      if (observation.epoch === undefined) return result
      await this.waitRootEpoch(request.id, signal, observation.epoch, true)
      return observation.epoch.lastResult ?? result
    } finally { observation.release?.() }
  }

  private executeTurnAdmitted(request: NativeTurnRequest, signal: AbortSignal,
    observation?: { release?: () => void; epoch?: NativeContinuationActivation }): Promise<NativeTurnResult> {
    if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
    signal.throwIfAborted()
    this.assertSessionNotRetiring(request.id)
    if (this.presetSelections.has(request.id)) throw new Error('native-headless: preset selection is in progress')
    return this.withRootExecution(request, signal, execution => execution.run(
      async (composed) => {
        this.settledRoots.delete(execution)
        const epoch = this.rootEpochs.get(request.id)
        if (epoch?.activation.isClosing) await epoch.activation.done
        const selected = this.rootEpochs.get(request.id)
        const retain = selected?.activation.retainChild()
        try {
          return await this.runTurn(request, request.id, execution.agent, composed, this.executionConfig(execution.agent),
            undefined, selected?.owner, 'root', false, undefined, observation)
        } finally { retain?.() }
      }, signal,
    ))
  }

  /**
   * Execute a human operation with the exact root Session owner before any model admission.
   * @param request - fresh or restored Session identity; no input or turn is synthesized.
   * @param operation - operation using the Program's sole writer and composed cancellation.
   * @param signal - caller cancellation before and during exclusive idle admission.
   * @returns the operation result after durable writes and idle Consumers settle; retained work may continue.
   */
  executeSessionOperation<T>(request: Pick<NativeTurnRequest, 'id' | 'resume' | 'preset' | 'route' | 'rootOrigin'>,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
    signal.throwIfAborted()
    this.assertSessionNotRetiring(request.id)
    if (this.presetSelections.has(request.id)) throw new Error('native-headless: preset selection is in progress')
    this.selectedRootRoute(request.id, request.route)
    const live = this.continuationOwners.get(request.id)
    const active = live === undefined ? undefined : this.activeOwners.get(live)?.owner
    if (active !== undefined) {
      if (!request.resume) throw new Error('native-headless: fresh Session identity is already active')
      if (request.rootOrigin !== undefined && active.rootOrigin !== request.rootOrigin) {
        throw new Error('native-headless: root origin differs from its attached owner')
      }
      return this.runLiveSessionOperation(active, operation, signal)
    }
    const freshAdmission = !request.resume && !this.executions.has(request.id)
    let selectedExecution: NativeAgentExecution | undefined
    let operationStarted = false
    const pending = this.withRootExecution(request, signal, (execution) => {
      if (freshAdmission) selectedExecution = execution
      return this.runIdleSessionOperation(execution, request, async (owner, effective) => {
        operationStarted = true
        return operation(owner, effective)
      }, signal)
    })
    if (!freshAdmission) return pending
    return pending.catch(async (error: unknown) => {
      if (operationStarted || selectedExecution === undefined) throw error
      const owned = this.executions.get(request.id)
      if (owned?.execution !== selectedExecution || owned.route.id !== request.route
        || !this.canReleaseFreshFailure(request.id, owned)) throw error
      this.retiringSessions.set(request.id, owned.route.id)
      try {
        await owned.unregister()
        if (owned.route.workspaceId === undefined) this.retiringSessions.delete(request.id)
      } catch (cleanup: unknown) {
        throw new AggregateError([error, cleanup], 'native-headless: fresh Session admission and cleanup failed')
      }
      throw error
    })
  }

  private canReleaseFreshFailure(id: SessionId, owned: {
    readonly execution: NativeAgentExecution
    readonly route: Readonly<NativeRootRoute>
  }): boolean {
    const resident = this.continuationOwners.get(id)
    return owned.execution.status === 'idle' && !this.activeSessions.has(id) && resident === undefined
      && !this.rootEpochs.has(id) && !this.rootAdmissions.has(id) && !this.routeAdmissions.has(id)
      && !this.presetSelections.has(id) && !this.storageMutations.has(id)
      && ![...this.rootOperations.values()].some(agent => agent === owned.execution.agent)
      && ![...this.currentTurns.keys()].some(owner => owner.session.id === id)
  }

  private runIdleSessionOperation<T>(execution: NativeAgentExecution,
    request: Pick<NativeTurnRequest, 'id' | 'resume' | 'preset' | 'route' | 'rootOrigin'>,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal,
    forkSeed?: NativeRootForkSeed): Promise<T> {
    this.assertSessionNotRetiring(request.id)
    return execution.runMaintenance(async (agentSignal) => {
      this.settledRoots.delete(execution)
      const composed = AbortSignal.any([agentSignal, signal])
      composed.throwIfAborted()
      const epoch = this.rootEpochs.get(request.id)
      if (epoch?.activation.isClosing) throw new Error('native-headless: root Session is closing')
      const retain = epoch?.activation.retainChild()
      let result: { value: T } | undefined
      try {
        await this.runTurn(request, request.id, execution.agent, composed, this.executionConfig(execution.agent),
          undefined, epoch?.owner, 'root', false, async (owner, effectiveSignal) => {
            effectiveSignal.throwIfAborted()
            result = { value: await operation(owner, effectiveSignal) }
          }, undefined, forkSeed)
        if (result === undefined) throw new Error('native-headless: Session operation did not run')
        return result.value
      } finally { retain?.() }
    })
  }

  private async forkRootSession(request: NativeRootForkRequest, signal: AbortSignal): Promise<SessionId> {
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    if (this.disposal !== undefined) throw new Error('native-headless: application is disposed')
    this.assertSessionNotRetiring(request.source)
    this.assertSessionNotRetiring(request.id)
    if (request.source === request.id || this.executions.has(request.id) || this.agents.get(NativeAgentId(request.id)) !== undefined) {
      throw new Error('native-headless: fork requires a fresh destination identity')
    }
    const sourceAgent = this.agents.get(NativeAgentId(request.source))
    if (sourceAgent !== undefined && this.executions.get(request.source)?.execution.agent !== sourceAgent) {
      throw new Error('native-headless: fork source belongs to another Program')
    }
    const resident = this.continuationOwners.get(request.source)
    let events: readonly SessionEvent[]
    let agentPreset: string | undefined
    if (resident !== undefined) {
      if (resident.session.header.cwd !== this.executionConfigFor(request.id, request.route).cwd) throw new Error('native-headless: fork source workspace differs from profile configuration')
      const active = this.activeOwners.get(resident)?.owner
      if (active === undefined || !active.writerAvailable) throw new Error('native-headless: fork source is closing')
      events = await active.readEvents()
      agentPreset = resident.session.header.agentPreset
    } else {
      await using reader = await this.storage.open(request.source, 'read', { signal: effective })
      if (reader.header.cwd !== this.executionConfigFor(request.id, request.route).cwd) throw new Error('native-headless: fork source workspace differs from profile configuration')
      events = (await reader.read(0, Number.MAX_SAFE_INTEGER, { signal: effective })).events
      agentPreset = reader.header.agentPreset
    }
    effective.throwIfAborted()
    const currentSourceAgent = this.agents.get(NativeAgentId(request.source))
    if (currentSourceAgent !== sourceAgent || currentSourceAgent !== undefined
      && this.executions.get(request.source)?.execution.agent !== currentSourceAgent) {
      throw new Error('native-headless: fork source ownership changed during observation')
    }
    const atSeq = request.atSeq
    if (atSeq !== undefined && !events.some(event => event.seq === atSeq)) {
      throw new Error('native-headless: fork source event does not exist')
    }
    const boundary = atSeq === undefined
      ? events.findLast(event => event.type === 'turn/end')
      : events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
    if (boundary === undefined) throw new Error('native-headless: fork source turn has not closed')
    let cut = boundary.seq + 1
    for (const event of events.slice(cut)) {
      if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced' && event.data.inserted.length !== 0) break
      cut += 1
    }
    const seed = { source: request.source, events: events.slice(0, cut), ...agentPreset === undefined ? {} : { agentPreset } }
    if (this.executions.has(request.id) || this.agents.get(NativeAgentId(request.id)) !== undefined) {
      throw new Error('native-headless: fork destination became active during source read')
    }
    let acquired: ReturnType<typeof this.executions.get>
    try {
      return await this.withRootExecution({ id: request.id, resume: false, route: request.route }, effective, (execution) => {
        acquired = this.executions.get(request.id)
        return this.runIdleSessionOperation(execution,
          { id: request.id, resume: false, route: request.route }, () => Promise.resolve(request.id), effective, seed)
      }, seed)
    } catch (error: unknown) {
      if (acquired === undefined) throw error
      try { await acquired.unregister() }
      catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'native-headless: fork registration cleanup failed') }
      finally { if (this.executions.get(request.id) === acquired) this.executions.delete(request.id) }
      throw error
    }
  }

  private rootSessionOperations(agent: NativeAgent, id: SessionId): NativeRootSessionOperations {
    const execution = this.agents.execution(agent)
    const lifetime = AbortSignal.any([execution.signal, this.context.signal, this.operationCancellation.signal])
    return { agent, sessionId: id, signal: lifetime,
      interruptTurn: (reason) => {
        lifetime.throwIfAborted()
        if (this.disposal !== undefined || this.executions.get(id)?.execution !== execution || this.agents.get(agent.id) !== agent) {
          throw new Error('native-headless: original root Agent is no longer live')
        }
        const epoch = this.rootEpochs.get(id)
        if (epoch === undefined || epoch.owner.session.id !== id) {
          throw new Error('native-headless: root turn interruption requires the retained Session owner')
        }
        return epoch.activation.interrupt(reason)
      },
      runIdle: <T>(operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> => {
        lifetime.throwIfAborted()
        signal.throwIfAborted()
        if (this.disposal !== undefined || this.executions.get(id)?.execution !== execution || this.agents.get(agent.id) !== agent) {
          throw new Error('native-headless: original root Agent is no longer live')
        }
        let owner: NativeContinuationSession | undefined
        const pending = this.runIdleSessionOperation(execution, { id, resume: true }, async (active, composed) => {
          owner = this.continuationOwners.get(id)
          return operation(active, composed)
        }, AbortSignal.any([lifetime, signal]))
        return pending.then((value) => {
          if (owner?.hasPending && !this.rootEpochs.has(id)) {
            lifetime.throwIfAborted()
            this.queueRootWake(id, execution)
          }
          return value
        })
      },
    }
  }

  private runLiveSessionOperation<T>(owner: NativeProgramActiveSession,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    return this.runAttachedSessionOperation(owner, operation, signal, 'root')
  }

  private runAttachedSessionOperation<T>(owner: NativeProgramActiveSession,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal,
    invocation: 'root' | 'delegated'): Promise<T> {
    if (owner.invocation !== invocation) throw new Error('native-headless: human operation invocation differs from its exact owner')
    const execution = this.agents.execution(owner.agent)
    if (execution.status === 'maintenance') throw new Error('native-headless: exclusive Session maintenance is active')
    const release = owner.retain()
    const controller = new AbortController()
    const composed = AbortSignal.any([signal, execution.signal, this.context.signal, this.operationCancellation.signal, controller.signal])
    const drained = Promise.withResolvers<void>()
    const detach = this.agents.onDispose(owner.agent, () => {
      controller.abort({ kind: 'disposed' })
      return drained.promise
    })
    const pending = this.agents.withInitiator(owner.agent, async () => {
      try {
        composed.throwIfAborted()
        const value = await operation(owner, composed)
        await owner.flush()
        if (execution.status === 'idle') await owner.settled({ kind: 'completed' })
        return value
      } finally {
        try { await owner.flush() } finally { detach(); release(); drained.resolve() }
      }
    })
    this.rootOperations.set(pending, owner.agent)
    void pending.then(() => { this.rootOperations.delete(pending) }, () => { this.rootOperations.delete(pending) })
    return pending
  }

  /**
   * Wait for the current retained root epoch to release its writer and owned work.
   * @param id - Session whose current Program epoch is observed.
   * @param signal - caller cancellation; it closes and drains this epoch before rejecting.
   * @returns its final turn result, or undefined when no retained epoch exists.
   * @throws AggregateError containing epoch cleanup failures and an already accepted cancellation cause.
   */
  async waitRootSettlement(id: SessionId, signal: AbortSignal): Promise<NativeTurnResult | undefined> {
    return this.waitRootEpoch(id, signal)
  }

  private async waitRootEpoch(id: SessionId, signal: AbortSignal,
    selected?: NativeContinuationActivation, foreground = false): Promise<NativeTurnResult | undefined> {
    const activation = selected ?? this.rootEpochs.get(id)?.activation
    if (activation === undefined) {
      signal.throwIfAborted()
      const execution = this.executions.get(id)?.execution
      return execution === undefined ? undefined : this.settledRoots.get(execution)
    }
    const onAbort = (): void => {
      // The awaited epoch.done reports every close failure; this callback cannot await the same transaction.
      void activation.close().catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) onAbort()
      try {
        if (foreground && !signal.aborted) {
          await activation.waitForeground()
          const stillCancelled = (): boolean => signal.aborted
          if (stillCancelled()) await activation.done
        } else await activation.done
      }
      catch (error: unknown) {
        throw new AggregateError([...signal.aborted ? [signal.reason as unknown] : [], error],
          'native-headless: root epoch cleanup failed')
      }
      signal.throwIfAborted()
      return activation.lastResult
    } finally { signal.removeEventListener('abort', onAbort) }
  }

  /**
   * Execute a fresh child through the shared Agent, model, tools and Session writer.
   * @param request - exact active parent, fresh child identity and resolved composition.
   * @param signal - parent operation cancellation propagated to the child.
   * @returns the child result after writer closure and Agent release.
   * @throws when the caller does not own the active parent, the workspace changes, or depth exceeds the cap.
   */
  async executeDelegatedTurn(request: NativeDelegatedTurnRequest, signal: AbortSignal): Promise<NativeTurnResult> {
    if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
    signal.throwIfAborted()
    const parent = this.executions.get(request.parent.id)?.execution.agent
    if (parent === undefined || this.agents.get(parent.id) !== parent
      || this.agents.currentInitiator() !== parent || this.activeSessions.get(request.parent.id) !== request.parent) {
      throw new Error('native-headless: delegation requires the exact active parent Session and initiating Agent')
    }
    if (this.executions.has(request.id) || this.agents.get(NativeAgentId(request.id)) !== undefined) {
      throw new Error('native-headless: delegated Session identity is already active')
    }
    if (request.config.cwd !== request.parent.header.cwd || request.config.cwd !== this.executionConfigFor(request.parent.id).cwd) {
      throw new Error('native-headless: delegated workspace differs from the parent configuration')
    }
    const delegationDepth = (request.parent.header.delegationDepth ?? 0) + 1
    if (!Number.isSafeInteger(delegationDepth)) throw new RangeError('native-headless: child delegation depth exceeds the safe-integer range')
    if (delegationDepth > request.maxDepth) throw new RangeError('native-headless: child delegation depth exceeds maxDepth')
    const config = { ...this.config, ...request.config }
    const scope = new NativeScope(parent.scope)
    const composition = new ResourceOwner()
    let operationFailure: { error: unknown } | undefined
    let releaseParent: (() => void) | undefined
    const releaseResidentParent = this.continuationRuntime.retainChild(parent)
    try {
      return await this.withExecution(request.id, (execution) => {
        releaseParent = this.agents.onDispose(parent, () => execution.dispose())
        return execution.run(async (composed) => {
          await request.prepare?.({ agent: execution.agent, own: dispose => composition.own(dispose) })
          composed.throwIfAborted()
          return this.runTurn({ ...request, resume: false }, request.id, execution.agent,
            composed, config, { parentSession: request.parent.id, delegationDepth }, undefined, 'delegated')
        }, signal)
      }, scope, parent)
    } catch (error: unknown) {
      operationFailure = { error }
      throw error
    } finally {
      releaseParent?.()
      const releases = await Promise.allSettled([Promise.resolve().then(() => composition.dispose())])
      const owned = this.executions.get(request.id)
      if (owned !== undefined) {
        try {
          releases.push(...await Promise.allSettled([Promise.resolve().then(() => owned.unregister())]))
        } finally { this.executions.delete(request.id) }
      }
      const failures = releases.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) {
        releaseResidentParent?.()
        if (operationFailure !== undefined) failures.unshift(operationFailure.error)
        if (failures.length === 1) throw failures[0]
        throw new AggregateError(failures, 'native-headless: delegated execution and cleanup failed')
      }
      releaseResidentParent?.()
    }
  }

  private async selectRootPreset(request: NativeAgentPresetSelectionRequest & { readonly route: NativeRootRouteId },
    signal: AbortSignal): Promise<NativeAgentPresetFacts> {
    const registry = this.agentPresets
    if (registry === undefined) throw new Error('native-headless: preset Registry is unavailable')
    if (this.presetSelections.has(request.id)) throw new Error('native-headless: preset selection is already in progress')
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    this.assertSessionNotRetiring(request.id)
    this.presetSelections.add(request.id)
    let lease: NativeAgentPresetLease | undefined
    const ownership = { successorOwnsLease: false }
    try {
      const route = this.selectedRootRoute(request.id, request.route)
      if (!this.rootEpochs.has(request.id)) {
        await using reader = await this.storage.open(request.id, 'read', { signal: effective })
        if (reader.header.cwd !== route.configuration.cwd) throw new Error('native-headless: restored workspace differs from profile configuration')
        const history = await reader.read(0, Number.MAX_SAFE_INTEGER, { signal: effective })
        effective.throwIfAborted()
        const facts = foldNativeAgentPresetFacts(reader.header, history.events)
        if (facts.locked) throw new Error('native-headless: started Session cannot select a preset')
        if (facts.revision !== request.expectedRevision) throw new Error('native-headless: preset selection revision conflict')
        registry.resolvePreset({ fresh: false, facts, preset: request.preset })
      }
      return await this.withRootExecution({ id: request.id, resume: true, route: request.route }, effective, async (execution) => {
        const owned = this.executions.get(request.id)
        if (owned?.execution !== execution) throw new Error('native-headless: original preset Agent is no longer live')
        const epoch = this.rootEpochs.get(request.id)
        if (execution.status !== 'idle' || epoch?.activation.isRetained || epoch?.owner.hasPending) {
          throw new Error('native-headless: preset selection requires an idle unretained blank Session')
        }
        let selected: NativeAgentPresetFacts | undefined
        await this.runIdleSessionOperation(execution, { id: request.id, resume: true }, async (owner, operationSignal) => {
          const facts = foldNativeAgentPresetFacts(owner.session.header, await owner.readEvents())
          if (facts.locked) throw new Error('native-headless: started Session cannot select a preset')
          if (facts.revision !== request.expectedRevision) throw new Error('native-headless: preset selection revision conflict')
          const target = registry.resolvePreset({ fresh: false, facts, preset: request.preset })
          if (target === null) throw new Error('native-headless: explicit preset resolved without a standing composition')
          lease = registry.acquire(target)
          operationSignal.throwIfAborted()
          lease.signal.throwIfAborted()
          if (facts.preset === target.id && owned.presetLease?.generation === target.generation) {
            selected = facts
            return
          }
          const event = owner.append('agent-preset/selected', { agentPreset: target.id })
          await owner.flush()
          selected = { preset: target.id, revision: event.seq, locked: false }
        }, effective)
        if (selected === undefined || lease === undefined) throw new Error('native-headless: preset selection was not accepted')
        if (owned.presetLease?.generation === lease.generation) return selected
        // Accepted selection remains durable even if old cleanup or successor activation fails.
        try { await owned.unregister() } finally {
          if (this.executions.get(request.id) === owned) this.executions.delete(request.id)
        }
        effective.throwIfAborted()
        lease.signal.throwIfAborted()
        await this.withExecution(request.id, () => Promise.resolve(), new NativeScope(lease.scope),
          undefined, lease, this.workspaceRoutes.resolve(request.route))
        ownership.successorOwnsLease = true
        return selected
      })
    } finally {
      this.presetSelections.delete(request.id)
      if (!ownership.successorOwnsLease) await lease?.release()
    }
  }

  private selectedRootRoute(id: SessionId, explicit?: NativeRootRouteId): Readonly<NativeRootRoute> {
    const existing = this.executions.get(id)?.route ?? this.routeAdmissions.get(id)
    if (existing !== undefined) {
      if (explicit !== undefined && explicit !== existing.id) throw new Error('native-headless: Session is bound to another root route')
      return existing
    }
    return this.workspaceRoutes.resolve(explicit === undefined ? resolveRootRoute(this.config).id : explicit)
  }

  private assertSessionNotRetiring(id: SessionId): void {
    if (this.retiringSessions.has(id)) throw new Error('native-headless: Session idle retirement is in progress')
  }

  private releaseIdleRoot(request: {
    readonly route: NativeRootRouteId
    readonly id: SessionId
    readonly expectedOwner: NativeActiveSessionOwner
  }, signal: AbortSignal): Promise<void> {
    const { expectedOwner } = request
    const binding = this.rootOwnerBindings.get(expectedOwner)
    if (binding !== undefined && binding.route.id !== request.route) {
      throw new Error('native-headless: idle retirement route does not match its former root owner')
    }
    if (binding === undefined || expectedOwner.invocation !== 'root' || expectedOwner.rootOperations === undefined
      || expectedOwner.session.id !== request.id || expectedOwner.agent.id !== NativeAgentId(request.id)
      || binding.agent !== expectedOwner.agent || binding.sessionId !== request.id
      || expectedOwner.rootOperations.agent !== expectedOwner.agent || expectedOwner.rootOperations.sessionId !== request.id) {
      throw new Error('native-headless: idle retirement requires this Program\'s former root owner')
    }
    const prior = this.idleRetirements.get(request.id)
    if (prior !== undefined && (prior.owner !== expectedOwner || prior.route.id !== request.route)) {
      throw new Error('native-headless: another root owner is retiring this Session')
    }
    if (binding.retirement !== undefined) return binding.retirement
    signal.throwIfAborted()
    if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')

    const route = this.workspaceRoutes.resolve(request.route)
    const owned = this.executions.get(request.id)
    if (route.workspaceId === undefined || binding.route !== route || owned === undefined || owned.route !== route
      || owned.execution.agent !== binding.agent || this.agents.get(binding.agent.id) !== binding.agent) {
      throw new Error('native-headless: idle retirement route or Agent identity changed')
    }
    const resident = this.continuationOwners.get(request.id)
    const active = resident === undefined ? undefined : this.activeOwners.get(resident)?.owner
    const rootOperation = [...this.rootOperations.values()].some(agent => agent === binding.agent)
    const busy: string[] = []
    if (owned.execution.status !== 'idle') busy.push(`Agent ${owned.execution.status}`)
    if (this.activeSessions.has(request.id)) busy.push('active Session')
    if (resident !== undefined) busy.push(resident.hasPending ? 'pending inbox' : 'resident Session owner')
    if (active !== undefined) busy.push('active Session owner')
    if (this.rootEpochs.has(request.id)) busy.push('root epoch')
    if (this.rootAdmissions.has(request.id) || this.routeAdmissions.has(request.id)) busy.push('root admission')
    if (this.presetSelections.has(request.id)) busy.push('preset selection')
    if (this.storageMutations.has(request.id)) busy.push('storage mutation')
    if (rootOperation) busy.push('root operation')
    if ([...this.currentTurns.keys()].some(owner => owner.session.id === request.id)) busy.push('current turn')
    if (busy.length > 0) throw new Error(`native-headless: idle retirement requires a settled Session (${busy.join(', ')})`)

    const completion = Promise.withResolvers<void>()
    binding.retirement = completion.promise
    this.idleRetirements.set(request.id, { owner: expectedOwner, route, promise: completion.promise })
    this.retiringSessions.set(request.id, route.id)
    void Promise.resolve().then(() => owned.unregister()).then(completion.resolve, completion.reject)
    return completion.promise
  }

  private mutateStoredSession<T>(id: SessionId, route: Readonly<NativeRootRoute>, signal: AbortSignal,
    operation: (effective: AbortSignal) => Promise<T>, allowIdleRetirement = false): Promise<T> {
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    if (allowIdleRetirement) {
      const retirement = this.idleRetirements.get(id)
      if (this.retiringSessions.has(id) && retirement?.route !== route) {
        throw new Error('native-headless: Session deletion does not match its accepted idle retirement')
      }
    } else this.assertSessionNotRetiring(id)
    if (this.disposal !== undefined) throw new Error('native-headless: application is disposed')
    if (this.workspaceRoutes.resolve(route.id) !== route) throw new Error('native-headless: Session mutation route changed during admission')
    const owned = this.executions.get(id)
    const registered = this.agents.get(NativeAgentId(id))
    if (this.storageMutations.has(id) || this.rootAdmissions.has(id) || this.presetSelections.has(id)
      || this.continuationOwners.has(id) || this.rootEpochs.has(id)
      || registered !== undefined && owned?.execution.agent !== registered
      || owned !== undefined && (owned.execution.status !== 'idle' || owned.route.id !== route.id
        || [...this.executions.values()].some(child => child !== owned && child.interactionRoot === owned.execution.agent)
        || [...this.rootOperations.values()].includes(owned.execution.agent))) {
      throw new Error('native-headless: Session storage mutation requires an inactive identity')
    }
    const done = Promise.resolve().then(async () => {
      if (owned !== undefined) {
        try { await owned.unregister() } catch (error: unknown) {
          this.storageCleanupFailures.push(error)
          throw error
        }
      }
      effective.throwIfAborted()
      return operation(effective)
    })
    const admission = { route, done }
    this.storageMutations.set(id, admission)
    const release = (): void => { if (this.storageMutations.get(id) === admission) this.storageMutations.delete(id) }
    void done.then(release, release)
    return done
  }

  private trackStorageRequest<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposal !== undefined || this.context.signal.aborted) throw new Error('native-headless: application is disposed')
    const pending = operation()
    this.storageRequests.add(pending)
    const release = (): void => { this.storageRequests.delete(pending) }
    void pending.then(release, release)
    return pending
  }

  private deleteStoredSession(request: { readonly route: NativeRootRouteId; readonly id: SessionId },
    signal: AbortSignal): Promise<SessionDeletionReceipt> {
    const route = this.rootExecution.resolve(request.route)
    const deletion = this.storage.deletions
    if (deletion === undefined) throw new Error('native-headless: Session deletion is unavailable')
    return this.mutateStoredSession(request.id, route, signal, async (effective) => {
      const stored = await this.storage.stat(request.id, { signal: effective })
      if (stored === undefined) throw new SessionPersistenceNotFoundError(request.id)
      if (stored.header.cwd !== route.configuration.cwd) throw new Error('native-headless: Session deletion workspace differs from selected route')
      return deletion.delete(request.id, { signal: effective, expectedRevision: stored.revision })
    }, true)
  }

  private async restoreStoredSession(request: { readonly route: NativeRootRouteId; readonly id: SessionDeletionId },
    signal: AbortSignal): Promise<SessionId> {
    const route = this.rootExecution.resolve(request.route)
    const deletion = this.storage.deletions
    if (deletion === undefined) throw new Error('native-headless: Session deletion is unavailable')
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    const header = await deletion.inspect(request.id, { signal: effective })
    if (header.cwd !== route.configuration.cwd) throw new Error('native-headless: Session restoration workspace differs from selected route')
    return this.mutateStoredSession(header.id, route, effective, current =>
      deletion.restore(request.id, { signal: current, expectedCwd: route.configuration.cwd }))
  }

  private async listStoredDeletions(request: { readonly route: NativeRootRouteId; readonly limit: number },
    signal: AbortSignal): Promise<readonly SessionDeletionReceipt[]> {
    const route = this.rootExecution.resolve(request.route)
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) throw new RangeError('native-headless: deletion receipt limit must be positive')
    const deletion = this.storage.deletions
    if (deletion === undefined) throw new Error('native-headless: Session deletion is unavailable')
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    const matching: SessionDeletionReceipt[] = []
    for (const receipt of await deletion.list({ signal: effective })) {
      const header = await deletion.inspect(receipt.id, { signal: effective })
      if (header.cwd !== route.configuration.cwd) continue
      if (matching.length === request.limit) throw new RangeError('native-headless: deletion receipt limit exceeded')
      matching.push({ id: receipt.id, sessionId: receipt.sessionId })
    }
    return matching
  }

  private executionConfigFor(id: SessionId, route?: NativeRootRouteId): Readonly<Config> {
    return { ...this.config, ...this.selectedRootRoute(id, route).configuration }
  }

  private executionConfig(agent: NativeAgent): Readonly<Config> {
    const owned = this.executions.get(SessionId(agent.id))
    if (owned?.execution.agent !== agent) throw new Error('native-headless: Agent configuration requires exact Program ownership')
    return { ...this.config, ...owned.route.configuration }
  }

  private withRootExecution<T>(request: Pick<NativeTurnRequest, 'id' | 'resume' | 'preset' | 'route'>, signal: AbortSignal,
    task: (execution: NativeAgentExecution) => Promise<T>, forkSeed?: NativeRootForkSeed): Promise<T> {
    this.assertSessionNotRetiring(request.id)
    if (this.storageMutations.has(request.id)) throw new Error('native-headless: Session storage mutation is in progress')
    if (request.preset !== undefined) {
      if (request.resume || forkSeed !== undefined) throw new Error('native-headless: explicit preset is fresh-only')
      if (this.agentPresets === undefined) throw new Error('native-headless: explicit preset requires the preset Registry')
      if (this.executions.has(request.id) || this.rootAdmissions.has(request.id)) throw new Error('native-headless: fresh preset identity is already admitted')
    }
    const selectedRoute = this.selectedRootRoute(request.id, request.route)
    if (this.executions.has(request.id)) {
      return this.withExecution(request.id, task, undefined, undefined, undefined, selectedRoute)
    }
    let admission = this.rootAdmissions.get(request.id)
    if (admission === undefined) {
      this.routeAdmissions.set(request.id, selectedRoute)
      admission = this.agentPresets === undefined
        ? this.admitRootRoute(request, selectedRoute, signal)
        : this.admitRootPreset(request, signal, forkSeed)
      this.rootAdmissions.set(request.id, admission)
      const selected = admission
      void selected.then(() => {
        if (this.rootAdmissions.get(request.id) === selected) {
          this.rootAdmissions.delete(request.id)
          this.routeAdmissions.delete(request.id)
        }
      }, () => {
        if (this.rootAdmissions.get(request.id) === selected) {
          this.rootAdmissions.delete(request.id)
          this.routeAdmissions.delete(request.id)
        }
      })
    }
    return admission.then(() => {
      signal.throwIfAborted()
      this.context.signal.throwIfAborted()
      const owned = this.executions.get(request.id)
      if (owned === undefined) throw new Error('native-headless: root Agent admission was cancelled')
      owned.presetLease?.signal.throwIfAborted()
      return task(owned.execution)
    })
  }

  private async admitRootRoute(request: Pick<NativeTurnRequest, 'id' | 'resume'>,
    route: Readonly<NativeRootRoute>, signal: AbortSignal): Promise<void> {
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    const stored = await this.storage.stat(request.id, { signal: effective })
    effective.throwIfAborted()
    if (request.resume) {
      if (stored === undefined) throw new Error('native-headless: restored Session does not exist')
      if (stored.header.cwd !== route.configuration.cwd) throw new Error('native-headless: restored workspace differs from profile configuration')
    } else if (stored !== undefined) {
      throw new Error('native-headless: fresh Session identity already exists')
    }
    await this.withExecution(request.id, () => Promise.resolve(), undefined, undefined, undefined, route)
  }

  private async admitRootPreset(request: Pick<NativeTurnRequest, 'id' | 'resume' | 'preset' | 'route'>, signal: AbortSignal,
    forkSeed?: NativeRootForkSeed): Promise<void> {
    const registry = this.agentPresets
    if (registry === undefined) throw new Error('native-headless: preset Registry is unavailable')
    const effective = AbortSignal.any([signal, this.context.signal, this.operationCancellation.signal])
    effective.throwIfAborted()
    let facts = foldNativeAgentPresetFacts(forkSeed ?? {}, forkSeed?.events ?? [])
    if (request.resume) {
      await using reader = await this.storage.open(request.id, 'read', { signal: effective })
      if (reader.header.cwd !== this.executionConfigFor(request.id, request.route).cwd) throw new Error('native-headless: restored workspace differs from profile configuration')
      const stored = await reader.read(0, Number.MAX_SAFE_INTEGER, { signal: effective })
      facts = foldNativeAgentPresetFacts(reader.header, stored.events)
    } else if (await this.storage.stat(request.id, { signal: effective }) !== undefined) {
      throw new Error('native-headless: fresh Session identity already exists')
    }
    effective.throwIfAborted()
    const preset = registry.resolvePreset({ fresh: !request.resume && forkSeed === undefined, facts,
      ...request.preset === undefined ? {} : { preset: request.preset } })
    const lease = preset === null ? undefined : registry.acquire(preset)
    try {
      lease?.signal.throwIfAborted()
      effective.throwIfAborted()
      await this.withExecution(request.id, () => Promise.resolve(),
        new NativeScope(lease?.scope ?? this.executionScope), undefined, lease, this.selectedRootRoute(request.id, request.route))
    } catch (error: unknown) {
      await lease?.release()
      throw error
    }
  }

  private withExecution<T>(
    id: ReturnType<typeof SessionId>, task: (execution: NativeAgentExecution) => Promise<T>,
    scope?: NativeScope, parent?: NativeAgent, presetLease?: NativeAgentPresetLease, route?: Readonly<NativeRootRoute>,
  ): Promise<T> {
    this.assertSessionNotRetiring(id)
    if (this.storageMutations.has(id)) throw new Error('native-headless: Session storage mutation is in progress')
    let owned = this.executions.get(id)
    if (owned === undefined) {
      const parentLease = parent === undefined ? undefined : this.executions.get(SessionId(parent.id))?.presetLease
      const lease = presetLease ?? (parentLease === undefined ? undefined
        : this.agentPresets?.acquire(parentLease))
      let unregister: (() => Promise<void>) | undefined
      try {
        lease?.signal.throwIfAborted()
        const agent: NativeAgent = { id: NativeAgentId(id), scope: scope ?? new NativeScope(this.executionScope) }
        const registered = this.agents.register(agent)
        unregister = registered
        lease?.signal.throwIfAborted()
        const parentExecution = parent === undefined ? undefined : this.executions.get(SessionId(parent.id))
        if (parent !== undefined && (parentExecution?.execution.agent !== parent || this.agents.get(parent.id) !== parent)) {
          throw new Error('native-headless: interaction parent is not owned by this Program')
        }
        const execution = this.agents.execution(agent)
        let cleanup: Promise<void> | undefined
        let abort: (() => void) | undefined
        const release = (): Promise<void> => cleanup ??= (async () => {
          const resident = this.continuationOwners.get(id)
          const active = resident === undefined ? undefined : this.activeOwners.get(resident)
          const drained = await Promise.allSettled([execution.dispose(),
            this.rootEpochs.get(id)?.activation.close() ?? Promise.resolve()])
          const failures = drained.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
          const resources = await Promise.allSettled([resident?.close(), active?.release(), active?.owner.dispose()])
          failures.push(...resources.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
          try { await registered() } catch (error: unknown) { failures.push(error) }
          if (abort !== undefined) lease?.signal.removeEventListener('abort', abort)
          const failure = failures.length === 0 ? undefined : new AggregateError(failures, 'native-headless: preset Agent cleanup failed')
          await lease?.release(failure)
          if (failure !== undefined) throw failure
          if (this.executions.get(id)?.execution === execution) this.executions.delete(id)
        })()
        owned = { execution, unregister: release, route: route ?? parentExecution?.route ?? resolveRootRoute(this.config),
          interactionRoot: parentExecution?.interactionRoot ?? agent,
          ...lease === undefined ? {} : { presetLease: lease } }
        if (lease !== undefined) {
          abort = () => {
            const pending = release()
            this.presetCleanups.add(pending)
            void pending.then(() => { this.presetCleanups.delete(pending) }, (error: unknown) => {
              this.presetCleanups.delete(pending)
              this.presetCleanupFailures.push(error)
            })
          }
          lease.signal.addEventListener('abort', abort, { once: true })
        }
      } catch (error: unknown) {
        return (async () => {
          const failures: unknown[] = [error]
          try { await unregister?.() } catch (cleanup: unknown) { failures.push(cleanup) }
          const cleanupFailure = failures.length === 1 ? undefined
            : new AggregateError(failures.slice(1), 'native-headless: Agent registration cleanup failed')
          try { await lease?.release(cleanupFailure) } catch (cleanup: unknown) { failures.push(cleanup) }
          if (failures.length > 1) throw new AggregateError(failures, 'native-headless: Agent registration cleanup failed')
          throw error
        })()
      }
      this.executions.set(id, owned)
    }
    return task(owned.execution)
  }

  private async deliverContinuationInput(sender: NativeAgent, session: Session, id: SessionId,
    message: UserMessage, target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId> {
    signal.throwIfAborted()
    if (this.agents.get(sender.id) !== sender || sender.id !== NativeAgentId(session.id)) {
      throw new Error('native-headless: continuation sender is not the exact live Agent')
    }
    const recipient = this.executions.get(id)?.execution
    if (recipient === undefined || recipient.status === 'closing' || recipient.status === 'disposed') {
      throw new Error('native-headless: continuation recipient is not live')
    }
    if (id !== session.id && session.header.parentSession !== id) {
      const reader = await this.storage.open(id, 'read', { signal })
      try {
        if (reader.header.parentSession !== session.id || reader.header.origin !== 'subagent') {
          throw new Error('native-headless: continuation recipient is not adjacent')
        }
      } finally { await reader.close() }
    }
    const live = this.continuationOwners.get(id)
    let accepted: MessageId
    const rootEpoch = this.rootEpochs.get(id)
    if (rootEpoch !== undefined) {
      return wake ? rootEpoch.activation.enqueue(message, target, signal) : rootEpoch.owner.enqueue(message, target, signal)
    }
    if (live !== undefined && !live.isClosing) {
      accepted = await live.enqueue(message, target, signal)
    } else {
      const admit = async (agentSignal: AbortSignal): Promise<MessageId> => {
        const owner = await NativeContinuationSession.restore(this.storage, id, AbortSignal.any([signal, agentSignal]))
        try { return await owner.enqueue(message, target, signal) } finally { await owner.close() }
      }
      accepted = await (recipient.status === 'idle' ? recipient.runMaintenance(admit)
        : this.admitContinuationWhileBusy(recipient, id, message, target, signal, admit))
    }
    if (wake) this.queueRootWake(id, recipient)
    return accepted
  }

  private async admitContinuationWhileBusy(recipient: NativeAgentExecution, id: SessionId, message: UserMessage,
    target: InboxTarget, signal: AbortSignal, admit: (signal: AbortSignal) => Promise<MessageId>): Promise<MessageId> {
    const registry = this.activeSessionRegistry
    if (registry === undefined) return recipient.run(admit, signal)
    const effective = AbortSignal.any([signal, recipient.signal, this.context.signal])
    const queuedCancellation = new AbortController()
    const selectedLiveOwner = new Error('native-headless: continuation admitted by the active owner')
    const accepted = Promise.withResolvers<MessageId>()
    let claimed = false
    const attached = (owner: NativeActiveSessionOwner): Promise<void> => {
      if (claimed || owner.agent !== recipient.agent || owner.session.id !== id || !owner.writerAvailable
        || this.executions.get(id)?.execution !== recipient || this.agents.get(recipient.agent.id) !== recipient.agent) {
        return Promise.resolve()
      }
      claimed = true
      queuedCancellation.abort(selectedLiveOwner)
      // The attachment callback does not wait for an operation queued behind this same turn.
      void owner.enqueue(message, target, false, effective).then(accepted.resolve, accepted.reject)
      return Promise.resolve()
    }
    const release = registry.onAttached(attached)
    const queued = recipient.run(async (composed) => {
      if (claimed) return accepted.promise
      claimed = true
      return admit(composed)
    }, AbortSignal.any([effective, queuedCancellation.signal]))
    void queued.then(accepted.resolve, (error: unknown) => {
      if (error !== selectedLiveOwner) accepted.reject(error)
    })
    for (const owner of registry.owners()) void attached(owner)
    try { return await accepted.promise }
    finally {
      await release()
      try { await queued } catch (error: unknown) {
        // The live owner cancels only the still-queued alternative, before its body can acquire a writer.
        if (error !== selectedLiveOwner) throw error
      }
    }
  }

  private queueRootWake(id: SessionId, recipient: NativeAgentExecution): void {
    const operation = recipient.run(async (agentSignal) => {
      const owner = await NativeContinuationSession.restore(this.storage, id, agentSignal)
      try {
        if (!owner.hasPending) return { exitCode: 0 }
        return await this.runTurn({ id, resume: true }, id, recipient.agent, agentSignal, this.executionConfig(recipient.agent), undefined, owner, 'root')
      } finally {
        if (!this.rootEpochs.has(id)) {
          try { await this.releaseActiveOwner(owner) } finally {
            await owner.close()
            if (this.continuationOwners.get(id) === owner) this.continuationOwners.delete(id)
          }
        }
      }
    })
    this.noticeWakes.add(operation)
    void operation.then(() => { this.noticeWakes.delete(operation) }, (error: unknown) => {
      this.noticeWakes.delete(operation)
      this.noticeFailures.push(error)
    })
  }

  private async admitRootOrigin(owner: NativeContinuationSession, requested: 'scheduled' | undefined,
    invocation: 'root' | 'delegated', activeOwner: NativeActiveSessionOwner | undefined): Promise<'scheduled' | undefined> {
    if (requested !== undefined && invocation !== 'root') {
      throw new Error('native-headless: scheduled origin requires the selected root executor')
    }
    const scheduled = requested === 'scheduled' || owner.scheduledRoot
    if (activeOwner !== undefined && activeOwner.rootOrigin !== (scheduled ? 'scheduled' : undefined)) {
      throw new Error('native-headless: root origin differs from its attached owner')
    }
    if (!scheduled) return undefined
    if (!owner.scheduledRoot) await owner.markScheduledRoot()
    return 'scheduled'
  }

  private async ensureActiveOwner(owner: NativeContinuationSession, agent: NativeAgent,
    invocation: 'root' | 'delegated', config: Config,
    rootOrigin: 'scheduled' | undefined): Promise<NativeProgramActiveSession | undefined> {
    if (this.activeSessionRegistry === undefined) return undefined
    const existing = this.activeOwners.get(owner)
    if (existing !== undefined) {
      if (existing.cleanup !== undefined) throw new Error('native-headless: active Session owner is releasing')
      if (existing.owner.rootOrigin !== rootOrigin) {
        throw new Error('native-headless: root origin differs from its attached owner')
      }
      return existing.owner
    }
    const rootExecution = invocation === 'root' ? this.executions.get(owner.session.id) : undefined
    if (invocation === 'root' && (rootExecution?.execution.agent !== agent
      || this.agents.get(agent.id) !== agent)) {
      throw new Error('native-headless: root owner provenance requires the exact registered Agent')
    }
    const active = new NativeProgramActiveSession(agent, owner, invocation, rootOrigin, {
      signal: AbortSignal.any([this.agents.execution(agent).signal, this.context.signal, this.operationCancellation.signal]),
      retain: () => {
        const childRetention = this.continuationRuntime.retainChild(agent)
        if (childRetention !== undefined) return childRetention
        if (invocation !== 'root') throw new Error('native-headless: one-shot delegation cannot retain residency')
        return this.retainRoot(owner, agent, config)
      },
      retainBackground: () => {
        if (invocation !== 'root') throw new Error('native-headless: background retention requires a root owner')
        return this.retainRootBackground(owner, agent, config)
      },
      ...invocation === 'root' ? { rootOperations: this.rootSessionOperations(agent, owner.session.id) } : {},
      enqueue: (message, target, wake, signal) =>
        this.continuationRuntime.forParent(agent, owner.session).deliver(owner.session.id, message, target, wake, signal),
    })
    try {
      const release = await this.activeSessionRegistry.register(active)
      this.activeOwners.set(owner, { owner: active, release })
      if (invocation === 'root') {
        const route = rootExecution?.route
        if (route === undefined) throw new Error('native-headless: root owner route was not admitted')
        this.rootOwnerBindings.set(active, { agent, sessionId: owner.session.id, route })
      }
      return active
    } catch (error: unknown) {
      await active.dispose()
      throw error
    }
  }

  private releaseActiveOwner(owner: NativeContinuationSession): Promise<void> {
    const entry = this.activeOwners.get(owner)
    if (entry === undefined) return Promise.resolve()
    if (entry.cleanup !== undefined) return entry.cleanup
    const completed = Promise.withResolvers<void>()
    entry.cleanup = completed.promise
    void (async () => {
      const failures: unknown[] = []
      try { await entry.release() } catch (error: unknown) { failures.push(error) }
      try { await entry.owner.dispose() } catch (error: unknown) { failures.push(error) }
      if (this.activeOwners.get(owner) === entry) this.activeOwners.delete(owner)
      if (failures.length !== 0) throw new AggregateError(failures, 'native-headless: active owner cleanup failed')
    })().then(completed.resolve, completed.reject)
    return completed.promise
  }

  /**
   * Cancel and drain all owned Agent operations before releasing their identities.
   * @returns the same complete application disposal promise on repeated calls.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    const completion = Promise.withResolvers<void>()
    this.disposal = completion.promise
    void this.disposeInternal().then(completion.resolve, completion.reject)
    return completion.promise
  }

  /**
   * Execute one preidentified user turn without writing process output.
   * @param request - Session identity, creation or resume choice, and optional identified user message.
   * @param signal - cancellation for storage, model, and tool work.
   * @returns a settled result after the turn is durable; an explicitly retained root keeps its writer for later turns.
   */
  async executeTurn(request: NativeTurnRequest, signal: AbortSignal): Promise<NativeTurnResult> {
    return this.executeTurnAdmitted(request, signal)
  }

  /**
   * Resolve the exact live recipient without granting execution or Session write access.
   * @param agent - exact registered Agent requesting a Program interaction.
   * @returns owned recipient and its live display root, or undefined after release or for another Program.
   */
  interactionOwner(agent: NativeAgent): NativeProgramInteractionOwner | undefined {
    if (this.disposal !== undefined || this.context.signal.aborted || this.agents.get(agent.id) !== agent) return undefined
    const owned = this.executions.get(SessionId(agent.id))
    if (owned?.execution.agent !== agent || owned.execution.status === 'closing' || owned.execution.status === 'disposed') return undefined
    const root = owned.interactionRoot
    const rootExecution = this.executions.get(SessionId(root.id))
    if (rootExecution?.execution.agent !== root || this.agents.get(root.id) !== root
      || rootExecution.execution.status === 'closing' || rootExecution.execution.status === 'disposed') return undefined
    const continuation = this.continuationOwners.get(SessionId(agent.id))
    if (continuation === undefined || continuation.isClosing) return undefined
    return { agent, session: continuation.session, displayRootAgent: root, displayRootSessionId: SessionId(root.id) }
  }

  private retainRoot(owner: NativeContinuationSession, agent: NativeAgent, config: Config): () => void {
    return this.ensureRootEpoch(owner, agent, config).activation.retainChild()
  }

  private retainRootBackground(owner: NativeContinuationSession, agent: NativeAgent, config: Config): () => void {
    return this.ensureRootEpoch(owner, agent, config).activation.retainBackground()
  }

  private ensureRootEpoch(owner: NativeContinuationSession, agent: NativeAgent, config: Config): {
    owner: NativeContinuationSession
    activation: NativeContinuationActivation
  } {
    const id = owner.session.id
    let epoch = this.rootEpochs.get(id)
    if (epoch === undefined) {
      const execution = this.agents.execution(agent)
      const activation = new NativeContinuationActivation(owner, execution, {
        run: (owned, _initial, signal) => this.runTurn({ id, resume: true }, id, agent, signal, config,
          undefined, owned, 'root', true),
        closing: () => this.releaseActiveOwner(owner),
        release: () => {
          if (activation.lastResult !== undefined) this.settledRoots.set(execution, activation.lastResult)
          releaseAgent()
          this.rootEpochs.delete(id)
          if (this.continuationOwners.get(id) === owner) this.continuationOwners.delete(id)
          return Promise.resolve()
        },
        settled: () => Promise.resolve(),
      }, false)
      const releaseAgent = this.agents.onDispose(agent, async () => {
        await Promise.allSettled([...this.rootOperations].filter(([, owner]) => owner === agent).map(([operation]) => operation))
        await activation.close()
      })
      epoch = { owner, activation }
      this.rootEpochs.set(id, epoch)
      const turn = this.currentTurns.get(owner)
      if (turn !== undefined) turn.release = activation.retainChild()
    }
    if (epoch.owner !== owner) throw new Error('native-headless: root retention requires the exact resident writer')
    return epoch
  }

  private async disposeInternal(): Promise<void> {
    this.operationCancellation.abort({ kind: 'disposed' })
    await this.workspaceRoutes.close()
    await Promise.allSettled([...this.rootOperations.keys(), ...this.rootForks, ...this.rootAdmissions.values(), ...this.storageRequests,
      ...[...this.storageMutations.values()].map(mutation => mutation.done)])
    const continuationResults = await Promise.allSettled([this.continuationRuntime.dispose()])
    const owned = [...this.executions.values()]
    const executionResults = await Promise.allSettled([...owned.map(({ execution }) => execution.dispose()),
      ...[...this.rootEpochs.values()].map(epoch => epoch.activation.close())])
    const results = await Promise.allSettled(owned.map(({ unregister }) => unregister()))
    this.executions.clear()
    await Promise.allSettled([...this.noticeWakes, ...this.presetCleanups])
    const errors = [...continuationResults, ...executionResults, ...results].flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    errors.push(...this.noticeFailures, ...this.presetCleanupFailures, ...this.storageCleanupFailures)
    if (errors.length > 0) throw new AggregateError(errors, 'native-headless: Agent cleanup failed')
  }
}

/**
 * Assemble the Session executor from the installation's declared services.
 * @param context - Host installation that owns these capabilities.
 * @param config - validated Program configuration.
 * @param executionScope - selected descendant scope for Agent contributions.
 * @param authority - explicit service selection. When supplied, its active and execution values are used as-is;
 * an omitted execution value does not fall back to context. Without this object, both optional services are read
 * from context.
 * @returns the executor registered for disposal with the installation.
 * @throws if `executionScope` does not belong to the installation tree.
 */
export function createNativeHeadlessApplication(context: NativeContext, config: Config,
  executionScope: NativeScope = context.scope,
  authority?: { readonly execution?: NativeSessionExecutionOperations; readonly active: NativeActiveSessionOperations },
): NativeHeadlessApplication {
  if (!context.scope.contains(executionScope)) throw new Error('native-headless: execution scope belongs to another installation tree')
  const application = new NativeHeadlessApplication(
    context, context.require('fs'), context.require('sessionPersistence'), context.require('modelExecution'), resolveNativeHeadlessConfig(config), context.require('agents'),
    context.optional('tools'), context.optional('promptSections'), context.optional('sandboxPolicy'), context.optional('approval'),
    context.optional('codeRuntime'), context.optional('timeContext'),
    authority === undefined ? context.optional('sessionExecution') : authority.execution,
    authority === undefined ? context.optional('activeSessions') : authority.active, context.optional('modelSelection'),
    context.optional('agentPresets'), context.optional('workspaceRegistry'), executionScope, context.optional('agentInstructions'),
  )
  context.own(() => application.dispose())
  return application
}

/** Native application entry loaded only after profile manifests are checked. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-headless', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'modelExecution', 'agents'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'sessionExecution', 'activeSessions', 'modelSelection', 'agentPresets', 'workspaceRegistry', 'agentInstructions'],
  provides: ['application', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeHeadlessConfig(input)
    return (context) => {
      const application = createNativeHeadlessApplication(context, config)
      context.provide('application', application)
      context.provide('rootExecution', application.rootExecution)
    }
  },
}
