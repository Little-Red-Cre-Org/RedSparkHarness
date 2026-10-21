/** Cordis Service adapter for the framework-free code execution definition. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { CodeRunRequest, CodeRunResult, CodeRuntimeDefinition } from '@deepseek-ai/dsh-code-runtime-definition'

export type {
  CodeBindingErrorClass,
  CodeBindingFunction,
  CodeBindingNamespace,
  CodeJsonValue,
  CodeRunFailure,
  CodeRunRequest,
  CodeRunResult,
} from '@deepseek-ai/dsh-code-runtime-definition'
export { DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime-definition'

declare module '@deepseek-ai/cordis' {
  interface Context {
    codeRuntime: CodeRuntimeDefinition
  }
}

/**
 * Registers one {@link CodeRuntimeDefinition} as `ctx.codeRuntime` for a Cordis application.
 * Program, budget, abort, and substrate failures resolve in {@link CodeRunResult}; only Service Definition misuse rejects.
 */
export abstract class CodeRuntime extends Service implements CodeRuntimeDefinition {
  /** Source language accepted by this backend. */
  abstract readonly language: string
  /** Execution substrate identifier, not a security claim. */
  abstract readonly isolation: string

  constructor(ctx: Context) {
    super(ctx, 'codeRuntime')
  }

  /**
   * Execute one program against its declared bindings and capture its output.
   * @param request - source program, host bindings, and cancellation signal.
   * @returns the program's resolved outcome, including any reported run failure.
   */
  abstract run(request: CodeRunRequest): Promise<CodeRunResult>
}

export default CodeRuntime
