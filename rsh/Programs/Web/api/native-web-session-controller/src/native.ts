/** Authenticated browser Session operations using the selected native execution authority. */
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { open, opendir, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { posix, relative, sep, win32 } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { NativeSessionFeed } from './follow.ts'
import type { NativePendingSubmission, NativeSubmissionAcknowledgement, NativeSubmissionEditResult, NativeSubmissionPromotionResult,
  NativeSubmissionsSnapshot, NativeSubmissionRequestId } from '@deepseek-ai/dsh-client-native-session/follow-types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin, NativePluginInventory } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import { foldNativeInboxEvent } from '@deepseek-ai/dsh-native-agent/inbox'
import type { NativeInboxState } from '@deepseek-ai/dsh-native-agent/inbox'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type {} from '@deepseek-ai/dsh-llm-pi-ai/native'
import type {} from '@deepseek-ai/dsh-authorization/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title/native'
import type { NativeSessionTitles } from '@deepseek-ai/dsh-session-title/native'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig, type Config as TurnConfig,
  type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { NativeConnectionRequestOwner, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'
import type { WorkspaceRegistryRuntime } from '@deepseek-ai/dsh-workspace/native'
import type {} from '@deepseek-ai/dsh-workspace/native'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import { NativeAgentPresetError } from '@deepseek-ai/dsh-agent-presets/native'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { NativePermissionPresetOperations } from '@deepseek-ai/dsh-permission-presets/native-definition'
import type { NativePlanMode } from '@deepseek-ai/dsh-plan-mode/native'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution/root-route'
import type { NativeAgent, NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import { createUserMessage, freezeMessage, MessageId } from '@deepseek-ai/dsh-llm/native'
import type { TextBlock } from '@deepseek-ai/dsh-llm/native'
import { isImageAdmissionError, type AttachmentOperations } from '@deepseek-ai/dsh-attachment/native'
import { deriveEventMessage, foldSurface, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { FileSystemOperations, FsObservation, FsPathInfo, FsTarget } from '@deepseek-ai/dsh-fs/native'
import { FsVersion } from '@deepseek-ai/dsh-fs/types'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from '@deepseek-ai/dsh-api-workspace-files/native-types'
import { cutWorkspaceFilePage } from '@deepseek-ai/dsh-api-workspace-files/native-helpers'

import { NativeWebHumanInteraction } from './human.ts'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import type { NativeUserQuestionRegistry } from '@deepseek-ai/dsh-user-questions/native'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeWebHumanId } from '@deepseek-ai/dsh-client-native-session/human'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialInfo, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-credentials/native'
import { canOpenNativePath, openNativePath, openNativeTextFile } from '@deepseek-ai/dsh-native-command'
import { NativeSettingsConflictError } from '@deepseek-ai/dsh-settings/native'
import type { NativeSettingsPathOp, NativeSettingsScope, NativeSettingsSection, NativeSettingsService } from '@deepseek-ai/dsh-settings-definition/native'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import type { NativeSessionFeedbackOperations } from '@deepseek-ai/dsh-command-feedback/native-definition'
import type { FeedbackRecord } from '@deepseek-ai/dsh-command-feedback/types'
import { FEEDBACK_CATEGORIES } from '@deepseek-ai/dsh-command-feedback/types'
import type { NativeMessageFeedbackOperations } from '@deepseek-ai/dsh-message-feedback/native-definition'
import type { MessageFeedbackDeleteRequest, MessageFeedbackListRequest, MessageFeedbackPutRequest } from '@deepseek-ai/dsh-message-feedback/types'
import type {} from '@deepseek-ai/dsh-command-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-message-feedback/native-definition'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import { NativeWebAccounts, NativeWebAuthorization } from './authorization.ts'
import { NativeWebModels } from './models.ts'
import { NativeWebSettingsEvents } from './settings-events.ts'
import { NativeSessionListFeed } from './session-list-follow.ts'
import type { NativeSessionListItem, NativeSessionSearchItem, NativeSessionSearchPage } from '@deepseek-ai/dsh-client-native-session/list-types'
import { NativeWebWorkspaceService } from './workspaces.ts'
import { NativeWebDirectoryService } from './directories.ts'

type NativeSessionAdmissionId = Branded<'native-web-admission'>
const CODEX_ACCOUNT_KEY = parseCredentialKey('llm-pi-ai/openai-codex')
const DEEPSEEK_ACCOUNT_KEY = parseCredentialKey('deepseek-account/default')

interface NativeAgentPresetListRow {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly source: 'profile' | 'system' | 'user'
  readonly status: 'ready' | 'needs-migration' | 'invalid'
  readonly problem?: string
}

const nativeAgentPresetEmpty = z.strictObject({})
const nativeAgentPresetId = z.strictObject({ id: z.string() })
const nativeAgentPresetCopy = z.strictObject({ from: z.string(), id: z.string(), name: z.string().optional() })
const nativeWorkspaceFileList = z.strictObject({ sessionId: z.string().min(1).max(256), path: z.string() })
const nativeWorkspaceFilePath = z.strictObject({ sessionId: z.string().min(1).max(256), path: z.string().min(1) })
const nativeWorkspaceFileRead = nativeWorkspaceFilePath.extend({
  range: z.strictObject({ offset: z.number().optional(), limit: z.number().optional() }),
})
const nativeWorkspaceFileRelated = nativeWorkspaceFilePath.extend({ relativePath: z.string().min(1) })

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Browser Session requests and their owned cancellation. */
    nativeWebSession: NativeWebSessionService
  }
}

/** Program settings and explicit wire admission limits. */
export interface Config extends TurnConfig {
  readonly maxPendingRequests: number
  readonly maxHistoryEvents: number
  readonly maxPromptChars: number
  readonly maxFollowBufferBytes: number
  readonly maxFollowers: number
  readonly maxPendingHumanRequests: number
  /** Maximum credential references accepted by one read; defaults to 64. */
  readonly maxCredentialRefsPerRead: number
  /** Maximum path edits accepted by one Settings mutation; defaults to 512. */
  readonly maxSettingsOperations: number
  /** Credential keys whose authorization flows the page may drive; defaults to empty. */
  readonly authorizationKeys: readonly string[]
  /** Caps on Native Session file pages, complete reads and directory listings. */
  readonly workspaceFiles: {
    readonly maxBytes: number
    readonly maxFileBytes: number
    readonly maxLines: number
    readonly maxEntries: number
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native web session: expected an object')
  return value as Record<string, unknown>
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`native web session: ${name} must be a positive safe integer`)
  return value
}

function sessionId(value: unknown): SessionId {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new TypeError('native web session: invalid Session id')
  }
  return SessionId(value)
}

function projectCredentialInfo(info: CredentialInfo): CredentialInfo {
  return { configured: info.configured, ...info.source === undefined ? {} : { source: info.source }, writable: info.writable }
}

function settingsConflictDetails(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof NativeSettingsConflictError)) return undefined
  return {
    namespace: error.namespace, expected: error.expected, actual: error.actual,
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof AggregateError)) return error instanceof Error ? error.message : String(error)
  return `${error.message}: ${error.errors.map(errorMessage).join('; ')}`
}

function submissionErrorDetails(endpoint: string, payload: unknown): Record<string, unknown> {
  if (endpoint !== 'session/queue' && endpoint !== 'session/steer' && endpoint !== 'session/dequeue'
    && endpoint !== 'session/submission/edit' && endpoint !== 'session/submission/promote'
    || payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const requestId = (payload as Record<string, unknown>)['requestId']
  return typeof requestId === 'string' ? { requestId } : {}
}

function latestTurnState(events: readonly SessionEvent[]): {
  running: boolean
  completed: boolean
} {
  let running = false
  let completed = false
  for (const event of events) {
    if (event.type === 'turn/start') { running = true; completed = false }
    if (event.type === 'turn/end') { running = false; completed = event.data.reason.kind === 'completed' }
  }
  return { running, completed }
}

function startsSessionConversation(event: SessionEvent): boolean {
  return event.type === 'turn/start'
    || event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'task-scheduler' && event.data.source.form === 'notice'
}

function searchSnippet(events: readonly SessionEvent[], query: string): string | undefined {
  const current = new Set(foldSurface(events).nodes)
  for (const event of events) {
    if (!current.has(event.seq)) continue
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const message = deriveEventMessage(event)
    for (const block of message?.content ?? []) {
      if (block.type !== 'text') continue
      const index = block.text.toLowerCase().indexOf(query)
      if (index < 0) continue
      const start = Math.max(0, index - 80)
      return Array.from(block.text.slice(start)).slice(0, 240).join('')
    }
  }
  return undefined
}

type WorkspaceFileObservation = readonly [target: FsTarget, observation: FsObservation]
type QueuedWorkspaceFileFrame = { readonly frame: WorkspaceFileWatchFrame; readonly bytes: number }

/** Queue only in-workspace frames while a Client is paused. */
class WorkspaceFileObservationQueue {
  private readonly values: QueuedWorkspaceFileFrame[] = []
  private waiter: ((result: IteratorResult<WorkspaceFileWatchFrame>) => void) | undefined
  private bytes = 0
  private closed = false

  constructor(
    private readonly maxBytes: number,
    private readonly fs: FileSystemOperations,
    private readonly root: FsTarget,
    private readonly overflow: () => void,
  ) {}

  next(): Promise<IteratorResult<WorkspaceFileWatchFrame>> {
    const value = this.values.shift()
    if (value !== undefined) {
      this.bytes -= value.bytes
      return Promise.resolve({ done: false, value: value.frame })
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => { this.waiter = resolve })
  }

  push(value: WorkspaceFileObservation): void {
    if (this.closed) return
    const [target, observation] = value
    if (!this.fs.contains(this.root, target)) return
    const absolutePath = this.fs.processPath(target)
    const frame: WorkspaceFileWatchFrame = { kind: 'change', change: observation.kind === 'present'
      ? { absolutePath, version: observation.version }
      : { absolutePath, absent: true } }
    const bytes = Buffer.byteLength(`data: ${JSON.stringify(frame)}\n\n`)
    const waiter = this.waiter
    if (waiter !== undefined) {
      this.waiter = undefined
      waiter({ done: false, value: frame })
    } else if (this.bytes + bytes > this.maxBytes) {
      this.close()
      this.overflow()
    } else {
      this.values.push({ frame, bytes })
      this.bytes += bytes
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.values.length = 0
    this.bytes = 0
    this.waiter?.({ done: true, value: undefined })
    this.waiter = undefined
  }

  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame> {
    const stop = (): void => { this.close() }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    try {
      while (!this.closed) {
        const next = await this.next()
        if (next.done) return
        yield next.value
      }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
}

async function* workspaceFileText(file: FileHandle, signal: AbortSignal, path: string): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let sampledBytes = 0
  for await (const chunk of file.createReadStream({ autoClose: false, signal }) as AsyncIterable<Uint8Array>) {
    signal.throwIfAborted()
    if (sampledBytes < 8192) {
      const sample = chunk.subarray(0, Math.min(chunk.length, 8192 - sampledBytes))
      if (sample.includes(0)) throw new Error(`"${path}" is not text`)
      sampledBytes += sample.length
    }
    yield decoder.decode(chunk, { stream: true })
  }
  yield decoder.decode()
}

function workspaceFilePath(path: string, allowRoot = false): string {
  if (path.includes('\0') || path.startsWith('/') || win32.isAbsolute(path) || /^[a-z]:/iu.test(path)) {
    throw new TypeError('native Session file paths must be workspace-relative')
  }
  const normalized = path.replace(/\\/g, '/')
  if (normalized.length === 0) {
    if (allowRoot) return '.'
    throw new TypeError('native Session file path is required')
  }
  return normalized
}

function workspacePathOf(fs: FileSystemOperations, root: FsTarget, target: FsTarget): string {
  return relative(fs.processPath(root), fs.processPath(target)).split(sep).join('/')
}

function workspaceFileEntry(child: { name: string; type: WorkspaceDirectoryEntry['type']; size?: number }): WorkspaceDirectoryEntry {
  return { name: child.name, type: child.type, ...child.size === undefined ? {} : { size: child.size } }
}

/** Resolve Program settings and resource limits before installing routes.
 * @param input - profile configuration.
 * @returns validated native Session configuration.
 */
export function resolveNativeWebSessionConfig(input: unknown): Config {
  const { maxPendingRequests, maxHistoryEvents, maxPromptChars, maxFollowBufferBytes, maxFollowers,
    maxPendingHumanRequests, maxCredentialRefsPerRead, maxSettingsOperations, authorizationKeys,
    workspaceFiles, ...turn } = object(input)
  const settingsLimits = z.strictObject({
    maxCredentialRefsPerRead: z.number().int().min(1).refine(Number.isSafeInteger).default(64),
    maxSettingsOperations: z.number().int().min(1).refine(Number.isSafeInteger).default(512),
    authorizationKeys: z.array(z.string()).default([]),
  }).parse({ maxCredentialRefsPerRead, maxSettingsOperations, authorizationKeys })
  const fileLimits = z.strictObject({
    maxBytes: z.number().int().refine(Number.isSafeInteger).min(1).default(2 * 1024 * 1024),
    maxFileBytes: z.number().int().refine(Number.isSafeInteger).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(32 * 1024 * 1024),
    maxLines: z.number().int().refine(Number.isSafeInteger).min(1).default(5000),
    maxEntries: z.number().int().refine(Number.isSafeInteger).min(1).default(2000),
  }).parse(workspaceFiles ?? {})
  return { ...resolveNativeHeadlessConfig(turn), maxPendingRequests: positive(maxPendingRequests, 'maxPendingRequests'),
    maxHistoryEvents: positive(maxHistoryEvents, 'maxHistoryEvents'), maxPromptChars: positive(maxPromptChars, 'maxPromptChars'), maxFollowBufferBytes: positive(maxFollowBufferBytes, 'maxFollowBufferBytes'),
    maxFollowers: positive(maxFollowers, 'maxFollowers'),
    maxPendingHumanRequests: positive(maxPendingHumanRequests, 'maxPendingHumanRequests'), ...settingsLimits, workspaceFiles: fileLimits }
}

const endpoints = new Set(['session/list', 'session/history', 'session/create', 'session/prompt', 'session/cancel', 'session/status', 'session/start', 'session/await', 'session/model-controls',
  'session/mode-controls', 'session/select-model', 'session/select-preset', 'session/select-plan-mode', 'session/permission-controls', 'session/select-permission',
  'session/answer-human', 'session/rename-title', 'session/refresh-title', 'session/search', 'session/archive', 'session/commands', 'session/command', 'settings/describe', 'settings/mutate', 'settings/open-document',
  'session/queue', 'session/steer', 'session/dequeue', 'session/submissions', 'session/submission/edit', 'session/submission/promote',
  'agent-presets/list',
  'agent-presets/read', 'agent-presets/copy', 'agent-presets/delete',
  'agent-presets/can-open-directory', 'agent-presets/open-directory',
  'models/providers', 'models/configurable-providers', 'models/discover', 'plugins/inventory',
  'credentials/describe', 'credentials/set', 'credentials/unset', 'authorization/list', 'authorization/begin', 'authorization/answer', 'authorization/decline', 'authorization/cancel',
  'accounts/list', 'accounts/usage', 'accounts/balance', 'accounts/sign-out',
  'workspaces/list', 'workspaces/create', 'workspaces/rename', 'workspaces/delete', 'workspaces/reorder', 'workspaces/reorder-session',
  'workspaces/archive-session', 'workspaces/search', 'workspaces/connect',
  'directories/pick', 'directories/list', 'directories/create-directory',
  'session/files/list', 'session/files/stat', 'session/files/read', 'session/files/read-all', 'session/files/read-related',
  'feedback/session-record', 'feedback/message-list', 'feedback/message-put', 'feedback/message-delete'])
const modelSelectionInput = z.strictObject({
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional(),
})
const nativeSettingsMutation = z.strictObject({
  ns: z.string().regex(/^[a-z][a-z0-9-]*$/), ops: z.array(z.unknown()),
  expectedRevision: z.number().int().refine(Number.isSafeInteger).nonnegative(),
})
const nativeCredentialRef = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
function credentialRefsRequest(maxCredentialRefsPerRead: number) {
  return z.strictObject({ refs: z.array(nativeCredentialRef).max(maxCredentialRefsPerRead) })
}
const nativeCredentialSet = z.strictObject({ ref: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), value: z.string().min(1) })
const nativeCredentialUnset = z.strictObject({ ref: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) })
const sessionTitleReadConcurrency = 4
const sessionSearchScanLimit = 100
const sessionSearchResultLimit = 20
const sessionSearchQueryMaxChars = 500
const nativeSessionSearch = z.strictObject({
  query: z.string().trim().min(1).max(sessionSearchQueryMaxChars).refine(query => !query.includes('\0')),
  cursor: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
})
const nativeSessionFeedbackRecord = z.strictObject({
  sessionId: z.string().min(1).max(256), text: z.string().optional(), category: z.enum(FEEDBACK_CATEGORIES).optional(),
})
const nativeMessageFeedbackList = z.strictObject({ sessionId: z.string().min(1).max(256) })
const nativeMessageFeedbackPut = z.strictObject({
  sessionId: z.string().min(1).max(256), messageId: z.string().min(1), rating: z.enum(['positive', 'negative']),
  note: z.string().optional(), category: z.enum(FEEDBACK_CATEGORIES).optional(), ifVersion: z.union([z.uuid(), z.null()]),
})
const nativeMessageFeedbackDelete = z.strictObject({
  sessionId: z.string().min(1).max(256), messageId: z.string().min(1), ifVersion: z.uuid(),
})

/** Optional selected authorities; no fallback catalog or composition registry is created. */
export interface NativeWebSelectionProviders {
  readonly directory?: NativeModelDirectory | undefined
  readonly defaultModel?: (() => ModelSelection | undefined) | undefined
  readonly models?: {
    readonly selection: NativeModelSelectionOperations
    readonly executionFor: (agent: NativeAgent) => Pick<NativeAgentExecution, 'status' | 'runMaintenance'>
  } | undefined
  readonly planMode?: NativePlanMode | undefined
  readonly permissionPresets?: NativePermissionPresetOperations | undefined
  readonly presets?: NativeAgentPresetOperations | undefined
  readonly attachments?: AttachmentOperations | undefined
  readonly settings?: NativeSettingsService | undefined
  readonly credentials?: NativeCredentials | undefined
  readonly titles?: NativeSessionTitles | undefined
  readonly commands?: NativeCommandOperations | undefined
  readonly sessionFeedback?: NativeSessionFeedbackOperations | undefined
  readonly messageFeedback?: NativeMessageFeedbackOperations | undefined
  readonly commandScope?: NativeScope | undefined
  readonly workspaceRegistry?: WorkspaceRegistryRuntime | undefined
  readonly executionFor?: (agent: NativeAgent) => Pick<NativeAgentExecution, 'status'>
}

interface NativeSessionListContext {
  readonly owners: readonly NativeActiveSessionOwner[]
  readonly ownerBySession: ReadonlyMap<SessionId, NativeActiveSessionOwner>
  readonly runningSubagentCount: ReadonlyMap<SessionId, number>
  readonly workspaceBySession: ReadonlyMap<SessionId, WorkspaceId>
  readonly archived: ReadonlySet<SessionId>
}

interface NativeDefaultModelSettings {
  readonly provider?: string
  readonly model?: string
}

function resolveDefaultModelSettings(value: NativeSettingsSection): NativeDefaultModelSettings {
  for (const key of Object.keys(value)) {
    if (!['provider', 'model'].includes(key)) throw new TypeError(`agent-default-model: unknown field "${key}"`)
  }
  const { provider, model } = value
  if (provider === undefined && model === undefined) return {}
  if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) {
    throw new TypeError('agent-default-model: provider and model must be nonempty strings')
  }
  return { provider, model }
}

function defaultModelSelection(settings: NativeSettingsScope<NativeDefaultModelSettings> | undefined): Pick<ModelSelection, 'provider' | 'model'> | undefined {
  const value = settings?.get()
  if (value?.provider === undefined || value.model === undefined) return undefined
  return { provider: value.provider, model: value.model }
}

/** Browser transport Consumer; the executor retains the sole Agent and Session writer. */
export class NativeWebSessionService {
  private readonly turns = new Map<SessionId, {
    admissionId: NativeSessionAdmissionId
    controller: AbortController
    done: Promise<unknown>
    waiting: boolean
    settled: boolean
    feed: NativeSessionFeed | undefined
    following: boolean
    submissions: Map<NativeSubmissionRequestId, 'submitting' | 'accepted' | 'claimed'>
  }>()
  private readonly human: NativeWebHumanInteraction
  private followers = 0
  private readonly shutdown = new AbortController()
  private readonly requests: NativeConnectionRequestOwner
  private readonly controls: NativeConnectionRequestOwner
  private readonly settlements: NativeConnectionRequestOwner
  private readonly followTasks = new Set<Promise<void>>()
  private readonly listFeeds = new Map<NativeSessionListFeed, () => void>()
  private readonly workspaceFileFollowers = new Set<WorkspaceFileObservationQueue>()
  private readonly ownerEvents = new Map<NativeActiveSessionOwner, () => void>()
  private readonly removeAttached: () => Promise<void>
  private readonly removeDetached: () => Promise<void>

  /**
   * @param executor - shared Program executor, not another Agent loop.
   * @param persistence - selected durable Session index.
   * @param active - selected exact live writer registry.
   * @param config - validated execution and wire limits.
   * @param lifetime - installation cancellation.
   * @param selections - selected catalog, model intent and standing composition authorities.
   * @param fileSystem - selected Native filesystem Provider for Session file operations.
   */
  constructor(private readonly executor: NativeHeadlessApplication,
    private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations,
    private readonly config: Config, private readonly lifetime: AbortSignal,
    private readonly selections: NativeWebSelectionProviders = {},
    private readonly notifyAgentPresetsUpdated: () => void = () => {},
    private readonly fileSystem?: FileSystemOperations) {
    this.human = new NativeWebHumanInteraction(config.maxPendingHumanRequests, (agent) => {
      const owner = this.active.owners().find(candidate => candidate.agent === agent)
      if (owner !== undefined) this.publishListChange(owner.session.id)
    })
    this.requests = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.controls = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.settlements = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.removeAttached = this.active.onAttached((owner) => {
      this.watchOwner(owner)
      this.publishListChange(owner.session.id)
      if (owner.session.header.parentSession !== undefined) this.publishListChange(owner.session.header.parentSession)
      return Promise.resolve()
    })
    this.removeDetached = this.active.onDetached((owner) => {
      this.ownerEvents.get(owner)?.()
      this.ownerEvents.delete(owner)
      this.publishListChange(owner.session.id)
      if (owner.session.header.parentSession !== undefined) this.publishListChange(owner.session.header.parentSession)
      return Promise.resolve()
    })
    for (const owner of this.active.owners()) this.watchOwner(owner)
  }

  private watchOwner(owner: NativeActiveSessionOwner): void {
    if (this.ownerEvents.has(owner)) return
    this.ownerEvents.set(owner, owner.onEvent(() => {
      this.publishListChange(owner.session.id)
      if (owner.session.header.parentSession !== undefined) this.publishListChange(owner.session.header.parentSession)
    }))
  }

  private publishListChange(id: SessionId): void {
    for (const feed of this.listFeeds.keys()) feed.push(id)
  }

  private humanFeed(agent: NativeAgent): NativeSessionFeed | undefined {
    const owner = this.active.owners().find(owner => owner.agent === agent && owner.invocation === 'root' && owner.writerAvailable)
    if (owner === undefined) return undefined
    try { this.executor.rootExecution.capture(owner) }
    catch {
      // The shared registry also exposes other Programs' roots; their answerers retain those requests.
      return undefined
    }
    const turn = this.turns.get(owner.session.id)
    return turn === undefined || turn.settled || turn.controller.signal.aborted ? undefined : turn.feed
  }

  /** Register answerers only for this Program's exact active root turns.
   * @param context - effect ownership and contribution visibility.
   * @param approval - selected approval Provider.
   * @param questions - selected question Definition.
   */
  bindHuman(context: Pick<NativeContext, 'own' | 'scope'>, approval?: NativeApprovalServiceDefinition, questions?: NativeUserQuestionRegistry): void {
    if (approval !== undefined) context.own(approval.registerAnswerer((request) => {
      const feed = this.humanFeed(request.agent)
      return feed === undefined ? undefined : this.human.approval(request, feed)
    }))
    if (questions !== undefined) context.own(questions.registerAnswerer('native-web', { ask: (request, next) => {
      const feed = this.humanFeed(request.agent)
      return feed === undefined ? next() : this.human.questions(request, feed)
    } }, context.scope))
  }

  private async start(payload: unknown, signal: AbortSignal): Promise<{ admissionId: NativeSessionAdmissionId }> {
    signal.throwIfAborted()
    const fields = object(payload)
    for (const key of Object.keys(fields)) if (!['sessionId', 'text', 'resume', 'follow', 'lastSeq', 'images'].includes(key)) throw new Error('native web session: unexpected prompt field')
    const id = sessionId(fields.sessionId)
    if (typeof fields.text !== 'string' || fields.text.length === 0 || fields.text.length > this.config.maxPromptChars) throw new TypeError('native web session: text exceeds configured limits or is empty')
    if (fields.follow !== undefined && typeof fields.follow !== 'boolean') throw new TypeError('native web session: follow must be boolean')
    if (fields.follow === true && (typeof fields.lastSeq !== 'number' || !Number.isSafeInteger(fields.lastSeq) || fields.lastSeq < -1)
      || fields.follow !== true && fields.lastSeq !== undefined) throw new TypeError('native web session: follow cursor must be an integer at least -1')
    if (typeof fields.resume !== 'boolean') throw new TypeError('native web session: resume must be explicit')
    const images = fields.images === undefined ? [] : z.array(z.strictObject({
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string(), name: z.string().optional(),
    })).parse(fields.images)
    const attachments = this.selections.attachments
    const directory = this.selections.directory
    const imageProviders = images.length === 0 ? undefined : (() => {
      if (attachments === undefined || directory === undefined) throw new Error('native web session: image input is unavailable')
      return { attachments, directory }
    })()
    if (this.turns.has(id)) throw new Error('native web session: Session already has a pending turn')
    if (this.turns.size >= this.config.maxPendingRequests) throw new Error('native web session: turn settlement capacity reached')
    const controller = new AbortController()
    const admissionId = randomUUID() as NativeSessionAdmissionId
    const feed = fields.follow === true
      ? new NativeSessionFeed(this.config.maxFollowBufferBytes, (error) => { controller.abort(error) }) : undefined
    let admitted!: () => void
    let refused!: (error: unknown) => void
    const acknowledgement = new Promise<void>((resolve, reject) => { admitted = resolve; refused = reject })
    const submissions = new Map<NativeSubmissionRequestId, 'submitting' | 'accepted' | 'claimed'>()
    let inbox: NativeInboxState | undefined
    let inboxThroughSeq: number | undefined
    const eventsBeforeBaseline: SessionEvent[] = []
    const processTurnEvent = (event: SessionEvent): void => {
      const removed = event.type === 'agent/inbox/spliced'
        ? inbox?.[event.data.target].slice(event.data.start, event.data.start + (event.data.removedCount ?? 0)) ?? []
        : []
      if (inbox === undefined) throw new Error('native web session: inbox projection is unavailable before its baseline')
      inbox = foldNativeInboxEvent(inbox, event)
      if (event.type === 'agent/inbox/spliced') {
        for (const message of event.data.inserted) {
          const requestId = brandString<NativeSubmissionRequestId>(message.id)
          if (submissions.get(requestId) === 'submitting') {
            submissions.set(requestId, 'accepted')
            feed?.push({ type: 'submission-update', requestId, status: 'accepted' })
          }
        }
        if (event.data.outcome === 'canceled') {
          const insertedIds = new Set(event.data.inserted.map(message => message.id))
          for (const message of removed) {
            if (insertedIds.has(message.id)) continue
            const requestId = brandString<NativeSubmissionRequestId>(message.id)
            if (submissions.get(requestId) === 'accepted') {
              submissions.delete(requestId)
              feed?.push({ type: 'submission-update', requestId, status: 'rejected' })
            }
          }
        }
      }
      if (event.type === 'user/message') {
        const requestId = brandString<NativeSubmissionRequestId>(event.data.id)
        if (submissions.get(requestId) === 'accepted') submissions.set(requestId, 'claimed')
      }
      if (event.type === 'turn/end') {
        for (const [requestId, status] of submissions) {
          if (status === 'claimed') {
            submissions.delete(requestId)
            feed?.push({ type: 'submission-update', requestId, status: 'settled' })
          }
        }
      }
    }
    const observeTurnEvent = (event: SessionEvent): void => {
      if (inbox === undefined || inboxThroughSeq === undefined) {
        eventsBeforeBaseline.push(event)
        return
      }
      if (event.seq <= inboxThroughSeq) return
      processTurnEvent(event)
      inboxThroughSeq = event.seq
    }
    const execution = this.requests.run(this.lifetime, async (accepted) => {
      admitted()
      const turnSignal = AbortSignal.any([accepted, controller.signal])
      try {
        const route = await this.routeForSession(id, turnSignal)
        const result = await this.executor.executeRootTurn({ id, route, resume: fields.resume as boolean,
          ...imageProviders === undefined ? { message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: fields.text as string }] }) }
            : { prepareMessage: async (route, preparationSignal) => {
              const info = await imageProviders.directory.resolve(route.provider, route.model, preparationSignal)
              preparationSignal.throwIfAborted()
              if (!info.inputModalities?.includes('image')) throw new Error('native web session: selected model does not accept images')
              const content = await imageProviders.attachments.admitPromptContent([{ type: 'text', text: fields.text as string },
                ...images.map(image => ({ type: 'image' as const, mediaType: image.mediaType, data: image.data, ...image.name === undefined ? {} : { name: image.name } }))])
              preparationSignal.throwIfAborted()
              return createUserMessage({ source: { kind: 'user' }, content })
            } },
          ...feed === undefined ? {} : { onEvent: (event) => {
            feed.push({ type: 'event', event })
            observeTurnEvent(event)
          }, onBaseline: async (owner, baselineSignal) => {
            if (owner.session.id !== id || owner.invocation !== 'root' || !owner.writerAvailable
              || this.active.owner(owner.agent, owner.session) !== owner) throw new Error('native web session: history baseline lost its exact root owner')
            const events = await owner.readEvents({ maxEvents: this.config.maxHistoryEvents + 1, signal: baselineSignal })
            baselineSignal.throwIfAborted()
            if (this.active.owner(owner.agent, owner.session) !== owner) throw new Error('native web session: history baseline owner was released')
            if (events.length > this.config.maxHistoryEvents) throw new Error('native web session: history exceeds configured event limit')
            const observedSeqs = new Set(eventsBeforeBaseline.map(event => event.seq))
            inbox = { 'next-turn': [], 'next-step': [] }
            for (const event of events) {
              if (observedSeqs.has(event.seq)) processTurnEvent(event)
              else inbox = foldNativeInboxEvent(inbox, event)
            }
            inboxThroughSeq = events.at(-1)?.seq ?? -1
            for (const event of eventsBeforeBaseline.splice(0)) {
              if (event.seq <= inboxThroughSeq) continue
              processTurnEvent(event)
              inboxThroughSeq = event.seq
            }
            const cursor = fields.lastSeq as number
            if (cursor >= events.length || cursor >= 0 && events[cursor]?.seq !== cursor) {
              throw new Error('native web session: follow cursor is outside the exact Session history')
            }
            feed.setBaseline(id, cursor, events.slice(cursor + 1))
          }, onChunk: (chunk) => {
            if (chunk.type === 'block-start' && chunk.blockType === 'text') feed.push({ type: 'text-start' })
            if (chunk.type === 'text-delta') feed.push({ type: 'text', text: chunk.text })
          } } }, turnSignal)
        const failure = feed?.failure()
        if (failure !== undefined) throw failure
        return result
      } catch (error: unknown) {
        const failure = feed?.failure()
        if (failure !== undefined) {
          if (error === failure) throw failure
          throw new AggregateError([failure, error], `${failure.message}; execution failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        // Exact execution cancellation is observed after the shared writer has drained.
        if (turnSignal.aborted && error === turnSignal.reason) return { exitCode: 130 }
        throw error
      }
    })
    const done = execution.then((result) => {
      const failure = feed?.failure()
      if (failure !== undefined) throw failure
      return result
    }, (error: unknown) => {
      if (error instanceof Error) throw error
      throw new Error(String(error), { cause: error })
    })
    const followTask = done.then(
      () => this.finishFollow(id, feed),
      () => this.finishFollow(id, feed),
    ).catch((error: unknown) => {
      feed?.fail(error instanceof Error ? error : new Error(String(error), { cause: error }))
      this.requests.recordCleanupFailure(error)
    }).finally(() => { feed?.finish() })
    this.followTasks.add(followTask)
    void followTask.then(() => { this.followTasks.delete(followTask) })
    const turn = { admissionId, controller, done, waiting: false, settled: false, feed, following: false, submissions }
    this.turns.set(id, turn)
    // Keep rejected execution attached until the settlement consumer reads the same promise.
    const markSettled = (): void => { turn.settled = true; this.publishListChange(id) }
    void done.then(markSettled, (error: unknown) => { markSettled(); refused(error) })
    try { await acknowledgement } catch (error: unknown) { this.turns.delete(id); throw error }
    return { admissionId }
  }

  /**
   * Follow the exact admitted turn without acquiring another writer or Agent.
   * @param request - authenticated Fetch route request.
   * @returns SSE response, or a failure before any stream is admitted.
   */
  async follow(request: Request): Promise<Response> {
    const fields = object(await request.json())
    for (const key of Object.keys(fields)) if (!['sessionId', 'admissionId'].includes(key)) throw new Error('native web session: unexpected follow field')
    const turn = this.turns.get(sessionId(fields.sessionId))
    if (turn === undefined || fields.admissionId !== turn.admissionId || turn.feed === undefined || turn.following) {
      return new Response('native Session follow: unavailable admission', { status: 409 })
    }
    const signal = AbortSignal.any([request.signal, this.lifetime, this.shutdown.signal])
    signal.throwIfAborted()
    if (this.followers + this.listFeeds.size >= this.config.maxFollowers) {
      return new Response('native Session follow: capacity reached', { status: 429 })
    }
    turn.following = true
    this.followers++
    return turn.feed.response(signal, () => { this.followers-- })
  }

  /** Follow the complete Session list through the selected authenticated Fetch carrier.
   * @param request - authenticated empty POST request.
   * @returns baseline and coalesced Session updates as an SSE stream.
   */
  async followList(request: Request): Promise<Response> {
    z.strictObject({}).parse(await request.json())
    const signal = AbortSignal.any([request.signal, this.lifetime, this.shutdown.signal])
    signal.throwIfAborted()
    if (this.followers + this.listFeeds.size >= this.config.maxFollowers) {
      return new Response('native Session list follow: capacity reached', { status: 429 })
    }
    const feed = new NativeSessionListFeed(this.config.maxFollowBufferBytes, () => { this.listFeeds.delete(feed) })
    const stop = (): void => { feed.close() }
    this.listFeeds.set(feed, stop)
    return feed.response(signal,
      () => this.listSessions(signal),
      id => this.projectSession(id, this.listProjectionContext(), signal))
  }

  /** Follow instrumented filesystem observations inside one Session workspace.
   * @param request - authenticated Fetch request with a Session id.
   * @returns frames; closes if queued frame bytes exceed `maxFollowBufferBytes`.
   */
  async followWorkspaceFiles(request: Request): Promise<Response> {
    const fields = z.strictObject({ sessionId: z.string().min(1).max(256) }).parse(await request.json())
    const id = sessionId(fields.sessionId)
    const disconnect = new AbortController()
    const signal = AbortSignal.any([request.signal, this.lifetime, this.shutdown.signal, disconnect.signal])
    signal.throwIfAborted()
    if (this.followers + this.listFeeds.size >= this.config.maxFollowers) {
      return new Response('native Session workspace file follow: capacity reached', { status: 429 })
    }
    this.followers++
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      signal.removeEventListener('abort', release)
      this.followers--
    }
    signal.addEventListener('abort', release, { once: true })
    const encoder = new TextEncoder()
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    let streamEnded = false
    const end = (): void => {
      disconnect.abort()
      release()
      if (streamEnded) return
      streamEnded = true
      streamController?.close()
      void iterator.return?.()
    }
    const iterator: AsyncIterator<WorkspaceFileWatchFrame> = this.followWorkspaceFileChanges(id, signal, end)[Symbol.asyncIterator]()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller },
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (streamEnded) return
          if (next.done) {
            release()
            streamEnded = true
            controller.close()
          } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
        } catch (error: unknown) {
          release()
          if (streamEnded) return
          streamEnded = true
          controller.error(error)
        }
      },
      async cancel() {
        disconnect.abort()
        release()
        streamEnded = true
        await iterator.return?.()
      },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }

  private async *followWorkspaceFileChanges(
    id: SessionId, signal: AbortSignal, overflow: () => void,
  ): AsyncIterable<WorkspaceFileWatchFrame> {
    signal.throwIfAborted()
    let follower: WorkspaceFileObservationQueue | undefined
    const stop = (): void => {
      follower?.close()
      if (follower !== undefined) this.workspaceFileFollowers.delete(follower)
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      const fs = this.requireFileSystem()
      const rootPath = await this.workspaceFileRoot(id, signal)
      const root = await fs.resolve(rootPath, { signal })
      if (signal.aborted) return
      follower = new WorkspaceFileObservationQueue(this.config.maxFollowBufferBytes, fs, root, overflow)
      this.workspaceFileFollowers.add(follower)
      yield { kind: 'ready' }
      for await (const frame of follower.read(signal)) yield frame
    } finally {
      signal.removeEventListener('abort', stop)
      stop()
    }
  }

  private async finishFollow(id: SessionId, feed: NativeSessionFeed | undefined): Promise<void> {
    const titles = this.selections.titles
    if (feed === undefined || titles === undefined) return
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (owner === undefined) return
    try { this.executor.rootExecution.capture(owner) }
    catch { return }
    const remove = owner.onEvent((event) => {
      if (event.type === 'session/title') feed.push({ type: 'title-updated' })
    })
    try { await titles.drainOwner(owner) }
    finally { remove() }
  }

  private async command(payload: unknown, signal: AbortSignal): Promise<unknown> {
    const request = z.strictObject({
      sessionId: z.string().min(1).max(256),
      line: z.string().min(1).max(this.config.maxPromptChars),
    }).parse(payload)
    const id = SessionId(request.sessionId)
    const commands = this.selections.commands
    const scope = this.selections.commandScope
    const parsed = commands?.parse(request.line)
    if (commands === undefined || scope === undefined || parsed === undefined) {
      throw new Error('native web session: command must be an available slash command')
    }
    if (!commands.list(scope).some(command => command.name === parsed.name)) {
      throw new Error(`native web session: command /${parsed.name} is unavailable`)
    }
    if (this.turns.has(id)) throw new Error('native web session: command requires an idle Session')
    const route = await this.routeForSession(id, signal)
    return this.executor.executeSessionOperation({ id, resume: true, route }, async (owner, accepted) => {
      if (this.turns.has(id)) throw new Error('native web session: command requires an idle Session')
      if (this.executor.rootExecution.capture(owner).id !== route) {
        throw new Error('native web session: command requires this Program root owner')
      }
      if (!commands.list(owner.agent.scope).some(command => command.name === parsed.name)) {
        throw new Error(`native web session: command /${parsed.name} is unavailable to this root owner`)
      }
      const result = await commands.dispatch({
        agent: owner.agent,
        session: owner.session,
        line: request.line,
        attachments: [],
        signal: accepted,
      })
      if (result === undefined) throw new Error(`native web session: command /${parsed.name} is no longer available`)
      return result
    }, signal)
  }

  private async commandCatalog(id: SessionId, signal: AbortSignal): Promise<unknown> {
    const commands = this.selections.commands
    const scope = this.selections.commandScope
    if (commands === undefined || scope === undefined) throw new Error('native web session: command catalog is unavailable')
    const visibleNames = new Set(commands.list(scope).map(command => command.name))
    const route = await this.routeForSession(id, signal)
    return this.executor.executeSessionOperation({ id, resume: true, route }, (owner) => {
      if (this.executor.rootExecution.capture(owner).id !== route) {
        throw new Error('native web session: command catalog requires this Program root owner')
      }
      return Promise.resolve({ commands: commands.list(owner.agent.scope).filter(command => visibleNames.has(command.name)) })
    }, signal)
  }

  private async submit(payload: unknown, target: 'next-turn' | 'next-step', signal: AbortSignal): Promise<NativeSubmissionAcknowledgement> {
    const request = z.strictObject({
      sessionId: z.string().min(1).max(256),
      prompt: z.string().min(1).max(this.config.maxPromptChars),
      requestId: z.string().min(1).max(256),
    }).parse(payload)
    const id = SessionId(request.sessionId)
    const turn = this.turns.get(id)
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (turn === undefined || turn.settled || turn.controller.signal.aborted || owner === undefined) {
      throw new Error('native web session: queued submission requires an active browser turn')
    }
    this.executor.rootExecution.capture(owner)
    const requestId = brandString<NativeSubmissionRequestId>(request.requestId)
    if (turn.submissions.has(requestId)) throw new Error('native web session: duplicate submission request id')
    const message = freezeMessage({ id: MessageId(request.requestId), role: 'user' as const, source: { kind: 'user' as const },
      content: [{ type: 'text' as const, text: request.prompt }] })
    turn.submissions.set(requestId, 'submitting')
    try { await owner.enqueue(message, target, true, signal) }
    catch (error: unknown) { turn.submissions.delete(requestId); throw error }
    return { requestId, placement: target === 'next-turn' ? 'queued' : 'steering', status: 'accepted' }
  }

  private async dequeue(payload: unknown, signal: AbortSignal): Promise<{ requestId: NativeSubmissionRequestId }> {
    const request = z.strictObject({ sessionId: z.string().min(1).max(256), requestId: z.string().min(1).max(256) }).parse(payload)
    const id = SessionId(request.sessionId)
    const messageId = MessageId(request.requestId)
    const remove = async (owner: NativeActiveSessionOwner): Promise<{ requestId: NativeSubmissionRequestId }> => {
      for (const target of ['next-turn', 'next-step'] as const) {
        if (owner.messages(target).some(message => message.id === messageId)) {
          await owner.remove([messageId], target, signal)
          return { requestId: brandString<NativeSubmissionRequestId>(request.requestId) }
        }
      }
      throw new Error('native web session: pending submission not found')
    }
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (owner !== undefined) {
      this.executor.rootExecution.capture(owner)
      return remove(owner)
    }
    if (await this.persistence.stat(id, { signal }) === undefined) throw new Error('native web session: unknown Session')
    const route = await this.routeForSession(id, signal)
    return this.executor.executeSessionOperation({ id, resume: true, route }, remove, signal)
  }

  private async editSubmission(payload: unknown, signal: AbortSignal): Promise<NativeSubmissionEditResult> {
    const request = z.strictObject({
      sessionId: z.string().min(1).max(256), requestId: z.string().min(1).max(256),
      text: z.string().min(1).max(this.config.maxPromptChars),
    }).parse(payload)
    if (request.text.trim().length === 0) throw new Error('native web session: edited submission text must not be blank')
    const id = SessionId(request.sessionId)
    const messageId = MessageId(request.requestId)
    const content: readonly TextBlock[] = [{ type: 'text', text: request.text }]
    const edit = async (owner: NativeActiveSessionOwner): Promise<NativeSubmissionEditResult> => {
      if (owner.session.id !== id || owner.invocation !== 'root' || !owner.writerAvailable
        || this.active.owner(owner.agent, owner.session) !== owner) {
        throw new Error('native web session: submission edit requires the exact root Session owner')
      }
      this.executor.rootExecution.capture(owner)
      const result = await owner.editPendingText(messageId, content, signal)
      return { requestId: brandString<NativeSubmissionRequestId>(request.requestId), outcome: result.kind }
    }
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (owner !== undefined) return edit(owner)
    if (await this.persistence.stat(id, { signal }) === undefined) throw new Error('native web session: unknown Session')
    const route = await this.routeForSession(id, signal)
    return this.executor.executeSessionOperation({ id, resume: true, route }, edit, signal)
  }

  private async promoteSubmission(payload: unknown, signal: AbortSignal): Promise<NativeSubmissionPromotionResult> {
    const request = z.strictObject({ sessionId: z.string().min(1).max(256),
      requestId: z.string().min(1).max(256) }).parse(payload)
    const id = SessionId(request.sessionId)
    const turn = this.turns.get(id)
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (turn === undefined || turn.settled || turn.controller.signal.aborted || owner === undefined) {
      throw new Error('native web session: submission promotion requires an active browser turn')
    }
    this.executor.rootExecution.capture(owner)
    const requestId = brandString<NativeSubmissionRequestId>(request.requestId)
    const result = await owner.promotePending(MessageId(request.requestId), signal)
    return { requestId, outcome: result.kind }
  }

  private async pendingSubmissions(id: SessionId, signal: AbortSignal): Promise<NativeSubmissionsSnapshot> {
    const owner = this.active.owners().find(candidate => candidate.session.id === id
      && candidate.invocation === 'root' && candidate.writerAvailable)
    if (owner !== undefined) {
      this.executor.rootExecution.capture(owner)
      return this.projectPendingSubmissions(owner, signal)
    }
    if (await this.persistence.stat(id, { signal }) === undefined) throw new Error('native web session: unknown Session')
    const route = await this.routeForSession(id, signal)
    return this.executor.executeSessionOperation({ id, resume: true, route }, activeOwner =>
      this.projectPendingSubmissions(activeOwner, signal), signal)
  }

  private async projectPendingSubmissions(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<NativeSubmissionsSnapshot> {
    const events = await owner.readEvents({ signal })
    let inbox: NativeInboxState = { 'next-turn': [], 'next-step': [] }
    for (const event of events) inbox = foldNativeInboxEvent(inbox, event)
    const submissions: readonly NativePendingSubmission[] = [
      ...inbox['next-turn'].map(message => ({ requestId: brandString<NativeSubmissionRequestId>(message.id),
        placement: 'queued' as const, status: 'accepted' as const, message })),
      ...inbox['next-step'].map(message => ({ requestId: brandString<NativeSubmissionRequestId>(message.id),
        placement: 'steering' as const, status: 'accepted' as const, message })),
    ]
    return { throughSeq: events.at(-1)?.seq ?? -1, submissions }
  }

  /** Deliver one Native filesystem observation to every open Session file feed.
   * @param target - resolved filesystem target.
   * @param observation - observed presence or absence and its version.
   */
  observeWorkspaceFile(target: FsTarget, observation: FsObservation): void {
    for (const follower of this.workspaceFileFollowers) follower.push([target, observation])
  }

  private requireFileSystem(): FileSystemOperations {
    if (this.fileSystem === undefined) throw new Error('native Session workspace files are unavailable')
    return this.fileSystem
  }

  private async workspaceFileRoot(id: SessionId, signal: AbortSignal): Promise<string> {
    const owner = this.active.owners().find(candidate => candidate.session.id === id)
    const snapshot = owner === undefined ? await this.persistence.stat(id, { signal }) : undefined
    const header = owner?.session.header ?? snapshot?.header
    if (header === undefined) throw new Error('native web session: unknown Session')
    return header.cwd ?? this.workspaceForSession(id)?.path ?? this.config.cwd
  }

  private async inspectWorkspaceFilePath(rootPath: string, path: string, signal: AbortSignal, allowRoot = false): Promise<{
    readonly root: FsTarget
    readonly target: FsTarget
    readonly entry: FsPathInfo
  }> {
    const fs = this.requireFileSystem()
    const acceptedPath = workspaceFilePath(path, allowRoot)
    const root = await fs.resolve(rootPath, { signal })
    const rootListing = allowRoot && acceptedPath === '.'
    const entry = await fs.lstat(rootListing ? fs.processPath(root) : acceptedPath,
      rootListing ? undefined : { cwd: rootPath }, signal)
    if (entry === undefined) throw new Error(`no entry at "${path}"`)
    const target = rootListing ? root : await fs.resolve(acceptedPath, { cwd: rootPath, signal })
    if (!fs.contains(root, target)) throw new Error(`"${path}" is outside the Session workspace`)
    return { root, target, entry }
  }

  private async locateWorkspaceFile(rootPath: string, path: string, signal: AbortSignal): Promise<{
    readonly root: FsTarget
    readonly target: FsTarget
  }> {
    const located = await this.inspectWorkspaceFilePath(rootPath, path, signal)
    if (located.entry.type !== 'file') throw new Error(`"${path}" is a ${located.entry.type}`)
    return { root: located.root, target: located.target }
  }

  private async verifyWorkspaceFileHandle(
    root: FsTarget, target: FsTarget, file: FileHandle, signal: AbortSignal,
  ): Promise<{ readonly info: BigIntStats; readonly path: string }> {
    const fs = this.requireFileSystem()
    signal.throwIfAborted()
    const opened = await file.stat({ bigint: true })

    if (process.platform === 'linux') {
      const descriptorPath = await readlink(`/proc/self/fd/${file.fd}`)
      const resolved = await fs.resolve(descriptorPath, { signal })
      if (!fs.contains(root, resolved)) throw new Error('opened file is outside the Session workspace')
      return { info: opened, path: fs.processPath(resolved) }
    }

    const path = await realpath(fs.processPath(target))
    const resolved = await fs.resolve(path, { signal })
    if (!fs.contains(root, resolved)) throw new Error('opened file is outside the Session workspace')

    const currentFile = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
      const current = await currentFile.stat({ bigint: true })
      if (opened.dev !== current.dev || opened.ino !== current.ino) {
        throw new Error('workspace file changed while opening')
      }
      if (await realpath(path) !== path) throw new Error('opened file path changed while opening')
    } finally {
      await currentFile.close()
    }
    return { info: opened, path }
  }

  private async openWorkspaceFile(
    root: FsTarget, target: FsTarget, signal: AbortSignal, directory = false,
  ): Promise<{ readonly file: FileHandle; readonly info: BigIntStats; readonly path: string }> {
    signal.throwIfAborted()
    const path = this.requireFileSystem().processPath(target)
    const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
      | (directory ? fsConstants.O_DIRECTORY : 0)
    const file = await open(path, flags)
    try {
      const { info, path } = await this.verifyWorkspaceFileHandle(root, target, file, signal)
      return { file, info, path }
    } catch (error: unknown) {
      await file.close()
      throw error
    }
  }

  private workspaceFileStat(target: FsTarget, info: BigIntStats): WorkspaceFileStat {
    return {
      absolutePath: this.requireFileSystem().processPath(target),
      version: FsVersion(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`),
      bytes: Number(info.size),
    }
  }

  private resolveWorkspaceFileRange(range: WorkspaceFileRange): { offset: number; limit: number } {
    const offset = range.offset ?? 1
    const limit = range.limit ?? this.config.workspaceFiles.maxLines
    if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1
      || limit > this.config.workspaceFiles.maxLines || !Number.isSafeInteger(offset + limit - 1)) {
      throw new TypeError('native Session file range is outside its configured limits')
    }
    return { offset, limit }
  }

  private async cutWorkspaceFilePage(file: FileHandle, offset: number, limit: number, signal: AbortSignal, path: string): Promise<{
    readonly text: string
    readonly lines: number
    readonly eof: boolean
  }> {
    return cutWorkspaceFilePage(workspaceFileText(file, signal, path), offset, limit, this.config.workspaceFiles.maxBytes, path)
  }

  private async workspaceDirectoryNames(
    root: FsTarget, target: FsTarget, signal: AbortSignal,
  ): Promise<{ readonly cwd: string; readonly names: string[]; readonly file?: FileHandle }> {
    const fs = this.requireFileSystem()
    if (process.platform === 'win32') {
      const path = fs.processPath(target)
      const directory = await opendir(path)
      try {
        const resolved = await fs.resolve(path, { signal })
        if (!fs.contains(root, resolved)) throw new Error('opened directory is outside the Session workspace')
        const opened = await stat(fs.processPath(resolved), { bigint: true })
        if (!opened.isDirectory()) throw new Error('opened path is not a directory')
        const names: string[] = []
        while (true) {
          const entry = await directory.read()
          if (entry === null) break
          names.push(entry.name)
        }
        const current = await fs.resolve(path, { signal })
        if (!fs.contains(root, current)) throw new Error('opened directory is outside the Session workspace')
        const currentInfo = await stat(fs.processPath(current), { bigint: true })
        if (opened.dev !== currentInfo.dev || opened.ino !== currentInfo.ino) {
          throw new Error('workspace directory changed while listing')
        }
        return { cwd: fs.processPath(resolved), names }
      } finally {
        await directory.close()
      }
    }
    const { file, info, path } = await this.openWorkspaceFile(root, target, signal, true)
    try {
      if (!info.isDirectory()) throw new Error('opened path is not a directory')
      const cwd = process.platform === 'linux' ? `/proc/self/fd/${file.fd}` : path
      const names = await readdir(cwd)
      if (process.platform === 'darwin') {
        const current = await stat(path, { bigint: true })
        if (info.dev !== current.dev || info.ino !== current.ino) {
          throw new Error('workspace directory changed while listing')
        }
      }
      return { cwd, names, file }
    } catch (error: unknown) {
      await file.close()
      throw error
    }
  }

  private async listWorkspaceFiles(id: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const rootPath = await this.workspaceFileRoot(id, signal)
    const located = await this.inspectWorkspaceFilePath(rootPath, path, signal, true)
    if (located.entry.type !== 'directory') throw new Error(`"${path}" is a ${located.entry.type}`)
    const fs = this.requireFileSystem()
    const directory = await this.workspaceDirectoryNames(located.root, located.target, signal)
    try {
      const children = []
      for (const name of directory.names.sort((left, right) => left.localeCompare(right))) {
        const target = await fs.resolve(name, { cwd: directory.cwd, signal })
        if (!fs.contains(located.root, target)) throw new Error(`"${name}" resolves outside the Session workspace`)
        const child = await fs.stat(target, signal)
        children.push({ name, type: child?.type ?? 'other', target, ...(child?.size === undefined ? {} : { size: child.size }) })
      }
      const entries = children.slice(0, this.config.workspaceFiles.maxEntries).map(workspaceFileEntry)
      return { path: workspacePathOf(fs, located.root, located.target), entries, truncated: children.length > entries.length }
    } finally {
      await directory.file?.close()
    }
  }

  private async statWorkspaceFile(id: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceFileStat> {
    const rootPath = await this.workspaceFileRoot(id, signal)
    const { root, target } = await this.locateWorkspaceFile(rootPath, path, signal)
    const { file, info } = await this.openWorkspaceFile(root, target, signal)
    try {
      if (!info.isFile()) throw new Error(`"${path}" is not a regular file`)
      return this.workspaceFileStat(target, info)
    } finally {
      await file.close()
    }
  }

  private async readWorkspaceFile(id: SessionId, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText> {
    const rootPath = await this.workspaceFileRoot(id, signal)
    const { root, target } = await this.locateWorkspaceFile(rootPath, path, signal)
    const { offset, limit } = this.resolveWorkspaceFileRange(range)
    const { file, info } = await this.openWorkspaceFile(root, target, signal)
    try {
      if (!info.isFile()) throw new Error(`"${path}" is not a regular file`)
      const page = await this.cutWorkspaceFilePage(file, offset, limit, signal, path)
      if (page.text.includes(String.fromCharCode(0))) throw new Error(`"${path}" is not text`)
      return { ...this.workspaceFileStat(target, info), offset, text: page.text, lines: page.lines, eof: page.eof }
    } finally {
      await file.close()
    }
  }

  private async readAllWorkspaceFileAtRoot(rootPath: string, path: string, signal: AbortSignal): Promise<WorkspaceFileBytes> {
    const { root, target } = await this.locateWorkspaceFile(rootPath, path, signal)
    const limit = this.config.workspaceFiles.maxFileBytes
    const { file, info } = await this.openWorkspaceFile(root, target, signal)
    try {
      if (!info.isFile()) throw new Error(`"${path}" is not a regular file`)
      if (info.size > BigInt(limit)) throw new Error(`"${path}" exceeds the ${limit} byte file cap`)
      const bytes = Buffer.allocUnsafe(limit + 1)
      let bytesRead = 0
      while (bytesRead < bytes.length) {
        signal.throwIfAborted()
        const result = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
        if (result.bytesRead === 0) break
        bytesRead += result.bytesRead
      }
      if (bytesRead > limit) throw new Error(`"${path}" exceeds the ${limit} byte file cap`)
      return { ...this.workspaceFileStat(target, info), offset: 0,
        data: bytes.subarray(0, bytesRead).toString('base64'), eof: true }
    } finally {
      await file.close()
    }
  }

  private async readAllWorkspaceFile(id: SessionId, path: string, signal: AbortSignal): Promise<WorkspaceFileBytes> {
    return this.readAllWorkspaceFileAtRoot(await this.workspaceFileRoot(id, signal), path, signal)
  }

  private async readRelatedWorkspaceFile(
    id: SessionId, path: string, relativePath: string, signal: AbortSignal,
  ): Promise<WorkspaceFileBytes> {
    const rootPath = await this.workspaceFileRoot(id, signal)
    const basePath = workspaceFilePath(path)
    const relatedPath = workspaceFilePath(relativePath)
    const fs = this.requireFileSystem()
    const { root, target } = await this.locateWorkspaceFile(rootPath, basePath, signal)
    const resolved = posix.normalize(posix.join(posix.dirname(workspacePathOf(fs, root, target)), relatedPath))
    return this.readAllWorkspaceFileAtRoot(rootPath, resolved, signal)
  }

  private async workspaceFileRequest(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    if (endpoint === 'session/files/list') {
      const request = nativeWorkspaceFileList.parse(payload)
      return this.listWorkspaceFiles(sessionId(request.sessionId), request.path, signal)
    }
    if (endpoint === 'session/files/stat') {
      const request = nativeWorkspaceFilePath.parse(payload)
      return this.statWorkspaceFile(sessionId(request.sessionId), request.path, signal)
    }
    if (endpoint === 'session/files/read') {
      const request = nativeWorkspaceFileRead.parse(payload)
      const range: WorkspaceFileRange = {
        ...request.range.offset === undefined ? {} : { offset: request.range.offset },
        ...request.range.limit === undefined ? {} : { limit: request.range.limit },
      }
      return this.readWorkspaceFile(sessionId(request.sessionId), request.path, range, signal)
    }
    if (endpoint === 'session/files/read-all') {
      const request = nativeWorkspaceFilePath.parse(payload)
      return this.readAllWorkspaceFile(sessionId(request.sessionId), request.path, signal)
    }
    if (endpoint === 'session/files/read-related') {
      const request = nativeWorkspaceFileRelated.parse(payload)
      return this.readRelatedWorkspaceFile(sessionId(request.sessionId), request.path, request.relativePath, signal)
    }
    throw new Error('native Session workspace file endpoint is unsupported')
  }

  /** Read only an image already recorded in this Program's workspace Session.
   * @param request - authenticated image lookup with Session and attachment identities.
   * @returns verified raster bytes; caller-supplied paths and references are never accepted.
   */
  async image(request: Request): Promise<Response> {
    return this.controls.run(request.signal, async (signal) => {
      const fields = z.strictObject({ sessionId: z.string().min(1).max(256), attachmentId: z.string().min(1) }).parse(await request.json())
      const id = sessionId(fields.sessionId)
      const attachments = this.selections.attachments
      if (attachments === undefined) return new Response(null, { status: 404 })
      const history = await readNativeSessionHistory(id, {
        active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
        label: 'native web image', onCleanupFailure: (error) => { this.controls.recordCleanupFailure(error) },
      }, signal)
      const workspace = this.workspaceForSession(id)
      if (history.header.cwd !== this.config.cwd && history.header.cwd !== workspace?.path) return new Response(null, { status: 403 })
      const image = history.events.flatMap(event => isAppendSurfaceEvent(event) ? deriveEventMessage(event)?.content ?? [] : [])
        .find(block => block.type === 'image' && block.attachment.attachmentId === fields.attachmentId)
      if (image?.type !== 'image') return new Response(null, { status: 404 })
      if (image.attachment.bytes > attachments.imageLimits.maxImageBytes) return new Response(null, { status: 413 })
      const stored = await attachments.readImage(image.attachment, signal)
      signal.throwIfAborted()
      return new Response(new Uint8Array(stored.data), { headers: {
        'Content-Type': stored.ref.mediaType, 'Content-Length': String(stored.data.byteLength), 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      } })
    })
  }

  private async settle(payload: unknown, signal: AbortSignal): Promise<unknown> {
    const fields = object(payload)
    for (const key of Object.keys(fields)) if (!['sessionId', 'admissionId'].includes(key)) throw new Error('native web session: unexpected settlement field')
    const id = sessionId(fields.sessionId)
    const turn = this.turns.get(id)
    if (turn === undefined || fields.admissionId !== turn.admissionId || turn.waiting) throw new Error('native web session: unavailable turn settlement')
    turn.waiting = true
    try { return await this.settlements.run(signal, async (accepted) => {
      const abort = (): void => { turn.controller.abort(accepted.reason) }
      accepted.addEventListener('abort', abort, { once: true })
      try { return await turn.done } finally {
        accepted.removeEventListener('abort', abort)
        if (this.turns.get(id) === turn) this.turns.delete(id)
      }
    }) } catch (error: unknown) {
      if (this.turns.get(id) === turn) turn.waiting = false
      throw error
    }
  }

  /** Handle an authenticated decoded Connection request.
   * @param endpoint - owned Session endpoint.
   * @param payload - unknown wire fields.
   * @param signal - real carrier request cancellation.
   * @returns success after durable settlement, or an explicit failure.
   */
  async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      if (endpoint.startsWith('feedback/')) {
        return { ok: true, value: await this.requests.run(signal, async (accepted) => {
          if (endpoint === 'feedback/session-record') {
            const service = this.selections.sessionFeedback
            if (service === undefined) throw new Error('native web session: Session feedback is unavailable')
            const request = nativeSessionFeedbackRecord.parse(payload)
            const id = SessionId(request.sessionId)
            const entry: FeedbackRecord = { ...(request.text === undefined ? {} : { text: request.text }),
              ...(request.category === undefined ? {} : { category: request.category }) }
            const route = await this.routeForSession(id, accepted)
            return this.executor.executeSessionOperation({ id, resume: true, route },
              owner => service.record(owner, entry, accepted), accepted)
          }
          const service = this.selections.messageFeedback
          if (service === undefined) throw new Error('native web session: message feedback is unavailable')
          if (endpoint === 'feedback/message-list') {
            const request = nativeMessageFeedbackList.parse(payload)
            return service.list({ sessionId: SessionId(request.sessionId) } satisfies MessageFeedbackListRequest, accepted)
          }
          if (endpoint === 'feedback/message-put') {
            const request = nativeMessageFeedbackPut.parse(payload)
            const typed: MessageFeedbackPutRequest = { sessionId: SessionId(request.sessionId), messageId: MessageId(request.messageId),
              rating: request.rating,
              ...(request.note === undefined ? {} : { note: request.note }),
              ...(request.category === undefined ? {} : { category: request.category }),
              ifVersion: request.ifVersion as MessageFeedbackPutRequest['ifVersion'] }
            return service.put(typed, accepted)
          }
          if (endpoint === 'feedback/message-delete') {
            const request = nativeMessageFeedbackDelete.parse(payload)
            const typed: MessageFeedbackDeleteRequest = { sessionId: SessionId(request.sessionId),
              messageId: MessageId(request.messageId), ifVersion: request.ifVersion as MessageFeedbackDeleteRequest['ifVersion'] }
            return service.delete(typed, accepted)
          }
          throw new Error(`native web session: unsupported feedback endpoint ${endpoint}`)
        }) }
      }
      if (endpoint.startsWith('agent-presets/')) {
        return { ok: true, value: await this.controls.run(signal, accepted => this.agentPresets(endpoint, payload, accepted)) }
      }
      if (endpoint.startsWith('settings/') || endpoint.startsWith('credentials/')) {
        return { ok: true, value: await this.controls.run(signal, accepted => this.configuration(endpoint, payload, accepted)) }
      }
      if (endpoint.startsWith('session/files/')) {
        return { ok: true, value: await this.requests.run(signal, accepted => this.workspaceFileRequest(endpoint, payload, accepted)) }
      }
      if (endpoint === 'session/start') return { ok: true, value: await this.start(payload, signal) }
      if (endpoint === 'session/await') return { ok: true, value: await this.settle(payload, signal) }
      if (endpoint === 'session/command') return { ok: true, value: await this.requests.run(signal, accepted => this.command(payload, accepted)) }
      if (endpoint === 'session/queue' || endpoint === 'session/steer') {
        const target = endpoint === 'session/queue' ? 'next-turn' : 'next-step'
        return { ok: true, value: await this.requests.run(signal, accepted => this.submit(payload, target, accepted)) }
      }
      if (endpoint === 'session/dequeue') {
        return { ok: true, value: await this.requests.run(signal, accepted => this.dequeue(payload, accepted)) }
      }
      if (endpoint === 'session/submission/edit') {
        return { ok: true, value: await this.requests.run(signal, accepted => this.editSubmission(payload, accepted)) }
      }
      if (endpoint === 'session/submission/promote') {
        return { ok: true, value: await this.requests.run(signal, accepted => this.promoteSubmission(payload, accepted)) }
      }
      if (endpoint === 'session/prompt') {
        const acknowledged = await this.start(payload, signal)
        return { ok: true, value: await this.settle({ sessionId: object(payload).sessionId, ...acknowledged }, signal) }
      }
      const admission = endpoint === 'session/cancel' || endpoint === 'session/status' || endpoint === 'session/answer-human'
        || endpoint === 'session/mode-controls' || endpoint === 'session/permission-controls' ? this.controls : this.requests
      return { ok: true, value: await admission.run(signal, async (accepted) => {
        const fields = object(payload)
        const allowed = ['session/list', 'session/create', 'session/model-controls', 'agent-presets/list'].includes(endpoint) ? []
          : endpoint === 'session/search' ? ['query', 'cursor']
            : endpoint === 'session/select-model' ? ['sessionId', 'selected', 'expectedRevision']
              : endpoint === 'session/select-preset' ? ['sessionId', 'preset', 'expectedRevision']
                : endpoint === 'session/select-plan-mode' ? ['sessionId', 'active']
                  : endpoint === 'session/select-permission' ? ['sessionId', 'preset']
                    : endpoint === 'session/rename-title' ? ['sessionId', 'title']
                      : endpoint === 'session/refresh-title' ? ['sessionId']
                        : endpoint === 'session/answer-human' ? ['sessionId', 'admissionId', 'id', 'answer']
                          : endpoint === 'session/cancel' ? ['sessionId', 'admissionId'] : ['sessionId']
        for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`native web session: unexpected field ${key}`)
        if (endpoint === 'agent-presets/list') return this.agentPresetsList()
        if (endpoint === 'session/model-controls') {
          const defaultSelection = this.selections.defaultModel?.() ?? {
            provider: this.config.provider, model: this.config.model,
            ...this.config.reasoningEffort === undefined ? {} : { reasoningEffort: this.config.reasoningEffort },
          }
          return {
            catalog: this.selections.directory === undefined ? null : await this.selections.directory.catalog(defaultSelection, accepted),
            canSelectModel: this.selections.models !== undefined,
            images: this.selections.directory === undefined ? undefined : this.selections.attachments?.imageLimits,
            presets: this.selections.presets?.list().map(({ id, name, description }) => ({ id, name,
              ...description === undefined ? {} : { description } })) ?? [],
          }
        }
        if (endpoint === 'session/mode-controls') {
          const id = sessionId(fields.sessionId)
          const route = await this.routeForSession(id, accepted)
          return await this.executor.executeSessionOperation({ id, resume: true, route }, async (owner, operationSignal) => {
            const events = await owner.readEvents({ signal: operationSignal })
            const facts = foldNativeAgentPresetFacts(owner.session.header, events)
            const presets = this.selections.presets?.list() ?? []
            const planMode = this.selections.planMode
            const planState = planMode?.state(owner)
            return {
              current: facts.preset,
              options: presets.map(({ id: presetId, name, description }) => ({ id: presetId, name,
                ...description === undefined ? {} : { description } })),
              revision: facts.revision,
              locked: facts.locked,
              canSelect: presets.length > 0 && !facts.locked,
              planMode: { available: planMode !== undefined, ...(planState === undefined
                ? { active: false }
                : { active: planState.active, ...planState.pending === undefined ? {} : { pending: planState.pending } }) },
            }
          }, accepted)
        }
        if (endpoint === 'session/permission-controls') {
          const id = sessionId(fields.sessionId)
          const route = await this.routeForSession(id, accepted)
          const permissions = this.selections.permissionPresets
          if (permissions === undefined) return { available: false, currentValue: null, options: [] }
          const controls = await this.executor.executeSessionOperation({ id, resume: true, route },
            (owner, operationSignal) => permissions.controls(owner, operationSignal), accepted)
          return { available: true, ...controls }
        }
        if (endpoint === 'session/select-plan-mode') {
          const id = sessionId(fields.sessionId)
          if (typeof fields.active !== 'boolean') throw new TypeError('native web session: plan mode must be boolean')
          const planMode = this.selections.planMode
          if (planMode === undefined) throw new Error('native web session: plan mode is unavailable')
          const route = await this.routeForSession(id, accepted)
          return await this.executor.executeSessionOperation({ id, resume: true, route },
            (owner, operationSignal) => planMode.select(owner, fields.active as boolean, operationSignal), accepted)
        }
        if (endpoint === 'session/select-permission') {
          const id = sessionId(fields.sessionId)
          if (typeof fields.preset !== 'string' || fields.preset.length === 0) throw new TypeError('native web session: invalid permission preset')
          const permissions = this.selections.permissionPresets
          if (permissions === undefined) throw new Error('native web session: permission presets are unavailable')
          const route = await this.routeForSession(id, accepted)
          await this.executor.executeSessionOperation({ id, resume: true, route },
            (owner, operationSignal) => permissions.apply(owner, fields.preset as string, operationSignal), accepted)
          return { changed: true }
        }
        if (endpoint === 'session/list') return this.listSessions(accepted)
        if (endpoint === 'session/search') return this.searchSessions(payload, accepted)
        if (endpoint === 'session/archive') {
          const registry = this.selections.workspaceRegistry
          if (registry === undefined) throw new Error('session archive is unsupported by this Host')
          const archiveId = sessionId(fields.sessionId)
          await registry.archiveSession(archiveId, accepted)
          accepted.throwIfAborted()
          this.publishListChange(archiveId)
          return { archived: true }
        }
        if (endpoint === 'session/create') {
          const id = SessionId(randomUUID())
          await this.executor.executeSessionOperation({ id, resume: false }, () => Promise.resolve(undefined), accepted)
          return { sessionId: id }
        }
        const id = sessionId(fields.sessionId)
        if (endpoint === 'session/rename-title' || endpoint === 'session/refresh-title') {
          const titles = this.selections.titles
          const route = await this.routeForSession(id, accepted)
          if (titles === undefined || !this.canManageTitle(id, route)) throw new Error('native web session: title changes are unavailable for this Session owner')
          if (endpoint === 'session/rename-title') {
            if (typeof fields.title !== 'string') throw new TypeError('native web session: title must be a string')
            await this.executor.executeSessionOperation({ id, resume: true, route },
              async (owner) => { await titles.rename(owner, fields.title as string) }, accepted)
          } else {
            await this.executor.executeSessionOperation({ id, resume: true, route },
              async (owner) => { await titles.refresh(owner, accepted) }, accepted)
          }
          return { changed: true }
        }
        if (endpoint === 'session/select-model' || endpoint === 'session/select-preset') {
          if (this.turns.has(id)) throw new Error('native web session: selection requires an idle Session')
          const route = await this.routeForSession(id, accepted)
          const expectedRevision = fields.expectedRevision === null ? null
            : typeof fields.expectedRevision === 'number' ? SessionSeq(fields.expectedRevision)
              : (() => { throw new TypeError('native web session: invalid selection revision') })()
          if (endpoint === 'session/select-model') {
            const selection = this.selections.models
            if (selection === undefined) throw new Error('native web session: model selection is unavailable')
            const parsed = modelSelectionInput.parse(fields.selected)
            const selected = { provider: parsed.provider, model: parsed.model,
              ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort } }
            await this.executor.executeSessionOperation({ id, resume: true, route },
              (owner, effective) => {
                const execution = selection.executionFor(owner.agent)
                const commit = (signal: AbortSignal) => selection.selection.select(owner, { selected, expectedRevision }, signal)
                // Cold operations hold maintenance already; retained owners need idle admission.
                return execution.status === 'maintenance' ? commit(effective)
                  : execution.runMaintenance(signal => commit(AbortSignal.any([effective, signal])))
              }, accepted)
          } else {
            if (this.selections.presets === undefined) throw new Error('native web session: preset selection is unavailable')
            if (typeof fields.preset !== 'string' || fields.preset.length === 0) throw new TypeError('native web session: invalid preset')
            await this.executor.rootExecution.selectPreset({ id, preset: fields.preset, expectedRevision,
              route }, accepted)
          }
          return { changed: true }
        }
        if (endpoint === 'session/history') return readNativeSessionHistory(id, {
          active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
          label: 'native web session', onCleanupFailure: (error) => { this.requests.recordCleanupFailure(error) },
        }, accepted)
        if (endpoint === 'session/commands') return this.commandCatalog(id, accepted)
        if (endpoint === 'session/submissions') return this.pendingSubmissions(id, accepted)
        if (endpoint === 'session/answer-human') {
          accepted.throwIfAborted()
          const turn = this.turns.get(id)
          const owner = this.active.owners().find(owner => owner.session.id === id && owner.invocation === 'root' && owner.writerAvailable)
          if (turn === undefined || turn.settled || turn.controller.signal.aborted || fields.admissionId !== turn.admissionId
            || owner === undefined || typeof fields.id !== 'string' || fields.id.length === 0) throw new Error('native Web human answer has no matching active root admission')
          this.executor.rootExecution.capture(owner)
          this.human.answer(brandString<NativeWebHumanId>(fields.id), owner.agent, fields.answer)
          return { answered: true }
        }
        if (endpoint === 'session/status') {
          const exists = this.turns.has(id) || await this.persistence.stat(id, { signal: accepted }) !== undefined
          return { status: this.turns.get(id)?.settled === false ? 'running' : exists ? 'idle' : 'unknown' }
        }
        if (endpoint === 'session/cancel') {
          const turn = this.turns.get(id)
          if (turn === undefined || turn.settled || fields.admissionId !== undefined && fields.admissionId !== turn.admissionId) {
            return { cancelled: false }
          }
          turn.controller.abort({ kind: 'user' })
          await turn.done
          return { cancelled: true }
        }
        throw new Error('native web session: unsupported endpoint')
      }) }
    } catch (error: unknown) {
      if (endpoint.startsWith('agent-presets/')) {
        if (error instanceof NativeAgentPresetError) {
          return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
        }
        return { ok: false, error: {
          code: endpoint === 'agent-presets/open-directory' ? 'native/agent-presets-directory' : 'native/agent-presets',
          message: endpoint === 'agent-presets/open-directory' ? 'Could not open Agent preset folder.' : 'Agent preset request failed.',
          details: {},
        } }
      }
      if (endpoint.startsWith('settings/') || endpoint.startsWith('credentials/')) {
        const settingsRequest = endpoint.startsWith('settings/')
        const conflict = settingsRequest ? settingsConflictDetails(error) : undefined
        return { ok: false, error: {
          code: conflict === undefined ? settingsRequest ? 'native/settings' : 'native/credentials' : 'native/settings-conflict',
          message: conflict === undefined ? settingsRequest ? 'Settings request failed.' : 'Credentials request failed.'
            : 'Settings changed since it was loaded.',
          details: conflict ?? {},
        } }
      }
      if (endpoint.startsWith('session/files/')) {
        return { ok: false, error: { code: 'native/session-files', message: 'Session workspace file request failed.', details: {} } }
      }
      if (endpoint === 'session/list' || endpoint === 'session/search' || endpoint === 'session/archive') {
        return { ok: false, error: { code: 'native/sessions', message: 'Session request failed.', details: {} } }
      }
      return { ok: false, error: { code: isImageAdmissionError(error) ? 'native/image' : 'native/session',
        message: errorMessage(error), details: submissionErrorDetails(endpoint, payload) } }
    }
  }

  private agentPresetsList(): {
    readonly default: string | null
    readonly presets: readonly NativeAgentPresetListRow[]
  } {
    const service = this.selections.presets
    if (service === undefined) return { default: null, presets: [] }
    const catalog = service.catalog()
    const standing = service.list()
    const folders = new Map(catalog.folders.map(folder => [folder.id, folder]))
    const registered = new Set(standing.map(preset => preset.id))
    const presets: NativeAgentPresetListRow[] = standing.map((preset) => {
      const folder = folders.get(preset.id)
      return { id: preset.id, name: preset.name,
        ...preset.description === undefined ? {} : { description: preset.description },
        source: folder?.trust ?? 'profile', status: 'ready' as const }
    })
    for (const folder of catalog.folders) {
      if (registered.has(folder.id)) continue
      presets.push({ id: folder.id, name: folder.name,
        ...folder.description === undefined ? {} : { description: folder.description },
        source: folder.trust, status: folder.status,
        ...folder.problem === undefined ? {} : { problem: folder.problem } })
    }
    return { default: catalog.default, presets }
  }

  private async agentPresets(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    if (endpoint === 'agent-presets/list') {
      nativeAgentPresetEmpty.parse(payload)
      return this.agentPresetsList()
    }
    if (endpoint === 'agent-presets/can-open-directory') {
      nativeAgentPresetEmpty.parse(payload)
      return canOpenNativePath()
    }
    if (endpoint === 'agent-presets/read') {
      const { id } = nativeAgentPresetId.parse(payload)
      return await this.agentPresetService(id).read(id)
    }
    if (endpoint === 'agent-presets/copy') {
      const { from, id, name } = nativeAgentPresetCopy.parse(payload)
      await this.agentPresetService(from).copy(from, id, name)
      this.notifyAgentPresetsUpdated()
      return { updated: true }
    }
    if (endpoint === 'agent-presets/delete') {
      const { id } = nativeAgentPresetId.parse(payload)
      await this.agentPresetService(id).delete(id)
      this.notifyAgentPresetsUpdated()
      return { updated: true }
    }
    if (endpoint === 'agent-presets/open-directory') {
      const { id } = nativeAgentPresetId.parse(payload)
      const path = this.agentPresetService(id).directory(id)
      if (!canOpenNativePath()) return { opened: false, path }
      await openNativePath(path, signal)
      return { opened: true }
    }
    throw new Error('agent-presets: unsupported endpoint')
  }

  private agentPresetService(id: string): NativeAgentPresetOperations {
    const service = this.selections.presets
    if (service === undefined) throw new NativeAgentPresetError('agent-preset/not-found',
      'this deployment composes no agent presets', { agentPreset: id, available: [] })
    return service
  }

  private async listSessions(signal: AbortSignal): Promise<NativeSessionListItem[]> {
    const stored = await this.persistence.list({ signal })
    signal.throwIfAborted()
    const projection = this.listProjectionContext()
    const sessions = new Map(stored.map(snapshot => [snapshot.header.id, snapshot.header]))
    for (const owner of projection.owners) sessions.set(owner.session.id, owner.session.header)
    const headers = [...sessions.values()].filter(header => !projection.archived.has(header.id))
    const result = new Map<SessionId, NativeSessionListItem>()
    let cursor = 0
    const readNext = async (): Promise<void> => {
      for (;;) {
        signal.throwIfAborted()
        const header = headers[cursor++]
        if (header === undefined) return
        const item = await this.projectSession(header.id, projection, signal)
        if (item !== undefined) result.set(header.id, item)
      }
    }
    const readers = Array.from({ length: Math.min(sessionTitleReadConcurrency, headers.length) }, () => readNext())
    const settlements = await Promise.allSettled(readers)
    signal.throwIfAborted()
    const unexpected = settlements.find(settlement => settlement.status === 'rejected')
    if (unexpected?.status === 'rejected') throw unexpected.reason
    return headers.map(header => result.get(header.id)).filter((item): item is NativeSessionListItem => item !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  private listProjectionContext(): NativeSessionListContext {
    const owners = this.active.owners()
    const ownerBySession = new Map(owners.map(owner => [owner.session.id, owner]))
    const runningSubagentCount = new Map<SessionId, number>()
    for (const owner of owners) {
      const active = this.selections.executionFor?.(owner.agent).status === 'running'
      if (!active) continue
      const parent = owner.session.header.parentSession
      if (parent !== undefined) runningSubagentCount.set(parent, (runningSubagentCount.get(parent) ?? 0) + 1)
    }
    const workspaceBySession = new Map<SessionId, WorkspaceId>()
    for (const workspace of this.selections.workspaceRegistry?.list() ?? []) {
      for (const id of workspace.sessionIds) workspaceBySession.set(id, workspace.id)
    }
    return {
      owners, ownerBySession, runningSubagentCount, workspaceBySession,
      archived: new Set(this.selections.workspaceRegistry?.archivedSessionIds ?? []),
    }
  }

  private async projectSession(id: SessionId, context: NativeSessionListContext,
    signal: AbortSignal): Promise<NativeSessionListItem | undefined> {
    if (context.archived.has(id)) return undefined
    const owner = context.ownerBySession.get(id)
    const header = owner?.session.header ?? (await this.persistence.stat(id, { signal }))?.header
    if (header === undefined) return undefined
    let history: Awaited<ReturnType<typeof readNativeSessionHistory>> | undefined
    try {
      history = await readNativeSessionHistory(id, {
        active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
        label: 'native web Session list', onCleanupFailure: (error) => { this.requests.recordCleanupFailure(error) },
      }, signal)
    } catch {
      if (signal.aborted) signal.throwIfAborted()
      // An unreadable history affects this row's projections, not the rest of the list.
    }
    const title = history === undefined ? undefined : foldSessionTitle(history.events)
    const turn = history === undefined ? undefined : latestTurnState(history.events)
    const currentOwner = this.active.owners().find(candidate => candidate.session.id === id)
    const execution = currentOwner === undefined ? undefined : this.selections.executionFor?.(currentOwner.agent)
    const running = execution?.status === 'running' || this.turns.get(id)?.settled === false
      || this.selections.executionFor === undefined && (turn?.running ?? false)
    const rootOwner = currentOwner?.invocation === 'root' ? currentOwner : undefined
    const pendingKind = rootOwner === undefined ? undefined : this.human.pendingKind(rootOwner.agent)
    const canManageTitle = !this.turns.has(id) && this.canManageTitle(id)
    const workspaceId = context.workspaceBySession.get(id)
    return {
      header: history?.header ?? header,
      titleProjection: history === undefined ? { status: 'unavailable' }
        : title === undefined ? { status: 'absent' } : { status: 'resolved', title: title.title },
      titleActions: { rename: canManageTitle, refresh: canManageTitle },
      updatedAt: history?.events.reduce((latest, event) => Math.max(latest, event.time), history.header.createdAt) ?? header.createdAt,
      blank: history === undefined ? false : !history.events.some(startsSessionConversation), running,
      completed: !running && (turn?.completed ?? false),
      runningSubagentCount: context.runningSubagentCount.get(id) ?? 0,
      ...(pendingKind === undefined ? {} : { pendingInteraction: { kind: pendingKind } }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
      hasActiveSchedule: false,
    }
  }

  private async searchSessions(payload: unknown, signal: AbortSignal): Promise<NativeSessionSearchPage> {
    const request = nativeSessionSearch.parse(payload)
    const start = request.cursor === undefined ? 0 : Number(request.cursor)
    if (!Number.isSafeInteger(start)) throw new TypeError('native Session search cursor is invalid')
    const stored = await this.persistence.list({ signal })
    const context = this.listProjectionContext()
    const sessions = new Map(stored.map(snapshot => [snapshot.header.id, snapshot.header]))
    for (const owner of context.owners) sessions.set(owner.session.id, owner.session.header)
    const headers = [...sessions.values()].filter(header => !context.archived.has(header.id))
    if (start > headers.length) throw new TypeError('native Session search cursor is outside the current list')
    const end = Math.min(headers.length, start + sessionSearchScanLimit)
    const normalized = request.query.toLowerCase()
    const items: NativeSessionSearchItem[] = []
    let next = end
    for (let index = start; index < end; index++) {
      signal.throwIfAborted()
      const header = headers[index]
      if (header === undefined) break
      const history = await readNativeSessionHistory(header.id, {
        active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
        label: 'native web Session search', onCleanupFailure: (error) => { this.requests.recordCleanupFailure(error) },
      }, signal)
      const title = foldSessionTitle(history.events)?.title ?? ''
      const titleMatched = title.toLowerCase().includes(normalized)
      const match = titleMatched ? undefined : searchSnippet(history.events, normalized)
      if (titleMatched || match !== undefined) {
        const workspaceId = context.workspaceBySession.get(header.id)
        items.push({ sessionId: header.id, title,
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
          ...(match === undefined ? {} : { snippet: match }),
        })
        if (items.length === sessionSearchResultLimit) { next = index + 1; break }
      }
    }
    return { items, ...(next < headers.length ? { cursor: String(next) } : {}) }
  }

  /** Whether the selected root route can operate on this stored or attached Session. */
  private canManageTitle(id: SessionId, route?: NativeRootRouteId): boolean {
    if (this.selections.titles === undefined) return false
    const roots = this.executor.rootExecution
    const owner = this.active.owners().find(candidate => candidate.session.id === id && candidate.invocation === 'root')
    const workspace = this.workspaceForSession(id)
    const owners = this.active.owners().filter(owner => owner.session.id === id)
    if (owners.some(owner => owner.invocation === 'delegated')) return false
    if (owner === undefined && workspace !== undefined && route === undefined) return true
    try {
      const selectedRoute = route
        ?? (owner === undefined ? workspace === undefined
          ? this.titleRoute()
          : roots.workspaceRoutes().find(candidate => candidate.workspaceId === workspace.id)?.id
          : roots.capture(owner).id)
      if (selectedRoute === undefined) return false
      roots.resolve(selectedRoute)
      const root = owners.find(candidate => candidate.invocation === 'root')
      return root === undefined || root.writerAvailable && roots.capture(root).id === selectedRoute
    } catch {
      return false
    }
  }

  private async routeForSession(id: SessionId, signal: AbortSignal): Promise<NativeRootRouteId> {
    const owner = this.active.owners().find(candidate => candidate.session.id === id && candidate.invocation === 'root')
    if (owner !== undefined) return this.executor.rootExecution.capture(owner).id
    const workspace = this.workspaceForSession(id)
    if (workspace === undefined) return this.titleRoute()
    const route = this.executor.rootExecution.workspaceRoutes().find(candidate => candidate.workspaceId === workspace.id)
    if (route !== undefined) return route.id
    return (await this.executor.rootExecution.selectWorkspace({ baseRoute: this.titleRoute(), workspaceId: workspace.id }, signal)).id
  }

  private workspaceForSession(id: SessionId) {
    return this.selections.workspaceRegistry?.list().find(workspace => workspace.sessionIds.includes(id))
  }

  private titleRoute(): NativeRootRouteId {
    return this.config.rootRouteId ?? brandString<NativeRootRouteId>('root')
  }

  private async configuration(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    if (endpoint === 'settings/describe') {
      if (Object.keys(object(payload)).length !== 0) throw new TypeError('native settings: describe takes no fields')
      const settings = this.selections.settings
      return {
        hasDocument: settings?.documentPath !== undefined,
        namespaces: settings === undefined ? [] : settings.describe(),
        limits: {
          maxCredentialRefsPerRead: this.config.maxCredentialRefsPerRead,
          maxSettingsOperations: this.config.maxSettingsOperations,
        },
      }
    }
    if (endpoint === 'settings/open-document') {
      if (Object.keys(object(payload)).length !== 0) throw new TypeError('native settings: open-document takes no fields')
      const path = this.settings().documentPath
      if (path === undefined) throw new Error('native settings: no local settings document')
      await openNativeTextFile(path, signal)
      return { opened: true }
    }
    if (endpoint === 'settings/mutate') {
      const request = nativeSettingsMutation.parse(payload)
      if (request.ops.length > this.config.maxSettingsOperations) {
        throw new TypeError('native settings: mutation exceeds configured operation limit')
      }
      const settings = this.settings()
      if (!settings.describe().some(row => row.namespace === request.ns)) {
        throw new Error(`native settings: namespace "${request.ns}" is not exposed to the native page`)
      }
      await settings.mutate(request.ns, request.ops as NativeSettingsPathOp[], request.expectedRevision)
      signal.throwIfAborted()
      const next = settings.describe().find(row => row.namespace === request.ns)
      if (next === undefined) throw new Error(`native settings: namespace "${request.ns}" was disposed after the write`)
      return next
    }
    if (endpoint === 'credentials/describe') {
      const { refs } = credentialRefsRequest(this.config.maxCredentialRefsPerRead).parse(payload)
      const allowed = this.acceptedCredentialRefs()
      for (const ref of refs) if (!allowed.has(ref)) {
        throw new Error(`native credentials: reference "${ref}" is not declared by an active settings schema`)
      }
      const credentials = this.credentials()
      const entries = await Promise.all([...new Set(refs)].map(async ref =>
        [ref, projectCredentialInfo(await credentials.describe(credentialRef(ref)))] as const))
      signal.throwIfAborted()
      return Object.fromEntries(entries)
    }
    if (endpoint === 'credentials/set') {
      const { ref, value } = nativeCredentialSet.parse(payload)
      await this.credentials().set(credentialRef(this.acceptedCredentialRef(ref)), value)
      signal.throwIfAborted()
      return { updated: true }
    }
    if (endpoint === 'credentials/unset') {
      const { ref } = nativeCredentialUnset.parse(payload)
      await this.credentials().unset(credentialRef(this.acceptedCredentialRef(ref)))
      signal.throwIfAborted()
      return { updated: true }
    }
    throw new Error(`native web session: unsupported endpoint "${endpoint}"`)
  }

  private settings(): NativeSettingsService {
    if (this.selections.settings === undefined) throw new Error('native settings: this composition has no settings service')
    return this.selections.settings
  }

  private credentials(): NativeCredentials {
    if (this.selections.credentials === undefined) throw new Error('native credentials: this composition has no credential provider')
    return this.selections.credentials
  }

  private acceptedCredentialRefs(): Set<string> {
    return new Set(this.settings().describe().flatMap(row => row.credentialRefs))
  }

  private acceptedCredentialRef(ref: string): string {
    if (!this.acceptedCredentialRefs().has(ref)) {
      throw new Error(`native credentials: reference "${ref}" is not declared by an active settings schema`)
    }
    return ref
  }

  /** Close requests, dispose the Session executor, and drain title follow tasks.
   * @returns completion including accepted request and executor cleanup failures.
   */
  async close(): Promise<void> {
    this.human.close()
    this.shutdown.abort(new Error('native Session follow: disposed'))
    for (const stop of this.listFeeds.values()) stop()
    await Promise.all([this.removeAttached(), this.removeDetached()])
    for (const remove of this.ownerEvents.values()) remove()
    this.ownerEvents.clear()
    const results = await Promise.allSettled([this.requests.close(), this.controls.close(), this.settlements.close()])
    const executor = await Promise.allSettled([this.executor.dispose()])
    while (this.followTasks.size > 0) await Promise.allSettled([...this.followTasks])
    this.turns.clear()
    const errors = [...results, ...executor].flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native web session: request and executor cleanup failed')
  }
}

/** Project Host installation states for the Plugins page without configuration or failure messages. */
function pluginInventory(inventory: NativePluginInventory | undefined, payload: unknown): ConnectionRpcResult<unknown> {
  try {
    if (Object.keys(object(payload)).length !== 0) throw new TypeError('plugins/inventory takes no fields')
    const entries = (inventory?.list() ?? []).map(({ id, name, scope, state, failure }) => ({
      id, name, scope, state, ...failure === undefined ? {} : { failure },
    }))
    return { ok: true, value: { entries } }
  } catch {
    return { ok: false, error: { code: 'native/plugin-inventory', message: 'Plugin inventory request failed.', details: {} } }
  }
}

/** Native Host Session installer; the Web Host remains the selected application. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-web-session-controller', targets: ['host'],
  requires: ['hostConnection', 'fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions', 'workspaceRegistry'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'tmuxContext', 'modelSelection', 'modelDirectory', 'modelSettings', 'agentPresets', 'planMode', 'permissionPresets', 'agentInstructions', 'userQuestions', 'attachments', 'settings', 'credentials', 'authorization', 'accounts', 'sessionTitles', 'commands', 'pluginInventory', 'requestContexts', 'sessionFeedback', 'messageFeedback'],
  provides: ['nativeWebSession', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeWebSessionConfig(input)
    return (context) => {
      const { maxPendingRequests: _pending, maxHistoryEvents: _history, maxPromptChars: _prompt,
        maxFollowBufferBytes: _buffer, maxFollowers: _followers, maxPendingHumanRequests: _human,
        maxCredentialRefsPerRead: _credentialRefs, maxSettingsOperations: _settingsOperations,
        authorizationKeys: _authorizationKeys, workspaceFiles: _workspaceFiles, ...turn } = config
      const workspaceRegistry = context.require('workspaceRegistry')
      const settings = context.optional('settings')
      const defaultSettings = settings?.register<'agent-default-model', NativeDefaultModelSettings>(
        'agent-default-model', {}, resolveDefaultModelSettings,
      )
      if (defaultSettings !== undefined) context.own(() => { defaultSettings.dispose() })
      const readDefaultModel = () => defaultModelSelection(defaultSettings)
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
        defaultModelSelection: readDefaultModel, workspaceRegistry,
      })
      const models = context.optional('modelSelection')
      const modelSettings = context.optional('modelSettings')
      const selectedAuthorization = context.optional('authorization')
      const selectedCredentials = context.optional('credentials')
      const providers = selectedAuthorization === undefined || selectedCredentials === undefined
        ? undefined : { authorization: selectedAuthorization, credentials: selectedCredentials }
      const authorization = new NativeWebAuthorization(providers, config.authorizationKeys.map(parseCredentialKey), context.signal)
      const accounts = new NativeWebAccounts(context.optional('accounts'), config.authorizationKeys.map(parseCredentialKey))
      const modelEndpoints = new NativeWebModels(context.optional('modelDirectory'), context.optional('modelSettings'), context.signal)
      context.own(() => modelEndpoints.close())
      const settingsEvents = new NativeWebSettingsEvents(context)
      context.own(() => settingsEvents.close())
      const workspaceService = new NativeWebWorkspaceService(context, workspaceRegistry, executor,
        context.require('sessionPersistence'), context.require('activeSessions'),
        config.rootRouteId ?? brandString<NativeRootRouteId>('root'), config.maxHistoryEvents, config.maxFollowers)
      context.own(() => workspaceService.close())
      const directoryService = new NativeWebDirectoryService(context.signal)
      let defaultModelInitialization: Promise<void> | undefined
      const initializeDefaultModel = (): Promise<void> => {
        if (defaultSettings === undefined || modelSettings === undefined) return Promise.resolve()
        if (defaultModelInitialization !== undefined) return defaultModelInitialization
        const operation = (async () => {
          if (readDefaultModel() !== undefined) return
          const selection = await modelSettings.firstAvailableAccountModel(context.signal)
          if (selection === undefined || readDefaultModel() !== undefined) return
          await defaultSettings.replace(selection, defaultSettings.revision)
        })()
        defaultModelInitialization = operation.finally(() => { defaultModelInitialization = undefined })
        return defaultModelInitialization
      }
      context.on('authorization/settled', async (key, settlement) => {
        if (settlement !== 'authorized' || key !== CODEX_ACCOUNT_KEY && key !== DEEPSEEK_ACCOUNT_KEY) return
        await initializeDefaultModel()
      })
      const service = new NativeWebSessionService(executor, context.require('sessionPersistence'), context.require('activeSessions'), config, context.signal,
        { directory: context.optional('modelDirectory'), defaultModel: readDefaultModel,
          presets: context.optional('agentPresets'), attachments: context.optional('attachments'),
          planMode: context.optional('planMode'), permissionPresets: context.optional('permissionPresets'),
          settings: context.optional('settings'), credentials: context.optional('credentials'), titles: context.optional('sessionTitles'),
          commands: context.optional('commands'), commandScope: context.scope,
          sessionFeedback: context.optional('sessionFeedback'), messageFeedback: context.optional('messageFeedback'),
          workspaceRegistry,
          executionFor: agent => context.require('agents').execution(agent),
          models: models === undefined ? undefined : { selection: models, executionFor: agent => context.require('agents').execution(agent) } },
        () => { settingsEvents.agentPresetsUpdated() }, context.require('fs'))
      context.on('fs/observed', (target, observation) => { service.observeWorkspaceFile(target, observation) })
      service.bindHuman(context, context.optional('approval'), context.optional('userQuestions'))
      context.own(() => service.close())
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => endpoints.has(endpoint),
        (endpoint, payload, signal) => endpoint.startsWith('authorization/')
          ? authorization.handle(endpoint, payload)
          : endpoint.startsWith('accounts/') ? accounts.handle(endpoint, payload, signal)
            : endpoint.startsWith('models/') ? modelEndpoints.handle(endpoint, payload, signal)
              : endpoint.startsWith('workspaces/') ? workspaceService.handle(endpoint, payload, signal)
                : endpoint.startsWith('directories/') ? directoryService.handle(endpoint, payload, signal)
                  : endpoint === 'plugins/inventory' ? Promise.resolve(pluginInventory(context.optional('pluginInventory'), payload))
                    : service.handle(endpoint, payload, signal)))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/workspaces/follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => workspaceService.follow(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.follow(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/list-follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.followList(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/files-follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.followWorkspaceFiles(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/image', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.image(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/authorization', methods: ['POST'], requestBody: 'buffered',
        fetch: request => authorization.frames(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/settings-events', methods: ['POST'], requestBody: 'buffered',
        fetch: request => settingsEvents.stream(request) }))
      context.provide('nativeWebSession', service)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}
