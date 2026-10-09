/** Native theme preference service for independently installed Client modules. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, isThemePreference,
  type ThemePreference, type ThemeSnapshot,
} from './theme-contract.ts'
import { installThemeStyles } from './theme-sheets.ts'

/** Native theme capability with an explicit preference write face. */
export interface NativeThemeService {
  /** Read the resolved appearance and its revision. */
  getSnapshot(): ThemeSnapshot
  /** Subscribe to preference or operating-system changes. */
  subscribe(listener: () => void): () => void
  /** Select a durable-profile override for light, dark, or system appearance. */
  setPreference(preference: ThemePreference): void
  /** Switch between the two explicit palettes. */
  toggle(): void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Resolved theme choice consumed by the native shell presenter. */
    clientNativeTheme: NativeThemeService
  }
}

/** Native theme Provider; DOM projection belongs to the shell layout module. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-theme',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeTheme'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => key !== 'preference'))) throw new TypeError('native theme: invalid configuration')
    const initial = input !== undefined && 'preference' in input ? input.preference : DEFAULT_PREFERENCE
    if (!isThemePreference(initial)) throw new TypeError('native theme: preference must be light, dark, or system')
    return (context) => {
      const media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)')
      let preference = initial
      let revision = 0
      const listeners = new Set<() => void>()
      const snapshot = (): ThemeSnapshot => {
        const colorScheme = preference === 'system' ? media?.matches === true ? 'dark' : 'light' : preference
        const active = Object.freeze({ id: colorScheme, colorScheme, tokens: Object.freeze({}) })
        return Object.freeze({
          preference,
          fontSize: DEFAULT_FONT_SIZE,
          active,
          themes: [Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
            Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) })],
          revision,
        })
      }
      let current = snapshot()
      const publish = (): void => {
        current = snapshot()
        revision += 1
        current = Object.freeze({ ...current, revision })
        notifySubscribers(listeners, '[native-theme]')
      }
      const onSystemChange = (): void => { if (preference === 'system') publish() }
      media?.addEventListener('change', onSystemChange)
      context.own(() => media?.removeEventListener('change', onSystemChange))
      context.own(installThemeStyles())
      const service: NativeThemeService = {
        getSnapshot: () => current,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        setPreference(value) {
          if (preference === value) return
          preference = value
          publish()
        },
        toggle() {
          const currentScheme = current.active.colorScheme
          preference = currentScheme === 'dark' ? 'light' : 'dark'
          publish()
        },
      }
      context.provide('clientNativeTheme', service)
    }
  },
}
