/** Native request Consumer for exact selected DeepSeek package provenance. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/types'
import { resolveConfig } from './config.ts'
import { createInventoryExtension } from './wire.ts'

export type * from './types.ts'

/** Publish the selected package inventory to official Native DeepSeek requests. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
  targets: ['host'],
  requires: ['deepseekLlmApiExtensions', 'pluginInventory', 'activeSessions'],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      if (!config.enabled) return
      const extensions = context.require('deepseekLlmApiExtensions')
      const inventory = context.require('pluginInventory')
      const activeSessions: NativeActiveSessionOperations = context.require('activeSessions')
      context.effect(extensions.register(context.scope, 'dsh_plugin_packages', {
        prepare(request: DeepSeekLlmApiExtensionRequest) {
          request.signal.throwIfAborted()
          const owner = request.sessionId === undefined ? undefined : activeSessions.owners()
            .find(candidate => String(candidate.session.id) === request.sessionId)
          const identities = inventory.packages(owner?.agent.scope ?? context.scope)
            .map(installation => installation.package)
          return { value: createInventoryExtension(identities) }
        },
      }))
    }
  },
}
