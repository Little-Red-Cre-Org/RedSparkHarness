/** Native Client locale registry for the shared Slot renderer. */
import type { LocaleFace, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { en, zh, formatLocaleTemplate } from './dictionary.ts'

/** Built-in locale supported by this native Client entry. */
export type NativeLocaleId = 'en' | 'zh'

/** Observable locale selection used by native presentation modules. */
export interface NativeLocaleSnapshot {
  /** Active language. */
  readonly locale: NativeLocaleId
  /** Advances after language or dictionary changes. */
  readonly revision: number
}

/** Native locale capability shared with independently installed UI modules. */
export interface NativeLocaleService extends LocaleFace {
  /** Read the active language and registry revision. */
  getSnapshot(): NativeLocaleSnapshot
  /** Select a built-in language and update the document language. */
  setLocale(locale: NativeLocaleId): void
  /** Register one module's complete English and Chinese dictionary pair. */
  register(namespace: string, dictionaries: Readonly<Record<NativeLocaleId, Readonly<Record<string, string>>>>): () => void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Shared locale registry installed by a native Client profile. */
    clientLocale: NativeLocaleService
  }
}

/** Locale and dictionary owner consumed by Native UI modules. */
class NativeLocaleRuntime implements NativeLocaleService {
  private revision = 0
  private snapshot: NativeLocaleSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly dictionaries = new Map<string, Readonly<Record<NativeLocaleId, Readonly<Record<string, string>>>>>()
  private readonly bound = new Map<string, Translate>()
  private readonly previousLanguage = typeof document === 'undefined' ? undefined : document.documentElement.lang

  constructor(locale: NativeLocaleId) {
    this.snapshot = Object.freeze({ locale, revision: this.revision })
    this.dictionaries.set('common', { en, zh })
    this.writeDocumentLanguage(locale)
  }

  getSnapshot = (): NativeLocaleSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  bind(namespace: string): Translate {
    let translate = this.bound.get(namespace)
    if (translate === undefined) {
      translate = (key, params) => {
        const locale = this.snapshot.locale
        const value = this.dictionaries.get(namespace)?.[locale][key]
          ?? this.dictionaries.get('common')?.[locale][key]
          ?? key
        return formatLocaleTemplate(value, params)
      }
      this.bound.set(namespace, translate)
    }
    return translate
  }

  register(
    namespace: string,
    dictionaries: Readonly<Record<NativeLocaleId, Readonly<Record<string, string>>>>,
  ): () => void {
    if (this.dictionaries.has(namespace)) throw new Error(`native locale: namespace '${namespace}' is already registered`)
    this.dictionaries.set(namespace, dictionaries)
    this.publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.dictionaries.delete(namespace)) this.publish()
    }
  }

  setLocale(locale: NativeLocaleId): void {
    if (locale === this.snapshot.locale) return
    this.snapshot = Object.freeze({ locale, revision: ++this.revision })
    this.writeDocumentLanguage(locale)
    this.notify()
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      if (this.previousLanguage === undefined) document.documentElement.removeAttribute('lang')
      else document.documentElement.lang = this.previousLanguage
    }
    this.listeners.clear()
  }

  private publish(): void {
    this.snapshot = Object.freeze({ locale: this.snapshot.locale, revision: ++this.revision })
    this.notify()
  }

  private notify(): void {
    notifySubscribers(this.listeners, '[native-locale]')
  }

  private writeDocumentLanguage(locale: NativeLocaleId): void {
    if (typeof document !== 'undefined') document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }
}

/** Native locale Provider for the shared UI slot renderer. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-locale',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: ['clientLocale'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => key !== 'locale'))) throw new TypeError('native locale: invalid configuration')
    const requested = input !== undefined && 'locale' in input ? input.locale : undefined
    if (requested !== undefined && requested !== 'en' && requested !== 'zh') throw new TypeError('native locale: locale must be en or zh')
    return (context) => {
      const browser = typeof navigator === 'undefined' ? undefined : navigator.languages
      const locale = requested ?? (browser?.some(language => language.toLowerCase().startsWith('zh')) ? 'zh' : 'en')
      const runtime = new NativeLocaleRuntime(locale)
      context.own(() => { runtime.dispose() })
      context.own(context.require('clientSlots').installLocale(runtime))
      context.provide('clientLocale', runtime)
    }
  },
}
