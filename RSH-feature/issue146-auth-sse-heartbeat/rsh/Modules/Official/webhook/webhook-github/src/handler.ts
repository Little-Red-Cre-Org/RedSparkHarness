/** Cordis adapter for the existing provider-neutral webhook rule runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { HttpRoute } from '@deepseek-ai/dsh-http-routes/host'
import type {} from '@deepseek-ai/dsh-webhook'
import { createGitHubWebhookRequestHandler } from './ingress.ts'

/** Values validated once by the Cordis plugin configuration. */
export interface GitHubWebhookHandlerConfig {
  readonly source: string
  readonly secretEnv: CredentialRef
  readonly maxBodyBytes: number
}

/** Preserve Cordis credential rotation, rule dispatch, and logger ownership.
 * @param ctx - Cordis context providing credentials, webhook rules, and logging.
 * @param config - source label, credential reference, and body limit.
 * @returns a handler for the configured signed GitHub endpoint.
 */
export function createGitHubWebhookHandler(
  ctx: Context,
  config: GitHubWebhookHandlerConfig,
): HttpRoute['handler'] {
  return createGitHubWebhookRequestHandler({
    source: config.source,
    maxBodyBytes: config.maxBodyBytes,
    resolveSecret: async () => (await ctx.credentials.resolve(config.secretEnv))?.value,
    dispatch: (delivery) => { ctx.webhookRuntime.dispatch(delivery) },
    warn: (message) => { ctx.logger.warn(message) },
  })
}
