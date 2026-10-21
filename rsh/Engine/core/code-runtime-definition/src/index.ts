/** Framework-free code execution vocabulary shared by its Providers and Consumers. */
import type {} from '@deepseek-ai/dsh-native-runtime'

export type {
  CodeBindingErrorClass,
  CodeBindingFunction,
  CodeBindingNamespace,
  CodeJsonValue,
  CodeRunFailure,
  CodeRunRequest,
  CodeRunResult,
  NativeCodeRunRequest,
} from './types.ts'
export { DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from './vocabulary.ts'

import type { CodeRunRequest, CodeRunResult, NativeCodeRunRequest } from './types.ts'

/**
 * Cordis-free code-execution operations implemented by a selected backend.
 * Program, budget, abort, and substrate failures resolve in {@link CodeRunResult};
 * only Service Definition misuse rejects. Implementations bridge
 * structured-cloneable bindings, materialize each declared namespace rejection
 * class, isolate runs from one another, and terminate in-flight runs on disposal.
 */
export interface CodeRuntimeDefinition {
  /**
   * Source language {@link run} expects in `program`, as a lowercase
   * identifier. Informational rather than gating: consumers that generate
   * language-specific presentation switch on this value and fail loudly when
   * they cannot present it. The current tool SDK presents `'typescript'` and
   * `'python'`.
   */
  readonly language: string
  /**
   * Execution substrate as a lowercase identifier. Informational rather than
   * a security claim; known values include `'worker-thread'`, `'process'`, and
   * `'container'`.
   */
  readonly isolation: string
  /**
   * Execute one program against its declared bindings and capture its output.
   * @param request - the program, its bindings, and its abort signal.
   * @returns the run outcome, including any program or substrate failure.
   */
  run(request: CodeRunRequest): Promise<CodeRunResult>
}

/** Native implementations also own and drain their execution substrates. */
export interface NativeCodeRuntime extends CodeRuntimeDefinition {
  /**
   * Execute one program with an optional native stop notification for binding cleanup.
   * @param request - the program, its bindings, abort signal, and optional stop callback.
   * @returns the run outcome, including any program or substrate failure.
   */
  run(request: NativeCodeRunRequest): Promise<CodeRunResult>
  /** @returns completion after every live execution substrate has exited. */
  dispose(): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { codeRuntime: NativeCodeRuntime }
}
