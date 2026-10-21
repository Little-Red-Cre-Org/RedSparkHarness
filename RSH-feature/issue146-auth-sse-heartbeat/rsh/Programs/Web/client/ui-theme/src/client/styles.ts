import type { Context } from '@deepseek-ai/cordis'
import { installThemeStyles as installGlobalThemeStyles } from '../theme-sheets.ts'

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  ctx.effect(() => installGlobalThemeStyles(), 'ui-theme: global stylesheets')
}
