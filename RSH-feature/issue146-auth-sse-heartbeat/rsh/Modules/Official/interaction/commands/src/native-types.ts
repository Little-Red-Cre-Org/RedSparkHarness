/** Human command Definition over exact Program-owned Session transactions. */
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm/native'
import type { CommandId } from './brand.ts'
import type { CommandDescriptor, CommandExecution, CommandResult } from './facts.ts'

export type * from './facts.ts'
export { CommandId, CommandDefinitionId } from './brand.ts'

/** Exact parsed command name and unmodified trailing input. */
export interface NativeParsedCommand { readonly name: string; readonly rawInput: string }

/** Handler input admitted only through the Program's explicit human command entry. */
export interface NativeCommandInvocation {
  readonly commandId: CommandId
  readonly agent: NativeAgent
  readonly owner: NativeActiveSessionOwner
  readonly rawInput: string
  /** Blocks already admitted by the Program's selected attachment service. */
  readonly attachments: readonly (ImageBlock | FileBlock)[]
  readonly signal: AbortSignal
}

/** Scoped command definition; the handler never implicitly sends input to a model. */
export interface NativeCommandDefinition extends CommandDescriptor {
  readonly recordInput?: boolean
  /**
   * Run one directly admitted human command.
   * @param invocation - exact owner and durable invocation identity.
   * @returns direct UI outcome, after domain effects finish.
   */
  handler(invocation: NativeCommandInvocation): Promise<CommandResult> | CommandResult
}

/** Program's human entry, independent of a model tool execution. */
export interface NativeCommandRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly line: string
  readonly attachments: readonly (ImageBlock | FileBlock)[]
  readonly signal: AbortSignal
}

/** Definition consumed by interactive Programs and command plugins. */
export interface NativeCommandOperations {
  /**
   * Register a scoped command and retain accepted handler drain.
   * @param definition - validated name, UI metadata and handler.
   * @param scope - registration visibility and contribution lifetime.
   * @returns exact cancellation and quiescent release.
   */
  register(definition: NativeCommandDefinition, scope?: NativeScope): () => Promise<void>
  /**
   * Parse slash syntax while preserving separator whitespace.
   * @param line - full human input.
   * @returns parsed command, or undefined for ordinary input.
   */
  parse(line: string): NativeParsedCommand | undefined
  /**
   * List visible command metadata without handlers.
   * @param scope - consuming Program Agent visibility.
   * @returns immutable metadata copies.
   */
  list(scope: NativeScope): readonly CommandDescriptor[]
  /**
   * Persist and execute an explicit human command through the sole writer.
   * @param request - root invocation with exact live Agent/Session and admitted attachments.
   * @returns paired outcome, or undefined when no visible command matches.
   */
  dispatch(request: NativeCommandRequest): Promise<CommandExecution | undefined>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { commands: NativeCommandOperations }
}
