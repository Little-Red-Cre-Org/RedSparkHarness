/** Native sidebar Settings entry and compact appearance controls. */
import { useEffect, useState } from 'react'
import {
  IconDarkOutline16, IconGlobeOutline14, IconLightOutline16, IconSettingsOutline16, SettingsPanel, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleService } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/native'
import type { NativeConversationController } from './controller.ts'
import { SettingsPage, type NativeSettingsActions } from './settings-page.tsx'
import { applyNativeSettingsPreferences } from './settings-preferences.ts'
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
    authorizationList: client.authorizationList.bind(client),
    authorizationBegin: client.authorizationBegin.bind(client),
    authorizationFrames: client.authorizationFrames.bind(client),
    authorizationAnswer: client.authorizationAnswer.bind(client),
    authorizationDecline: client.authorizationDecline.bind(client),
    authorizationCancel: client.authorizationCancel.bind(client),
    accountsList: client.accountsList.bind(client),
    accountsUsage: client.accountsUsage.bind(client),
    accountsBalance: client.accountsBalance.bind(client),
    accountsSignOut: client.accountsSignOut.bind(client),
    modelsListProviders: client.modelsListProviders.bind(client),
    modelsListConfigurableProviders: client.modelsListConfigurableProviders.bind(client),
    modelsDiscover: client.modelsDiscover.bind(client),
    settingsEvents: client.settingsEvents.bind(client),
    modelCatalog: client.modelCatalog.bind(client),
    pluginInventoryList: client.pluginInventoryList.bind(client),
    agentPresetsList: client.agentPresetsList.bind(client),
    agentPresetRead: client.agentPresetRead.bind(client),
    agentPresetCopy: client.agentPresetCopy.bind(client),
    agentPresetDelete: client.agentPresetDelete.bind(client),
    agentPresetsCanOpenDirectory: client.agentPresetsCanOpenDirectory.bind(client),
    agentPresetOpenDirectory: client.agentPresetOpenDirectory.bind(client),
  }
}

type NativeSidebarSettingsInjected = {
  hooks: { locale: NativeLocaleService; theme: NativeThemeService }
  settingsActions: NativeSettingsActions
  refreshModelControls: NativeConversationController['refreshModelControls']
  setLocale: NativeLocaleService['setLocale']
  toggleTheme: NativeThemeService['toggle']
  setThemePreference: NativeThemeService['setPreference']
  setFontSize: NativeThemeService['setFontSize']
}
type NativeSidebarSettingsProps = PropsRuntime<'sidebar.settings'>
  & InjectFace<NativeSidebarSettingsInjected>
  & PropsLocale<'nativeApplication'>

/** Render Settings, language, and theme controls in the sidebar foot.
 * @param props - sidebar geometry, locale, theme, and Settings actions.
 * @returns the sidebar controls and optional Settings panel.
 */
export function NativeSidebarSettings({
  wide, useLocale, useTheme, settingsActions, refreshModelControls, setLocale, toggleTheme,
  setThemePreference, setFontSize, t,
}: NativeSidebarSettingsProps) {
  const locale = useLocale(snapshot => snapshot.locale)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const [hasSettingsDocument, setHasSettingsDocument] = useState(false)
  const [settingsDocumentError, setSettingsDocumentError] = useState(false)
  useEffect(() => {
    const lifetime = new AbortController()
    void settingsActions.settingsDescribe(lifetime.signal).then((description) => {
      if (!lifetime.signal.aborted) applyNativeSettingsPreferences(description, { setLocale, setThemePreference, setFontSize })
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
          onClick={() => { setSettingsSection('general'); setShowSettings(true) }}>
          <IconSettingsOutline16 size={wide ? 16 : 18} />
          {wide && <span>{t('settings')}</span>}
        </button>
      </Tooltip>
      <div className={css.appearanceActions}>
        <Tooltip label={t('localeToggle')} delayMs={500} disabled={wide}>
          <button type="button" className={css.iconButton} aria-label={t('localeToggle')}
            onClick={() => { setLocale(locale === 'zh' ? 'en' : 'zh') }}>
            <IconGlobeOutline14 size={wide ? 14 : 18} />
          </button>
        </Tooltip>
        <Tooltip label={t('themeToggle')} delayMs={500} disabled={wide}>
          <button type="button" className={css.iconButton} aria-label={t('themeToggle')} onClick={toggleTheme}>
            {colorScheme === 'dark' ? <IconLightOutline16 size={wide ? 16 : 18} /> : <IconDarkOutline16 size={wide ? 16 : 18} />}
          </button>
        </Tooltip>
      </div>
    </div>
    {showSettings ? <SettingsPanel
      title={t('settings')}
      closeLabel={t('settingsClose')}
      rows={[
        { id: 'general', label: t('settingsGeneral') },
        { id: 'jobs', label: t('settingsJobs') },
        { id: 'models', label: t('settingsModels') },
        { id: 'plugins', label: t('settingsPlugins') },
        { id: 'agent-presets', label: t('settingsAgentPresets') },
      ]}
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
        onAuthorized={() => { void refreshModelControls() }} />
    </SettingsPanel> : null}
  </>
}
