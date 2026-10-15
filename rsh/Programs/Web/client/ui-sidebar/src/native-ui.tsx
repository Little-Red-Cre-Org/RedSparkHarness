/** Native navigation surface over the Session, layout, and schedule owners. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import {
  Button, DirectoryBrowser, IconClockOutline16, IconPersonalizationOutline16, IconProjectAddOutline16, Menu, Modal, Tooltip,
  ProjectRowItem, SearchResultItem, SessionNodeItem, WorkspaceSectionEmpty, WorkspaceSectionHeader, workspaceLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryBrowserListing, MenuEntry, SessionSearchRow, WorkspaceGroupRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  NativeScheduleClient, NativeScheduleFrame, NativeScheduledJob, NativeSessionClient, NativeSessionListItem,
} from '@deepseek-ai/dsh-client-native-session/native'
import type {
  NativeDirectoryPickerClient, NativeWorkspace, NativeWorkspaceBaseline, NativeWorkspaceClient, NativeWorkspaceFrame,
}
  from '@deepseek-ai/dsh-client-native-session/workspaces'
import type {
  NativeConversationService, NativeConversationSnapshot, NativeSessionPresentation,
} from '@deepseek-ai/dsh-client-ui-session/native'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/native'
import type {
  InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
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
  moveWorkspaceUp: '上移工作区 {name}', moveWorkspaceDown: '下移工作区 {name}',
  moveSessionUp: '上移会话 {name}', moveSessionDown: '下移会话 {name}',
  sessions: '会话', workspace: '工作区', empty: '暂无会话', loading: '正在读取会话…',
  scheduleAction: '定时任务', search: '搜索会话', searchAria: '搜索会话', searchPlaceholder: '搜索会话…',
  'schedule.loading': '正在读取定时任务…', 'schedule.empty': '暂无定时任务。', 'schedule.error': '无法读取定时任务。',
  'schedule.close': '返回会话', 'schedule.nextRun': '下次执行', 'schedule.noNextRun': '暂无后续执行',
  'schedule.once': '单次执行：{time}（{zone}）', 'schedule.every': '每 {interval} 执行一次，首次于 {time}（{zone}）',
  'schedule.hours': '{n} 小时', 'schedule.minutes': '{n} 分钟', 'schedule.seconds': '{n} 秒',
  'schedule.state.active': '计划中', 'schedule.state.paused': '已暂停', 'schedule.state.failed': '执行失败',
  sortUpdated: '按最近活动排序', sortManual: '按手动顺序排序', addWorkspace: '新建工作区', workspaceTitle: '工作区名称',
  viewOptions: '视图选项', groupBy: '分组方式', groupWorkspace: '按工作区', groupFlat: '平铺会话', orderBy: '排序方式',
  'browser.title': '选择工作区目录', 'browser.home': '主目录', 'browser.newFolder': '新建文件夹', 'browser.folderName': '文件夹名称',
  'browser.createIn': '在“{name}”中新建文件夹', 'browser.untitledFolder': '未命名文件夹', 'browser.create': '创建',
  'browser.cancel': '取消', 'browser.open': '打开', 'browser.editPath': '编辑路径', 'browser.loading': '加载中…',
  'browser.truncated': '文件夹过多，仅显示开头部分。', 'browser.showHidden': '显示隐藏文件',
  'search.pending': '正在搜索…', 'search.noMatches': '没有匹配的会话', 'search.unavailable': '搜索不可用',
  renameTitle: '重命名', refreshTitle: '重新生成标题', titleInput: '会话标题', saveTitle: '保存', cancelTitle: '取消',
  'actions.newSession.aria': '在“{name}”中新建会话', 'actions.session.aria': '会话“{name}”的操作',
  'actions.workspace.aria': '工作区“{name}”的操作', cancel: '取消', close: '关闭', copy: '复制',
  'date.ymd': '{y}年{m}月{d}日',
  'delete.sessionNote': '删除“{name}”？对应的执行历史和提醒会同步隐藏，定时计划不受影响。',
  'delete.workspace': '删除工作区', 'delete.desc': '将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。',
  'delete.pending': '正在删除工作区…', 'group.ungrouped': '未分组', 'hover.copied': '已复制',
  'hover.created': '创建于 {time}', 'menu.archiveSession': '归档会话', 'menu.fork': '分叉会话',
  'menu.removeSession': '删除会话', rename: '重命名', 'schedule.active': '有活动定时任务', 'session.new': '新会话',
  'status.completed': '已完成', 'status.idle': '空闲', 'status.planReview': '计划待审', 'status.running': '进行中',
  'status.subagentsRunning.one': '{n} 个子代理运行中', 'status.subagentsRunning.other': '{n} 个子代理运行中',
  'status.waitingAnswer': '等待回答', 'status.waitingApproval': '等待审批', 'time.ago': '{t}前',
  'time.days': '{n}天', 'time.hours': '{n}小时', 'time.minutes': '{n}分钟', 'time.months': '{n}个月',
  'time.now': '刚刚', 'time.years': '{n}年',
} as const
const en = {
  moveWorkspaceUp: 'Move workspace {name} up', moveWorkspaceDown: 'Move workspace {name} down',
  moveSessionUp: 'Move session {name} up', moveSessionDown: 'Move session {name} down',
  sessions: 'Sessions', workspace: 'Workspaces', empty: 'No sessions yet', loading: 'Loading Sessions…',
  scheduleAction: 'Scheduled tasks', search: 'Search sessions', searchAria: 'Search sessions', searchPlaceholder: 'Search sessions…',
  'schedule.loading': 'Loading scheduled tasks…', 'schedule.empty': 'No scheduled tasks.', 'schedule.error': 'Could not load scheduled tasks.',
  'schedule.close': 'Back to conversation', 'schedule.nextRun': 'Next run', 'schedule.noNextRun': 'No upcoming run',
  'schedule.once': 'Once · {time} ({zone})', 'schedule.every': 'Every {interval} from {time} ({zone})',
  'schedule.hours': '{n}h', 'schedule.minutes': '{n} min', 'schedule.seconds': '{n}s',
  'schedule.state.active': 'Scheduled', 'schedule.state.paused': 'Paused', 'schedule.state.failed': 'Failed',
  sortUpdated: 'Sort by recent activity', sortManual: 'Sort by manual order', addWorkspace: 'New workspace', workspaceTitle: 'Workspace title',
  viewOptions: 'View options', groupBy: 'Group by', groupWorkspace: 'Workspace', groupFlat: 'Flat list', orderBy: 'Order by',
  'browser.title': 'Select Workspace Directory', 'browser.home': 'Home', 'browser.newFolder': 'New folder', 'browser.folderName': 'Folder name',
  'browser.createIn': 'New folder in “{name}”', 'browser.untitledFolder': 'Untitled folder', 'browser.create': 'Create',
  'browser.cancel': 'Cancel', 'browser.open': 'Open', 'browser.editPath': 'Edit path', 'browser.loading': 'Loading…',
  'browser.truncated': 'Too many folders to list; only the beginning is shown.', 'browser.showHidden': 'Show hidden files',
  'search.pending': 'Searching…', 'search.noMatches': 'No matching sessions', 'search.unavailable': 'Search is unavailable',
  renameTitle: 'Rename', refreshTitle: 'Refresh title', titleInput: 'Session title', saveTitle: 'Save', cancelTitle: 'Cancel',
  'actions.newSession.aria': 'New session in {name}', 'actions.session.aria': 'Session actions for {name}',
  'actions.workspace.aria': 'Workspace actions for {name}', cancel: 'Cancel', close: 'Close', copy: 'Copy',
  'date.ymd': '{y}-{m}-{d}',
  'delete.sessionNote': 'Delete “{name}”? Its execution history and reminders will also be hidden. Schedules are unaffected.',
  'delete.workspace': 'Delete workspace', 'delete.desc': 'This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.',
  'delete.pending': 'Deleting workspace…', 'group.ungrouped': 'Ungrouped', 'hover.copied': 'Copied',
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
type NativeWorkspaceId = NativeWorkspace['workspaceId']
type NativeSessionGroup = WorkspaceGroupRow<NativeWorkspaceId, NativeSessionId>
interface NativeWorkspaceSnapshot extends NativeWorkspaceBaseline {
  readonly ready: boolean
}
type NativeWorkspacesInjected = {
  hooks: {
    conversation: NativeConversationService
    workspaceRegistry: HostObservable<NativeWorkspaceSnapshot>
    homeDirectory: HostObservable<string | undefined>
  }
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
  searchSessions: NativeSessionClient['search']
  archiveSession: NativeSessionClient['archive']
  selectWorkspace: (id: NativeWorkspaceId) => Promise<void>
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryBrowserListing>
  createDirectory: NativeDirectoryPickerClient['createDirectory']
  createWorkspace: (path: string) => Promise<void>
  renameWorkspace: NativeWorkspaceClient['rename']
  reorderWorkspace: NativeWorkspaceClient['reorder']
  reorderSession: NativeWorkspaceClient['reorderSession']
  deleteWorkspace: NativeWorkspaceClient['delete']
  toggleSidebar: () => void
}
type NativeWorkspacesProps = PropsRuntime<'sidebar.workspaces'> & InjectFace<NativeWorkspacesInjected> & PropsLocale<'nativeSidebar'>

function groupNativeSessions(
  sessions: NativeConversationSnapshot['sessions'],
  registry: NativeWorkspaceSnapshot,
  selected: NativeConversationSnapshot['selected'],
  displayTitle: NativeSessionPresentation['displayTitle'],
  collapsedGroups: ReadonlySet<string>,
  order: 'updated' | 'manual',
  groupBy: 'workspace' | 'flat',
  t: NativeSidebarTranslate,
): NativeSessionGroup[] {
  const archived = new Set(registry.archivedSessionIds)
  const visible = sessions.filter(session => !archived.has(session.header.id)
    && (!session.blank || session.header.id === selected))
  const workspaceIds = new Set(registry.workspaces.map(workspace => workspace.workspaceId))
  const rows = (items: readonly NativeSessionListItem[], workspace?: NativeWorkspace): NativeSessionGroup['sessions'] => {
    const ordered = [...items]
    if (order === 'updated') ordered.sort((left, right) => right.updatedAt - left.updatedAt)
    else if (workspace !== undefined) {
      const position = new Map(workspace.sessionIds.map((id, index) => [id, index]))
      ordered.sort((left, right) => (position.get(left.header.id) ?? Number.MAX_SAFE_INTEGER)
        - (position.get(right.header.id) ?? Number.MAX_SAFE_INTEGER) || left.header.createdAt - right.header.createdAt)
    } else ordered.sort((left, right) => right.header.createdAt - left.header.createdAt)
    return ordered.map(session => ({
      id: session.header.id,
      title: displayTitle(session),
      blank: session.blank,
      ...(session.pendingInteraction === undefined ? {} : { pendingInteraction: session.pendingInteraction.kind }),
      running: session.running,
      runningSubagentCount: session.runningSubagentCount,
      completed: session.completed,
      hasActiveSchedule: session.hasActiveSchedule,
      updatedAt: session.updatedAt,
    }))
  }
  const groups: NativeSessionGroup[] = registry.workspaces.map((workspace) => {
    const key = workspace.workspaceId
    const children = rows(visible.filter(session => session.workspaceId === key), workspace)
    return {
      key,
      workspaceId: key,
      cwd: workspace.path,
      createdAt: new Date(workspace.createdAt).getTime(),
      label: workspace.title,
      sessionCount: children.length,
      expanded: !collapsedGroups.has(key),
      containsCurrent: children.some(session => session.id === selected),
      sessions: children,
    }
  })
  const ungrouped = visible.filter(session => session.workspaceId === undefined || !workspaceIds.has(session.workspaceId))
  if (ungrouped.length > 0) {
    const children = rows(ungrouped)
    groups.push({
      key: 'ungrouped', workspaceId: undefined, cwd: undefined, createdAt: undefined,
      label: t('group.ungrouped'), sessionCount: children.length, expanded: !collapsedGroups.has('ungrouped'),
      containsCurrent: children.some(session => session.id === selected), sessions: children,
    })
  }
  if (groupBy === 'flat') {
    const sessions = groups.flatMap(group => group.sessions)
    if (sessions.length === 0) return []
    if (order === 'updated') sessions.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    return [{
      key: 'flat', workspaceId: undefined, cwd: undefined, createdAt: undefined, label: t('sessions'),
      sessionCount: sessions.length, expanded: true, containsCurrent: sessions.some(session => session.id === selected),
      sessions,
    }]
  }
  return groups
}

type NativeSearchState = {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchRow<NativeSessionId>[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SEARCH_DEBOUNCE_MS = 250

function NativeSessionBrowser({
  wide, useConversation, useWorkspaceRegistry, displayTitle, selectSession, renameTitle, refreshTitle,
  searchSessions, archiveSession, selectWorkspace, useHomeDirectory, listDirectory, createDirectory, createWorkspace,
  renameWorkspace, deleteWorkspace, reorderWorkspace, reorderSession, toggleSidebar, t,
}: {
  wide: boolean
  useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
  useWorkspaceRegistry: SnapshotSelectorHook<NativeWorkspaceSnapshot>
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: NativeSessionId, title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
  searchSessions: NativeSessionClient['search']
  archiveSession: NativeSessionClient['archive']
  selectWorkspace: (id: NativeWorkspaceId) => Promise<void>
  useHomeDirectory: SnapshotSelectorHook<string | undefined>
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryBrowserListing>
  createDirectory: NativeDirectoryPickerClient['createDirectory']
  createWorkspace: (path: string) => Promise<void>
  renameWorkspace: NativeWorkspaceClient['rename']
  reorderWorkspace: NativeWorkspaceClient['reorder']
  reorderSession: NativeWorkspaceClient['reorderSession']
  deleteWorkspace: NativeWorkspaceClient['delete']
  toggleSidebar: () => void
  t: NativeSidebarTranslate
}) {
  const snapshot = useConversation(value => value)
  const registry = useWorkspaceRegistry(value => value)
  const homeDirectory = useHomeDirectory(value => value)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [editingId, setEditingId] = useState<NativeSessionId>()
  const [titleDraft, setTitleDraft] = useState('')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<NativeWorkspaceId>()
  const [workspaceTitleDraft, setWorkspaceTitleDraft] = useState('')
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<{ id: NativeWorkspaceId; title: string }>()
  const [workspaceDeletePending, setWorkspaceDeletePending] = useState(false)
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<string>()
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const ordering = useRef(false)
  const [orderingPending, setOrderingPending] = useState(false)
  const [order, setOrder] = useState<'updated' | 'manual'>('updated')
  const [groupBy, setGroupBy] = useState<'workspace' | 'flat'>('workspace')
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const [directoryPickerBusy, setDirectoryPickerBusy] = useState(false)
  const [directoryPickerError, setDirectoryPickerError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [searchState, setSearchState] = useState<NativeSearchState>({ query: '', status: 'idle', items: [] })
  const searchInput = useRef<HTMLInputElement>(null)
  const groups = groupNativeSessions(snapshot.sessions, registry, snapshot.selected, displayTitle, collapsedGroups, order, groupBy, t)
  const sessionItems = useMemo(() => new Map(snapshot.sessions.map(item => [item.header.id, item])), [snapshot.sessions])
  const workspaceItems = useMemo(() => new Map(registry.workspaces.map(item => [item.workspaceId, item])), [registry.workspaces])
  const archived = useMemo(() => new Set(registry.archivedSessionIds), [registry.archivedSessionIds])
  const searchQuery = query.trim()
  useEffect(() => {
    if (wide && searchExpanded) searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded])
  useEffect(() => {
    if (!searchExpanded || searchQuery === '') {
      setSearchState({ query: searchQuery, status: 'idle', items: [] })
      return
    }
    const request = new AbortController()
    setSearchState({ query: searchQuery, status: 'loading', items: [] })
    const timer = window.setTimeout(() => {
      void searchSessions(searchQuery, undefined, request.signal).then((page) => {
        if (request.signal.aborted) return
        const items = page.items.filter(item => !archived.has(item.sessionId)).map((item) => {
          const session = sessionItems.get(item.sessionId)
          const workspace = item.workspaceId === undefined ? undefined : workspaceItems.get(item.workspaceId)
          return {
            id: item.sessionId,
            title: item.title,
            workspace: workspace?.title ?? (item.cwd === undefined ? t('group.ungrouped') : workspaceLabel(item.cwd)),
            ...(item.snippet === undefined ? {} : { snippet: item.snippet }),
            ...(session?.pendingInteraction === undefined ? {} : { pendingInteraction: session.pendingInteraction.kind }),
            running: session?.running ?? false,
            runningSubagentCount: session?.runningSubagentCount ?? 0,
            completed: session?.completed ?? false,
            hasActiveSchedule: session?.hasActiveSchedule ?? false,
          }
        })
        setSearchState({ query: searchQuery, status: 'ready', items })
      }).catch(() => {
        if (!request.signal.aborted) setSearchState({ query: searchQuery, status: 'error', items: [] })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); request.abort() }
  }, [searchExpanded, searchQuery, searchSessions, archived, sessionItems, workspaceItems, t])
  const runAction = (action: () => Promise<unknown>): void => {
    void action().catch((error: unknown) => { setActionError(errorMessage(error)) })
  }
  const addWorkspaceAction = <Tooltip label={t('addWorkspace')} delayMs={500} disabled={wide}>
    <button type="button" className={css.workspaceHeaderButton} aria-label={t('addWorkspace')}
      title={t('addWorkspace')} disabled={snapshot.state !== 'ready' || !registry.ready}
      onClick={() => { setDirectoryPickerError(undefined); setDirectoryPickerOpen(true) }}>
      <IconProjectAddOutline16 size={wide ? 16 : 18} />
    </button>
  </Tooltip>
  const runOrdering = (action: () => Promise<unknown>): void => {
    if (ordering.current || !registry.ready) return
    ordering.current = true
    setOrderingPending(true)
    setActionError(undefined)
    void action().catch((error: unknown) => { setActionError(errorMessage(error)) }).finally(() => {
      ordering.current = false
      setOrderingPending(false)
    })
  }
  const orderControls = (kind: 'workspace' | 'session', name: string, index: number, count: number, move: (up: boolean) => void) => (
    <div className={css.orderControls}>
      <button type="button" aria-label={t(kind === 'workspace' ? 'moveWorkspaceUp' : 'moveSessionUp', { name })} title={t(kind === 'workspace' ? 'moveWorkspaceUp' : 'moveSessionUp', { name })}
        disabled={orderingPending || !registry.ready || index === 0} onClick={() => { move(true) }}>↑</button>
      <button type="button" aria-label={t(kind === 'workspace' ? 'moveWorkspaceDown' : 'moveSessionDown', { name })} title={t(kind === 'workspace' ? 'moveWorkspaceDown' : 'moveSessionDown', { name })}
        disabled={orderingPending || !registry.ready || index === count - 1} onClick={() => { move(false) }}>↓</button>
    </div>
  )
  const renderSession = (session: NativeSessionGroup['sessions'][number], flat = false,
    group?: NativeSessionGroup, index = 0) => {
    const item = sessionItems.get(session.id)
    return <div key={session.id}>
      <div className={css.orderedRow}>
        <SessionNodeItem
          node={session}
          currentId={snapshot.selected}
          now={Date.now()}
          onOpen={(id) => { if (snapshot.state === 'ready') void selectSession(id) }}
          onRename={item?.titleActions?.rename === true
            ? (_id, currentTitle) => { setTitleDraft(currentTitle); setEditingId(session.id) }
            : undefined}
          onRefresh={item?.titleActions?.refresh === true
            ? (id) => { if (snapshot.state === 'ready') runAction(() => refreshTitle(id)) }
            : undefined}
          onArchive={id => archiveSession(id).catch((error: unknown) => { setActionError(errorMessage(error)) })}
          allowRemove={false}
          flat={flat}
          refreshTitleLabel={t('refreshTitle')}
          t={t}
        />
        {order !== 'manual' || group?.workspaceId === undefined ? null
          : orderControls('session', session.title, index, group.sessions.length, (up) => {
            const workspaceId = group.workspaceId
            if (workspaceId === undefined) return
            const anchor = group.sessions[up ? index - 1 : index + 2]?.id
            runOrdering(() => reorderSession(workspaceId, session.id, anchor))
          })}
      </div>
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
    </div>
  }
  const adoptWorkspaceDirectory = (path: string): void => {
    setDirectoryPickerError(undefined)
    setDirectoryPickerBusy(true)
    void createWorkspace(path).then(() => {
      setDirectoryPickerOpen(false)
    }).catch((error: unknown) => {
      setDirectoryPickerError(errorMessage(error))
    }).finally(() => { setDirectoryPickerBusy(false) })
  }
  const confirmWorkspaceDelete = (): void => {
    if (workspaceDeleteTarget === undefined || workspaceDeletePending) return
    setWorkspaceDeletePending(true)
    setWorkspaceDeleteError(undefined)
    void deleteWorkspace(workspaceDeleteTarget.id).then(() => {
      setWorkspaceDeleteTarget(undefined)
    }).catch((error: unknown) => {
      setWorkspaceDeleteError(errorMessage(error))
    }).finally(() => { setWorkspaceDeletePending(false) })
  }
  const currentSearch = searchState.query === searchQuery
    ? searchState
    : { query: searchQuery, status: 'loading' as const, items: [] }
  if (!wide) return <WorkspaceSectionHeader
    wide={false}
    label={t(groupBy === 'workspace' ? 'workspace' : 'sessions')}
    searchExpanded={searchExpanded}
    query={query}
    maxLength={500}
    searchLabel={t('search')}
    searchAriaLabel={t('searchAria')}
    placeholder={t('searchPlaceholder')}
    clearLabel={t('search')}
    actions={addWorkspaceAction}
    onRailSearch={() => { toggleSidebar(); setSearchExpanded(true) }}
  />
  return <div className={css.workspaceBrowser}>
    <WorkspaceSectionHeader
      wide={wide}
      label={t(groupBy === 'workspace' ? 'workspace' : 'sessions')}
      searchExpanded={searchExpanded}
      query={query}
      maxLength={500}
      searchLabel={t('search')}
      searchAriaLabel={t('searchAria')}
      placeholder={t('searchPlaceholder')}
      clearLabel={t('search')}
      inputRef={searchInput}
      onSearchActivate={() => { searchInput.current?.focus() }}
      onSearchExpand={() => { setSearchExpanded(true) }}
      onQueryChange={setQuery}
      onSearchClear={() => { setSearchExpanded(false); setQuery('') }}
      actions={<>
        <Menu
          open={viewOptionsOpen}
          onClose={() => { setViewOptionsOpen(false) }}
          items={[
            { type: 'label', id: 'group-by', text: t('groupBy') },
            { id: 'workspace', label: t('groupWorkspace') },
            { id: 'flat', label: t('groupFlat') },
            { type: 'separator', id: 'order-separator' },
            { type: 'label', id: 'order-by', text: t('orderBy') },
            { id: 'updated', label: t('sortUpdated') },
            { id: 'manual', label: t('sortManual') },
          ] satisfies readonly MenuEntry[]}
          selectedIds={[groupBy, order]}
          onSelect={(id) => {
            if (id === 'workspace' || id === 'flat') setGroupBy(id)
            else if (id === 'updated' || id === 'manual') setOrder(id)
            setViewOptionsOpen(false)
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <Tooltip label={t('viewOptions')} side="bottom" delayMs={500}>
              <button type="button" className={css.workspaceHeaderButton} aria-label={t('viewOptions')}
                title={t('viewOptions')} onClick={() => { setViewOptionsOpen(value => !value) }}>
                <IconPersonalizationOutline16 />
              </button>
            </Tooltip>
          )}
        />
        {addWorkspaceAction}
      </>}
    />
    {actionError !== undefined && <div role="alert">{actionError}</div>}
    <nav className={css.workspaceList} aria-label={t('workspace')} role="tree">
      {searchExpanded && searchQuery !== '' ? <>
        {currentSearch.status === 'loading' && <WorkspaceSectionEmpty label={t('search.pending')} />}
        {currentSearch.status === 'error' && <WorkspaceSectionEmpty label={t('search.unavailable')} />}
        {currentSearch.status === 'ready' && currentSearch.items.length === 0 && <WorkspaceSectionEmpty label={t('search.noMatches')} />}
        {currentSearch.items.map(result => <SearchResultItem
          key={result.id} result={result} currentId={snapshot.selected}
          onOpen={(id) => {
            if (snapshot.state !== 'ready') return
            setSearchExpanded(false)
            setQuery('')
            void selectSession(id)
          }} t={t}
        />)}
      </> : <>
        {groups.length === 0 && <WorkspaceSectionEmpty label={snapshot.state === 'loading' || !registry.ready ? t('loading') : t('empty')} />}
        {groupBy === 'flat'
          ? groups.flatMap(group => group.sessions.map(session => renderSession(session, true)))
          : groups.map((group) => {
            const workspaceId = group.workspaceId
            const workspaceActions = workspaceId === undefined ? undefined : {
              rename: () => {
                const workspace = workspaceItems.get(workspaceId)
                if (workspace !== undefined) { setWorkspaceTitleDraft(workspace.title); setEditingWorkspaceId(workspaceId) }
              },
              delete: () => {
                setWorkspaceDeleteError(undefined)
                setWorkspaceDeleteTarget({ id: workspaceId, title: group.label })
              },
            }
            return <div className={css.workspaceGroup} key={group.key}>
              <div className={css.orderedRow}>
                <ProjectRowItem group={group} label={group.label} home={homeDirectory} onToggle={() => {
                  setCollapsedGroups((current) => {
                    const next = new Set(current)
                    if (next.has(group.key)) next.delete(group.key)
                    else next.add(group.key)
                    return next
                  })
                  if (workspaceId !== undefined && snapshot.state === 'ready') runAction(() => selectWorkspace(workspaceId))
                }} onCreate={workspaceId === undefined ? undefined : () => {
                  setCollapsedGroups((current) => {
                    const next = new Set(current)
                    next.delete(group.key)
                    return next
                  })
                  if (snapshot.state === 'ready') runAction(() => selectWorkspace(workspaceId))
                }} actions={workspaceActions} showCreate={workspaceId !== undefined} t={t} />
                {order !== 'manual' || workspaceId === undefined ? null
                  : orderControls('workspace', group.label, registry.workspaces.findIndex(row => row.workspaceId === workspaceId),
                    registry.workspaces.length, (up) => {
                      const index = registry.workspaces.findIndex(row => row.workspaceId === workspaceId)
                      const anchor = registry.workspaces[up ? index - 1 : index + 2]?.workspaceId
                      runOrdering(() => reorderWorkspace(workspaceId, anchor))
                    })}
              </div>
              {editingWorkspaceId === workspaceId && workspaceId !== undefined && <form className={css.sessionRename} onSubmit={(event) => {
                event.preventDefault()
                runAction(async () => { await renameWorkspace(workspaceId, workspaceTitleDraft.trim()); setEditingWorkspaceId(undefined) })
              }}>
                <label>{t('workspaceTitle')}
                  <input aria-label={t('workspaceTitle')} required value={workspaceTitleDraft} onChange={(event) => { setWorkspaceTitleDraft(event.target.value) }} />
                </label>
                <Button type="submit" variant="primary" size="sm">{t('saveTitle')}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingWorkspaceId(undefined) }}>{t('cancelTitle')}</Button>
              </form>}
              {group.expanded && group.sessions.map((session, index) => renderSession(session, false, group, index))}
            </div>
          })}
      </>}
    </nav>
    <Modal
      open={workspaceDeleteTarget !== undefined}
      title={t('delete.workspace')}
      closeLabel={t('close')}
      {...workspaceDeleteTarget === undefined
        ? {}
        : { description: t('delete.desc', { name: workspaceDeleteTarget.title }) }}
      onClose={() => {
        if (workspaceDeletePending) return
        setWorkspaceDeleteTarget(undefined)
        setWorkspaceDeleteError(undefined)
      }}
      footer={<>
        <Button variant="outline" disabled={workspaceDeletePending} onClick={() => { setWorkspaceDeleteTarget(undefined) }}>{t('cancel')}</Button>
        <Button variant="outline" disabled={workspaceDeletePending} onClick={confirmWorkspaceDelete}>{t('delete.workspace')}</Button>
      </>}
    >
      {workspaceDeletePending && <div role="status">{t('delete.pending')}</div>}
      {workspaceDeleteError !== undefined && <div role="alert">{workspaceDeleteError}</div>}
    </Modal>
    <DirectoryBrowser
      open={directoryPickerOpen}
      listDirectory={listDirectory}
      createDirectory={createDirectory}
      onOpen={adoptWorkspaceDirectory}
      onClose={() => { setDirectoryPickerOpen(false) }}
      busy={directoryPickerBusy}
      ownerError={directoryPickerError}
      t={t}
    />
  </div>
}

function assertNever(value: never): never {
  throw new Error(`native sidebar: unknown Workspace frame ${String(value)}`)
}

function nextWorkspaceSnapshot(snapshot: NativeWorkspaceSnapshot, frame: NativeWorkspaceFrame): NativeWorkspaceSnapshot {
  switch (frame.type) {
    case 'baseline': return { ...frame.value, ready: true }
    case 'upsert': {
      const workspaces = [...snapshot.workspaces]
      const index = workspaces.findIndex(workspace => workspace.workspaceId === frame.workspace.workspaceId)
      if (index === -1) workspaces.push(frame.workspace)
      else workspaces[index] = frame.workspace
      return { ...snapshot, workspaces }
    }
    case 'remove':
      return { ...snapshot, workspaces: snapshot.workspaces.filter(workspace => workspace.workspaceId !== frame.workspaceId) }
    case 'order': {
      const byId = new Map(snapshot.workspaces.map(workspace => [workspace.workspaceId, workspace]))
      return {
        ...snapshot,
        workspaces: frame.workspaceIds.map((id) => {
          const workspace = byId.get(id)
          if (workspace === undefined) throw new Error(`native sidebar: Workspace order references missing ${id}`)
          return workspace
        }),
      }
    }
    case 'archived': return { ...snapshot, archivedSessionIds: frame.archivedSessionIds }
    default: return assertNever(frame)
  }
}

function ScheduledTasksAction({ wide, open, t }: { wide: boolean; open: () => void; t: NativeSidebarTranslate }) {
  return <Tooltip label={t('scheduleAction')} delayMs={500} disabled={wide}>
    <button type="button" className={css.scheduleAction} aria-label={t('scheduleAction')}
      title={t('scheduleAction')} onClick={() => { open() }}>
      <IconClockOutline16 size={wide ? 16 : 18} />
      {wide && <span>{t('scheduleAction')}</span>}
    </button>
  </Tooltip>
}

function scheduleTime(timestamp: number, timeZone: string, locale: NativeLocaleSnapshot['locale']): string {
  const offsetMinutes = timeZone === 'UTC' ? 0
    : (timeZone[3] === '+' ? 1 : -1) * (Number(timeZone.slice(4, 6)) * 60 + Number(timeZone.slice(7, 9)))
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    .format(timestamp + offsetMinutes * 60000)
}

function scheduleInterval(seconds: number, t: NativeSidebarTranslate): string {
  if (seconds % 3600 === 0) return t('schedule.hours', { n: seconds / 3600 })
  if (seconds % 60 === 0) return t('schedule.minutes', { n: seconds / 60 })
  return t('schedule.seconds', { n: seconds })
}

function applyScheduleFrame(jobs: readonly NativeScheduledJob[], frame: NativeScheduleFrame): readonly NativeScheduledJob[] {
  switch (frame.type) {
    case 'baseline': return frame.jobs
    case 'upsert': {
      const index = jobs.findIndex(job => job.id === frame.job.id)
      return index === -1 ? [...jobs, frame.job] : jobs.map((job, row) => row === index ? frame.job : job)
    }
    case 'remove': return jobs.filter(job => job.id !== frame.id)
    default: return assertNever(frame)
  }
}

/** Render the read-only Native Schedule list while following Host changes.
 * Closing the panel aborts its live feed.
 * @param props - Schedule client, locale hook, return action and localized copy.
 * @returns The live scheduled-task list panel.
 */
export function NativeScheduledTasksPanel({ client, close, useLocale, t }: {
  client: NativeScheduleClient
  close: () => void
  useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
  t: NativeSidebarTranslate
}): ReactNode {
  const locale = useLocale(snapshot => snapshot.locale)
  const [jobs, setJobs] = useState<readonly NativeScheduledJob[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const frame of client.follow(controller.signal)) {
          if (frame.type === 'baseline') setReady(true)
          setJobs(current => applyScheduleFrame(current, frame))
        }
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    })()
    return () => { controller.abort() }
  }, [client])
  return <section className={css.schedulePanel} aria-labelledby="native-scheduled-tasks-title">
    <header className={css.schedulePanelHeader}>
      <h1 id="native-scheduled-tasks-title">{t('scheduleAction')}</h1>
      <button type="button" className={css.scheduleClose} onClick={close}>{t('schedule.close')}</button>
    </header>
    {error && <p className={css.scheduleError} role="alert">{t('schedule.error')}</p>}
    {!ready ? <p className={css.scheduleEmpty} role="status">{t('schedule.loading')}</p>
      : jobs.length === 0 ? <p className={css.scheduleEmpty}>{t('schedule.empty')}</p>
        : jobs.map((job) => {
          const separator = '; every '
          const separatorIndex = job.schedule.indexOf(separator)
          const start = separatorIndex === -1 ? job.schedule : job.schedule.slice(0, separatorIndex)
          const repeat = separatorIndex === -1 ? undefined : job.schedule.slice(separatorIndex + separator.length)
          const scheduledAt = scheduleTime(Date.parse(start), job.timeZone, locale)
          const everySeconds = repeat === undefined ? undefined : Number.parseInt(repeat, 10)
          return <article className={css.scheduleCard} key={job.id}>
            <div className={css.scheduleCardHeader}>
              <strong>{job.title}</strong>
              <span className={css.scheduleBadge} data-state={job.state}>{t(`schedule.state.${job.state}`)}</span>
            </div>
            <p className={css.scheduleTiming}>{everySeconds === undefined
              ? t('schedule.once', { time: scheduledAt, zone: job.timeZone })
              : t('schedule.every', { interval: scheduleInterval(everySeconds, t), time: scheduledAt, zone: job.timeZone })}</p>
            <div className={css.scheduleNextRun}>
              <span>{t('schedule.nextRun')}</span>
              <strong>{job.nextRunAt === undefined ? t('schedule.noNextRun')
                : scheduleTime(job.nextRunAt, job.timeZone, locale)}</strong>
            </div>
          </article>
        })}
  </section>
}

/** Native SidebarRoot and its optional Session browser are installed independently from AppFrame. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-sidebar',
  targets: ['client'],
  requires: [
    'clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientNativeSessionPresentation',
    'clientNativeSession', 'clientNativeSchedule', 'clientNativeWorkspace', 'clientNativeDirectoryPicker', 'clientLocale',
  ],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const presentation = context.require('clientNativeSessionPresentation')
    const nativeSession = context.require('clientNativeSession')
    const scheduleClient = context.require('clientNativeSchedule')
    const workspaceClient = context.require('clientNativeWorkspace')
    const directoryPicker = context.require('clientNativeDirectoryPicker')
    const locale = context.require('clientLocale')
    const workspaceRegistry = createSnapshotStore<NativeWorkspaceSnapshot>({
      workspaces: [], archivedSessionIds: [], ready: false,
    })
    const homeDirectory = createSnapshotStore<string | undefined>(undefined)
    const homeLookup = directoryPicker.list(undefined, context.signal).then(({ path }) => {
      homeDirectory.set(path)
    }).catch((error: unknown) => {
      if (!context.signal.aborted) console.error('native sidebar home directory lookup failed:', error)
    })
    context.own(async () => { await homeLookup })
    const listDirectory = async (path?: string, signal?: AbortSignal): Promise<DirectoryBrowserListing> => {
      const listing = await directoryPicker.list(path, signal ?? context.signal)
      if (path === undefined) homeDirectory.set(listing.path)
      return {
        path: listing.path,
        home: homeDirectory.getSnapshot() ?? listing.path,
        crumbs: listing.crumbs.map(crumb => ({ ...crumb, hidden: false })),
        entries: listing.entries.filter(entry => entry.kind === 'directory')
          .map(entry => ({ name: entry.name, path: entry.path, hidden: entry.name.startsWith('.') })),
        truncated: false,
      }
    }
    const workspaceFollow = (async () => {
      try {
        for await (const frame of workspaceClient.follow(context.signal)) {
          workspaceRegistry.set(nextWorkspaceSnapshot(workspaceRegistry.getSnapshot(), frame))
        }
      } catch (error: unknown) {
        if (!context.signal.aborted) console.error('native sidebar Workspace follow failed:', error)
      }
    })()
    context.own(async () => { await workspaceFollow })
    context.own(locale.register('sidebar', { en: sidebarEn, zh: sidebarZh }))
    context.own(locale.register('nativeSidebar', { en, zh }))

    const scheduledTasksPanelId = 'scheduled-tasks' as MainPanelId
    context.own(slots.inject('main', () => slots.register({
      name: 'main', key: scheduledTasksPanelId, locale: 'nativeSidebar',
      inject: () => ({
        client: scheduleClient,
        close: () => { layout.selectPanel(null) },
        hooks: { locale: context.require('clientLocale') },
      }),
    }, NativeScheduledTasksPanel)))

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
        hooks: { conversation: controller, workspaceRegistry, homeDirectory },
        displayTitle: item => presentation.displayTitle(item),
        selectSession: controller.select.bind(controller),
        renameTitle: async (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => {
          await controller.renameTitle(id, title)
          return controller.getSnapshot().error === undefined
        },
        refreshTitle: controller.refreshTitle.bind(controller),
        searchSessions: nativeSession.search.bind(nativeSession),
        archiveSession: id => nativeSession.archive(id, context.signal),
        selectWorkspace: async (id) => {
          const { sessionId } = await workspaceClient.connectWorkspace(id, context.signal)
          await controller.select(sessionId)
        },
        listDirectory,
        createDirectory: (path, name) => directoryPicker.createDirectory(path, name, context.signal),
        createWorkspace: async (path) => {
          const { workspace } = await workspaceClient.create({ path }, context.signal)
          const { sessionId } = await workspaceClient.connectWorkspace(workspace.workspaceId, context.signal)
          await controller.select(sessionId)
        },
        renameWorkspace: (id, title) => workspaceClient.rename(id, title, context.signal),
        deleteWorkspace: id => workspaceClient.delete(id, context.signal),
        reorderWorkspace: (id, before) => workspaceClient.reorder(id, before, context.signal),
        reorderSession: (id, session, before) => workspaceClient.reorderSession(id, session, before, context.signal),
        toggleSidebar: layout.toggleSidebar.bind(layout),
      }),
    }, ({ wide, useConversation, useWorkspaceRegistry, useHomeDirectory, displayTitle, selectSession, renameTitle, refreshTitle,
      searchSessions, archiveSession, selectWorkspace, listDirectory, createDirectory, createWorkspace,
      renameWorkspace, deleteWorkspace, reorderWorkspace, reorderSession, toggleSidebar,
      t }: NativeWorkspacesProps) => (
      <NativeSessionBrowser wide={wide} useConversation={useConversation} useWorkspaceRegistry={useWorkspaceRegistry}
        useHomeDirectory={useHomeDirectory}
        displayTitle={displayTitle} selectSession={selectSession} renameTitle={renameTitle} refreshTitle={refreshTitle}
        searchSessions={searchSessions} archiveSession={archiveSession} selectWorkspace={selectWorkspace}
        listDirectory={listDirectory} createDirectory={createDirectory} createWorkspace={createWorkspace}
        renameWorkspace={renameWorkspace} deleteWorkspace={deleteWorkspace}
        reorderWorkspace={reorderWorkspace} reorderSession={reorderSession}
        toggleSidebar={toggleSidebar} t={t} />))))
    context.own(slots.inject('sidebar.header.action', () => slots.register({
      name: 'sidebar.header.action', id: 'scheduled-tasks', order: 10, locale: 'nativeSidebar',
      inject: () => ({ open: () => { layout.selectPanel(scheduledTasksPanelId) } }),
    }, ({ wide, open, t }: { wide: boolean; open: () => void; t: NativeSidebarTranslate }) => (
      <ScheduledTasksAction wide={wide} open={open} t={t} />))))
    syncPanels()
  },
}
