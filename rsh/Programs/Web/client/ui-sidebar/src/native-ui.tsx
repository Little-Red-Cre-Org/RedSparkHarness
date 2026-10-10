/** Native navigation surface over the existing Session and layout owners. */
import { useState } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  NativeConversationService, NativeConversationSnapshot, NativeSessionPresentation,
} from '@deepseek-ai/dsh-client-ui-session/native'
import type { NativeLocaleSnapshot, NativeLocaleService } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/theme-contract'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/native'
import type {
  InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type { SidebarPanelMetadata, SidebarRootInjected } from './client/contract/slots.ts'
import { SidebarRoot } from './client/SidebarRoot.tsx'
import css from './client/SidebarRoot.module.css'
import { en as sidebarEn, zh as sidebarZh, type SidebarKey } from './client/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebar: SidebarKey
    nativeSidebar: NativeSidebarKey
  }
}

/** Session and appearance controls added to the legacy sidebar shell. */
const zh = {
  sessions: '会话', empty: '暂无已保存会话', loading: '正在读取会话…', language: '语言', theme: '切换主题',
  themeLight: '浅色', themeDark: '深色',
  languageTargetEn: '切换到 English', languageTargetZh: '切换到中文',
  renameTitle: '重命名', refreshTitle: '重新生成标题', titleInput: '会话标题', saveTitle: '保存', cancelTitle: '取消',
} as const
const en = {
  sessions: 'Sessions', empty: 'No saved Sessions', loading: 'Loading Sessions…', language: 'Language', theme: 'Toggle theme',
  themeLight: 'Light', themeDark: 'Dark',
  languageTargetEn: 'Switch to English', languageTargetZh: 'Switch to Chinese',
  renameTitle: 'Rename', refreshTitle: 'Refresh title', titleInput: 'Session title', saveTitle: 'Save', cancelTitle: 'Cancel',
} satisfies Record<keyof typeof zh, string>
type NativeSidebarKey = keyof typeof zh
type NativeSidebarTranslate = TranslateNS<'nativeSidebar'>
type NativeWorkspacesInjected = {
  hooks: { conversation: NativeConversationService }
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
}
type NativeWorkspacesProps = PropsRuntime<'sidebar.workspaces'> & InjectFace<NativeWorkspacesInjected> & PropsLocale<'nativeSidebar'>

function SessionBrowser({ wide, useConversation, displayTitle, selectSession, renameTitle, refreshTitle, t }: {
  wide: boolean
  useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
  t: NativeSidebarTranslate
}) {
  const snapshot = useConversation(value => value)
  const [editingId, setEditingId] = useState<string>()
  const [titleDraft, setTitleDraft] = useState('')
  if (!wide) return <div aria-label={t('sessions')} />
  if (snapshot.sessions.length === 0) return <p style={{ padding: '8px 12px' }}>
    {snapshot.state === 'loading' ? t('loading') : t('empty')}
  </p>
  return <nav aria-label={t('sessions')} style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
    <p style={{ padding: '4px 12px', color: 'var(--dsw-alias-label-secondary)' }}>{t('sessions')}</p>
    {snapshot.sessions.map((session) => {
      const label = displayTitle(session)
      const id = session.header.id
      const selected = snapshot.selected === id
      const actions = session.titleActions
      return <div key={id} style={{ padding: '4px 8px' }}>
        <button type="button" aria-current={selected ? 'page' : undefined}
          disabled={snapshot.state !== 'ready'} onClick={() => { void selectSession(id) }}
          title={label} style={{
            display: 'block', width: '100%', overflow: 'hidden', padding: '8px 12px',
            border: 0, borderRadius: 8, textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'inherit', background: selected ? 'var(--dsw-alias-interactive-bg-selected)' : 'transparent',
          }}>{label}</button>
        {editingId === id ? <form onSubmit={(event) => {
          event.preventDefault()
          void renameTitle(id, titleDraft).then((success) => {
            if (success) setEditingId(undefined)
          })
        }}>
          <label style={{ display: 'block' }}>{t('titleInput')}
            <input aria-label={t('titleInput')} value={titleDraft} onChange={(event) => { setTitleDraft(event.target.value) }} />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={snapshot.state !== 'ready'}>{t('saveTitle')}</Button>
          <Button variant="ghost" size="sm" disabled={snapshot.state !== 'ready'} onClick={() => { setEditingId(undefined) }}>{t('cancelTitle')}</Button>
        </form> : <div style={{ display: 'flex', gap: 4 }}>
          {actions?.rename === true ? <Button variant="ghost" size="sm" disabled={snapshot.state !== 'ready'} onClick={() => {
            setTitleDraft(session.titleProjection.status === 'resolved' ? session.titleProjection.title : label)
            setEditingId(id)
          }}>{t('renameTitle')}</Button> : null}
          {actions?.refresh === true ? <Button variant="ghost" size="sm" disabled={snapshot.state !== 'ready'}
            onClick={() => { void refreshTitle(id) }}>{t('refreshTitle')}</Button> : null}
        </div>}
      </div>
    })}
  </nav>
}

function NativeSidebarActions({ wide, useLocale, useTheme, setLocale, toggleTheme, t }: {
  wide: boolean
  useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
  useTheme: SnapshotSelectorHook<ThemeSnapshot>
  setLocale: NativeLocaleService['setLocale']
  toggleTheme: NativeThemeService['toggle']
  t: NativeSidebarTranslate
}) {
  const language = useLocale(value => value.locale)
  const appearance = useTheme(value => value)
  const target = language === 'zh' ? 'en' : 'zh'
  const themeLabel = t(appearance.active.colorScheme === 'dark' ? 'themeDark' : 'themeLight')
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <button type="button" className={css.panelRow} aria-label={t('language')} title={t(language === 'zh' ? 'languageTargetEn' : 'languageTargetZh')}
      onClick={() => { setLocale(target) }}>
      {wide ? `${t('language')}: ${target === 'zh' ? '中文' : 'English'}` : target.toUpperCase()}
    </button>
    <button type="button" className={css.panelRow} aria-label={t('theme')} title={t('theme')} onClick={toggleTheme}>
      {wide ? `${t('theme')}: ${themeLabel}` : appearance.active.colorScheme === 'dark' ? '☾' : '☼'}
    </button>
  </div>
}

/** Native SidebarRoot and its optional Session browser are installed independently from AppFrame. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-sidebar',
  targets: ['client'],
  requires: ['clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientNativeSessionPresentation', 'clientLocale', 'clientNativeTheme'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const presentation = context.require('clientNativeSessionPresentation')
    const locale = context.require('clientLocale')
    const theme = context.require('clientNativeTheme')
    context.own(locale.register('sidebar', { en: sidebarEn, zh: sidebarZh }))
    context.own(locale.register('nativeSidebar', { en, zh }))

    const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
    const syncPanels = (): void => {
      const next = slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
        id: String(options.id) as MainPanelId,
        order: options.order ?? 0,
        label: resolveSlotLabel(options.label) ?? String(options.id),
      })).sort((left, right) => left.order - right.order)
      const current = panels.getSnapshot()
      if (current.length === next.length && current.every((panel, index) => {
        const candidate = next[index]
        return candidate !== undefined && panel.id === candidate.id
          && panel.order === candidate.order && panel.label === candidate.label
      })) return
      panels.set(next)
    }
    context.own(slots.subscribe('sidebar.panellist', syncPanels))
    context.own(locale.subscribe(syncPanels))
    context.own(slots.inject('sidebar', () => slots.register({
      name: 'sidebar', locale: 'sidebar',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'sidebar.header.action': { kind: 'list', scope: 'root' },
      },
      inject: (): SidebarRootInjected => ({
        startSession: () => { if (controller.getSnapshot().state === 'ready') void controller.create() },
        toggleSidebar: () => { layout.toggleSidebar() },
        selectPanel: (id) => { layout.selectPanel(id) },
        hooks: { panels },
      }),
    }, SidebarRoot)))
    context.own(slots.inject('sidebar.workspaces', () => slots.register({
      name: 'sidebar.workspaces', locale: 'nativeSidebar',
      inject: (): NativeWorkspacesInjected => ({
        hooks: { conversation: controller },
        displayTitle: item => presentation.displayTitle(item),
        selectSession: controller.select.bind(controller),
        renameTitle: async (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => {
          await controller.renameTitle(id, title)
          return controller.getSnapshot().error === undefined
        },
        refreshTitle: controller.refreshTitle.bind(controller),
      }),
    }, ({ wide, useConversation, displayTitle, selectSession, renameTitle, refreshTitle, t }: NativeWorkspacesProps) => (
      <SessionBrowser wide={wide} useConversation={useConversation} displayTitle={displayTitle} selectSession={selectSession}
        renameTitle={renameTitle} refreshTitle={refreshTitle} t={t} />))))
    context.own(slots.inject('sidebar.footer.action', () => [
      slots.register({ name: 'sidebar.footer.action', id: 'native-language', order: 10, locale: 'nativeSidebar',
        inject: () => ({ hooks: { locale, theme }, setLocale: locale.setLocale.bind(locale), toggleTheme: theme.toggle.bind(theme) }) },
      ({ wide, useLocale, useTheme, setLocale, toggleTheme, t }: {
        wide: boolean
        useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
        useTheme: SnapshotSelectorHook<ThemeSnapshot>
        setLocale: NativeLocaleService['setLocale']
        toggleTheme: NativeThemeService['toggle']
        t: NativeSidebarTranslate
      }) => <NativeSidebarActions wide={wide} useLocale={useLocale} useTheme={useTheme}
        setLocale={setLocale} toggleTheme={toggleTheme} t={t} />),
    ]))
    syncPanels()
  },
}
