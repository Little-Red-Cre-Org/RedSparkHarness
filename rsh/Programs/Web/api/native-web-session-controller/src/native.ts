/** Authenticated browser Session operations using the selected native execution authority. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { NativeSessionFeed } from './follow.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title/native'
import type { NativeSessionTitles } from '@deepseek-ai/dsh-session-title/native'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig, type Config as TurnConfig,
  type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { NativeConnectionRequestOwner, type ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution/root-route'
import type { NativeAgent, NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { isImageAdmissionError, type AttachmentOperations } from '@deepseek-ai/dsh-attachment/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

import { NativeWebHumanInteraction } from './human.ts'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import type { NativeUserQuestionRegistry } from '@deepseek-ai/dsh-user-questions/native'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeWebHumanId } from '@deepseek-ai/dsh-client-native-session/human'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import type { CredentialInfo, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-credentials/native'
import { NativeSettingsConflictError } from '@deepseek-ai/dsh-settings/native'
import type { NativeSettingsPathOp, NativeSettingsService } from '@deepseek-ai/dsh-settings-definition/native'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-settings-definition/native'
import type { NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/list-types'

type NativeSessionAdmissionId = Branded<'native-web-admission'>

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

/** Resolve Program settings and resource limits before installing routes.
 * @param input - profile configuration.
 * @returns validated native Session configuration.
 */
export function resolveNativeWebSessionConfig(input: unknown): Config {
  const { maxPendingRequests, maxHistoryEvents, maxPromptChars, maxFollowBufferBytes, maxFollowers,
    maxPendingHumanRequests, maxCredentialRefsPerRead, maxSettingsOperations, ...turn } = object(input)
  const settingsLimits = z.strictObject({
    maxCredentialRefsPerRead: z.number().int().min(1).refine(Number.isSafeInteger).default(64),
    maxSettingsOperations: z.number().int().min(1).refine(Number.isSafeInteger).default(512),
  }).parse({ maxCredentialRefsPerRead, maxSettingsOperations })
  return { ...resolveNativeHeadlessConfig(turn), maxPendingRequests: positive(maxPendingRequests, 'maxPendingRequests'),
    maxHistoryEvents: positive(maxHistoryEvents, 'maxHistoryEvents'), maxPromptChars: positive(maxPromptChars, 'maxPromptChars'), maxFollowBufferBytes: positive(maxFollowBufferBytes, 'maxFollowBufferBytes'),
    maxFollowers: positive(maxFollowers, 'maxFollowers'),
    maxPendingHumanRequests: positive(maxPendingHumanRequests, 'maxPendingHumanRequests'), ...settingsLimits }
}

const endpoints = new Set(['session/list', 'session/history', 'session/create', 'session/prompt', 'session/cancel', 'session/status', 'session/start', 'session/await', 'session/model-controls',
  'session/select-model', 'session/select-preset', 'session/answer-human', 'session/rename-title', 'session/refresh-title', 'session/command', 'settings/describe', 'settings/mutate',
  'credentials/describe', 'credentials/set', 'credentials/unset'])
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

/** Optional selected authorities; no fallback catalog or composition registry is created. */
export interface NativeWebSelectionProviders {
  readonly directory?: NativeModelDirectory | undefined
  readonly models?: {
    readonly selection: NativeModelSelectionOperations
    readonly executionFor: (agent: NativeAgent) => Pick<NativeAgentExecution, 'status' | 'runMaintenance'>
  } | undefined
  readonly presets?: NativeAgentPresetOperations | undefined
  readonly attachments?: AttachmentOperations | undefined
  readonly settings?: NativeSettingsService | undefined
  readonly credentials?: NativeCredentials | undefined
  readonly titles?: NativeSessionTitles | undefined
  readonly commands?: NativeCommandOperations | undefined
  readonly commandScope?: NativeScope | undefined
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
  }>()
  private readonly human: NativeWebHumanInteraction
  private followers = 0
  private readonly shutdown = new AbortController()
  private readonly requests: NativeConnectionRequestOwner
  private readonly controls: NativeConnectionRequestOwner
  private readonly settlements: NativeConnectionRequestOwner
  private readonly followTasks = new Set<Promise<void>>()

  /**
   * @param executor - shared Program executor, not another Agent loop.
   * @param persistence - selected durable Session index.
   * @param active - selected exact live writer registry.
   * @param config - validated execution and wire limits.
   * @param lifetime - installation cancellation.
   * @param selections - selected catalog, model intent and standing composition authorities.
   */
  constructor(private readonly executor: NativeHeadlessApplication,
    private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations,
    private readonly config: Config, private readonly lifetime: AbortSignal,
    private readonly selections: NativeWebSelectionProviders = {}) {
    this.human = new NativeWebHumanInteraction(config.maxPendingHumanRequests)
    this.requests = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.controls = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
    this.settlements = new NativeConnectionRequestOwner(lifetime, config.maxPendingRequests)
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
    for (const key of Object.keys(fields)) if (!['sessionId', 'text', 'resume', 'follow', 'images'].includes(key)) throw new Error('native web session: unexpected prompt field')
    const id = sessionId(fields.sessionId)
    if (typeof fields.text !== 'string' || fields.text.length === 0 || fields.text.length > this.config.maxPromptChars) throw new TypeError('native web session: text exceeds configured limits or is empty')
    if (fields.follow !== undefined && typeof fields.follow !== 'boolean') throw new TypeError('native web session: follow must be boolean')
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
    const execution = this.requests.run(this.lifetime, async (accepted) => {
      admitted()
      const turnSignal = AbortSignal.any([accepted, controller.signal])
      try {
        const result = await this.executor.executeRootTurn({ id, resume: fields.resume as boolean,
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
          ...feed === undefined ? {} : { onEvent: (event) => { feed.push({ type: 'event', event }) }, onChunk: (chunk) => {
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
    const turn = { admissionId, controller, done, waiting: false, settled: false, feed, following: false }
    this.turns.set(id, turn)
    // Keep rejected execution attached until the settlement consumer reads the same promise.
    void done.then(() => { turn.settled = true }, (error: unknown) => { turn.settled = true; refused(error) })
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
    if (this.followers >= this.config.maxFollowers) return new Response('native Session follow: capacity reached', { status: 429 })
    turn.following = true
    this.followers++
    return turn.feed.response(signal, () => { this.followers-- })
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
    const route = this.config.rootRouteId ?? brandString<NativeRootRouteId>('root')
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

  /** Read only an image already recorded in this Program's workspace Session.
   * @param request - authenticated image lookup with Session and attachment identities.
   * @returns verified raster bytes; caller-supplied paths and references are never accepted.
   */
  async image(request: Request): Promise<Response> {
    return this.controls.run(request.signal, async (signal) => {
      const fields = z.strictObject({ sessionId: z.string().min(1).max(256), attachmentId: z.string().min(1) }).parse(await request.json())
      const attachments = this.selections.attachments
      if (attachments === undefined) return new Response(null, { status: 404 })
      const history = await readNativeSessionHistory(sessionId(fields.sessionId), {
        active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
        label: 'native web image', onCleanupFailure: (error) => { this.controls.recordCleanupFailure(error) },
      }, signal)
      if (history.header.cwd !== this.config.cwd) return new Response(null, { status: 403 })
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
      if (endpoint.startsWith('settings/') || endpoint.startsWith('credentials/')) {
        return { ok: true, value: await this.controls.run(signal, accepted => this.configuration(endpoint, payload, accepted)) }
      }
      if (endpoint === 'session/start') return { ok: true, value: await this.start(payload, signal) }
      if (endpoint === 'session/await') return { ok: true, value: await this.settle(payload, signal) }
      if (endpoint === 'session/command') return { ok: true, value: await this.requests.run(signal, accepted => this.command(payload, accepted)) }
      if (endpoint === 'session/prompt') {
        const acknowledged = await this.start(payload, signal)
        return { ok: true, value: await this.settle({ sessionId: object(payload).sessionId, ...acknowledged }, signal) }
      }
      const admission = endpoint === 'session/cancel' || endpoint === 'session/status' || endpoint === 'session/answer-human' ? this.controls : this.requests
      return { ok: true, value: await admission.run(signal, async (accepted) => {
        const fields = object(payload)
        const allowed = ['session/list', 'session/create', 'session/model-controls'].includes(endpoint) ? []
          : endpoint === 'session/select-model' ? ['sessionId', 'selected', 'expectedRevision']
            : endpoint === 'session/select-preset' ? ['sessionId', 'preset', 'expectedRevision']
              : endpoint === 'session/rename-title' ? ['sessionId', 'title']
                : endpoint === 'session/refresh-title' ? ['sessionId']
                  : endpoint === 'session/answer-human' ? ['sessionId', 'admissionId', 'id', 'answer']
                    : endpoint === 'session/cancel' ? ['sessionId', 'admissionId'] : ['sessionId']
        for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`native web session: unexpected field ${key}`)
        if (endpoint === 'session/model-controls') return {
          catalog: this.selections.directory === undefined ? null : await this.selections.directory.catalog({
            provider: this.config.provider, model: this.config.model,
            ...this.config.reasoningEffort === undefined ? {} : { reasoningEffort: this.config.reasoningEffort },
          }, accepted),
          canSelectModel: this.selections.models !== undefined,
          images: this.selections.directory === undefined ? undefined : this.selections.attachments?.imageLimits,
          presets: this.selections.presets?.list().map(({ id, name, description }) => ({ id, name,
            ...description === undefined ? {} : { description } })) ?? [],
        }
        if (endpoint === 'session/list') return this.listSessions(accepted)
        if (endpoint === 'session/create') {
          const id = SessionId(randomUUID())
          await this.executor.executeSessionOperation({ id, resume: false }, () => Promise.resolve(undefined), accepted)
          return { sessionId: id }
        }
        const id = sessionId(fields.sessionId)
        if (endpoint === 'session/rename-title' || endpoint === 'session/refresh-title') {
          const titles = this.selections.titles
          if (titles === undefined || !this.canManageTitle(id)) throw new Error('native web session: title changes are unavailable for this Session owner')
          if (endpoint === 'session/rename-title') {
            if (typeof fields.title !== 'string') throw new TypeError('native web session: title must be a string')
            await this.executor.executeSessionOperation({ id, resume: true, route: this.titleRoute() },
              async (owner) => { await titles.rename(owner, fields.title as string) }, accepted)
          } else {
            await this.executor.executeSessionOperation({ id, resume: true, route: this.titleRoute() },
              async (owner) => { await titles.refresh(owner, accepted) }, accepted)
          }
          return { changed: true }
        }
        if (endpoint === 'session/select-model' || endpoint === 'session/select-preset') {
          if (this.turns.has(id)) throw new Error('native web session: selection requires an idle Session')
          const expectedRevision = fields.expectedRevision === null ? null
            : typeof fields.expectedRevision === 'number' ? SessionSeq(fields.expectedRevision)
              : (() => { throw new TypeError('native web session: invalid selection revision') })()
          if (endpoint === 'session/select-model') {
            const selection = this.selections.models
            if (selection === undefined) throw new Error('native web session: model selection is unavailable')
            const parsed = modelSelectionInput.parse(fields.selected)
            const selected = { provider: parsed.provider, model: parsed.model,
              ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort } }
            await this.executor.executeSessionOperation({ id, resume: true },
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
              route: this.config.rootRouteId ?? brandString<NativeRootRouteId>('root') }, accepted)
          }
          return { changed: true }
        }
        if (endpoint === 'session/history') return readNativeSessionHistory(id, {
          active: this.active, persistence: this.persistence, maxHistoryEvents: this.config.maxHistoryEvents,
          label: 'native web session', onCleanupFailure: (error) => { this.requests.recordCleanupFailure(error) },
        }, accepted)
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
      return { ok: false, error: { code: isImageAdmissionError(error) ? 'native/image' : 'native/session', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }

  private async listSessions(signal: AbortSignal): Promise<NativeSessionListItem[]> {
    const stored = await this.persistence.list({ signal })
    signal.throwIfAborted()
    const sessions = [...new Map(stored.map(snapshot => [snapshot.header.id, snapshot.header])).values()]
    const result = new Map<SessionId, NativeSessionListItem>()
    let cursor = 0
    const readNext = async (): Promise<void> => {
      for (;;) {
        signal.throwIfAborted()
        const header = sessions[cursor++]
        if (header === undefined) return
        let titleProjection: NativeSessionListItem['titleProjection']
        try {
          const history = await readNativeSessionHistory(header.id, {
            active: this.active,
            persistence: this.persistence,
            maxHistoryEvents: this.config.maxHistoryEvents,
            label: 'native web Session title',
            onCleanupFailure: (error) => { this.requests.recordCleanupFailure(error) },
          }, signal)
          const title = foldSessionTitle(history.events)
          titleProjection = title === undefined ? { status: 'absent' } : { status: 'resolved', title: title.title }
        } catch {
          if (signal.aborted) signal.throwIfAborted()
          titleProjection = { status: 'unavailable' }
        }
        const canManageTitle = !this.turns.has(header.id) && this.canManageTitle(header.id)
        result.set(header.id, { header, titleProjection,
          titleActions: { rename: canManageTitle, refresh: canManageTitle } })
      }
    }
    const readers = Array.from({ length: Math.min(sessionTitleReadConcurrency, sessions.length) }, () => readNext())
    const settlements = await Promise.allSettled(readers)
    signal.throwIfAborted()
    const unexpected = settlements.find(settlement => settlement.status === 'rejected')
    if (unexpected?.status === 'rejected') throw unexpected.reason
    return sessions.map(header => result.get(header.id) as NativeSessionListItem)
  }

  /** Whether the selected root route can operate on this stored or attached Session. */
  private canManageTitle(id: SessionId): boolean {
    if (this.selections.titles === undefined) return false
    const roots = this.executor.rootExecution
    const route = this.titleRoute()
    try {
      roots.resolve(route)
      const owners = this.active.owners().filter(owner => owner.session.id === id)
      if (owners.some(owner => owner.invocation === 'delegated')) return false
      const owner = owners.find(candidate => candidate.invocation === 'root')
      return owner === undefined || owner.writerAvailable && roots.capture(owner).id === route
    } catch {
      return false
    }
  }

  private titleRoute(): NativeRootRouteId {
    return this.config.rootRouteId ?? brandString<NativeRootRouteId>('root')
  }

  private async configuration(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    if (endpoint === 'settings/describe') {
      if (Object.keys(object(payload)).length !== 0) throw new TypeError('native settings: describe takes no fields')
      return {
        namespaces: this.settings().describe(),
        limits: {
          maxCredentialRefsPerRead: this.config.maxCredentialRefsPerRead,
          maxSettingsOperations: this.config.maxSettingsOperations,
        },
      }
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
    const results = await Promise.allSettled([this.requests.close(), this.controls.close(), this.settlements.close()])
    const executor = await Promise.allSettled([this.executor.dispose()])
    while (this.followTasks.size > 0) await Promise.allSettled([...this.followTasks])
    this.turns.clear()
    const errors = [...results, ...executor].flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native web session: request and executor cleanup failed')
  }
}

/** Native Host Session installer; the Web Host remains the selected application. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-web-session-controller', targets: ['host'],
  requires: ['hostConnection', 'fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'modelSelection', 'modelDirectory', 'agentPresets', 'workspaceRegistry', 'agentInstructions', 'userQuestions', 'attachments', 'settings', 'credentials', 'sessionTitles', 'commands'],
  provides: ['nativeWebSession', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeWebSessionConfig(input)
    return (context) => {
      const { maxPendingRequests: _pending, maxHistoryEvents: _history, maxPromptChars: _prompt,
        maxFollowBufferBytes: _buffer, maxFollowers: _followers, maxPendingHumanRequests: _human,
        maxCredentialRefsPerRead: _credentialRefs, maxSettingsOperations: _settingsOperations, ...turn } = config
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
      })
      const models = context.optional('modelSelection')
      const service = new NativeWebSessionService(executor, context.require('sessionPersistence'), context.require('activeSessions'), config, context.signal,
        { directory: context.optional('modelDirectory'), presets: context.optional('agentPresets'), attachments: context.optional('attachments'),
          settings: context.optional('settings'), credentials: context.optional('credentials'), titles: context.optional('sessionTitles'),
          commands: context.optional('commands'), commandScope: context.scope,
          models: models === undefined ? undefined : { selection: models, executionFor: agent => context.require('agents').execution(agent) } })
      service.bindHuman(context, context.optional('approval'), context.optional('userQuestions'))
      context.own(() => service.close())
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => endpoints.has(endpoint),
        (endpoint, payload, signal) => service.handle(endpoint, payload, signal)))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.follow(request) }))
      context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/image', methods: ['POST'], requestBody: 'buffered',
        fetch: request => service.image(request) }))
      context.provide('nativeWebSession', service)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}
