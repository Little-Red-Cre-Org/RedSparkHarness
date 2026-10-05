/** Standard ACP carrier over the shared native Agent and Session executor. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError,
  type AgentConnection, type NewSessionRequest, type PromptRequest, type PromptResponse,
  type SessionUpdate, type SessionNotification } from '@agentclientprotocol/sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { isImageAdmissionError, type AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/native'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/model-directory'

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
}

interface OwnedSession {
  readonly executor: NativeHeadlessApplication
  current?: { readonly abort: AbortController; readonly done: Promise<PromptResponse> }
}

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('native ACP: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['provider', 'model', 'systemPrompt', 'maxSteps'].includes(key)) throw new Error(`native ACP: unknown configuration field ${key}`)
  }
  for (const key of ['provider', 'model', 'systemPrompt']) {
    if (typeof fields[key] !== 'string' || fields[key].length === 0) throw new TypeError(`native ACP: ${key} must be a nonempty string`)
  }
  if (typeof fields.maxSteps !== 'number' || !Number.isSafeInteger(fields.maxSteps) || fields.maxSteps <= 0) {
    throw new TypeError('native ACP: maxSteps must be a positive integer')
  }
  return { provider: fields.provider as string, model: fields.model as string,
    systemPrompt: fields.systemPrompt as string, maxSteps: fields.maxSteps }
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
    default: return [] // The merge-extensible Session map contains non-presentation facts.
  }
}

/** Owns one ACP connection and its independently cancellable native Sessions. */
export class NativeAcpApplication implements NativeApplication {
  private readonly sessions = new Map<string, OwnedSession>()
  private readonly lifetime = new AbortController()
  private initialized = false
  private initializing = false
  private readonly activating = new Set<string>()
  private closing = false
  private connection: AgentConnection | undefined
  private readonly pending = new Set<Promise<unknown>>()

  constructor(private readonly context: NativeContext, private readonly config: Config,
    private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {}

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
        } finally { this.initializing = false }
        return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: 'redspark-harness-native-acp', version: '0.0.1' },
          agentCapabilities: { promptCapabilities: { image: this.context.optional('attachments') !== undefined
            && this.context.optional('modelDirectory') !== undefined, audio: false, embeddedContext: false },
          mcpCapabilities: { http: false }, sessionCapabilities: { close: {}, list: {}, resume: {} } }, authMethods: [] }
      })()))
      .onRequest(methods.agent.authenticate, () => ({}))
      .onRequest(methods.agent.session.new, ({ params, signal: requestSignal }) => this.track(this.newSession(params, requestSignal)))
      .onRequest(methods.agent.session.resume, ({ params, signal: requestSignal }) => this.track((async () => {
        this.ready()
        const cwd = this.workspace(params.cwd, params.mcpServers ?? [])
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
            this.assertOpen()
            this.sessions.set(params.sessionId, this.createExecutor(params.sessionId, cwd))
            return {}
          } finally { await handle.close() }
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
      for (const record of this.sessions.values()) record.current?.abort.abort(this.lifetime.signal.reason)
      await Promise.allSettled([...this.pending])
      const results = await Promise.allSettled([...this.sessions.values()].map(record => record.executor.dispose()))
      this.sessions.clear()
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

  private workspace(cwd: string, servers: NewSessionRequest['mcpServers']): string {
    if (!isAbsolute(cwd)) throw RequestError.invalidParams(undefined, 'cwd must be absolute')
    if (servers.length > 0) throw RequestError.invalidParams(undefined, 'native ACP per-session MCP mounts are not supported')
    return resolve(cwd)
  }

  private createExecutor(id: string, cwd: string): OwnedSession {
    return { executor: createNativeHeadlessApplication(this.context, { ...this.config, cwd,
      rootRouteId: brandString<NativeRootRouteId>(`acp:${id}`) }) }
  }

  private async newSession(params: NewSessionRequest, signal: AbortSignal): Promise<{ sessionId: string }> {
    this.ready()
    const cwd = this.workspace(params.cwd, params.mcpServers)
    const fs = this.context.require('fs')
    const info = await fs.stat(await fs.resolve('.', { cwd, signal }), signal)
    if (info?.type !== 'directory') throw RequestError.invalidParams(undefined, 'cwd must be a directory')
    const id = SessionId(randomUUID())
    const handle = await this.context.require('sessionPersistence').create({ version: SESSION_FORMAT_VERSION,
      id, cwd, createdAt: Date.now(), isSeeded: false }, { signal })
    try { await handle.flush({ signal }) } finally { await handle.close() }
    this.assertOpen()
    this.sessions.set(id, this.createExecutor(id, cwd))
    return { sessionId: id }
  }

  private async notify(notification: SessionNotification): Promise<void> {
    const connection = this.connection
    if (connection === undefined) throw new Error('native ACP: no connection')
    await connection.client.notify(methods.client.session.update, notification)
  }

  private async prompt(params: PromptRequest, requestSignal: AbortSignal): Promise<PromptResponse> {
    this.ready()
    const record = this.sessions.get(params.sessionId)
    if (record === undefined) throw RequestError.invalidParams(undefined, 'unknown session')
    if (record.current !== undefined) throw RequestError.invalidRequest(undefined, 'session prompt is already running')
    if (params.prompt.length === 0) throw RequestError.invalidParams(undefined, 'native ACP prompt must be nonempty')
    const attachments = this.context.optional('attachments')
    const parts = params.prompt.map((block): AttachmentAdmissionPart => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'image') {
        const mediaType = attachments?.imageLimits.mediaTypes.find(type => type === block.mimeType)
        if (mediaType !== undefined) return { type: 'image', data: block.data, mediaType }
      }
      throw RequestError.invalidParams(undefined, 'native ACP accepts text and configured raster image formats only')
    })
    const abort = new AbortController()
    const signal = AbortSignal.any([requestSignal, abort.signal, this.lifetime.signal])
    const done = Promise.resolve().then(async (): Promise<PromptResponse> => {
      let stopReason: PromptResponse['stopReason'] = 'end_turn'
      let notifications = Promise.resolve()
      let exitCode: number
      try {
        const hasImage = parts.some(part => part.type === 'image')
        if (hasImage) {
          const directory = this.context.optional('modelDirectory')
          if (directory === undefined) throw RequestError.invalidParams(undefined, 'native ACP images require a model directory')
          await record.executor.executeSessionOperation({ id: SessionId(params.sessionId), resume: true }, async (owner, admitted) => {
            const check = async (effective: AbortSignal): Promise<void> => {
              const selection = await this.context.optional('modelSelection')?.state(owner, effective)
              const route = selection?.next ?? this.config
              const info = await directory.resolve(route.provider, route.model, effective)
              if (!info.inputModalities?.includes('image')) throw RequestError.invalidParams(undefined, 'selected model does not declare image input')
            }
            const execution = this.context.require('agents').execution(owner.agent)
            if (execution.status === 'maintenance') await check(admitted)
            else await execution.runMaintenance(agentSignal => check(AbortSignal.any([agentSignal, admitted])))
          }, signal)
        }
        signal.throwIfAborted()
        const content = attachments === undefined
          ? parts.map((part) => {
            if (part.type !== 'text') throw RequestError.invalidParams(undefined, 'native ACP images require attachment storage')
            return part
          }) : await attachments.admitPromptContent(parts)
        signal.throwIfAborted()
        const result = await record.executor.executeRootTurn({ id: SessionId(params.sessionId), resume: true,
          message: createUserMessage({ content, source: { kind: 'user' } }), onEvent: (event) => {
            for (const update of updates(event)) {
              notifications = notifications.then(() => this.notify({ sessionId: params.sessionId, update }))
              void notifications.catch(() => {}) // The prompt awaits and reports this transport failure after durable settlement.
            }
            if (event.type === 'turn/end') {
              if (event.data.reason.kind === 'max-tokens') stopReason = 'max_tokens'
              else if (event.data.reason.kind === 'interrupted') stopReason = 'cancelled'
            }
          } }, signal)
        exitCode = result.exitCode
      } catch (error: unknown) {
        if (isImageAdmissionError(error)) throw RequestError.invalidParams(undefined, error.message)
        if (!signal.aborted || error !== signal.reason) throw error
        exitCode = 1
      }
      await notifications
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
    this.sessions.delete(id)
    this.activating.add(id)
    try {
      record.current?.abort.abort(new Error('ACP Session closed'))
      await record.current?.done.catch(() => {}) // Prompt failure is returned by its own protocol request.
      await record.executor.dispose()
    } finally { this.activating.delete(id) }
    return {}
  }
}

/** Host installation for the explicitly selected native-acp profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-acp', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentInstructions', 'modelSelection',
    'sessionExecution', 'activeSessions', 'agentPresets', 'workspaceRegistry', 'attachments', 'modelDirectory'], provides: ['application'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('application', new NativeAcpApplication(context, config)) }
  },
}
