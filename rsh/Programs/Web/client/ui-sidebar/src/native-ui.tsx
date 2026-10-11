/** Native navigation surface over the existing Session and layout owners. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import {
  Button, IconClockOutline16, IconPersonalizationOutline16, IconProjectAddOutline16, Modal, Tooltip,
  ProjectRowItem, SearchResultItem, SessionNodeItem, WorkspaceSectionEmpty, WorkspaceSectionHeader, workspaceLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSearchRow, WorkspaceGroupRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  NativeSessionClient, NativeSessionListItem,
} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeWorkspace, NativeWorkspaceBaseline, NativeWorkspaceClient, NativeWorkspaceFrame }
  from '@deepseek-ai/dsh-client-native-session/workspaces'
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
  sessions: '会话', workspace: '工作区', empty: '暂无会话', loading: '正在读取会话…',
  scheduleAction: '定时任务', search: '搜索会话', searchAria: '搜索会话', searchPlaceholder: '搜索会话…',
  sortUpdated: '按最近活动排序', sortManual: '按手动顺序排序', addWorkspace: '新建工作区', workspaceTitle: '工作区名称',
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
  sessions: 'Sessions', workspace: 'Workspaces', empty: 'No sessions yet', loading: 'Loading Sessions…',
  scheduleAction: 'Scheduled tasks', search: 'Search sessions', searchAria: 'Search sessions', searchPlaceholder: 'Search sessions…',
  sortUpdated: 'Sort by recent activity', sortManual: 'Sort by manual order', addWorkspace: 'New workspace', workspaceTitle: 'Workspace title',
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
  }
  displayTitle: NativeSessionPresentation['displayTitle']
  selectSession: NativeConversationService['select']
  renameTitle: (id: Parameters<NativeConversationService['renameTitle']>[0], title: string) => Promise<boolean>
  refreshTitle: NativeConversationService['refreshTitle']
  searchSessions: NativeSessionClient['search']
  archiveSession: NativeSessionClient['archive']
  selectWorkspace: (id: NativeWorkspaceId) => Promise<void>
  createWorkspace: () => Promise<void>
  renameWorkspace: NativeWorkspaceClient['rename']
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

function NativeSessionBrowser({
  wide, useConversation, useWorkspaceRegistry, displayTitle, selectSession, renameTitle, refreshTitle,
  searchSessions, archiveSession, selectWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, toggleSidebar, t,
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
  createWorkspace: () => Promise<void>
  renameWorkspace: NativeWorkspaceClient['rename']
  deleteWorkspace: NativeWorkspaceClient['delete']
  toggleSidebar: () => void
  t: NativeSidebarTranslate
}) {
  const snapshot = useConversation(value => value)
  const registry = useWorkspaceRegistry(value => value)
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
  const [order, setOrder] = useState<'updated' | 'manual'>('updated')
  const [actionError, setActionError] = useState<string>()
  const [searchState, setSearchState] = useState<NativeSearchState>({ query: '', status: 'idle', items: [] })
  const searchInput = useRef<HTMLInputElement>(null)
  const groups = groupNativeSessions(snapshot.sessions, registry, snapshot.selected, displayTitle, collapsedGroups, order, t)
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
          hasActiveSchedule: false,
        }
      })
      setSearchState({ query: searchQuery, status: 'ready', items })
    }).catch(() => {
      if (!request.signal.aborted) setSearchState({ query: searchQuery, status: 'error', items: [] })
    })
    return () => { request.abort() }
  }, [searchExpanded, searchQuery, searchSessions, archived, sessionItems, workspaceItems, t])
  const runAction = (action: () => Promise<unknown>): void => {
    void action().catch((error: unknown) => { setActionError(errorMessage(error)) })
  }
  const addWorkspaceAction = <Tooltip label={t('addWorkspace')} delayMs={500} disabled={wide}>
    <button type="button" className={css.workspaceHeaderButton} aria-label={t('addWorkspace')}
      title={t('addWorkspace')} disabled={snapshot.state !== 'ready' || !registry.ready}
      onClick={() => { runAction(createWorkspace) }}>
      <IconProjectAddOutline16 size={wide ? 16 : 18} />
    </button>
  </Tooltip>
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
    label={t('workspace')}
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
      label={t('workspace')}
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
        <button type="button" className={css.workspaceHeaderButton} aria-label={t(order === 'updated' ? 'sortManual' : 'sortUpdated')}
          title={t(order === 'updated' ? 'sortManual' : 'sortUpdated')} onClick={() => { setOrder(order === 'updated' ? 'manual' : 'updated') }}>
          <IconPersonalizationOutline16 />
        </button>
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
        {groups.map((group) => {
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
            <ProjectRowItem group={group} label={group.label} onToggle={() => {
              setCollapsedGroups((current) => {
                const next = new Set(current)
                if (next.has(group.key)) next.delete(group.key)
                else next.add(group.key)
                return next
              })
              if (workspaceId !== undefined && snapshot.state === 'ready') runAction(() => selectWorkspace(workspaceId))
            }} onCreate={workspaceId === undefined ? undefined : () => {
              if (snapshot.state === 'ready') runAction(() => selectWorkspace(workspaceId))
            }} actions={workspaceActions} showCreate={workspaceId !== undefined} t={t} />
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
            {group.expanded && group.sessions.map((session) => {
              const item = sessionItems.get(session.id)
              return <div key={session.id}>
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
              </div>
            })}
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
  requires: [
    'clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientNativeSessionPresentation',
    'clientNativeSession', 'clientNativeWorkspace', 'clientNativeDirectoryPicker', 'clientLocale',
  ],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const presentation = context.require('clientNativeSessionPresentation')
    const nativeSession = context.require('clientNativeSession')
    const workspaceClient = context.require('clientNativeWorkspace')
    const directoryPicker = context.require('clientNativeDirectoryPicker')
    const locale = context.require('clientLocale')
    const workspaceRegistry = createSnapshotStore<NativeWorkspaceSnapshot>({
      workspaces: [], archivedSessionIds: [], ready: false,
    })
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
        hooks: { conversation: controller, workspaceRegistry },
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
        createWorkspace: async () => {
          const path = await directoryPicker.pick(context.signal)
          if (path === null) return
          const { workspace } = await workspaceClient.create({ path }, context.signal)
          const { sessionId } = await workspaceClient.connectWorkspace(workspace.workspaceId, context.signal)
          await controller.select(sessionId)
        },
        renameWorkspace: (id, title) => workspaceClient.rename(id, title, context.signal),
        deleteWorkspace: id => workspaceClient.delete(id, context.signal),
        toggleSidebar: layout.toggleSidebar.bind(layout),
      }),
    }, ({ wide, useConversation, useWorkspaceRegistry, displayTitle, selectSession, renameTitle, refreshTitle,
      searchSessions, archiveSession, selectWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, toggleSidebar,
      t }: NativeWorkspacesProps) => (
      <NativeSessionBrowser wide={wide} useConversation={useConversation} useWorkspaceRegistry={useWorkspaceRegistry}
        displayTitle={displayTitle} selectSession={selectSession} renameTitle={renameTitle} refreshTitle={refreshTitle}
        searchSessions={searchSessions} archiveSession={archiveSession} selectWorkspace={selectWorkspace}
        createWorkspace={createWorkspace} renameWorkspace={renameWorkspace} deleteWorkspace={deleteWorkspace}
        toggleSidebar={toggleSidebar} t={t} />))))
    context.own(slots.inject('sidebar.header.action', () => slots.register({
      name: 'sidebar.header.action', id: 'scheduled-tasks', order: 10, locale: 'nativeSidebar',
    }, ({ wide, t }: { wide: boolean; t: NativeSidebarTranslate }) => <ScheduledTasksAction wide={wide} t={t} />)))
    syncPanels()
  },
}
