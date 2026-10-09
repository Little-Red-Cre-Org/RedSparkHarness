/** Framework-independent theme values shared by browser and native Clients. */

/** Built-in user appearance choice. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Built-in preferences accepted at the settings and Native installer boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const
/** Default appearance when no profile override is selected. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'
/** Default conversation content font size in px. */
export const DEFAULT_FONT_SIZE = 14

/** Narrow a wire or installer value to a supported appearance choice.
 * @param value - Value to narrow to a supported appearance choice.
 * @returns Whether the value is a supported appearance choice.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/** One selectable palette and its alias-token overrides. */
export interface ThemeDefinition {
  /** Stable theme id. */
  readonly id: string
  /** Base palette selected by the presenter. */
  readonly colorScheme: 'light' | 'dark'
  /** Alias-token overrides for the active palette. */
  readonly tokens: Readonly<Record<string, string>>
}

/** Complete resolved preference consumed by the DOM presenter. */
export interface ThemeSnapshot {
  /** Persisted appearance choice. */
  readonly preference: ThemePreference
  /** Conversation content font size in px. */
  readonly fontSize: number
  /** Resolved palette with active alias overrides. */
  readonly active: ThemeDefinition
  /** Available theme definitions. */
  readonly themes: readonly ThemeDefinition[]
  /** Monotonic registry or preference change counter. */
  readonly revision: number
}
