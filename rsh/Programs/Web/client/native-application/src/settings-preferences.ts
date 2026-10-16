/** Applies Host-backed locale and appearance preferences to native Client services. */
import type { NativeLocaleService } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeSettingsDescription } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'

/** Apply published language, theme, and font-size preferences.
 * @param description - Host Settings namespaces.
 * @param setters - Native Client locale and theme setters.
 */
export function applyNativeSettingsPreferences(
  description: NativeSettingsDescription,
  setters: {
    setLocale: NativeLocaleService['setLocale']
    setThemePreference: NativeThemeService['setPreference']
    setFontSize: NativeThemeService['setFontSize']
  },
): void {
  const rows = description.namespaces
  const localePreference = rows.find(row => row.namespace === 'locale')?.value.preference
  if (localePreference === 'en' || localePreference === 'zh') setters.setLocale(localePreference)
  const themeSettings = rows.find(row => row.namespace === 'ui-theme')
  const preference = themeSettings?.value.preference
  if (preference === 'light' || preference === 'dark' || preference === 'system') setters.setThemePreference(preference)
  const fontSize = themeSettings?.value.fontSize
  if (typeof fontSize === 'number') setters.setFontSize(fontSize)
}
