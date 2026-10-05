/** Pure common dictionaries and interpolation shared by native and compatibility locale consumers. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { CommonKey } from './locales/zh.ts'
export { en, zh } from './locales/index.ts'
export type { CommonKey } from './locales/zh.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared vocabulary consulted after an entry's own namespace. */
    common: CommonKey
  }
}

/**
 * Substitute the existing locale template's named parameters.
 * @param template - dictionary text.
 * @param params - optional interpolation values; missing values retain the placeholder.
 * @returns formatted text.
 */
export function formatLocaleTemplate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}
