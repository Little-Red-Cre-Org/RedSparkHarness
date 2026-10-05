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
    const calls = new Map(events.filter(event => event.type === 'tool/call').map(event => [event.seq, event]))
    const paths: string[] = []
    for (const event of events) {
      if (event.type !== 'tool/result' || event.data.error !== undefined) continue
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-result' || block.isError) continue
        for (const seq of event.sourceEventSeqs ?? []) {
          const call = calls.get(seq)
          if (call === undefined || call.data.callId !== block.toolCallId
            || call.data.turn !== event.data.turn || call.data.step !== event.data.step
            || !['read', 'write', 'edit'].includes(call.data.name)) continue
          let argumentsValue: unknown
          try { argumentsValue = JSON.parse(call.data.arguments) }
          catch (error) {
            if (!(error instanceof SyntaxError)) throw error
            continue
          }
          if (typeof argumentsValue !== 'object' || argumentsValue === null
            || !('file_path' in argumentsValue) || typeof argumentsValue.file_path !== 'string') continue
          const path = argumentsValue.file_path.trim()
          if (path.length > 0) paths.push(path)
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
    if (!result.isError && !call.signal.aborted && ['read', 'write', 'edit'].includes(call.name)
      && typeof call.arguments === 'object' && call.arguments !== null
      && 'file_path' in call.arguments && typeof call.arguments.file_path === 'string') {
      const path = call.arguments.file_path.trim()
      if (path.length > 0) paths.push(path)
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
