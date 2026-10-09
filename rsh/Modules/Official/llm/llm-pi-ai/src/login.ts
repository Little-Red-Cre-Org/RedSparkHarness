/** Cordis registration for shared pi-ai authorization flows. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import type { PiAiAuthInjection } from './adapter.ts'
import { createPiAiFlows } from './login-core.ts'

/**
 * Register login flows for installed providers that pi-ai can authenticate.
 * @param ctx - the Cordis context carrying the authorization service.
 * @param auth - the injectables used to construct each pi-ai collection.
 * @returns nothing; Cordis owns the flow registrations.
 */
export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {
  for (const flow of createPiAiFlows(auth, (providerId) => {
    ctx.logger.warn(
      'llm-pi-ai: catalog provider "%s" cannot address a credential record; its sign-in is not offered',
      providerId)
  })) ctx.authorization.registerFlow(flow)
}
