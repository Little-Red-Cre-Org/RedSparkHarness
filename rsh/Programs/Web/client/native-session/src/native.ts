/** Browser Session Consumer over the selected native Connection transport. */
import { nativeWebHumanSchema, type NativeWebHumanAnswer, type NativeWebHumanId, type NativeWebHumanPrompt } from './human.ts'
export type { NativeWebHumanAnswer, NativeWebHumanId, NativeWebHumanPrompt } from './human.ts'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-connection/native'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { SessionId, SessionHeader, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import { parseSessionEvent } from '@deepseek-ai/dsh-session/event-validation'
import { nativeModelControlsSchema, type NativeModelControls } from './model-controls.ts'
import type { NativeModelSelectionRequest } from '@deepseek-ai/dsh-native-model-selection/types'
import type { NativeAgentPresetSelectionRequest } from '@deepseek-ai/dsh-agent-presets/selection'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/facts'
import type { AuthorizationFrame, AuthorizationMethod } from '@deepseek-ai/dsh-authorization/types'
import { createNativeWorkspaceClients } from './workspaces.ts'
import { NativeSessionRpcError } from './rpc-error.ts'
export { NativeSessionRpcError } from './rpc-error.ts'
export type {
  NativeDirectoryEntry, NativeDirectoryListing, NativeDirectoryPickerClient,
  NativeWorkspace, NativeWorkspaceBaseline, NativeWorkspaceClient, NativeWorkspaceFrame,
} from './workspaces.ts'
export type { NativeModelControls } from './model-controls.ts'

type NativeSessionAdmissionId = Branded<'native-web-admission'>

/** Raster upload bytes encoded by the browser; the Host admits their durable references. */
export interface NativeImageUpload {
  readonly mediaType: NativeSessionImage['mediaType']
  readonly data: string
  readonly name?: string
}

/** Original durable image identity from the Session message protocol. */
export type NativeSessionImage = Extract<SessionEventMap['user/message']['content'][number], { type: 'image' }>['attachment']

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Native Session RPC Consumer selected by the browser composition. */
    clientNativeSession: NativeSessionClient
    /** Read-only Native schedule catalog selected by the browser composition. */
    clientNativeSchedule: NativeScheduleClient
    /** Native Workspace RPC Consumer selected by the browser composition. */
    clientNativeWorkspace: import('./workspaces.ts').NativeWorkspaceClient
    /** Native directory chooser and browser selected by the browser composition. */
    clientNativeDirectoryPicker: import('./workspaces.ts').NativeDirectoryPickerClient
  }
}

import type { NativeSessionFollowFrame } from './follow-types.ts'
export type { NativeSessionFollowFrame } from './follow-types.ts'
import type { NativeSessionListFrame, NativeSessionListItem, NativeSessionSearchPage, NativeSessionTitleProjection } from './list-types.ts'
export type { NativeSessionListFrame, NativeSessionListItem, NativeSessionSearchItem, NativeSessionSearchPage, NativeSessionTitleProjection } from './list-types.ts'
import type { NativeScheduleFrame, NativeScheduledJob } from './schedule-types.ts'
export type { NativeScheduleFrame, NativeScheduledJob } from './schedule-types.ts'

/** Browser parser capacity, resolved by the native Client profile. */
export interface NativeSessionClientConfig {
  readonly maxFollowBufferChars: number
}

/** Read-only browser access to persisted scheduled work. */
export interface NativeScheduleClient {
  /**
   * List active, paused, and failed scheduled plans.
   * @param signal - caller cancellation.
   * @returns safe plan metadata without prompts or captured execution configuration.
   */
  list(signal?: AbortSignal): Promise<readonly NativeScheduledJob[]>
  /**
   * Follow one complete baseline and subsequent schedule changes.
   * @param signal - caller cancellation; abort closes the stream cleanly.
   * @returns baseline, upsert, and remove frames from the Host.
   */
  follow(signal: AbortSignal): AsyncIterable<NativeScheduleFrame>
}

/** Redacted Settings registration returned by the native Host configuration RPC. */
export interface NativeSettingsDescriptor {
  /** Owning Settings namespace. */
  readonly namespace: string
  /** Serialized owner schema. */
  readonly schema: unknown
  /** Resolved values with schema-declared secret paths omitted. */
  readonly value: Readonly<Record<string, unknown>>
  /** Redacted composition base. */
  readonly base: Readonly<Record<string, unknown>>
  /** Redacted stored user overrides. */
  readonly user: Readonly<Record<string, unknown>>
  /** Owner-declared effect timing. */
  readonly applies: 'live' | 'restart'
  /** Hidden secret locations and their current presence. */
  readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[]
  /** Current values carrying the `credential-ref` schema role. */
  readonly credentialRefs: readonly string[]
  /** Revision expected by the next write. */
  readonly revision: number
}

/** One Host installation and its lifecycle state; configuration and failure messages stay on the Host. */
export interface NativePluginInventoryEntry {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly state: 'planned' | 'activating' | 'ready' | 'draining' | 'failed' | 'disposed'
  /** Which lifecycle step failed, when the installation failed. */
  readonly failure?: 'activation' | 'cleanup'
}

/** Installations of the running Host in dependency order. */
export interface NativePluginInventory {
  readonly entries: readonly NativePluginInventoryEntry[]
}

/** Settings views and the Host-validated request budgets used by the Client. */
export interface NativeSettingsDescription {
  /** Whether the Host has a local settings document `settingsOpenDocument` can open. */
  readonly hasDocument: boolean
  /** Registered, redacted Settings namespaces. */
  readonly namespaces: readonly NativeSettingsDescriptor[]
  /** Per-request limits enforced by the selected Host. */
  readonly limits: {
    /** Maximum credential refs accepted by one read request. */
    readonly maxCredentialRefsPerRead: number
    /** Maximum operations accepted by one atomic Settings mutation. */
    readonly maxSettingsOperations: number
  }
}

/** File-backed and profile-installed preset choices advertised by the Host. */
export interface NativeAgentPresetList {
  /** Fresh-session default, or null when no preset Registry is installed. */
  readonly default: string | null
  /** Ready standing choices and file folders that need attention or installation. */
  readonly presets: readonly {
    /** Preset id. */
    readonly id: string
    /** Display name. */
    readonly name: string
    /** Optional display description. */
    readonly description?: string
    /** Folder trust, or `profile` for a profile-only composition. */
    readonly source: 'profile' | 'system' | 'user'
    /** Native folder or standing composition status. */
    readonly status: 'ready' | 'needs-migration' | 'invalid'
    /** Short reason when a folder cannot be installed. */
    readonly problem?: string
  }[]
}

/** Native preset metadata and optional raw composition file returned by the Host. */
export interface NativeAgentPresetDocument {
  /** Preset id. */
  readonly id: string
  /** Profile-only, shipped or user-authored source. */
  readonly source: 'profile' | 'system' | 'user'
  /** Composition file status. */
  readonly status: 'ready' | 'needs-migration' | 'invalid'
  /** Display name. */
  readonly name: string
  /** Optional display description. */
  readonly description?: string
  /** Raw `agent.native.json` text when the folder has a composition file. */
  readonly content?: string
  /** Short reason when the folder cannot be installed. */
  readonly problem?: string
}

/** One path-addressed Settings edit. */
export type NativeSettingsPathOp =
  /** Set one JSON value at the path. */
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  /** Remove the path from the user layer. */
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Safe credential presence facts; the credential value is never returned. */
export interface NativeCredentialInfo {
  /** Whether a credential provider resolves a value for this ref. */
  readonly configured: boolean
  /** Provider source label, when configured. */
  readonly source?: string
  /** Whether the current provider accepts writes. */
  readonly writable: boolean
}

/** Safe metadata for one Host-registered authorization flow. */
export interface NativeAuthorizationEntry {
  /** Allowlisted credential record key. */
  readonly key: string
  /** User-facing flow name. */
  readonly label: string
  /** Flow methods in preference order. */
  readonly methods: readonly AuthorizationMethod[]
  /** Whether the credential record is configured. */
  readonly configured: boolean
  /** Whether the credential provider accepts writes. */
  readonly writable: boolean
  /** Current attempt identity, when the flow is running. */
  readonly attemptId?: string
}

/** Safe account summary returned by the selected Host. */
export interface NativeAccountSummary {
  readonly key: string
  readonly provider: 'openai-codex' | 'deepseek-account'
  readonly status: 'signed-out' | 'ready' | 'unavailable'
  readonly identity: {
    readonly email: string | null
    readonly contact: string | null
    readonly name: string | null
    readonly avatarUrl: string | null
  }
  readonly plan: string | null
}

/** Provider route advertised by the selected Native model adapter. */
export interface NativeLlmProviderInfo {
  readonly id: string
  readonly name: string
}

/** Configurable provider entry and optional diagnostic from the selected adapter. */
export interface NativeConfigurableModelProvider {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly declared?: boolean
  readonly error?: string
}

/** One draft endpoint interrogation; apiKey is used only for this request. */
export interface NativeModelDiscoveryRequest {
  readonly provider?: string
  readonly baseURL?: string
  readonly api?: string
  readonly apiKey?: string
}

/** Candidate model metadata returned by endpoint discovery. */
export interface NativeDiscoveredModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** Notification-only event that tells Settings pages which view to reread. */
export type NativeSettingsEvent =
  | { readonly type: 'settings/document-updated'; readonly namespace: string; readonly revision: number }
  | { readonly type: 'credentials/reference-updated'; readonly ref: string }
  | { readonly type: 'llm/adapters-updated' }
  | { readonly type: 'agent-presets/updated' }
  | { readonly type: 'accounts/changed'; readonly key: string }

/** Provider-reported quota window, with reset time in Unix seconds. */
export interface NativeQuotaWindow {
  readonly usedPercent: number
  readonly windowSeconds: number | null
  readonly resetsAt: number | null
}

/** Provider-reported quota group. */
export interface NativeQuota {
  readonly name: string
  readonly primary: NativeQuotaWindow | null
  readonly secondary: NativeQuotaWindow | null
}

/** Account usage, including the absent-provider response used by this RPC. */
export type NativeAccountUsage =
  | {
    readonly status: 'ready'
    readonly email: string | null
    readonly plan: string | null
    readonly quotas: readonly NativeQuota[]
    readonly credits: { readonly unlimited: boolean; readonly balance: string | null } | null
  }
  | { readonly status: 'signed-out' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'unsupported' }

/** Account wallet balance, retained as a decimal string. */
export interface NativeAccountWallet {
  readonly currency: 'CNY' | 'USD'
  readonly balance: string
}

/** Account balance or the account operation's status. */
export type NativeAccountBalance =
  | { readonly status: 'ready'; readonly wallets: readonly NativeAccountWallet[]; readonly bonusWallets: readonly NativeAccountWallet[] }
  | { readonly status: 'signed-out' | 'failed' | 'unsupported' }

/** Lifecycle results shared by the native browser composition. */
export interface NativeSessionClient {
  /** List native preset folders and installed standing compositions.
   * @param signal - caller cancellation.
   * @returns current preset catalog; empty with a null default when no Registry is installed.
   */
  agentPresetsList(signal?: AbortSignal): Promise<NativeAgentPresetList>
  /** Read one preset's metadata and raw native composition file.
   * @param id - preset id.
   * @param signal - caller cancellation.
   * @returns Host-owned preset details; profile-only compositions have no file content.
   */
  agentPresetRead(id: string, signal?: AbortSignal): Promise<NativeAgentPresetDocument>
  /** Copy one file-backed preset into the Host's user preset directory.
   * @param from - source preset id.
   * @param id - new directory id.
   * @param name - optional display name.
   * @param signal - caller cancellation.
   * @returns completion after the Host writes the copy.
   */
  agentPresetCopy(
    from: string, id: string, name?: string, signal?: AbortSignal,
  ): Promise<void>
  /** Delete one user-authored preset.
   * @param id - preset id.
   * @param signal - caller cancellation.
   * @returns completion after the Host removes its directory.
   */
  agentPresetDelete(id: string, signal?: AbortSignal): Promise<void>
  /** Report whether the Host can open a preset folder in its file manager.
   * @param signal - caller cancellation.
   * @returns Host-local opener availability.
   */
  agentPresetsCanOpenDirectory(signal?: AbortSignal): Promise<boolean>
  /** Open one user preset folder or return its Host-local path.
   * @param id - user preset id.
   * @param signal - caller cancellation.
   * @returns whether the Host opened the folder, or its path for display.
   */
  agentPresetOpenDirectory(
    id: string, signal?: AbortSignal,
  ): Promise<{ readonly opened: true } | { readonly opened: false; readonly path: string }>
  /** Describe schema-published Settings namespaces and Host request budgets.
   * @param signal - caller cancellation.
   * @returns the registered views and validated limits for bounded reads and atomic writes.
   */
  settingsDescribe(signal?: AbortSignal): Promise<NativeSettingsDescription>
  /**
   * Read the running Host's plugin installations for the Plugins page.
   * @param signal - caller cancellation.
   * @returns installation names, scopes and lifecycle states.
   */
  pluginInventoryList(signal?: AbortSignal): Promise<NativePluginInventory>
  /**
   * Read every routable model for model pickers outside a Session.
   * @param signal - caller cancellation.
   * @returns the Host catalog, or null when no model directory is installed.
   */
  modelCatalog(signal?: AbortSignal): Promise<NativeModelControls['catalog']>
  /**
   * Open the Host's local settings document in its text editor.
   * @param signal - caller cancellation.
   * @returns confirmation once the editor command was accepted.
   */
  settingsOpenDocument(signal?: AbortSignal): Promise<{ readonly opened: true }>
  /** Apply Settings path edits against the revision the page displayed.
   * @param namespace - registered Settings namespace.
   * @param ops - path-addressed user-layer edits.
   * @param expectedRevision - observed revision; stale writes reject with `native/settings-conflict`.
   * @param signal - caller cancellation.
   * @returns the actual redacted view after the write.
   */
  settingsMutate(
    namespace: string, ops: readonly NativeSettingsPathOp[], expectedRevision: number, signal?: AbortSignal,
  ): Promise<NativeSettingsDescriptor>
  /** List live provider routes from the selected Host model directory.
   * @param signal - caller cancellation.
   * @returns provider ids and display names; empty when the Host has no model directory.
   */
  modelsListProviders(signal?: AbortSignal): Promise<readonly NativeLlmProviderInfo[]>
  /** List configurable provider routes and catalog diagnostics from the selected Host.
   * @param signal - caller cancellation.
   * @returns configurable provider entries; empty when the Host has no model settings provider.
   */
  modelsListConfigurableProviders(signal?: AbortSignal): Promise<readonly NativeConfigurableModelProvider[]>
  /** Discover candidate models from the current Settings draft.
   * @param settingsNs - Settings namespace that owns discovery.
   * @param request - endpoint and optional one-request API key.
   * @param signal - caller cancellation.
   * @returns deduplicated candidate metadata projected for the Settings page.
   */
  modelsDiscover(
    settingsNs: string, request: NativeModelDiscoveryRequest, signal?: AbortSignal,
  ): Promise<readonly NativeDiscoveredModel[]>
  /** Watch Settings, credential-reference and model-adapter invalidations.
   * @param signal - caller cancellation; abort closes the stream cleanly.
   * @returns notification frames without Settings or credential values.
   */
  settingsEvents(signal: AbortSignal): AsyncIterable<NativeSettingsEvent>
  /** Describe credential refs declared by the active Settings schemas.
   * @param refs - schema-discovered reference names.
   * @param signal - caller cancellation.
   * @returns presence and source facts without values.
   */
  credentialsDescribe(refs: readonly string[], signal?: AbortSignal): Promise<Readonly<Record<string, NativeCredentialInfo>>>
  /** Store one secret value for a schema-declared credential reference.
   * @param ref - discovered credential reference.
   * @param value - write-only credential value.
   * @param signal - caller cancellation.
   * @returns completion acknowledgement.
   */
  credentialsSet(ref: string, value: string, signal?: AbortSignal): Promise<void>
  /** Remove one schema-declared credential reference.
   * @param ref - discovered credential reference.
   * @param signal - caller cancellation.
   * @returns completion acknowledgement.
   */
  credentialsUnset(ref: string, signal?: AbortSignal): Promise<void>
  /** List allowlisted authorization flows without reading credential records.
   * @param signal - caller cancellation.
   * @returns safe flow labels, methods and credential presence facts.
   */
  authorizationList(signal?: AbortSignal): Promise<readonly NativeAuthorizationEntry[]>
  /** List supported Host accounts without returning credential values.
   * @param signal - caller cancellation.
   * @returns safe account summaries; empty when the Host has no account provider.
   */
  accountsList(signal?: AbortSignal): Promise<readonly NativeAccountSummary[]>
  /** Read provider-reported usage for one configured account key.
   * @param key - allowlisted credential record key.
   * @param signal - caller cancellation.
   * @returns usage status and quota metadata without tokens.
   */
  accountsUsage(key: string, signal?: AbortSignal): Promise<NativeAccountUsage>
  /** Read account balance for one configured account key.
   * @param key - allowlisted credential record key.
   * @param signal - caller cancellation.
   * @returns balance status; unsupported when no provider is installed.
   */
  accountsBalance(key: string, signal?: AbortSignal): Promise<NativeAccountBalance>
  /** Sign out of one configured account key.
   * @param key - allowlisted credential record key.
   * @param signal - caller cancellation.
   * @returns completion after the Host deletes its account credential record.
   */
  accountsSignOut(key: string, signal?: AbortSignal): Promise<void>
  /** Start one allowlisted flow independently of the caller's page lifetime.
   * @param key - allowlisted credential key.
   * @param method - optional flow method id.
   * @param signal - caller cancellation while the Host admits the attempt.
   * @returns the current attempt identity.
   */
  authorizationBegin(key: string, method?: string, signal?: AbortSignal): Promise<{ readonly attemptId: string }>
  /** Watch replayable authorization frames until this iteration ends.
   * @param key - allowlisted credential key.
   * @param attemptId - current attempt identity.
   * @param signal - ends this frame iteration without cancelling the attempt.
   * @returns secret-free frames from the beginning of the attempt.
   */
  authorizationFrames(key: string, attemptId: string, signal: AbortSignal): AsyncIterable<AuthorizationFrame>
  /** Submit a value to one open authorization prompt.
   * @param key - allowlisted credential key.
   * @param attemptId - current attempt identity.
   * @param promptId - open prompt identity.
   * @param value - text or selected option id.
   * @param signal - caller cancellation.
   * @returns completion after the Host accepts the answer.
   */
  authorizationAnswer(key: string, attemptId: string, promptId: string, value: string, signal?: AbortSignal): Promise<void>
  /** Decline one open authorization prompt.
   * @param key - allowlisted credential key.
   * @param attemptId - current attempt identity.
   * @param promptId - open prompt identity.
   * @param signal - caller cancellation.
   * @returns completion after the Host accepts the decline.
   */
  authorizationDecline(key: string, attemptId: string, promptId: string, signal?: AbortSignal): Promise<void>
  /** Cancel an authorization attempt and wait for its Host drain.
   * @param key - allowlisted credential key.
   * @param attemptId - current attempt identity.
   * @param signal - caller cancellation while waiting for the Host reply.
   * @returns completion after the attempt releases its key.
   */
  authorizationCancel(key: string, attemptId: string, signal?: AbortSignal): Promise<void>
  /** Fetch verified bytes of an image recorded in the selected Session.
   * @param sessionId - recorded Session identity.
   * @param image - image reference obtained from its validated history.
   * @param signal - caller cancellation.
   * @returns verified raster Blob, suitable for an owned object URL.
   */
  image(sessionId: SessionId, image: NativeSessionImage, signal?: AbortSignal): Promise<Blob>
  /** Answer a presentation belonging to this Consumer's exact outstanding turn.
   * @param sessionId - selected Session.
   * @param id - observed pending presentation identity.
   * @param answer - structured allow/reject or question answers.
   * @param signal - caller cancellation.
   * @returns completion after the Host accepts the exact pending answer.
   */
  answerHuman(sessionId: SessionId, id: NativeWebHumanId, answer: NativeWebHumanAnswer, signal?: AbortSignal): Promise<void>
  /** Read actual advisory catalogs and installed standing presets.
   * @param signal - caller cancellation.
   * @returns current Host capability availability and provider-owned choices.
   */
  modelControls(signal?: AbortSignal): Promise<NativeModelControls>
  /** Persist a Session-local model/effort intent against its last observed revision.
   * @param sessionId - selected stored Session.
   * @param request - complete model choice and expected durable intent revision.
   * @param signal - caller cancellation.
   * @returns completion after the sole Host writer persists the choice.
   */
  selectModel(sessionId: SessionId, request: NativeModelSelectionRequest, signal?: AbortSignal): Promise<void>
  /** Replace the composition of an idle blank Session through its Program epoch.
   * @param request - Session, advertised preset and expected durable selection revision.
   * @param signal - caller cancellation.
   * @returns completion after old Agent drain and accepted successor activation.
   */
  selectPreset(request: NativeAgentPresetSelectionRequest, signal?: AbortSignal): Promise<void>
  /** Execute one exact registered slash command on the selected idle Session owner.
   * @param sessionId - selected stored Session.
   * @param line - complete slash command line.
   * @param signal - caller cancellation; the Host drains the command before settlement.
   * @returns the durable command lifecycle identity and normalized outcome.
   */
  executeCommand(sessionId: SessionId, line: string, signal?: AbortSignal): Promise<CommandExecution>
  /** Cancel owned prompts and wait for their Host settlement replies.
   * @returns completion after all owned calls settle.
   */
  close(): Promise<void>
  /**
   * @param signal - caller cancellation.
   * @returns Session rows ordered by latest activity.
   */
  list(signal?: AbortSignal): Promise<readonly NativeSessionListItem[]>
  /**
   * Follow the Host list after its complete ordered baseline.
   * @param signal - ends this iteration without changing Session state.
   * @returns baseline, upsert and removal frames from the selected Host.
   */
  follow(signal: AbortSignal): AsyncIterable<NativeSessionListFrame>
  /**
   * Search Session titles and current recorded message text in bounded Host pages.
   * @param query - non-empty literal search text.
   * @param cursor - continuation returned by the preceding page.
   * @param signal - caller cancellation.
   * @returns matching Session titles and message snippets.
   */
  search(query: string, cursor?: string, signal?: AbortSignal): Promise<NativeSessionSearchPage>
  /**
   * Archive one Session through the selected Workspace registry.
   * @param sessionId - stored Session identity.
   * @param signal - caller cancellation.
   * @returns completion after the Host records the archive.
   */
  archive(sessionId: SessionId, signal?: AbortSignal): Promise<void>
  /** Pin a title through the selected Host Session owner. */
  renameTitle(sessionId: SessionId, title: string, signal?: AbortSignal): Promise<void>
  /** Deliberately unpin and regenerate through the selected Host provider or fallback. */
  refreshTitle(sessionId: SessionId, signal?: AbortSignal): Promise<void>
  /**
   * @param signal - caller cancellation.
   * @returns a durably created blank Session.
   */
  create(signal?: AbortSignal): Promise<{ readonly sessionId: SessionId }>
  /**
   * @param sessionId - stored identity.
   * @param signal - caller cancellation.
   * @returns bounded durable history.
   */
  history(sessionId: SessionId, signal?: AbortSignal): Promise<{
    readonly header: SessionHeader
    readonly events: readonly SessionEvent[]
    readonly inheritedEventCount: number
  }>
  /**
   * @param sessionId - selected identity.
   * @param text - human input.
   * @param resume - explicit existing-Session selection.
   * @param signal - abort cancels and drains this turn.
   * @param observe - synchronous presentation observer; failures cancel and drain the turn.
   * @param images - ordered browser uploads, admitted by the Host before the user message.
   * @param onFollowError - background follow failure after turn settlement, when present.
   * @returns durable turn settlement.
   */
  prompt(sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal,
    observe?: (frame: NativeSessionFollowFrame) => void, images?: readonly NativeImageUpload[],
    onFollowError?: (error: unknown) => void): Promise<{
    readonly exitCode: number
    readonly answer?: string
  }>
  /**
   * @param sessionId - selected identity.
   * @param signal - caller cancellation.
   * @returns cancellation after turn settlement.
   */
  cancel(sessionId: SessionId, signal?: AbortSignal): Promise<{ readonly cancelled: boolean }>
  /**
   * @param sessionId - selected identity.
   * @param signal - caller cancellation.
   * @returns current Program admission state.
   */
  status(sessionId: SessionId, signal?: AbortSignal): Promise<{ readonly status: 'running' | 'idle' | 'unknown' }>
}

function fields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native Session reply must be an object')
  return value as Record<string, unknown>
}

function settingsDescriptor(value: unknown): NativeSettingsDescriptor {
  const data = fields(value)
  if (typeof data.namespace !== 'string' || data.namespace.length === 0 || typeof data.schema !== 'object' || data.schema === null
    || typeof data.value !== 'object' || data.value === null || Array.isArray(data.value)
    || typeof data.base !== 'object' || data.base === null || Array.isArray(data.base)
    || typeof data.user !== 'object' || data.user === null || Array.isArray(data.user)
    || data.applies !== 'live' && data.applies !== 'restart'
    || !Array.isArray(data.secrets) || !data.secrets.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const secret = item as Record<string, unknown>
    return Array.isArray(secret.path) && secret.path.every(part => typeof part === 'string') && typeof secret.set === 'boolean'
  })
    || !Array.isArray(data.credentialRefs) || !data.credentialRefs.every(ref => typeof ref === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref))
    || typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw new TypeError('invalid native Settings descriptor')
  }
  return data as unknown as NativeSettingsDescriptor
}

function settingsDescription(value: unknown): NativeSettingsDescription {
  const data = fields(value)
  const limits = fields(data.limits)
  if (!Array.isArray(data.namespaces) || typeof data.hasDocument !== 'boolean'
    || typeof limits.maxCredentialRefsPerRead !== 'number' || !Number.isSafeInteger(limits.maxCredentialRefsPerRead) || limits.maxCredentialRefsPerRead < 1
    || typeof limits.maxSettingsOperations !== 'number' || !Number.isSafeInteger(limits.maxSettingsOperations) || limits.maxSettingsOperations < 1) {
    throw new TypeError('invalid native Settings description')
  }
  return { hasDocument: data.hasDocument, namespaces: data.namespaces.map(settingsDescriptor), limits: {
    maxCredentialRefsPerRead: limits.maxCredentialRefsPerRead,
    maxSettingsOperations: limits.maxSettingsOperations,
  } }
}

function credentialInfo(value: unknown): NativeCredentialInfo {
  const data = fields(value)
  if (typeof data.configured !== 'boolean' || typeof data.writable !== 'boolean'
    || data.source !== undefined && typeof data.source !== 'string'
    || Object.keys(data).some(key => !['configured', 'writable', 'source'].includes(key))) {
    throw new TypeError('invalid native credential description')
  }
  return { configured: data.configured, writable: data.writable,
    ...data.source === undefined ? {} : { source: data.source } }
}

const authorizationEntrySchema = z.strictObject({
  key: z.string(), label: z.string(),
  methods: z.array(z.strictObject({ id: z.string(), label: z.string() })),
  configured: z.boolean(), writable: z.boolean(), attemptId: z.string().optional(),
})
const accountSummarySchema = z.strictObject({
  key: z.string(), provider: z.enum(['openai-codex', 'deepseek-account']), status: z.enum(['signed-out', 'ready', 'unavailable']),
  identity: z.strictObject({
    email: z.string().nullable(), contact: z.string().nullable(), name: z.string().nullable(), avatarUrl: z.string().nullable(),
  }),
  plan: z.string().nullable(),
})
const quotaWindowSchema = z.strictObject({
  usedPercent: z.number(), windowSeconds: z.number().nullable(), resetsAt: z.number().nullable(),
})
const quotaSchema = z.strictObject({
  name: z.string(), primary: quotaWindowSchema.nullable(), secondary: quotaWindowSchema.nullable(),
})
const accountUsageSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), email: z.string().nullable(), plan: z.string().nullable(),
    quotas: z.array(quotaSchema), credits: z.strictObject({ unlimited: z.boolean(), balance: z.string().nullable() }).nullable() }),
  z.strictObject({ status: z.literal('signed-out') }),
  z.strictObject({ status: z.literal('failed'), reason: z.string() }),
  z.strictObject({ status: z.literal('unsupported') }),
])
const accountWalletSchema = z.strictObject({ currency: z.enum(['CNY', 'USD']), balance: z.string() })
const accountBalanceSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), wallets: z.array(accountWalletSchema), bonusWallets: z.array(accountWalletSchema) }),
  z.strictObject({ status: z.literal('signed-out') }),
  z.strictObject({ status: z.literal('failed') }),
  z.strictObject({ status: z.literal('unsupported') }),
])
const scheduledJobSchema = z.strictObject({
  id: z.string().min(1), sessionId: z.string().min(1), title: z.string(),
  state: z.enum(['active', 'paused', 'failed']), schedule: z.string().min(1), timeZone: z.string().min(1),
  nextRunAt: z.number().int().refine(Number.isSafeInteger).optional(),
  lastRunAt: z.number().int().refine(Number.isSafeInteger).optional(),
})
const scheduleFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('baseline'), jobs: z.array(scheduledJobSchema) }),
  z.strictObject({ type: z.literal('upsert'), job: scheduledJobSchema }),
  z.strictObject({ type: z.literal('remove'), id: z.string().min(1) }),
])
const llmProviderSchema = z.strictObject({ id: z.string().min(1), name: z.string() })
const nativeAgentPresetListSchema = z.strictObject({
  default: z.string().nullable(),
  presets: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), description: z.string().optional(),
    source: z.enum(['profile', 'system', 'user']),
    status: z.enum(['ready', 'needs-migration', 'invalid']), problem: z.string().optional(),
  })),
})
const nativeAgentPresetDocumentSchema = z.strictObject({
  id: z.string().min(1), source: z.enum(['profile', 'system', 'user']),
  status: z.enum(['ready', 'needs-migration', 'invalid']), name: z.string(),
  description: z.string().optional(), content: z.string().optional(), problem: z.string().optional(),
})
const configurableModelProviderSchema = z.strictObject({
  provider: z.string(), displayName: z.string(), settingsNs: z.string(), settingsPath: z.array(z.string()),
  declared: z.boolean().optional(), error: z.string().optional(),
})
const discoveredModelSchema = z.strictObject({
  id: z.string().min(1), name: z.string().optional(), contextWindow: z.number().optional(), maxTokens: z.number().optional(),
})
const settingsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('settings/document-updated'), namespace: z.string(),
    revision: z.number().int().nonnegative().refine(Number.isSafeInteger),
  }),
  z.strictObject({ type: z.literal('credentials/reference-updated'), ref: z.string() }),
  z.strictObject({ type: z.literal('llm/adapters-updated') }),
  z.strictObject({ type: z.literal('agent-presets/updated') }),
  z.strictObject({ type: z.literal('accounts/changed'), key: z.string() }),
])
const listItemSchema = z.strictObject({
  header: z.unknown(), titleProjection: z.unknown(),
  titleActions: z.strictObject({ rename: z.boolean(), refresh: z.boolean() }).optional(),
  updatedAt: z.number().int().nonnegative().refine(Number.isSafeInteger), blank: z.boolean(),
  running: z.boolean(), completed: z.boolean(), runningSubagentCount: z.number().int().nonnegative().refine(Number.isSafeInteger),
  pendingInteraction: z.strictObject({ kind: z.enum(['approval', 'plan-review', 'question']) }).optional(),
  workspaceId: z.string().min(1).optional(), hasActiveSchedule: z.boolean(),
})
const listFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('baseline'), items: z.array(listItemSchema) }),
  z.strictObject({ type: z.literal('upsert'), item: listItemSchema }),
  z.strictObject({ type: z.literal('remove'), sessionId: z.string().min(1) }),
])
const searchPageSchema = z.strictObject({
  items: z.array(z.strictObject({
    sessionId: z.string().min(1), title: z.string(), workspaceId: z.string().min(1).optional(),
    cwd: z.string().optional(), snippet: z.string().optional(),
  })),
  cursor: z.string().optional(),
})
const authorizationFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('notice'), notice: z.strictObject({
    message: z.string(), url: z.string().optional(), code: z.string().optional(),
  }) }),
  z.strictObject({ type: z.literal('prompt'), promptId: z.string(), prompt: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), message: z.string(), placeholder: z.string().optional() }),
    z.strictObject({ kind: z.literal('secret'), message: z.string(), placeholder: z.string().optional() }),
    z.strictObject({ kind: z.literal('select'), message: z.string(), options: z.array(z.strictObject({
      id: z.string(), label: z.string(), description: z.string().optional(),
    })) }),
  ]) }),
  z.strictObject({ type: z.literal('prompt-closed'), promptId: z.string() }),
  z.strictObject({ type: z.literal('settled'), settlement: z.enum(['authorized', 'cancelled', 'failed']),
    code: z.string().optional(), message: z.string().optional() }),
])

function scheduleJob(value: unknown): NativeScheduledJob {
  const job = scheduledJobSchema.parse(value)
  const { nextRunAt, lastRunAt, ...metadata } = job
  return { ...metadata, sessionId: job.sessionId as SessionId,
    ...(nextRunAt === undefined ? {} : { nextRunAt }), ...(lastRunAt === undefined ? {} : { lastRunAt }) }
}

function scheduleFrame(value: unknown): NativeScheduleFrame {
  const frame = scheduleFrameSchema.parse(value)
  switch (frame.type) {
    case 'baseline': return { type: 'baseline', jobs: frame.jobs.map(scheduleJob) }
    case 'upsert': return { type: 'upsert', job: scheduleJob(frame.job) }
    case 'remove': return frame
  }
}

function header(value: unknown): SessionHeader {
  const data = fields(value)
  if (typeof data.id !== 'string' || data.id.length === 0 || data.version !== SESSION_FORMAT_VERSION
    || typeof data.createdAt !== 'number' || !Number.isSafeInteger(data.createdAt) || data.createdAt < 0
    || typeof data.isSeeded !== 'boolean') throw new TypeError('invalid native Session header')
  return data as unknown as SessionHeader
}

function listItem(value: unknown): NativeSessionListItem {
  const data = listItemSchema.parse(value)
  const projection = fields(data.titleProjection)
  const titleProjection: NativeSessionTitleProjection = projection.status === 'resolved' && typeof projection.title === 'string'
    && projection.title.length > 0 ? { status: 'resolved', title: projection.title }
    : projection.status === 'absent' ? { status: 'absent' }
      : projection.status === 'unavailable' ? { status: 'unavailable' }
        : (() => { throw new TypeError('invalid native Session title projection') })()
  return {
    header: header(data.header), titleProjection,
    ...data.titleActions === undefined ? {} : { titleActions: data.titleActions },
    updatedAt: data.updatedAt, blank: data.blank, running: data.running, completed: data.completed,
    runningSubagentCount: data.runningSubagentCount,
    ...data.pendingInteraction === undefined ? {} : { pendingInteraction: data.pendingInteraction },
    ...data.workspaceId === undefined ? {} : { workspaceId: data.workspaceId as Branded<'WorkspaceId'> },
    hasActiveSchedule: data.hasActiveSchedule,
  }
}

function listFrame(value: unknown): NativeSessionListFrame {
  const frame = listFrameSchema.parse(value)
  if (frame.type === 'baseline') return { type: 'baseline', items: frame.items.map(listItem) }
  if (frame.type === 'upsert') return { type: 'upsert', item: listItem(frame.item) }
  return { type: 'remove', sessionId: frame.sessionId as SessionId }
}

const pluginInventorySchema = z.strictObject({ entries: z.array(z.strictObject({
  id: z.string(), name: z.string(), scope: z.string(),
  state: z.enum(['planned', 'activating', 'ready', 'draining', 'failed', 'disposed']),
  failure: z.enum(['activation', 'cleanup']).optional(),
})) }) as unknown as z.ZodType<NativePluginInventory>

function decodeReply(endpoint: string, value: unknown): unknown {
  if (endpoint === 'agent-presets/list') return nativeAgentPresetListSchema.parse(value)
  if (endpoint === 'agent-presets/read') return nativeAgentPresetDocumentSchema.parse(value)
  if (endpoint === 'agent-presets/copy' || endpoint === 'agent-presets/delete') {
    if (fields(value).updated !== true) throw new TypeError('invalid native Agent preset write acknowledgement')
    return undefined
  }
  if (endpoint === 'agent-presets/can-open-directory') {
    if (typeof value !== 'boolean') throw new TypeError('invalid native Agent preset directory capability')
    return value
  }
  if (endpoint === 'agent-presets/open-directory') {
    const data = fields(value)
    if (data.opened === true) return { opened: true }
    if (data.opened === false && typeof data.path === 'string') return { opened: false, path: data.path }
    throw new TypeError('invalid native Agent preset directory response')
  }
  if (endpoint === 'models/providers') {
    if (!Array.isArray(value)) throw new TypeError('native model provider list must be an array')
    return value.map(item => llmProviderSchema.parse(item))
  }
  if (endpoint === 'models/configurable-providers') {
    if (!Array.isArray(value)) throw new TypeError('native configurable model provider list must be an array')
    return value.map(item => configurableModelProviderSchema.parse(item))
  }
  if (endpoint === 'models/discover') {
    if (!Array.isArray(value)) throw new TypeError('native discovered model list must be an array')
    return value.map(item => discoveredModelSchema.parse(item))
  }
  if (endpoint === 'settings/describe') {
    return settingsDescription(value)
  }
  if (endpoint === 'settings/mutate') return settingsDescriptor(value)
  if (endpoint === 'plugins/inventory') return pluginInventorySchema.parse(value)
  if (endpoint === 'settings/open-document') {
    if (fields(value).opened !== true) throw new TypeError('invalid native settings document open reply')
    return { opened: true }
  }
  if (endpoint === 'credentials/describe') {
    const data = fields(value)
    return Object.fromEntries(Object.entries(data).map(([ref, info]) => [ref, credentialInfo(info)]))
  }
  if (endpoint === 'credentials/set' || endpoint === 'credentials/unset') {
    if (fields(value).updated !== true) throw new TypeError('invalid native credential write acknowledgement')
    return undefined
  }
  if (endpoint === 'authorization/list') {
    if (!Array.isArray(value)) throw new TypeError('native authorization list must be an array')
    return value.map(item => authorizationEntrySchema.parse(item))
  }
  if (endpoint === 'accounts/list') {
    if (!Array.isArray(value)) throw new TypeError('native account list must be an array')
    return value.map(item => accountSummarySchema.parse(item))
  }
  if (endpoint === 'accounts/usage') return accountUsageSchema.parse(value)
  if (endpoint === 'accounts/balance') return accountBalanceSchema.parse(value)
  if (endpoint === 'accounts/sign-out') {
    if (fields(value).updated !== true) throw new TypeError('invalid native account sign-out acknowledgement')
    return undefined
  }
  if (endpoint === 'session/model-controls') return nativeModelControlsSchema.parse(value)
  if (endpoint === 'session/list') {
    if (!Array.isArray(value)) throw new TypeError('native Session list must be an array')
    return value.map(listItem)
  }
  if (endpoint === 'session/search') {
    const page = searchPageSchema.parse(value)
    return { items: page.items.map(item => ({
      sessionId: item.sessionId as SessionId, title: item.title,
      ...item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId as Branded<'WorkspaceId'> },
      ...item.cwd === undefined ? {} : { cwd: item.cwd },
      ...item.snippet === undefined ? {} : { snippet: item.snippet },
    })), ...page.cursor === undefined ? {} : { cursor: page.cursor } }
  }
  const data = fields(value)
  switch (endpoint) {
    case 'session/command': {
      const result = fields(data.result)
      if (typeof data.commandId !== 'string' || data.commandId.length === 0
        || result.kind !== 'success' && result.kind !== 'error'
        || result.text !== undefined && typeof result.text !== 'string'
        || result.kind === 'error' && typeof result.text !== 'string'
        || result.sourceEventSeq !== undefined && (typeof result.sourceEventSeq !== 'number'
          || !Number.isSafeInteger(result.sourceEventSeq) || result.sourceEventSeq < 0)) {
        throw new TypeError('invalid native Session command result')
      }
      return data
    }
    case 'session/answer-human':
      if (data.answered !== true) throw new TypeError('invalid native human answer acknowledgement')
      break
    case 'authorization/begin':
      if (typeof data.attemptId !== 'string') throw new TypeError('invalid native authorization attempt')
      break
    case 'authorization/answer':
      if (data.answered !== true) throw new TypeError('invalid native authorization answer acknowledgement')
      return undefined
    case 'authorization/decline':
      if (data.declined !== true) throw new TypeError('invalid native authorization decline acknowledgement')
      return undefined
    case 'authorization/cancel':
      if (data.cancelled !== true) throw new TypeError('invalid native authorization cancellation acknowledgement')
      return undefined
    case 'session/rename-title':
    case 'session/refresh-title':
      if (data.changed !== true) throw new TypeError('invalid native Session title acknowledgement')
      break
    case 'session/select-model':
    case 'session/select-preset':
      if (data.changed !== true) throw new TypeError('invalid native Session selection acknowledgement')
      break
    case 'session/history':
      if (!Array.isArray(data.events) || typeof data.inheritedEventCount !== 'number'
        || !Number.isSafeInteger(data.inheritedEventCount) || data.inheritedEventCount < 0
        || data.inheritedEventCount > data.events.length) throw new TypeError('invalid native Session history')
      return { header: header(data.header), inheritedEventCount: data.inheritedEventCount,
        events: data.events.map((value: unknown, index: number) => parseSessionEvent(value, index)) }
    case 'session/start':
      if (typeof data.admissionId !== 'string' || data.admissionId.length === 0) throw new TypeError('invalid native Session admission')
      break
    case 'session/create':
      if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) throw new TypeError('invalid native Session identity')
      break
    case 'session/archive':
      if (data.archived !== true) throw new TypeError('invalid native Session archive acknowledgement')
      return undefined
    case 'session/prompt':
    case 'session/await':
      if (typeof data.exitCode !== 'number' || !Number.isSafeInteger(data.exitCode)
        || data.answer !== undefined && typeof data.answer !== 'string') throw new TypeError('invalid native Session result')
      break
    case 'session/cancel':
      if (typeof data.cancelled !== 'boolean') throw new TypeError('invalid native Session cancellation')
      break
    case 'session/status':
      if (data.status !== 'idle' && data.status !== 'running' && data.status !== 'unknown') throw new TypeError('invalid native Session status')
      break
    default: throw new Error('unsupported native Session reply')
  }
  return data
}

function followFrame(value: unknown): NativeSessionFollowFrame {
  const data = fields(value)
  if (data.type === 'title-updated' && Object.keys(data).length === 1) return { type: 'title-updated' }
  if (data.type === 'human' && Object.keys(data).length === 2) return { type: 'human', prompt: nativeWebHumanSchema.parse(data.prompt) as NativeWebHumanPrompt }
  if (data.type === 'human-removed' && typeof data.id === 'string' && data.id.length > 0 && Object.keys(data).length === 2) return { type: 'human-removed', id: data.id as NativeWebHumanId }
  if (data.type === 'event' && Object.keys(data).length === 2) {
    const event = fields(data.event)
    if (typeof event.seq !== 'number') throw new TypeError('native Session follow: event has no sequence')
    return { type: 'event', event: parseSessionEvent(event, event.seq) }
  }
  if (data.type === 'text' && typeof data.text === 'string' && Object.keys(data).length === 2) return { type: 'text', text: data.text }
  if ((data.type === 'text-start' || data.type === 'settled') && Object.keys(data).length === 1) return { type: data.type }
  throw new TypeError('native Session follow: invalid frame')
}

function objectConfig(input: unknown): Record<string, unknown> {
  const data = fields(input)
  if (Object.keys(data).some(key => key !== 'maxFollowBufferChars') || typeof data.maxFollowBufferChars !== 'number'
    || !Number.isSafeInteger(data.maxFollowBufferChars) || data.maxFollowBufferChars < 1) throw new TypeError('native Session Client: invalid follow parser capacity')
  return data
}

/** Create a lifecycle Consumer without another transport or Session cache.
 * @param rpc - selected Connection's generic RPC caller.
 * @param config - explicit SSE parser capacity.
 * @param installationSignal - optional installation cancellation.
 * @returns typed Session operations; Host failures reject the call.
 */
export function createNativeSessionClient(
  rpc: ClientConnectionRpc, config: NativeSessionClientConfig, installationSignal?: AbortSignal,
): NativeSessionClient {
  const admissions = new Map<SessionId, NativeSessionAdmissionId>()
  const shutdown = new AbortController()
  const lifetime = installationSignal === undefined ? shutdown.signal : AbortSignal.any([installationSignal, shutdown.signal])
  const pendingPrompts = new Set<Promise<unknown>>()
  const pendingFollows = new Set<Promise<void>>()
  const pendingListFollows = new Set<Promise<void>>()
  async function call<T>(endpoint: string, payload: object, signal?: AbortSignal, useLifetime = true): Promise<T> {
    const accepted = !useLifetime ? signal : signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    const result = await rpc.call('/api', endpoint, payload, accepted)
    if (!result.ok) throw new NativeSessionRpcError(result.error.code, result.error.message, result.error.details)
    return decodeReply(endpoint, result.value) as T
  }
  async function prompt(
    sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal, observe?: (frame: NativeSessionFollowFrame) => void,
    images?: readonly NativeImageUpload[], onFollowError?: (error: unknown) => void,
  ) {
    const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    accepted.throwIfAborted()
    const responseOperation = rpc.response
    if (observe !== undefined && responseOperation === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
    const following = new AbortController()
    // Admission and settlement remain reachable while caller cancellation requests exact Host drain.
    const { admissionId } = await call<{ admissionId: NativeSessionAdmissionId }>('session/start', { sessionId, text, resume, follow: observe !== undefined,
      ...images === undefined ? {} : { images } }, undefined, false)
    admissions.set(sessionId, admissionId)
    let cancellation: Promise<unknown> | undefined
    let turnSettled = false
    const wasTurnSettled = (): boolean => turnSettled
    let followFailure: unknown
    const abort = (): void => {
      following.abort(accepted.reason)
      if (!turnSettled) {
        cancellation ??= call('session/cancel', { sessionId, admissionId }, undefined, false)
        // Settlement reports cancellation failures after the original turn's response has drained.
        void cancellation.then(() => undefined, () => undefined)
      }
    }
    accepted.addEventListener('abort', abort, { once: true })
    if (accepted.aborted) abort()
    let followComplete = false
    const isFollowComplete = (): boolean => followComplete
    let followWork: Promise<void> | undefined
    try {
      if (observe !== undefined && responseOperation !== undefined) {
        const activeFollow = (async () => {
          try {
            const response = await responseOperation('/api', 'native-session/follow', { sessionId, admissionId }, following.signal)
            if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
              throw new Error(`native Session follow: invalid response HTTP ${response.status}`)
            }
            let terminal = false
            const events = response.body.pipeThrough(new TextDecoderStream())
              .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
            let nextSeq: number | undefined
            for await (const { data } of events) {
              const frame = followFrame(JSON.parse(data))
              if (terminal) throw new Error('native Session follow: output after settlement')
              if (frame.type === 'event') {
                if (nextSeq !== undefined && frame.event.seq !== nextSeq) throw new Error('native Session follow: event sequence gap')
                nextSeq = frame.event.seq + 1
              }
              if (frame.type === 'settled') terminal = true
              observe(frame)
            }
            if (!terminal) throw new Error('native Session follow: EOF before settlement')
          } catch (error: unknown) {
            if (!wasTurnSettled() && !accepted.aborted) { followFailure = error; abort() }
            else {
              try { onFollowError?.(error) }
              catch (callbackError: unknown) { console.error('native Session follow error observer failed:', callbackError) }
            }
          }
        })().finally(() => { followComplete = true })
        followWork = activeFollow
        pendingFollows.add(activeFollow)
        void activeFollow.then(() => { pendingFollows.delete(activeFollow) })
      }

      const settlementWork = call<{ exitCode: number; answer?: string }>('session/await', { sessionId, admissionId }, undefined, false)
        .then((value) => { turnSettled = true; return { status: 'fulfilled' as const, value } },
          (reason: unknown) => { turnSettled = true; return { status: 'rejected' as const, reason } })
      if (followWork !== undefined) {
        const first = await Promise.race([followWork.then(() => 'follow' as const), settlementWork.then(() => 'settlement' as const)])
        if (first === 'follow') await followWork
      }
      const settlement = await settlementWork
      if (isFollowComplete() && followWork !== undefined) await followWork
      const controls = await Promise.allSettled(cancellation === undefined ? [] : [cancellation])
      const errors: unknown[] = [settlement, ...controls].flatMap(outcome => outcome.status === 'rejected'
        ? [outcome.reason as unknown] : [])
      if (followFailure !== undefined) errors.unshift(followFailure)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'native Session settlement and cancellation failed')
      if (settlement.status === 'rejected') throw settlement.reason
      return settlement.value
    } finally {
      if (admissions.get(sessionId) === admissionId) admissions.delete(sessionId)
      if (followWork === undefined || isFollowComplete()) accepted.removeEventListener('abort', abort)
      else void followWork.then(() => { accepted.removeEventListener('abort', abort) })
    }
  }
  return {
    agentPresetsList: signal => call('agent-presets/list', {}, signal),
    agentPresetRead: (id, signal) => call('agent-presets/read', { id }, signal),
    async agentPresetCopy(from, id, name, signal) {
      await call('agent-presets/copy', { from, id, ...(name === undefined ? {} : { name }) }, signal)
    },
    async agentPresetDelete(id, signal) { await call('agent-presets/delete', { id }, signal) },
    agentPresetsCanOpenDirectory: signal => call('agent-presets/can-open-directory', {}, signal),
    agentPresetOpenDirectory: (id, signal) => call('agent-presets/open-directory', { id }, signal),
    settingsDescribe: signal => call('settings/describe', {}, signal),
    async settingsOpenDocument(signal) {
      await call('settings/open-document', {}, signal)
      return { opened: true }
    },
    pluginInventoryList: signal => call('plugins/inventory', {}, signal),
    async modelCatalog(signal) {
      return (await call<NativeModelControls>('session/model-controls', {}, signal)).catalog
    },
    settingsMutate: (namespace, ops, expectedRevision, signal) =>
      call('settings/mutate', { ns: namespace, ops, expectedRevision }, signal),
    modelsListProviders: signal => call('models/providers', {}, signal),
    modelsListConfigurableProviders: signal => call('models/configurable-providers', {}, signal),
    modelsDiscover: (settingsNs, request, signal) => call('models/discover', { settingsNs, request }, signal),
    credentialsDescribe: (refs, signal) => call('credentials/describe', { refs }, signal),
    async credentialsSet(ref, value, signal) { await call('credentials/set', { ref, value }, signal) },
    async credentialsUnset(ref, signal) { await call('credentials/unset', { ref }, signal) },
    authorizationList: signal => call('authorization/list', {}, signal),
    accountsList: signal => call('accounts/list', {}, signal),
    accountsUsage: (key, signal) => call('accounts/usage', { key }, signal),
    accountsBalance: (key, signal) => call('accounts/balance', { key }, signal),
    async accountsSignOut(key, signal) { await call('accounts/sign-out', { key }, signal) },
    authorizationBegin: (key, method, signal) => call('authorization/begin', { key, ...(method === undefined ? {} : { method }) }, signal),
    async *authorizationFrames(key, attemptId, signal) {
      const responseOperation = rpc.response
      if (responseOperation === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
      const accepted = AbortSignal.any([lifetime, signal])
      const response = await responseOperation('/api', 'native-session/authorization', { key, attemptId }, accepted)
      if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
        throw new Error(`native authorization frames: invalid response HTTP ${response.status}`)
      }
      const frames = response.body.pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
      for await (const { data } of frames) yield authorizationFrameSchema.parse(JSON.parse(data)) as AuthorizationFrame
    },
    async *settingsEvents(signal) {
      const accepted = AbortSignal.any([lifetime, signal])
      const responseOperation = rpc.response
      if (responseOperation === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
      try {
        const response = await responseOperation('/api', 'native-session/settings-events', {}, accepted)
        if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
          throw new Error(`native settings events: invalid response HTTP ${response.status}`)
        }
        const frames = response.body.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
        for await (const { data } of frames) yield settingsEventSchema.parse(JSON.parse(data))
      } catch (error: unknown) {
        if (accepted.aborted) return
        throw error
      }
    },
    async authorizationAnswer(key, attemptId, promptId, value, signal) {
      await call('authorization/answer', { key, attemptId, promptId, value }, signal)
    },
    async authorizationDecline(key, attemptId, promptId, signal) {
      await call('authorization/decline', { key, attemptId, promptId }, signal)
    },
    async authorizationCancel(key, attemptId, signal) {
      await call('authorization/cancel', { key, attemptId }, signal)
    },
    async image(sessionId, image, signal) {
      const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
      accepted.throwIfAborted()
      if (rpc.response === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
      const response = await rpc.response('/api', 'native-session/image', { sessionId, attachmentId: image.attachmentId }, accepted)
      if (!response.ok || response.headers.get('content-type') !== image.mediaType
        || response.headers.get('content-length') !== String(image.bytes)) throw new Error(`native Session image: invalid response HTTP ${response.status}`)
      const blob = await response.blob()
      accepted.throwIfAborted()
      if (blob.size !== image.bytes) throw new Error('native Session image: byte length mismatch')
      return blob
    },
    async close() {
      shutdown.abort(new Error('native Session Client disposed'))
      while (pendingPrompts.size > 0 || pendingFollows.size > 0 || pendingListFollows.size > 0) {
        await Promise.allSettled([...pendingPrompts, ...pendingFollows, ...pendingListFollows])
      }
    },
    async answerHuman(sessionId, id, answer, signal) {
      const admissionId = admissions.get(sessionId)
      if (admissionId === undefined) throw new Error('native Session Client: human answer has no owned turn')
      await call('session/answer-human', { sessionId, admissionId, id, answer }, signal)
    },
    list: signal => call('session/list', {}, signal),
    async *follow(signal) {
      const responseOperation = rpc.response
      if (responseOperation === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
      const following = new AbortController()
      const accepted = AbortSignal.any([lifetime, signal, following.signal])
      const completed = Promise.withResolvers<void>()
      pendingListFollows.add(completed.promise)
      const finish = (): void => {
        following.abort()
        completed.resolve(undefined)
        pendingListFollows.delete(completed.promise)
      }
      accepted.addEventListener('abort', finish, { once: true })
      if (accepted.aborted) finish()
      try {
        const response = await responseOperation('/api', 'native-session/list-follow', {}, accepted)
        if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
          throw new Error(`native Session list follow: invalid response HTTP ${response.status}`)
        }
        const frames = response.body.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
        for await (const { data } of frames) yield listFrame(JSON.parse(data))
      } catch (error: unknown) {
        if (!accepted.aborted) throw error
      } finally {
        accepted.removeEventListener('abort', finish)
        finish()
      }
    },
    search: (query, cursor, signal) => call('session/search', { query, ...(cursor === undefined ? {} : { cursor }) }, signal),
    async archive(sessionId, signal) { await call('session/archive', { sessionId }, signal) },
    async renameTitle(sessionId, title, signal) { await call('session/rename-title', { sessionId, title }, signal) },
    async refreshTitle(sessionId, signal) { await call('session/refresh-title', { sessionId }, signal) },
    modelControls: signal => call('session/model-controls', {}, signal),
    async selectModel(sessionId, request, signal) {
      await call('session/select-model', { sessionId, ...request }, signal)
    },
    async selectPreset({ id, ...request }, signal) {
      await call('session/select-preset', { sessionId: id, ...request }, signal)
    },
    executeCommand: (sessionId, line, signal) => call('session/command', { sessionId, line }, signal),
    create: signal => call('session/create', {}, signal),
    history: (sessionId, signal) => call('session/history', { sessionId }, signal),
    prompt(sessionId, text, resume, signal, observe, images, onFollowError) {
      const pending = prompt(sessionId, text, resume, signal, observe, images, onFollowError)
      pendingPrompts.add(pending)
      const settled = (): void => { pendingPrompts.delete(pending) }
      void pending.then(settled, settled)
      return pending
    },
    cancel: (sessionId, signal) => call('session/cancel', { sessionId }, signal),
    status: (sessionId, signal) => call('session/status', { sessionId }, signal),
  }
}

function createNativeScheduleClient(rpc: ClientConnectionRpc, config: NativeSessionClientConfig,
  lifetime: AbortSignal): NativeScheduleClient {
  return {
    async list(signal) {
      const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
      const result = await rpc.call('/api', 'schedules/list', {}, accepted)
      if (!result.ok) throw new NativeSessionRpcError(result.error.code, result.error.message, result.error.details)
      if (!Array.isArray(result.value)) throw new TypeError('invalid native schedules list')
      return result.value.map(scheduleJob)
    },
    async *follow(signal) {
      const accepted = AbortSignal.any([lifetime, signal])
      const responseOperation = rpc.response
      if (responseOperation === undefined) throw new Error('native schedule Client: selected carrier has no Fetch response operation')
      try {
        const response = await responseOperation('/api', 'schedules/follow', {}, accepted)
        if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
          throw new Error(`native schedules follow: invalid response HTTP ${response.status}`)
        }
        const events = response.body.pipeThrough(new TextDecoderStream())
          .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
        for await (const { data } of events) yield scheduleFrame(JSON.parse(data))
        if (!accepted.aborted) throw new Error('native schedules follow: stream ended')
      } catch (error: unknown) {
        if (!accepted.aborted) throw error
      }
    },
  }
}

/** Native browser installation that shares the Connection Provider's owned transport. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-session', targets: ['client'],
  requires: ['clientConnection'], provides: ['clientNativeSession', 'clientNativeSchedule', 'clientNativeWorkspace', 'clientNativeDirectoryPicker'],
  resolve(input) {
    const fields = objectConfig(input)
    const config: NativeSessionClientConfig = { maxFollowBufferChars: fields.maxFollowBufferChars as number }
    return (context) => {
      const rpc = context.require('clientConnection').rpc
      const client = createNativeSessionClient(rpc, config, context.signal)
      const schedules = createNativeScheduleClient(rpc, config, context.signal)
      const clients = createNativeWorkspaceClients(rpc, config.maxFollowBufferChars, context.signal)
      context.own(() => client.close())
      context.own(() => clients.workspace.close())
      context.provide('clientNativeSession', client)
      context.provide('clientNativeSchedule', schedules)
      context.provide('clientNativeWorkspace', clients.workspace)
      context.provide('clientNativeDirectoryPicker', clients.directoryPicker)
    }
  },
}
