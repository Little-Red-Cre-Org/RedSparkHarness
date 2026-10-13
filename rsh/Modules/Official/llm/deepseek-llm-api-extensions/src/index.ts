/**
 * DeepSeek LLM API extension registry: plugins own independent top-level request
 * fields while the official adapter performs one preparation and acceptance transaction.
 * @module @deepseek-ai/dsh-deepseek-llm-api-extensions
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  DeepSeekLlmApiExtensionMap,
  DeepSeekLlmApiExtensionProvider,
  DeepSeekLlmApiExtensionRequest,
  DeepSeekLlmApiJson,
  PreparedDeepSeekLlmApiExtensions,
} from './types.ts'
import { prepareDeepSeekLlmApiExtensions } from './registry-core.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deepseekLlmApiExtensions: DeepSeekLlmApiExtensionRegistry
  }
}

/** Registry of independently owned top-level fields for official DeepSeek requests. */
export class DeepSeekLlmApiExtensionRegistry extends Service {
  private readonly providers = new Map<string, DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiJson>>()

  constructor(ctx: Context) {
    super(ctx, 'deepseekLlmApiExtensions')
  }

  /**
   * Register the sole provider of one top-level request field. Registration is effect-scoped.
   * @param field - declaration-merged field owned by the provider.
   * @param provider - request-time field preparation and optional acceptance behavior.
   * @returns disposer that releases the field.
   */
  register<K extends keyof DeepSeekLlmApiExtensionMap>(
    field: K,
    provider: DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiExtensionMap[K]>,
  ): () => Promise<void> {
    const fieldName = field as string
    if (fieldName.length === 0 || fieldName.trim() !== fieldName) {
      throw new Error('deepseek-llm-api-extensions: field must be a non-blank trimmed string')
    }
    const providers = this.providers
    const erased = provider as DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiJson>
    const dispose = this.ctx.effect(() => {
      if (providers.has(fieldName)) {
        throw new Error(`deepseek-llm-api-extensions: field ${JSON.stringify(fieldName)} is already registered`)
      }
      providers.set(fieldName, erased)
      return () => {
        providers.delete(fieldName)
      }
    }, `deepseekLlmApiExtensions.register(${JSON.stringify(fieldName)})`)
    return dispose
  }

  /**
   * Prepare every currently registered field from one immutable base request.
   * Preparation failures reject before HTTP dispatch. Field values are cloned and frozen;
   * providers retain no mutable alias to the outgoing request.
   * @param request - exact serialized request facts before extension fields.
   * @returns detached fields and their idempotent joint acceptance transaction.
   */
  async prepare(request: DeepSeekLlmApiExtensionRequest): Promise<PreparedDeepSeekLlmApiExtensions> {
    return prepareDeepSeekLlmApiExtensions(this.providers, request)
  }
}

export default DeepSeekLlmApiExtensionRegistry
