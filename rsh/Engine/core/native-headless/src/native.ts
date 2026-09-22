/** Native headless Agent authority over the existing Session and filesystem interfaces. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import { FsError, type FsTarget, type FsWriteIntent } from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import {
  AssistantStreamAccumulator, BlockAssembler, createAssistantMessage, createSystemMessage,
  createToolResultMessage, createUserMessage,
  type ContentBlock, type GenerateOptions, type StreamChunk, type ToolCallBlock, type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { interruptedTurnClosers, SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'

/** One selected model route. The P2 fixture substitutes only this external capability. */
export interface NativeModel {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    model: NativeModel
  }
}

/** Explicit headless request and workspace policy. */
export interface Config {
  cwd: string
  provider: string
  model: string
  systemPrompt: string
  maxSteps: number
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

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`native-headless: ${name} must be a nonempty string`)
  return value
}

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native-headless: configuration must be an object')
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['cwd', 'provider', 'model', 'systemPrompt', 'maxSteps'].includes(key)) throw new Error(`native-headless: unknown configuration field ${key}`)
  }
  const cwd = nonempty(fields.cwd, 'cwd')
  if (!isAbsolute(cwd)) throw new Error('native-headless: cwd must be absolute')
  const maxSteps = fields.maxSteps === undefined ? 4 : fields.maxSteps
  if (typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
    throw new Error('native-headless: maxSteps must be a positive integer')
  }
  return {
    cwd: resolve(cwd), provider: nonempty(fields.provider, 'provider'), model: nonempty(fields.model, 'model'),
    systemPrompt: nonempty(fields.systemPrompt, 'systemPrompt'), maxSteps,
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

function parseArgs(args: readonly string[]): { prompt: string; resume?: ReturnType<typeof SessionId> } {
  if (args[0] === '--resume') {
    if (args[1] === undefined || args[1].length === 0) throw new Error('native-headless: --resume needs a Session id')
    return { resume: SessionId(args[1]), prompt: args.slice(2).join(' ') }
  }
  return { prompt: args.join(' ') }
}

/** One profile-owned application; the host cancels admitted work before releasing its Providers. */
export class NativeHeadlessApplication implements NativeApplication {
  constructor(
    private readonly context: NativeContext,
    private readonly fs: import('@deepseek-ai/dsh-fs/native').FileSystemOperations,
    private readonly storage: JsonlSessionBackend,
    private readonly model: NativeModel,
    private readonly config: Config,
    private readonly tools: NativeToolRegistry | undefined,
    private readonly promptSections: NativePromptRegistry | undefined,
    private readonly sandboxPolicy: NativeSandboxPolicy | undefined,
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

  /** Execute one turn, checkpoint its complete log, and close write ownership before return. */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    const request = parseArgs(args)
    if (request.prompt.length === 0 && request.resume === undefined) throw new Error('native-headless: a prompt is required')
    const additions = await this.promptSections?.render() ?? ''
    const systemPrompt = additions === '' ? this.config.systemPrompt : `${this.config.systemPrompt}\n\n${additions}`
    const schemas = [...TOOL_SCHEMAS, ...(this.tools?.schemas() ?? [])]
    if (new Set(schemas.map(schema => schema.name)).size !== schemas.length) {
      throw new Error('native-headless: duplicate tool schema')
    }
    const root = await this.fs.resolve(this.config.cwd, { signal })
    const rootInfo = await this.fs.stat(root, signal)
    if (rootInfo?.type !== 'directory') throw new Error('native-headless: cwd must be a directory')
    const id = request.resume ?? SessionId(randomUUID())
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
      } else {
        const stored = await writer.read(0, Number.MAX_SAFE_INTEGER, { signal })
        const closers = interruptedTurnClosers(stored.events)
        closersToAppend = closers
        const repaired = [...stored.events, ...closers]
        const lastTurn = repaired.findLast(event => event.type === 'turn/end')
        turn = lastTurn?.type === 'turn/end' ? lastTurn.data.turn + 1 : 1
        session = Session.fromRestore(id, repaired, writer.header, writer.inheritedEventCount, stored.eventState,
          (event) => { pending.push(event) })
      }
      const persist = async (): Promise<void> => {
        if (pending.length > 0) {
          await writer.append(pending)
          pending.length = 0
        }
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
      pending.push(session.append('turn/start', { turn }))
      let reason: import('@deepseek-ai/dsh-session').TurnEndReason = { kind: 'completed' }
      try {
        for (let step = 1; step <= this.config.maxSteps; step++) {
          signal.throwIfAborted()
          pending.push(session.append('step/start', { turn, step }))
          if (step === 1) {
            if (session.deriveMessages().every(message => message.role !== 'system')) {
              pending.push(session.append('system/message', { turn, step, message: createSystemMessage(systemPrompt, 'native-headless') }, { surfaceOp: 'append' }))
            }
            if (request.prompt.length > 0) {
              pending.push(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: request.prompt }] }), { surfaceOp: 'append' }))
            }
          }
          const priorHeader = session.requestHeader()
          if (priorHeader === undefined || step === 1 && request.resume !== undefined) {
            pending.push(session.append('request/header', {
              header: { config: { provider: this.config.provider, model: this.config.model }, tools: schemas },
              reason: priorHeader === undefined ? 'initial' : 'resume',
            }))
          }
          const priorContext = session.requestContext()
          if (priorContext?.provider !== this.config.provider || priorContext.model !== this.config.model) {
            pending.push(session.append('request/context', { provider: this.config.provider, model: this.config.model }))
          }
          await persist()
          const options: GenerateOptions = {
            provider: this.config.provider, model: this.config.model,
            messages: session.deriveMessages(), tools: schemas, sessionId: id, signal,
          }
          const accumulator = new AssistantStreamAccumulator()
          const assembler = new BlockAssembler()
          let finished = false
          try {
            for await (const chunk of this.model.stream(options)) {
              signal.throwIfAborted()
              if (finished) throw new Error('native-headless: model emitted data after terminal finish')
              if (chunk.type === 'finish') finished = true
              assembler.push(accumulator.push({ time: Date.now(), chunk }).chunk)
            }
            signal.throwIfAborted()
            if (!finished) throw new Error('native-headless: model ended without terminal finish')
          } catch (error: unknown) {
            pending.push(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
            throw error
          }
          if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
            pending.push(session.append('assistant/attempt', { turn, step, stream: [...accumulator.snapshot()] }))
            throw new Error(`native-headless: model ${assembler.finish.kind}: ${assembler.finish.failure.message}`)
          }
          const message = createAssistantMessage({ content: assembler.blocks(), source: {
            provider: this.config.provider, model: this.config.model,
          } })
          pending.push(session.append('assistant/message', {
            turn, step, message, stream: [...accumulator.snapshot()],
            ...assembler.usage === undefined ? {} : { usage: assembler.usage },
          }, { surfaceOp: 'append' }))
          await persist()
          const calls = message.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
          if (assembler.finish.kind === 'max-tokens') {
            if (calls.length > 0) throw new Error('native-headless: truncated tool call')
            reason = { kind: 'max-tokens' }
          }
          const actor = { agent: { session } }
          for (const call of calls) {
            pending.push(session.append('tool/call', { turn, step, callId: call.id, name: call.name, arguments: call.arguments }))
            await persist()
            let content: ContentBlock[]
            let isError = false
            let error: { name: string; code: string } | undefined
            try {
              if (call.name === 'read_file' || call.name === 'write_file') {
                content = [{ type: 'text', text: await this.execute(call, root, actor, session, signal) }]
              } else {
                if (this.tools === undefined) throw new Error(`unknown tool ${call.name}`)
                const result = await this.tools.execute({
                  callId: call.id, name: call.name, arguments: JSON.parse(call.arguments) as unknown, session, signal,
                })
                content = [...result.content]
                isError = result.isError
                error = result.error === undefined ? undefined : { ...result.error }
              }
            } catch (failure: unknown) {
              if (signal.aborted) throw failure
              content = [{ type: 'text', text: failure instanceof Error ? failure.message : String(failure) }]
              isError = true
              error = { name: failure instanceof Error ? failure.name : 'Error', code: failure instanceof FsError ? failure.code : 'UNKNOWN' }
            }
            pending.push(session.append('tool/result', {
              turn, step, message: createToolResultMessage({ callId: call.id, content, isError }),
              ...error === undefined ? {} : { error },
            }, { surfaceOp: 'append', sourceEventSeqs: [SessionSeq(session.seq - 1)] }))
            await persist()
          }
          pending.push(session.append('step/end', { turn, step }))
          await persist()
          if (calls.length === 0) {
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
          pending.push(session.append('turn/end', { turn, reason }))
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
  requires: ['fs', 'sessionPersistence', 'model'], optional: ['tools', 'promptSections', 'sandboxPolicy'], provides: ['application'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      context.provide('application', new NativeHeadlessApplication(
        context, context.require('fs'), context.require('sessionPersistence'), context.require('model'), config,
        context.optional('tools'), context.optional('promptSections'), context.optional('sandboxPolicy'),
      ))
    }
  },
}
