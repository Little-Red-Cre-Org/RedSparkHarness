/** Native code-execution vocabulary and worker-thread Provider. */
import { fileURLToPath } from 'node:url'

export type {
  CodeBindingErrorClass,
  CodeBindingFunction,
  CodeBindingNamespace,
  CodeJsonValue,
  CodeRunFailure,
  CodeRunRequest,
  CodeRunResult,
  NativeCodeRunRequest,
  NativeCodeRuntime,
} from '@deepseek-ai/dsh-code-runtime-definition'
export { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from './worker-thread.ts'
export type { Config as NativeWorkerThreadCodeRuntimeConfig, ResolvedConfig as ResolvedNativeWorkerThreadCodeRuntimeConfig } from './worker-thread.ts'
export { plugin } from './native.ts'
export { DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime-definition'

export { snapshotCodeJsonValue } from './worker-json.ts'

/**
 * Resolve the private child entry used by the process-sandbox Provider.
 * @returns the absolute child entry path.
 */
export function nativeCodeRuntimeChildPath(): string {
  return fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './process-child.ts' : './process-child.js', import.meta.url))
}
