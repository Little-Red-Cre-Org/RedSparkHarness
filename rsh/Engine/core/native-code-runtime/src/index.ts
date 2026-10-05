/** Native code-execution vocabulary and worker-thread Provider. */
import { fileURLToPath } from 'node:url'
import type { CodeRunRequest, CodeRunResult } from './types.ts'

export type {
  CodeBindingErrorClass,
  CodeBindingFunction,
  CodeBindingNamespace,
  CodeJsonValue,
  CodeRunFailure,
  CodeRunRequest,
  CodeRunResult,
} from './types.ts'
export { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from './worker-thread.ts'
export type { Config as NativeWorkerThreadCodeRuntimeConfig, ResolvedConfig as ResolvedNativeWorkerThreadCodeRuntimeConfig } from './worker-thread.ts'
export { plugin } from './native.ts'
export { DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from './vocabulary.ts'

export { snapshotCodeJsonValue } from './worker-json.ts'

/**
 * Resolve the private child entry used by the process-sandbox Provider.
 * @returns the absolute child entry path.
 */
export function nativeCodeRuntimeChildPath(): string {
  return fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './process-child.ts' : './process-child.js', import.meta.url))
}

/** Framework-free code runtime selected by a native Host profile. */
export interface NativeCodeRuntime {
  readonly language: string
  readonly isolation: string
  /** @param request - model-written program and explicit bindings. @returns the resolved program outcome. */
  run(request: CodeRunRequest): Promise<CodeRunResult>
  /** @returns completion after all live execution substrates have exited. */
  dispose(): Promise<void>
}
