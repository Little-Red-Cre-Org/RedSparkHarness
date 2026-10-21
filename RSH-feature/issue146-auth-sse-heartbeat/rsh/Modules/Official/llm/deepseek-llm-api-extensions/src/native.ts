/** Native request-field registry Provider for the official DeepSeek adapter. */
import { NativeContributions, type NativeContext, type NativePlugin, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type {
  DeepSeekLlmApiExtensionMap,
  DeepSeekLlmApiExtensionProvider,
  DeepSeekLlmApiExtensionRequest,
  DeepSeekLlmApiJson,
  PreparedDeepSeekLlmApiExtensions,
} from './types.ts'
import { prepareDeepSeekLlmApiExtensions } from './registry-core.ts'

export type * from './types.ts'

/** Scoped Native API for registering and preparing DeepSeek request fields. */
export interface NativeDeepSeekLlmApiExtensions {
  /**
   * Register one field in a visible Native scope.
   * @param scope - exact installation scope that owns the contribution.
   * @param field - declaration-merged request field.
   * @param provider - request-time field preparation and optional acceptance behavior.
   * @returns a disposer for the registration.
   */
  register<K extends keyof DeepSeekLlmApiExtensionMap>(
    scope: NativeScope,
    field: K,
    provider: DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiExtensionMap[K]>,
  ): () => void
  /**
   * Prepare fields visible from one exact request scope.
   * @param scope - active Agent scope, or the model installation scope without an active owner.
   * @param request - exact serialized request facts and cancellation signal.
   * @returns detached fields and their one post-2xx acceptance transaction.
   */
  prepare(scope: NativeScope, request: DeepSeekLlmApiExtensionRequest): Promise<PreparedDeepSeekLlmApiExtensions>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    deepseekLlmApiExtensions: NativeDeepSeekLlmApiExtensions
  }
}

type ErasedProvider = DeepSeekLlmApiExtensionProvider<DeepSeekLlmApiJson>

/** Construct the Native registry service for one provider-root scope. */
function registryProvider(context: NativeContext): NativeDeepSeekLlmApiExtensions {
  const contributions = new NativeContributions<ErasedProvider>(context.scope)
  context.own(() => { contributions.clear() })
  return {
    register(scope, field, provider) {
      const fieldName = field as string
      if (fieldName.length === 0 || fieldName.trim() !== fieldName) {
        throw new Error('deepseek-llm-api-extensions: field must be a non-blank trimmed string')
      }
      return contributions.register(fieldName, provider, scope)
    },
    prepare(scope, request) {
      return prepareDeepSeekLlmApiExtensions(contributions.visible(scope), request)
    },
  }
}

/** Provide the scoped Native extension registry without a Cordis dependency. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-deepseek-llm-api-extensions',
  targets: ['host'],
  requires: [],
  provides: ['deepseekLlmApiExtensions'],
  resolve: () => (context) => {
    context.provide('deepseekLlmApiExtensions', registryProvider(context))
  },
}
