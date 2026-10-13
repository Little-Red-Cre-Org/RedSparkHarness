/** Shared preparation and acceptance semantics for Cordis and Native registry faces. */
import type {
  DeepSeekLlmApiExtensionRequest,
  DeepSeekLlmApiJson,
  PreparedDeepSeekLlmApiExtensions,
} from './types.ts'

interface ErasedResult {
  readonly value: DeepSeekLlmApiJson
  accept?(): void | Promise<void>
}

interface ErasedProvider {
  prepare(request: DeepSeekLlmApiExtensionRequest): ErasedResult | undefined | Promise<ErasedResult | undefined>
}

/** Recursively freeze a fresh structured clone. */
function freezeJson<T extends DeepSeekLlmApiJson>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

/** Settle every acceptance callback before reporting failures. */
async function acceptAll(callbacks: readonly (() => void | Promise<void>)[]): Promise<void> {
  const outcomes = await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(callback)))
  const failures: unknown[] = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map(outcome => outcome.reason as unknown)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'DeepSeek LLM API extension acceptance failed')
}

/** Stop awaiting provider work when the containing model request is cancelled. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await Promise.race([work, aborted.promise])
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Prepare a detached field snapshot and its one post-2xx acceptance transaction.
 * @param providers - Visible field providers selected by the caller.
 * @param request - Extension request passed to each selected provider.
 * @returns Detached JSON fields and an idempotent callback that accepts every prepared provider.
 */
export async function prepareDeepSeekLlmApiExtensions(
  providers: Iterable<readonly [string, ErasedProvider]>,
  request: DeepSeekLlmApiExtensionRequest,
): Promise<PreparedDeepSeekLlmApiExtensions> {
  request.signal.throwIfAborted()
  const prepared = await abortable(Promise.all([...providers].map(async ([field, provider]) => ({
    field,
    result: await provider.prepare(request),
  }))), request.signal)
  const fields: Record<string, DeepSeekLlmApiJson> = Object.create(null) as Record<string, DeepSeekLlmApiJson>
  const callbacks: Array<() => void | Promise<void>> = []
  for (const { field, result } of prepared) {
    if (result === undefined) continue
    fields[field] = freezeJson(structuredClone(result.value))
    const accept = result.accept?.bind(result)
    if (accept !== undefined) callbacks.push(accept)
  }
  Object.freeze(fields)
  let acceptance: Promise<void> | undefined
  return {
    fields,
    accept: () => acceptance ??= acceptAll(callbacks),
  }
}
