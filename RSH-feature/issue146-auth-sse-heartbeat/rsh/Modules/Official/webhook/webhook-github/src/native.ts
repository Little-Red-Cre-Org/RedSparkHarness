/** Native GitHub ingress admits trusted rule requests through the selected Session authority. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import type {} from '@deepseek-ai/dsh-http-routes/native'
import type {} from '@deepseek-ai/dsh-native-session-execution'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution/root-route'
import type { NativeWebhookRuleOperations } from '@deepseek-ai/dsh-webhook/definition'
import type { VerifiedWebhookDelivery } from '@deepseek-ai/dsh-webhook/types'
import { createGitHubWebhookRequestHandler } from './ingress.ts'

/** Explicit route, rotating credential reference, body limit, and authorized root route. */
export interface NativeGitHubWebhookConfig {
  readonly source: string
  readonly path: string
  readonly secretEnv: string
  readonly maxBodyBytes: number
  readonly rootRoute: string
}

const configuration = z.strictObject({
  source: z.string().min(1),
  path: z.string().min(2).refine(path => path.startsWith('/') && !path.endsWith('/') && !path.includes('?') && !path.includes('#'),
    'path must be an absolute non-root pathname without a trailing slash, query, or fragment'),
  secretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  maxBodyBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  rootRoute: z.string().min(1),
})

/** Validate the native configuration before requiring services or binding a route.
 * @param input - untrusted profile installation configuration.
 * @returns validated source, path, credential reference, body bound, and root route.
 */
export function resolveNativeGitHubWebhookConfig(input: unknown): NativeGitHubWebhookConfig {
  const parsed = configuration.parse(input)
  if (parsed.source.trim() !== parsed.source) throw new Error('webhook-github: source must be trimmed')
  return parsed
}

/** Real Native plugin entry selected explicitly by a profile installation. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-webhook-github',
  targets: ['host'],
  requires: ['httpRoutes', 'credentials', 'rootExecution', 'webhookRules'],
  provides: [],
  resolve(input) {
    const config = resolveNativeGitHubWebhookConfig(input)
    return async (context) => {
      const routes = context.require('httpRoutes')
      const credentials: NativeCredentials = context.require('credentials')
      const rules: NativeWebhookRuleOperations = context.require('webhookRules')
      const rootExecution = context.require('rootExecution')
      await rootExecution.ready(context.signal)
      const rootRoute = rootExecution.resolve(config.rootRoute as NativeRootRouteId)
      const handler = createGitHubWebhookRequestHandler({
        source: config.source,
        maxBodyBytes: config.maxBodyBytes,
        resolveSecret: async () => (await credentials.resolve(credentialRef(config.secretEnv)))?.value,
        dispatch: (delivery: VerifiedWebhookDelivery<'github'>) => rules.dispatch(delivery, rootRoute.id),
        warn: (message) => { console.warn(message) },
      })
      const disposeRoute = routes.register({ kind: 'exact', path: config.path, handler })
      context.own(async () => { await disposeRoute() })
    }
  },
}

export type { NativePlugin }
