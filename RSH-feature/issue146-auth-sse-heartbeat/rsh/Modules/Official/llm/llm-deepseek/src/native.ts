/** Native official DeepSeek Provider over the existing fetch/SSE adapter and shared configuration. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAdapterModel } from '@deepseek-ai/dsh-native-model-execution/native'
import { NativeAdapterModelDirectory } from '@deepseek-ai/dsh-native-model-execution/adapter-directory'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions/native'
import type { NativeDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type {} from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-launch-environment/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-fs/native'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm/native'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/types'
import { DeepSeekAdapter } from './adapter.ts'
import { Config, resolveAdapterOptions } from './config.ts'

const PROVIDER = 'deepseek-official'

/** Publish the actual official adapter with one installation-captured configuration. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-llm-deepseek', targets: ['host'],
  requires: ['credentials', 'launchEnvironment'],
  optional: ['attachments', 'fs', 'activeSessions', 'deepseekLlmApiExtensions'], provides: ['model', 'modelDirectory'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
      throw new Error('llm-deepseek: native configuration must be an object')
    }
    for (const key of Object.keys(input ?? {})) {
      if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) throw new Error(`llm-deepseek: unknown native configuration field ${key}`)
    }
    const config = Config(input ?? {})
    return (context) => {
      const environment = context.require('launchEnvironment')
      const credentials = context.require('credentials')
      const activeSessions: NativeActiveSessionOperations | undefined = context.optional('activeSessions')
      const attachments = context.optional('attachments')
      const fs = context.optional('fs')
      const extensions: NativeDeepSeekLlmApiExtensions | undefined = context.optional('deepseekLlmApiExtensions')
      const options = resolveAdapterOptions(config, environment)
      const home = environment.get('DSH_HOME')
      const adapter = new DeepSeekAdapter({
        options: () => options,
        async resolveApiKey(connection) {
          const hit = await credentials.resolve(connection.apiKeyEnv)
          context.signal.throwIfAborted()
          if (hit === undefined) throw new LlmError(`llm-deepseek: no API key for provider route "${PROVIDER}"; set ${connection.apiKeyEnv} in the credential store or launch environment`, 'MISSING_CREDENTIAL')
          return assertUsableApiKey(hit.value, 'llm-deepseek', connection.apiKeyEnv)
        },
        resolveUserId: () => getOrCreateAnonymousUserId({ env: { ...home === undefined ? {} : { DSH_HOME: home.value } } }),
        resolveAttachments: () => attachments,
        resolveImageAccess: (store, ref) => resolveImageAttachmentAccess(store, hostPath => fs?.processPathFromHostPath(hostPath), ref),
        prepareExtensions: (request: DeepSeekLlmApiExtensionRequest) => {
          if (extensions === undefined) return Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
          const owner = request.sessionId === undefined || activeSessions === undefined ? undefined : activeSessions.owners()
            .find(candidate => String(candidate.session.id) === request.sessionId)
          return extensions.prepare(owner?.agent.scope ?? context.scope, request)
        },
      })
      const model = new NativeAdapterModel(adapter, context.signal)
      context.own(() => model.close())
      const directory = new NativeAdapterModelDirectory(adapter, () => [PROVIDER], context.signal)
      context.own(() => directory.dispose())
      context.provide('modelDirectory', directory)
      context.provide('model', model)
    }
  },
}
