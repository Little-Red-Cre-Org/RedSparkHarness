/** Native first-run welcome and model setup over the selected Host capabilities. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, FishLogo, IconDarkOutline16, IconGlobeOutline14, IconLightOutline16,
  ModelOnboardingView, OnboardingSurface, WelcomeNoticeView, modelProtocolChoices,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCredentialInfo, ModelSettingsNamespace, ModelSettingsOperations,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  NativeSessionRpcError,
} from '@deepseek-ai/dsh-client-native-session/native'
import type {
  NativeConfigurableModelProvider, NativeSessionClient, NativeSettingsDescriptor,
} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleService } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'
import { modelSettingsSchema } from './model-settings-schema.ts'
import { en, zh, type ConversationLocaleKey } from './locales.ts'
import css from './onboarding.module.css'

const WELCOME_ACK_KEY = 'dsh.native.onboarding.welcome'
const WELCOME_ACK_VERSION = '2026-08-13.1'
const MODELS_SKIP_KEY = 'dsh.native.onboarding.models'
const MODELS_SKIP_VERSION = '2026-10-17.1'

type Step = 'welcome' | 'models' | 'done'
type Translate = (key: ConversationLocaleKey) => string

interface ModelSetup {
  readonly providers: readonly {
    readonly provider: string
    readonly displayName: string
    readonly namespace: ModelSettingsNamespace
    readonly settingsPath: readonly string[]
    readonly declared?: boolean
  }[]
  readonly customProvider?: {
    readonly namespace: ModelSettingsNamespace
    readonly protocols: readonly string[]
  }
}

type ModelSetupState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly setup: ModelSetup }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asNamespace(descriptor: NativeSettingsDescriptor): ModelSettingsNamespace {
  return {
    ns: descriptor.namespace,
    schema: descriptor.schema,
    value: descriptor.value,
    base: descriptor.base,
    user: descriptor.user,
    revision: descriptor.revision,
  }
}

function apiKeyRef(
  namespace: ModelSettingsNamespace | undefined,
  path: readonly string[],
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = modelSettingsSchema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as Record<string, unknown>).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

async function readModelSetup(client: NativeSessionClient, signal: AbortSignal): Promise<{
  readonly usable: boolean
  readonly setup?: ModelSetup
}> {
  const [activeProviders, configurableProviders, description, catalog] = await Promise.all([
    client.modelsListProviders(signal),
    client.modelsListConfigurableProviders(signal),
    client.settingsDescribe(signal),
    client.modelCatalog(signal),
  ])
  const namespaces = new Map(description.namespaces.map(descriptor => [descriptor.namespace, asNamespace(descriptor)]))
  const refs = [...new Set(configurableProviders.flatMap((entry) => {
    const ref = apiKeyRef(namespaces.get(entry.settingsNs), entry.settingsPath)
    return ref === undefined ? [] : [ref]
  }))]
  const credentials: Record<string, ModelCredentialInfo> = {}
  for (let offset = 0; offset < refs.length; offset += description.limits.maxCredentialRefsPerRead) {
    Object.assign(credentials, await client.credentialsDescribe(
      refs.slice(offset, offset + description.limits.maxCredentialRefsPerRead), signal,
    ))
  }

  const usable = activeProviders.some((provider) => {
    const entry = configurableProviders.find(candidate => candidate.provider === provider.id)
    if (entry === undefined) return true
    const ref = apiKeyRef(namespaces.get(entry.settingsNs), entry.settingsPath)
    return ref === undefined || credentials[ref]?.configured === true
  })
  if (usable) return { usable: true }

  const providers = configurableProviders.flatMap((entry: NativeConfigurableModelProvider) => {
    if (entry.provider === 'openai-codex' && entry.settingsNs === 'llm-pi-ai') return []
    const namespace = namespaces.get(entry.settingsNs)
    return namespace === undefined ? [] : [{
      provider: entry.provider,
      displayName: entry.displayName,
      namespace,
      settingsPath: entry.settingsPath,
      ...(entry.declared === undefined ? {} : { declared: entry.declared }),
    }]
  })
  // The Host's default Session route leads, so the form opens on the provider new Sessions use.
  const defaultProvider = catalog?.default.provider
  const defaultIndex = providers.findIndex(entry => entry.provider === defaultProvider)
  if (defaultIndex > 0) providers.unshift(...providers.splice(defaultIndex, 1))
  const customNamespace = namespaces.get('llm-pi-ai')
  const protocols = customNamespace === undefined ? [] : modelProtocolChoices(customNamespace, modelSettingsSchema)
  const setup: ModelSetup = {
    providers,
    ...(customNamespace === undefined || protocols.length === 0
      ? {} : { customProvider: { namespace: customNamespace, protocols } }),
  }
  return providers.length === 0 && setup.customProvider === undefined
    ? { usable: false }
    : { usable: false, setup }
}

function createModelOperations(client: NativeSessionClient, t: Translate): ModelSettingsOperations {
  return {
    async describeCredential(ref) {
      try { return (await client.credentialsDescribe([ref]))[ref] }
      catch { return undefined }
    },
    async storeCredential(ref, value) {
      try { await client.credentialsSet(ref, value); return undefined }
      catch (error: unknown) { return errorText(error) }
    },
    async removeCredential(ref) {
      try { await client.credentialsUnset(ref); return undefined }
      catch (error: unknown) { return errorText(error) }
    },
    async writeSettings(namespace, ops, expectedRevision) {
      if (expectedRevision === undefined) {
        return { kind: 'refused', message: t('onboardingSettingsUnavailable') }
      }
      try {
        const view = await client.settingsMutate(namespace, ops, expectedRevision)
        return { kind: 'written', view: { user: view.user, revision: view.revision } }
      } catch (error: unknown) {
        return error instanceof NativeSessionRpcError && error.code === 'native/settings-conflict'
          ? { kind: 'conflict', message: error.message }
          : { kind: 'refused', message: errorText(error) }
      }
    },
    async discoverModels(namespace, request, signal) {
      try { return { kind: 'found', models: await client.modelsDiscover(namespace, request, signal) } }
      catch (error: unknown) { return { kind: 'refused', message: errorText(error) } }
    },
  }
}

/** Render first-run steps using only the installed native Client and Host services.
 * @param props - native session, locale and theme capabilities plus app content.
 * @returns app content and the active onboarding surface.
 */
export function NativeOnboarding({ client, localeService, themeService, children }: {
  client: NativeSessionClient
  localeService: NativeLocaleService
  themeService: NativeThemeService
  children: ReactNode
}): ReactNode {
  const [step, setStep] = useState<Step>(() => localStorage.getItem(WELCOME_ACK_KEY) !== WELCOME_ACK_VERSION
    ? 'welcome' : localStorage.getItem(MODELS_SKIP_KEY) === MODELS_SKIP_VERSION ? 'done' : 'models')
  const [locale, setLocale] = useState(localeService.getSnapshot().locale)
  const [colorScheme, setColorScheme] = useState(themeService.getSnapshot().active.colorScheme)
  const [welcomeError, setWelcomeError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [setupState, setSetupState] = useState<ModelSetupState>({ status: 'loading' })
  const [modelUpdate, setModelUpdate] = useState(0)
  const t: Translate = useMemo(() => {
    const dictionary = locale === 'zh' ? zh : en
    return key => dictionary[key]
  }, [locale])
  const operations = useMemo(() => createModelOperations(client, t), [client, t])

  const loadModels = useCallback(async (signal: AbortSignal): Promise<void> => {
    setSetupState({ status: 'loading' })
    try {
      const result = await readModelSetup(client, signal)
      if (signal.aborted) return
      if (result.usable || result.setup === undefined) {
        setStep('done')
        return
      }
      setSetupState({ status: 'ready', setup: result.setup })
    } catch (error: unknown) {
      if (!signal.aborted) setSetupState({ status: 'error', message: errorText(error) })
    }
  }, [client])

  useEffect(() => {
    if (step !== 'models') return
    const lifetime = new AbortController()
    void loadModels(lifetime.signal)
    return () => { lifetime.abort() }
  }, [loadModels, modelUpdate, step, attempt])

  const acknowledgeWelcome = (): void => {
    try {
      localStorage.setItem(WELCOME_ACK_KEY, WELCOME_ACK_VERSION)
      setWelcomeError(undefined)
      setStep('models')
    } catch {
      setWelcomeError(t('welcomeError'))
    }
  }

  const configureLater = (): void => {
    // Settings > Models stays the way back; an unsaved skip only means the step returns next launch.
    try { localStorage.setItem(MODELS_SKIP_KEY, MODELS_SKIP_VERSION) } catch { /* not persisted */ }
    setStep('done')
  }

  if (step === 'done') return <>{children}</>
  const dictionary = locale === 'zh' ? zh : en
  const onboardingCopy = (key: ConversationLocaleKey) => dictionary[key]
  const toggleLocale = (): void => {
    const next = locale === 'zh' ? 'en' : 'zh'
    localeService.setLocale(next)
    setLocale(next)
  }
  const toggleTheme = (): void => {
    themeService.toggle()
    setColorScheme(themeService.getSnapshot().active.colorScheme)
  }

  return <OnboardingSurface>
    <div className={css.frame}>
      <header className={css.header}>
        <div className={css.brand}><FishLogo size={24} /><span>{t('title')}</span></div>
        <div className={css.actions}>
          <button type="button" className={css.iconButton} aria-label={t('localeToggle')} onClick={toggleLocale}>
            <IconGlobeOutline14 size={16} />
          </button>
          <button type="button" className={css.iconButton} aria-label={t('themeToggle')} onClick={toggleTheme}>
            {colorScheme === 'dark' ? <IconLightOutline16 size={16} /> : <IconDarkOutline16 size={16} />}
          </button>
        </div>
      </header>
      <main className={css.main}>
        <section className={css.card}>
          {step === 'welcome' ? <>
            <h1 className={css.title}>{t('welcomeTitle')}</h1>
            <WelcomeNoticeView body={t('welcomeBody')} continueLabel={t('welcomeContinue')}
              {...welcomeError === undefined ? {} : { error: welcomeError }}
              saving={false} onContinue={acknowledgeWelcome} />
          </> : setupState.status === 'loading' ? <div role="status" className={css.status}>
            {t('onboardingLoading')}
          </div> : setupState.status === 'error' ? <>
            <h1 className={css.title}>{t('onboardingTitle')}</h1>
            <p className={css.error} role="alert">{t('onboardingLoadFailed')}: {setupState.message}</p>
            <Button variant="outline" onClick={() => { setAttempt(value => value + 1) }}>{t('onboardingRetry')}</Button>
          </> : <>
            <h1 className={css.title}>{t('onboardingTitle')}</h1>
            <ModelOnboardingView providers={setupState.setup.providers}
              {...setupState.setup.customProvider === undefined ? {} : { customProvider: setupState.setup.customProvider }}
              operations={operations} schema={modelSettingsSchema}
              t={onboardingCopy} readOnly={false} onClose={(changed) => {
                if (changed) setModelUpdate(value => value + 1)
                else configureLater()
              }} />
          </>}
        </section>
      </main>
    </div>
  </OnboardingSurface>
}
