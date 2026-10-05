/** Native workspace instructions prepared against the single durable Session authority. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session/native'
import type { NativeToolExecution, NativeToolResult } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import { Config, resolveConfig } from './config.ts'
import { InstructionComposer } from './composition.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { agentInstructions: NativeAgentInstructions }
}

function touchedFile(name: string, args: unknown): string | undefined {
  if (!['read', 'write', 'edit'].includes(name) || typeof args !== 'object' || args === null
    || !('file_path' in args) || typeof args.file_path !== 'string') return undefined
  const path = args.file_path.trim()
  return path.length === 0 ? undefined : path
}

/** Request-context Provider; accepted filesystem results enable nested instruction discovery. */
export class NativeAgentInstructions {
  private readonly touches = new WeakMap<Session, string[]>()
  private readonly nestedTouches = new WeakMap<NativeToolExecution, string[]>()
  /** @param composer - shared instruction discovery and durable reconciliation. @param lifetime - installation cancellation. */
  constructor(private readonly composer: InstructionComposer, private readonly lifetime: AbortSignal) {}

  /**
   * Restore discovery hints from accepted calls and their successful durable results.
   * @param session - exact restored Session whose cwd resolves relative file paths.
   * @param events - writer-owned committed history, including inherited calls.
   */
  seed(session: Session, events: readonly SessionEvent[]): void {
    if (this.lifetime.aborted) return
    const calls = new Map<SessionEvent['seq'], {
      call: Extract<SessionEvent, { type: 'tool/call' }>
      nested: string[]
      starts: Map<string, Extract<SessionEvent, { type: 'tool/ptc-dispatch-start' }>>
    }>()
    const paths: string[] = []
    for (const event of events) {
      if (event.type === 'tool/call') {
        calls.set(event.seq, { call: event, nested: [], starts: new Map() })
      } else if (event.type === 'tool/ptc-dispatch-start') {
        const owner = [...calls.values()].findLast(value => value.call.data.callId === event.data.rootCallId)
        if (owner?.call.data.name === 'run_code' && event.data.parentCallId === event.data.rootCallId) {
          owner.starts.set(event.data.subCallId, event)
        }
      } else if (event.type === 'tool/ptc-dispatch') {
        const owner = [...calls.values()].findLast(value => value.call.data.callId === event.data.rootCallId)
        const start = owner?.starts.get(event.data.subCallId)
        if (start === undefined || owner === undefined) continue
        owner.starts.delete(event.data.subCallId)
        if (event.data.isError || start.data.rootCallId !== event.data.rootCallId
          || start.data.parentCallId !== event.data.parentCallId || start.data.name !== event.data.name
          || JSON.stringify(start.data.arguments) !== JSON.stringify(event.data.arguments)) continue
        const path = touchedFile(event.data.name, start.data.arguments)
        if (path !== undefined) owner.nested.push(path)
      } else if (event.type === 'tool/result') {
        for (const block of event.data.message.content) {
          if (block.type !== 'tool-result') continue
          for (const seq of event.sourceEventSeqs ?? []) {
            const owner = calls.get(seq)
            if (owner === undefined || owner.call.data.callId !== block.toolCallId
              || owner.call.data.turn !== event.data.turn || owner.call.data.step !== event.data.step) continue
            calls.delete(seq)
            paths.push(...owner.nested)
            if (block.isError || event.data.error !== undefined) continue
            let argumentsValue: unknown
            try { argumentsValue = JSON.parse(owner.call.data.arguments) }
            catch (error) {
              if (!(error instanceof SyntaxError)) throw error
              continue
            }
            const path = touchedFile(owner.call.data.name, argumentsValue)
            if (path !== undefined) paths.push(path)
          }
        }
      }
    }
    this.touches.set(session, [...new Set([...this.touches.get(session) ?? [], ...paths])])
  }

  /**
   * Observe a persisted tool result without starting background file reads.
   * @param call - settled filesystem or enclosing program invocation.
   * @param result - final result accepted by its Session owner.
   */
  acceptResult(call: NativeToolExecution, result: Readonly<NativeToolResult>): void {
    if (this.lifetime.aborted) return
    const paths = this.nestedTouches.get(call) ?? []
    this.nestedTouches.delete(call)
    if (!result.isError && !call.signal.aborted) {
      const path = touchedFile(call.name, call.arguments)
      if (path !== undefined) paths.push(path)
    }
    if (paths.length === 0) return
    if (call.parent !== undefined) {
      this.nestedTouches.set(call.parent, [...this.nestedTouches.get(call.parent) ?? [], ...paths])
    } else {
      this.touches.set(call.session, [...this.touches.get(call.session) ?? [], ...paths])
    }
  }

  /**
   * Prepare one instruction message for the admitted model request.
   * @param session - exact writer-owned Session whose visible messages define prior instruction state.
   * @param inputs - admitted user messages, before they are appended.
   * @param signal - request cancellation.
   * @returns context that the caller must append before deriving model history, or undefined when unchanged.
   */
  async prepare(session: Session, inputs: readonly UserMessage[], signal: AbortSignal): Promise<UserMessage | undefined> {
    const effective = AbortSignal.any([signal, this.lifetime])
    const paths = this.touches.get(session) ?? []
    const message = await this.composer.compose(session, effective, inputs, [], paths)
    effective.throwIfAborted()
    this.touches.delete(session)
    return message
  }
}

/** Native instruction Provider sharing discovery, byte budgeting and rendering with Cordis. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-agent-instructions', targets: ['host'],
  requires: ['fs'], optional: ['tools'], provides: ['agentInstructions'],
  resolve(input) {
    const config = resolveConfig(Config(input as Config))
    return (context) => {
      const instructions = new NativeAgentInstructions(new InstructionComposer(config, context.require('fs')), context.signal)
      const tools = context.optional('tools')
      if (tools !== undefined) context.own(tools.onResult((call, result) => instructions.acceptResult(call, result), context.scope))
      context.provide('agentInstructions', instructions)
    }
  },
}
