/** Native Session facts panel and its independent conversation-header action. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeConversationSnapshot } from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type { LayoutInfo } from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'

type NativeRightbarKey = 'details' | 'sessionId' | 'workingDirectory' | 'noSession' | 'close'
type NativeRightbarTranslate = TranslateNS<'nativeSidebarRight'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    nativeSidebarRight: NativeRightbarKey
  }
}

const zh = {
  details: '会话详情', sessionId: '会话 ID', workingDirectory: '会话目录元数据',
  noSession: '请先选择会话。', close: '关闭详情',
} as const satisfies Record<NativeRightbarKey, string>
const en = {
  details: 'Session details', sessionId: 'Session ID', workingDirectory: 'Session directory metadata',
  noSession: 'Select a Session first.', close: 'Close details',
} satisfies Record<NativeRightbarKey, string>

function SessionDetails({ useConversation, useLayoutInfo, close, t }: {
  useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
  useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
  close: () => void
  t: NativeRightbarTranslate
}) {
  const snapshot = useConversation(value => value)
  const visible = useLayoutInfo(value => value.rightbarShown)
  if (!visible) return null
  return <aside aria-label={t('details')} style={{
    position: 'absolute', inset: '0 0 0 auto', width: '100%', overflow: 'auto',
    boxSizing: 'border-box', padding: 20, background: 'var(--dsw-specific-sidebar-fill)',
    color: 'var(--dsw-alias-label-primary)', borderLeft: '1px solid var(--dsw-alias-line-regular)',
  }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h2>{t('details')}</h2>
      <Button variant="ghost" size="sm" onClick={close} aria-label={t('close')}>×</Button>
    </header>
    {snapshot.header === undefined ? <p>{t('noSession')}</p> : <dl>
      <dt>{t('sessionId')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{snapshot.header.id}</dd>
      {snapshot.header.cwd === undefined ? null : <>
        <dt>{t('workingDirectory')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{snapshot.header.cwd}</dd>
      </>}
    </dl>}
  </aside>
}

function DetailsAction({ useLayoutInfo, toggle, t }: {
  useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
  toggle: () => void
  t: NativeRightbarTranslate
}) {
  const visible = useLayoutInfo(value => value.rightbarShown)
  return <Button variant="outline" size="sm" aria-label={t('details')} aria-pressed={visible}
    onClick={toggle}>{t('details')}</Button>
}

/** Optional details-only right surface over the selected Native Session. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-sidebar-right',
  targets: ['client'],
  requires: ['clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientLocale'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const locale = context.require('clientLocale')
    context.own(locale.register('nativeSidebarRight', { en, zh }))
    context.own(slots.inject('rightbar', () => slots.register({ name: 'rightbar', locale: 'nativeSidebarRight',
      inject: () => ({ hooks: { conversation: controller, layoutInfo: layout.layoutInfo }, close: () => { layout.closeRightbar() } }) },
    ({ useConversation, useLayoutInfo, close, t }: {
      useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
      useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
      close: () => void
      t: NativeRightbarTranslate
    }) => <SessionDetails useConversation={useConversation} useLayoutInfo={useLayoutInfo} close={close} t={t} />)))
    context.own(slots.inject('native.conversation.actions', () => slots.register({
      name: 'native.conversation.actions', id: 'native-session-details', locale: 'nativeSidebarRight',
      inject: () => ({ hooks: { layoutInfo: layout.layoutInfo }, toggle: () => { layout.toggleRightbar() } }),
    }, ({ useLayoutInfo, toggle, t }: {
      useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
      toggle: () => void
      t: NativeRightbarTranslate
    }) => <DetailsAction useLayoutInfo={useLayoutInfo} toggle={toggle} t={t} />)))
  },
}
