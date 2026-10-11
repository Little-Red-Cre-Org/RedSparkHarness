/** Native navigation surface over the existing Session and layout owners. */
import { useState } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import {
  Button, IconClockOutline16, IconPersonalizationOutline16, IconProjectAddOutline16, Tooltip,
  ProjectRowItem, SessionNodeItem, WorkspaceSectionEmpty, WorkspaceSectionHeader, workspaceLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceGroupRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  NativeConversationService, NativeConversationSnapshot, NativeSessionPresentation,
} from '@deepseek-ai/dsh-client-ui-session/native'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/native'
import type {
  InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
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

/** Native sidebar copy for legacy workspace and session rows. */
const zh = {
  sessions: '会话', workspace: '工作区', empty: '暂无会话', loading: '正在读取会话…',
  scheduleAction: '定时任务', search: '搜索会话', searchAria: '搜索会话', searchPlaceholder: '搜索会话…',
  sortFilter: '排序和筛选', addWorkspace: '新建工作区',
  renameTitle: '重命名', refreshTitle: '重新生成标题', titleInput: '会话标题', saveTitle: '保存', cancelTitle: '取消',
  'actions.newSession.aria': '在“{name}”中新建会话', 'actions.session.aria': '会话“{name}”的操作',
  'actions.workspace.aria': '工作区“{name}”的操作', cancel: '取消', close: '关闭', copy: '复制',
  'date.ymd': '{y}年{m}月{d}日',
  'delete.sessionNote': '删除“{name}”？对应的执行历史和提醒会同步隐藏，定时计划不受影响。',
  'delete.workspace': '删除工作区', 'group.ungrouped': '未分组', 'hover.copied': '已复制',
  'hover.created': '创建于 {time}', 'menu.archiveSession': '归档会话', 'menu.fork': '分叉会话',
  'menu.removeSession': '删除会话', rename: '重命名', 'schedule.active': '有活动定时任务', 'session.new': '新会话',
  'status.completed': '已完成', 'status.idle': '空闲', 'status.planReview': '计划待审', 'status.running': '进行中',
  'status.subagentsRunning.one': '{n} 个子代理运行中', 'status.subagentsRunning.other': '{n} 个子代理运行中',
  'status.waitingAnswer': '等待回答', 'status.waitingApproval': '等待审批', 'time.ago': '{t}前',
  'time.days': '{n}天', 'time.hours': '{n}小时', 'time.minutes': '{n}分钟', 'time.months': '{n}个月',
  'time.now': '刚刚', 'time.years': '{n}年',
} as const
const en = {
  sessions: 'Sessions', workspace: 'Workspaces', empty: 'No sessions yet', loading: 'Loading Sessions…',
  scheduleAction: 'Scheduled tasks', search: 'Search sessions', searchAria: 'Search sessions', searchPlaceholder: 'Search sessions…',
  sortFilter: 'Sort and filter', addWorkspace: 'New workspace',
  renameTitle: 'Rename', refreshTitle: 'Refresh title', titleInput: 'Session title', saveTitle: 'Save', cancelTitle: 'Cancel',
  'actions.newSession.aria': 'New session in {name}', 'actions.session.aria': 'Session actions for {name}',
  'actions.workspace.aria': 'Workspace actions for {name}', cancel: 'Cancel', close: 'Close', copy: 'Copy',
  'date.ymd': '{y}-{m}-{d}',
  'delete.sessionNote': 'Delete “{name}”? Its execution history and reminders will also be hidden. Schedules are unaffected.',
  'delete.workspace': 'Delete workspace', 'group.ungrouped': 'Ungrouped', 'hover.copied': 'Copied',
  'hover.created': 'Created {time}', 'menu.archiveSession': 'Archive session', 'menu.fork': 'Fork session',
  'menu.removeSession': 'Delete session', rename: 'Rename', 'schedule.active': 'Has active scheduled task', 'session.new': 'New Session',
  'status.completed': 'Completed', 'status.idle': 'Idle', 'status.planReview': 'Plan awaiting review', 'status.running': 'Running',
  'status.subagentsRunning.one': '{n} subagent running', 'status.subagentsRunning.other': '{n} subagents running',
  'status.waitingAnswer': 'Waiting for answer', 'status.waitingApproval': 'Waiting for approval', 'time.ago': '{t} ago',
  'time.days': '{n}d', 'time.hours': '{n}h', 'time.minutes': '{n}min', 'time.months': '{n}mo',
  'time.now': 'now', 'time.years': '{n}y',
} satisfies Record<keyof typeof zh, string>
type NativeSidebarKey = keyof typeof zh
type NativeSidebarTranslate = TranslateNS<'nativeSidebar'>
type NativeSessionId = Parameters<NativeConversationService['select']>[0]
type NativeSessionGroup = WorkspaceGroupRow<string, NativeSessionId>
type NativeWorkspacesInjected = {
  hooks: { conversation: NativeConversationService }
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
}
type NativeWorkspacesProps = PropsRuntime<'sidebar.workspaces'> & InjectFace<NativeWorkspacesInjected> & PropsLocale<'nativeSidebar'>

function groupNativeSessions(
  sessions: NativeConversationSnapshot['sessions'],
  selected: NativeConversationSnapshot['selected'],
  displayTitle: NativeSessionPresentation['displayTitle'],
  collapsedGroups: ReadonlySet<string>,
  t: NativeSidebarTranslate,
): NativeSessionGroup[] {
  const grouped = new Map<string, { cwd: string | undefined; sessions: NativeSessionGroup['sessions'][number][]; latestCreatedAt: number }>()
  for (const session of [...sessions].sort((left, right) => right.header.createdAt - left.header.createdAt)) {
    const cwd = session.header.cwd
    const key = cwd ?? ''
    let group = grouped.get(key)
    if (group === undefined) {
      group = { cwd, sessions: [], latestCreatedAt: session.header.createdAt }
      grouped.set(key, group)
    }
    group.latestCreatedAt = Math.max(group.latestCreatedAt, session.header.createdAt)
    group.sessions.push({ id: session.header.id, title: displayTitle(session) })
  }
  return [...grouped].sort((left, right) => right[1].latestCreatedAt - left[1].latestCreatedAt).map(([key, group]) => ({
    key,
    workspaceId: undefined,
    cwd: group.cwd,
    createdAt: undefined,
    label: group.cwd === undefined || group.cwd === '' ? t('group.ungrouped') : workspaceLabel(group.cwd),
    sessionCount: group.sessions.length,
    expanded: !collapsedGroups.has(key),
    containsCurrent: group.sessions.some(session => session.id === selected),
    sessions: group.sessions,
  }))
}

function SessionBrowser({ wide, useConversation, displayTitle, selectSession, renameTitle, refreshTitle, t }: {
  wide: boolean
  useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: NativeSessionId, title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
  t: NativeSidebarTranslate
}) {
  const snapshot = useConversation(value => value)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [editingId, setEditingId] = useState<NativeSessionId>()
  const [titleDraft, setTitleDraft] = useState('')
  const groups = groupNativeSessions(snapshot.sessions, snapshot.selected, displayTitle, collapsedGroups, t)
  const sessionItems = new Map(snapshot.sessions.map(item => [item.header.id, item]))
  if (!wide) return <WorkspaceSectionHeader
    wide={false}
    label={t('workspace')}
    searchExpanded={false}
    query=""
    maxLength={500}
    searchLabel={t('search')}
    searchAriaLabel={t('searchAria')}
    placeholder={t('searchPlaceholder')}
    clearLabel={t('search')}
    searchDisabled
  />
  return <div className={css.workspaceBrowser}>
    <WorkspaceSectionHeader
      wide={wide}
      label={t('workspace')}
      searchExpanded={false}
      query=""
      maxLength={500}
      searchLabel={t('search')}
      searchAriaLabel={t('searchAria')}
      placeholder={t('searchPlaceholder')}
      clearLabel={t('search')}
      searchDisabled
      actions={<>
        <button type="button" className={css.workspaceHeaderButton} aria-label={t('sortFilter')}
          title={t('sortFilter')} disabled><IconPersonalizationOutline16 /></button>
        <button type="button" className={css.workspaceHeaderButton} aria-label={t('addWorkspace')}
          title={t('addWorkspace')} disabled><IconProjectAddOutline16 size={16} /></button>
      </>}
    />
    <nav className={css.workspaceList} aria-label={t('workspace')} role="tree">
      {groups.length === 0 && <WorkspaceSectionEmpty label={snapshot.state === 'loading' ? t('loading') : t('empty')} />}
      {groups.map(group => <div className={css.workspaceGroup} key={group.key}>
        <ProjectRowItem group={group} label={group.label} showCreate={false} onToggle={() => {
          setCollapsedGroups((current) => {
            const next = new Set(current)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })
        }} t={t} />
        {group.expanded && group.sessions.map(session => <div key={session.id}>
          <SessionNodeItem
            node={session}
            currentId={snapshot.selected}
            now={Date.now()}
            onOpen={(id) => { if (snapshot.state === 'ready') void selectSession(id) }}
            onRename={sessionItems.get(session.id)?.titleActions?.rename === true
              ? (_id, currentTitle) => { setTitleDraft(currentTitle); setEditingId(session.id) }
              : undefined}
            onRefresh={sessionItems.get(session.id)?.titleActions?.refresh === true
              ? (id) => { if (snapshot.state === 'ready') void refreshTitle(id) }
              : undefined}
            refreshTitleLabel={t('refreshTitle')}
            t={t}
          />
          {editingId === session.id && <form className={css.sessionRename} onSubmit={(event) => {
            event.preventDefault()
            void renameTitle(session.id, titleDraft).then((success) => { if (success) setEditingId(undefined) })
          }}>
            <label>{t('titleInput')}
              <input aria-label={t('titleInput')} value={titleDraft} onChange={(event) => { setTitleDraft(event.target.value) }} />
            </label>
            <Button type="submit" variant="primary" size="sm" disabled={snapshot.state !== 'ready'}>{t('saveTitle')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={snapshot.state !== 'ready'} onClick={() => { setEditingId(undefined) }}>
              {t('cancelTitle')}
            </Button>
          </form>}
        </div>)}
      </div>)}
    </nav>
  </div>
}

function ScheduledTasksAction({ wide, t }: { wide: boolean; t: NativeSidebarTranslate }) {
  return <Tooltip label={t('scheduleAction')} delayMs={500} disabled={wide}>
    <button type="button" className={css.scheduleAction} aria-label={t('scheduleAction')}
      title={t('scheduleAction')} disabled>
      <IconClockOutline16 size={wide ? 16 : 18} />
      {wide && <span>{t('scheduleAction')}</span>}
    </button>
  </Tooltip>
}

/** Native SidebarRoot and its optional Session browser are installed independently from AppFrame. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-sidebar',
  targets: ['client'],
  requires: ['clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientNativeSessionPresentation', 'clientLocale'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const presentation = context.require('clientNativeSessionPresentation')
    const locale = context.require('clientLocale')
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
    context.own(slots.inject('sidebar.header.action', () => slots.register({
      name: 'sidebar.header.action', id: 'scheduled-tasks', order: 10, locale: 'nativeSidebar',
    }, ({ wide, t }: { wide: boolean; t: NativeSidebarTranslate }) => <ScheduledTasksAction wide={wide} t={t} />)))
    syncPanels()
  },
}
