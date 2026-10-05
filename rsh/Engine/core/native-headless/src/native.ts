/** Native headless Agent authority over the existing Session and filesystem interfaces. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { NativeScope, type NativeApplication, type NativeContext, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import { FsError, type FsTarget, type FsWriteIntent } from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-approval/native'
import type {} from '@deepseek-ai/dsh-native-code-runtime/native'
import type {} from '@deepseek-ai/dsh-native-time-context/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type { NativeModelExecution } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeToolApproval, NativeToolApprovalRequest, NativeToolExecution, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import { NativeApprovalRequestId, type NativeApprovalOutcome, type NativeApprovalService } from '@deepseek-ai/dsh-native-approval'
import type { NativeCodeRuntime } from '@deepseek-ai/dsh-native-code-runtime'
import type { NativeTimeContext } from '@deepseek-ai/dsh-native-time-context'
import {
  HarnessError, createSystemMessage, createToolResultMessage, createUserMessage,
  type ContentBlock, type GenerateOptions, type ToolCallBlock, type ToolSchema, type UserMessage,
} from '@deepseek-ai/dsh-llm/native'
import { interruptedTurnClosers, SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'

/** Explicit headless request and workspace policy. */
export interface Config {
  cwd: string
  provider: string
  model: string
  systemPrompt: string
  maxSteps: number
  /** Enable fixed file/code tools independently of registry tools; defaults to true. */
  builtinTools?: boolean
}

interface ResolvedConfig extends Config {
  builtinTools: boolean
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

function resolveConfig(input: unknown): ResolvedConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native-headless: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['cwd', 'provider', 'model', 'systemPrompt', 'maxSteps', 'builtinTools'].includes(key)) throw new Error(`native-headless: unknown configuration field ${key}`)
  }
  const cwd = nonempty(fields.cwd, 'cwd')
  if (!isAbsolute(cwd)) throw new Error('native-headless: cwd must be absolute')
  const maxSteps = fields.maxSteps === undefined ? 4 : fields.maxSteps
  if (typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
    throw new Error('native-headless: maxSteps must be a positive integer')
  }
  const builtinTools = fields.builtinTools === undefined ? true : fields.builtinTools
  if (typeof builtinTools !== 'boolean') throw new Error('native-headless: builtinTools must be a boolean')
  return {
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

function codeProgram(raw: string): string {
  const value = object(JSON.parse(raw) as unknown)
  for (const key of Object.keys(value)) {
    if (key !== 'program') throw new Error(`unexpected run_code argument ${key}`)
  }
  if (typeof value.program !== 'string') throw new Error('native-headless: run_code program must be a string')
  return value.program
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
    private readonly approval: NativeApprovalService | undefined,
    private readonly codeRuntime: NativeCodeRuntime | undefined,
    private readonly timeContext: NativeTimeContext | undefined,
  ) {}

  private async target(path: string, root: FsTarget, signal: AbortSignal): Promise<FsTarget> {
    const target = await this.fs.resolve(path, { cwd: this.config.cwd, signal })
    if (!this.fs.contains(root, target)) throw new FsError(`path outside workspace: ${path}`, 'FS_SANDBOX_DENIED')
    return target
  }

  private async execute(call: ToolCallBlock, root: FsTarget, actor: object, session: Session, signal: AbortSignal): Promise<string> {
    if (call.name !== 'read_file' && call.name !== 'write_file') throw new Error(`unknown tool ${call.name}`)
    const args = toolArguments(call.arguments, call.name)
    const target = await this.target(args.path, root, signal)
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

  /** Execute one turn, checkpoint its complete log, and close write ownership before return. */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    const request = parseArgs(args)
    if (request.prompt.length === 0 && request.resume === undefined) throw new Error('native-headless: a prompt is required')
    const id = request.resume ?? SessionId(randomUUID())
    const agent: NativeAgent = { id: NativeAgentId(id), scope: new NativeScope(this.context.scope) }
    const unregister = this.agents.register(agent)
    try {
      return await this.agents.withInitiator(agent, () => this.runTurn(request, id, agent, signal))
    } finally {
      await unregister()
    }
  }

  /** Execute one turn after its native Agent lifecycle is visible. */
  private async runTurn(
    request: ReturnType<typeof parseArgs>,
    id: ReturnType<typeof SessionId>,
    agent: NativeAgent,
    signal: AbortSignal,
  ): Promise<number> {
    const additions = await this.promptSections?.render(agent.scope) ?? ''
    const systemPrompt = additions === '' ? this.config.systemPrompt : `${this.config.systemPrompt}\n\n${additions}`
    const schemas = [
      ...(this.config.builtinTools ? [...TOOL_SCHEMAS, ...(this.codeRuntime === undefined ? [] : [CODE_TOOL_SCHEMA])] : []),
      ...(this.tools?.modelSchemas(agent.scope) ?? []),
    ]
    if (new Set(schemas.map(schema => schema.name)).size !== schemas.length) {
      throw new Error('native-headless: duplicate tool schema')
    }
    const root = await this.fs.resolve(this.config.cwd, { signal })
    const rootInfo = await this.fs.stat(root, signal)
    if (rootInfo?.type !== 'directory') throw new Error('native-headless: cwd must be a directory')
    const fresh = request.resume === undefined ? Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: this.config.cwd, isSeeded: false, delegationDepth: 0,
    }) : undefined
    const writer = fresh !== undefined
      ? await this.storage.create(fresh.header, { signal })
      : await this.storage.open(id, 'write', { signal })
    let session: Session
    const pending: SessionEvent[] = []
    let closersToAppend: SessionEvent[] = []
    let turn = 1
    try {
      if (fresh !== undefined) {
        session = fresh
        this.timeContext?.seed(session, [])
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
      }
      const track = (event: SessionEvent): void => {
        pending.push(event)
        this.timeContext?.record(session, event)
      }
      let persistence: Promise<void> = Promise.resolve()
      const persist = (): Promise<void> => {
        persistence = persistence.then(async () => {
          if (pending.length === 0) return
          const accepted = [...pending]
          await writer.append(accepted)
          pending.splice(0, accepted.length)
        })
        return persistence
      }
      if (request.resume !== undefined) {
        if (session.header.cwd !== this.config.cwd) {
          throw new Error('native-headless: resumed Session workspace differs from profile configuration')
        }
        const priorSystem = session.deriveMessages().findLast(message => message.role === 'system')
        if (priorSystem !== undefined && (priorSystem.content[0]?.type !== 'text' || priorSystem.content[0].text !== systemPrompt)) {
          throw new Error('native-headless: resumed Session systemPrompt differs from profile configuration')
        }
        if (closersToAppend.length > 0) await writer.append(closersToAppend, { signal })
      }
      await persist()
      track(session.append('turn/start', { turn }))
      let reason: import('@deepseek-ai/dsh-session/native').TurnEndReason = { kind: 'completed' }
      try {
        for (let step = 1; step <= this.config.maxSteps; step++) {
          signal.throwIfAborted()
          track(session.append('step/start', { turn, step }))
          if (step === 1) {
            if (session.deriveMessages().every(message => message.role !== 'system')) {
              track(session.append('system/message', { turn, step, message: createSystemMessage(systemPrompt, 'native-headless') }, { surfaceOp: 'append' }))
            }
            if (request.prompt.length > 0) {
              track(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: request.prompt }] }), { surfaceOp: 'append' }))
            }
          }
          const timeContext = this.timeContext?.prepare({ session, turn, step })
          if (timeContext !== undefined) {
            track(session.append('user/message', timeContext, { surfaceOp: 'append' }))
          }
          const priorHeader = session.requestHeader()
          if (priorHeader === undefined || step === 1 && request.resume !== undefined) {
            track(session.append('request/header', {
              header: { config: { provider: this.config.provider, model: this.config.model }, tools: schemas },
              reason: priorHeader === undefined ? 'initial' : 'resume',
            }))
          }
          const priorContext = session.requestContext()
          if (priorContext?.provider !== this.config.provider || priorContext.model !== this.config.model) {
            track(session.append('request/context', { provider: this.config.provider, model: this.config.model }))
          }
          await persist()
          const options: GenerateOptions = {
            provider: this.config.provider, model: this.config.model,
            messages: session.deriveMessages(), tools: schemas, sessionId: id, signal,
          }
          const { message, finish } = await this.modelExecution.execute({
            session, turn, step, options, append: track, persist,
          })
          const calls = message.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
          if (finish.kind === 'max-tokens') {
            if (calls.length > 0) throw new Error('native-headless: truncated tool call')
            reason = { kind: 'max-tokens' }
          }
          let concludedByTool = false
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
              const requestApproval = async (requested: NativeToolApprovalRequest): Promise<NativeApprovalOutcome> => {
                if (requested.agent !== agent || requested.session !== session) {
                  throw new Error('native-headless: approval invocation belongs to a different Agent or Session')
                }
                const service = this.approval
                if (service === undefined) throw new Error('native-headless: no approval authority')
                const approvalId = NativeApprovalRequestId(randomUUID())
                track(session.append('native-approval/asked', {
                  id: approvalId, toolName: requested.toolName, callId: requested.callId,
                  ...requested.reason === undefined ? {} : { reason: requested.reason },
                }))
                await persist()
                await writer.flush()
                const decision = await service.request({
                  id: approvalId, agent, toolName: requested.toolName, callId: requested.callId,
                  ...requested.reason === undefined ? {} : { reason: requested.reason },
                  signal: AbortSignal.any([signal, requested.signal]),
                })
                track(session.append('native-approval/decided', decision))
                await persist()
                await writer.flush()
                return decision.outcome
              }
              const authorize = async (requested: NativeToolApproval): Promise<void> => {
                const outcome = await requestApproval({ agent, session, callId: call.id, toolName: call.name, signal, ...requested })
                if (outcome !== 'allowed-once') throw new NativeApprovalRejection(outcome, call.name)
              }
              if (this.config.builtinTools && (call.name === 'read_file' || call.name === 'write_file')) {
                if (call.name === 'write_file' && this.approval !== undefined) {
                  await authorize({ reason: 'Writing a file changes the selected workspace.' })
                }
                content = [{ type: 'text', text: await this.execute(call, root, actor, session, signal) }]
              } else if (this.config.builtinTools && call.name === 'run_code' && this.codeRuntime !== undefined) {
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
            if (execution !== undefined) this.tools?.acceptResult(execution, {
              content, isError, ...error === undefined ? {} : { error }, ...meta === undefined ? {} : { meta },
            })
            for (const context of additionalContexts) {
              track(session.append('user/message', context, { surfaceOp: 'append' }))
              await persist()
            }
          }
          track(session.append('step/end', { turn, step }))
          await persist()
          if (calls.length === 0 || concludedByTool) {
            process.stdout.write(`${message.content.filter(block => block.type === 'text').map(block => block.text).join('')}\n`)
            return 0
          }
        }
        reason = { kind: 'error', error: { code: 'STEP_LIMIT', message: 'native-headless: model step limit reached' } }
        return 1
      } catch (error: unknown) {
        reason = signal.aborted
          ? { kind: 'aborted', reason: { kind: 'disposed' } }
          : { kind: 'error', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } }
        throw error
      } finally {
        if (reason.kind === 'completed' || reason.kind === 'max-tokens' || reason.kind === 'error' && reason.error.code === 'STEP_LIMIT') {
          track(session.append('turn/end', { turn, reason }))
          await persist()
        } else {
          await persist()
          const stored = await writer.read(0, Number.MAX_SAFE_INTEGER)
          const closers = interruptedTurnClosers(stored.events)
          const repaired = closers.map(event => event.type === 'turn/end' ? {
            ...event, data: { ...event.data, reason },
          } : event)
          if (repaired.length > 0) await writer.append(repaired)
        }
        await writer.flush()
      }
    } finally {
      await writer.close()
    }
  }
}

/** Native application entry loaded only after all profile manifests are checked. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-headless', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'modelExecution', 'agents'], optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext'], provides: ['application'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      context.provide('application', new NativeHeadlessApplication(
        context, context.require('fs'), context.require('sessionPersistence'), context.require('modelExecution'), config, context.require('agents'),
        context.optional('tools'), context.optional('promptSections'), context.optional('sandboxPolicy'), context.optional('approval'), context.optional('codeRuntime'), context.optional('timeContext'),
      ))
    }
  },
}
