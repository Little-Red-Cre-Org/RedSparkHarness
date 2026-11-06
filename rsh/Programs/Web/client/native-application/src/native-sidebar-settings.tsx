/** Native sidebar Settings entry and compact appearance controls. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  IconDarkOutline16, IconGlobeOutline14, IconLightOutline16, IconSettingsOutline16, SettingsPanel, Tooltip,
} from '@redspark/rsh-client-ui-primitives'
import type { NativeSessionClient } from '@redspark/rsh-client-native-session/native'
import type { NativeLocaleService } from '@redspark/rsh-client-locale/native'
import type { NativeThemeService } from '@redspark/rsh-client-ui-theme/native'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-sidebar/native'
import type { NativeConversationController } from './controller.ts'
import type { ConversationLocaleKey } from './locales.ts'
import { SettingsPage, type NativeSettingsActions } from './settings-page.tsx'
import { applyNativeSettingsPreferences } from './settings-preferences.ts'
import { subscribeNativeSettingsRequests } from './settings-request.ts'
import css from './NativeSidebarSettings.module.css'

/** Bind Settings page operations to the selected Native Session Consumer.
 * @param client - selected Native Session service.
 * @returns the shared Settings actions bound to the client.
 */
export function createNativeSettingsActions(client: NativeSessionClient): NativeSettingsActions {
  return {
    settingsDescribe: client.settingsDescribe.bind(client), settingsMutate: client.settingsMutate.bind(client),
    settingsOpenDocument: client.settingsOpenDocument.bind(client),
    credentialsDescribe: client.credentialsDescribe.bind(client), credentialsSet: client.credentialsSet.bind(client),
    credentialsUnset: client.credentialsUnset.bind(client),
    modelsListProviders: client.modelsListProviders.bind(client),
    modelsListConfigurableProviders: client.modelsListConfigurableProviders.bind(client),
    modelsDiscover: client.modelsDiscover.bind(client),
    settingsEvents: client.settingsEvents.bind(client),
    modelCatalog: client.modelCatalog.bind(client),
    agentPresetsList: client.agentPresetsList.bind(client),
    agentPresetRead: client.agentPresetRead.bind(client),
    agentPresetCopy: client.agentPresetCopy.bind(client),
    agentPresetDelete: client.agentPresetDelete.bind(client),
    agentPresetsCanOpenDirectory: client.agentPresetsCanOpenDirectory.bind(client),
    agentPresetOpenDirectory: client.agentPresetOpenDirectory.bind(client),
  }
}

/** One settings page or Plugins tab a client package registered. */
export interface NativeSettingsLedgerEntry {
  /** Section or tab key (`settings.section` / `settings.plugins.tab` identity). */
  readonly id: string
  /** Registrant-requested position, ascending. */
  readonly order: number
  /** Registrant-localized display text; undefined when it declared none. */
  readonly label: string | undefined
}

type NativeSidebarSettingsInjected = {
  hooks: { locale: NativeLocaleService; theme: NativeThemeService }
  /** Registered settings pages and Plugins tabs, read at render time. */
  ledger: {
    sections: () => readonly NativeSettingsLedgerEntry[]
    tabs: () => readonly NativeSettingsLedgerEntry[]
    /** Subscribe to registration changes for both keys; the return value unsubscribes. */
    subscribe: (onChange: () => void) => () => void
    /** Monotonic count of registration changes, so React can re-read the projection. */
    version: () => number
  }
  settingsActions: NativeSettingsActions
  refreshModelControls: NativeConversationController['refreshModelControls']
  setLocale: NativeLocaleService['setLocale']
  toggleTheme: NativeThemeService['toggle']
  setThemePreference: NativeThemeService['setPreference']
  setFontSize: NativeThemeService['setFontSize']
}
type NativeSettingsHostSlots = 'settings.plugins.tab' | 'settings.section'
type NativeSidebarSettingsProps = PropsRuntime<'sidebar.settings'>
  & InjectFace<NativeSidebarSettingsInjected>
  & PropsLocale<'nativeApplication'>
  & PropsRenderSlots<NativeSettingsHostSlots>

/** The pages this shell renders itself: always present, and never removable by a registrant. */
const BUILT_IN_SECTIONS = [
  { id: 'general', labelKey: 'settingsGeneral', order: 0 },
  { id: 'plugins', labelKey: 'settingsPlugins', order: 20 },
  { id: 'agent-presets', labelKey: 'settingsAgentPresets', order: 30 },
] as const satisfies readonly { id: string; labelKey: ConversationLocaleKey; order: number }[]

/**
 * Whether the settings panel can show one page: the shell's own pages always
 * exist, everything else must be registered into `settings.section`.
 * @param ledger - registered section entries, read at render time.
 * @param id - the page key a caller asked for.
 * @returns true when the panel has content for that key.
 */
export function settingsSectionAvailable(
  ledger: NativeSidebarSettingsInjected['ledger'],
  id: string,
): boolean {
  return BUILT_IN_SECTIONS.some(section => section.id === id)
    || ledger.sections().some(entry => entry.id === id)
}

/**
 * Settings navigation: the three pages this shell renders itself, then every
 * page a client package registered into `settings.section`.
 *
 * A registered page appears only while its contribution exists, so a
 * composition without the models package has no Models row instead of an
 * empty one. The panel renders one page per id, so a registration whose id is
 * already shown is reported and left out.
 * @param t - settings copy for the built-in pages.
 * @param ledger - registered section entries, read at render time.
 * @returns the ordered navigation rows.
 */
function settingsRows(
  t: TranslateNS<'nativeApplication'>,
  ledger: NativeSidebarSettingsInjected['ledger'],
): readonly { id: string; label: string }[] {
  const builtIn = BUILT_IN_SECTIONS.map(section => ({ id: section.id, label: t(section.labelKey), order: section.order }))
  const shown = new Set<string>(BUILT_IN_SECTIONS.map(section => section.id))
  const registered = ledger.sections().flatMap((entry) => {
    if (shown.has(entry.id)) {
      // The panel renders one page per id, so a second row for the same id is
      // unreachable; naming the registration is the only way its author learns
      // the page never opens.
      console.warn(`[native-application] settings.section registration "${entry.id}" reuses an existing page id and is not shown`)
      return []
    }
    shown.add(entry.id)
    return [{ id: entry.id, label: entry.label ?? entry.id, order: entry.order }]
  })
  return [...builtIn, ...registered].sort((a, b) => a.order - b.order)
}

/** Render Settings, language, and theme controls in the sidebar foot.
 * @param props - sidebar geometry, locale, theme, and Settings actions.
 * @returns the sidebar controls and optional Settings panel.
 */
export function NativeSidebarSettings({
  wide, useLocale, useTheme, settingsActions, ledger, setLocale, toggleTheme,
  setThemePreference, setFontSize, t, renderSlot,
}: NativeSidebarSettingsProps) {
  const locale = useLocale(snapshot => snapshot.locale)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [showSettings, setShowSettings] = useState(false)
  // Registration churn re-reads the projection below: a package that unloads
  // must take its navigation row with it instead of leaving a row whose page
  // renders nothing.
  useSyncExternalStore(ledger.subscribe, ledger.version)
  const [selected, setSettingsSection] = useState('general')
  // A page can lose its registration while the panel is open. Standing on it
  // would show an empty body under a navigation that no longer lists it, so the
  // panel follows the ledger back to a page that exists.
  const settingsSection = settingsSectionAvailable(ledger, selected) ? selected : 'general'
  const [hasSettingsDocument, setHasSettingsDocument] = useState(false)
  const [settingsDocumentError, setSettingsDocumentError] = useState(false)
  const startupPreferencesStale = useRef(false)
  useEffect(() => subscribeNativeSettingsRequests((section) => {
    startupPreferencesStale.current = true
    // A request for a page only opens it when some package registered it; the
    // shell renders no editor of its own, so selecting an absent page would
    // land the panel on an empty body.
    if (settingsSectionAvailable(ledger, section)) setSettingsSection(section)
    setShowSettings(true)
  }), [ledger])
  useEffect(() => {
    const lifetime = new AbortController()
    void settingsActions.settingsDescribe(lifetime.signal).then((description) => {
      if (!lifetime.signal.aborted && !startupPreferencesStale.current) {
        applyNativeSettingsPreferences(description, { setLocale, setThemePreference, setFontSize })
      }
    }).catch(() => {
      /* Startup preferences are optional; retain the locale and theme already selected. */
    })
    return () => { lifetime.abort() }
  }, [settingsActions, setFontSize, setLocale, setThemePreference])
  const openSettingsDocument = async (): Promise<void> => {
    try {
      await settingsActions.settingsOpenDocument()
      setSettingsDocumentError(false)
    } catch {
      setSettingsDocumentError(true)
    }
  }
  return <>
    <div className={wide ? css.row : `${css.row} ${css.collapsed}`}>
      <Tooltip label={t('settings')} delayMs={500} disabled={wide}>
        <button type="button" className={css.settingsButton} aria-label={t('settings')}
          onClick={() => { startupPreferencesStale.current = true; setSettingsSection('general'); setShowSettings(true) }}>
          <IconSettingsOutline16 size={wide ? 16 : 18} />
          {wide && <span>{t('settings')}</span>}
        </button>
      </Tooltip>
      <div className={css.appearanceActions}>
        <Tooltip label={t('localeToggle')} delayMs={500} disabled={wide}>
          <button type="button" className={css.iconButton} aria-label={t('localeToggle')}
            onClick={() => { startupPreferencesStale.current = true; setLocale(locale === 'zh' ? 'en' : 'zh') }}>
            <IconGlobeOutline14 size={wide ? 14 : 18} />
          </button>
        </Tooltip>
        <Tooltip label={t('themeToggle')} delayMs={500} disabled={wide}>
          <button type="button" className={css.iconButton} aria-label={t('themeToggle')}
            onClick={() => { startupPreferencesStale.current = true; toggleTheme() }}>
            {colorScheme === 'dark' ? <IconLightOutline16 size={wide ? 16 : 18} /> : <IconDarkOutline16 size={wide ? 16 : 18} />}
          </button>
        </Tooltip>
      </div>
    </div>
    {showSettings ? <SettingsPanel
      title={t('settings')}
      closeLabel={t('settingsClose')}
      rows={settingsRows(t, ledger)}
      activeId={settingsSection}
      onSelect={setSettingsSection}
      onClose={() => { setShowSettings(false) }}
      actions={hasSettingsDocument ? <>
        <button type="button" className={css.documentAction} onClick={() => { void openSettingsDocument() }}>
          {t('settingsOpenDocument')}
        </button>
        {settingsDocumentError ? <span role="alert">{t('settingsOpenDocumentError')}</span> : null}
      </> : null}
    >
      <SettingsPage actions={settingsActions} t={t} section={settingsSection}
        useLocale={useLocale} useTheme={useTheme} setLocale={setLocale}
        setThemePreference={setThemePreference} setFontSize={setFontSize}
        onDocumentAvailabilityChange={setHasSettingsDocument}
        renderSlot={renderSlot} close={() => { setShowSettings(false) }} tabs={ledger.tabs()} />
    </SettingsPanel> : null}
  </>
}
