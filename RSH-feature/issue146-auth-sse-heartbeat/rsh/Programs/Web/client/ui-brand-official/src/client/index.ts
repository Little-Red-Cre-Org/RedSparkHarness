/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandMark } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar mark slot. The sidebar owns its localized product name;
 * the conversation hero keeps its declaring package's animated fallback.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.slots.inject('sidebar.brand.mark', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
  })
}
