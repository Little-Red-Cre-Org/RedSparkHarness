/** Native Session details, projected from the selected roster row and durable history. */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSessionClient, NativeWorkspaceFilesClient } from '@deepseek-ai/dsh-client-native-session/native'
import { Button, Pill, SidebarPathBar } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeConversationSnapshot } from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type { LayoutInfo } from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import { NativeFilesPanel } from './native-files.tsx'
import css from './native-ui.module.css'
import { en as rightbarEn, zh as rightbarZh, type NativeRightbarKey } from './locales.ts'

type NativeRightbarTranslate = TranslateNS<'nativeSidebarRight'>
type HistoryState =
  | { readonly sessionId: SessionId; readonly kind: 'loading' }
  | { readonly sessionId: SessionId; readonly kind: 'failed' }
  | { readonly sessionId: SessionId; readonly kind: 'ready'; readonly events: readonly SessionEvent[] }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    nativeSidebarRight: NativeRightbarKey
  }
}



interface HistorySummary {
  readonly turns: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latestRoute?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly contextWindow?: number
}

function summarizeHistory(events: readonly SessionEvent[]): HistorySummary {
  let turns = 0
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let latestRoute: HistorySummary['latestRoute']
  let contextWindow: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') turns += 1
    if (event.type === 'user/message') userMessages += 1
    if (event.type === 'tool/call') toolCalls += 1
    if (event.type === 'assistant/message') {
      assistantMessages += 1
      inputTokens += event.data.usage?.inputTokens ?? 0
      outputTokens += event.data.usage?.outputTokens ?? 0
    }
    if (event.type === 'request/header') {
      const { provider, model, reasoningEffort } = event.data.header.config
      latestRoute = { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
    }
    if (event.type === 'request/context') contextWindow = event.data.contextWindow
  }
  return {
    turns, userMessages, assistantMessages, toolCalls, inputTokens, outputTokens,
    ...(latestRoute === undefined ? {} : { latestRoute }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  }
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function DetailField({ label, value }: { label: string; value: string | number | undefined }): ReactNode {
  if (value === undefined) return null
  return <div className={css.field}><dt>{label}</dt><dd>{value}</dd></div>
}

function Overview({ snapshot, t }: { snapshot: NativeConversationSnapshot; t: NativeRightbarTranslate }): ReactNode {
  const header = snapshot.header
  if (header === undefined) return <p className={css.empty}>{t('noSession')}</p>
  const session = snapshot.sessions.find(item => item.header.id === header.id)
  const status = session === undefined ? undefined
    : session.running ? t('statusRunning')
      : session.completed ? t('statusCompleted')
        : session.blank ? t('statusBlank') : t('statusIdle')
  return (
    <div className={css.scroll}>
      {header.cwd === undefined ? null : <SidebarPathBar path={header.cwd} />}
      <section className={css.section}>
        <h3>{t('session')}</h3>
        <dl className={css.fields}>
          <DetailField label={t('sessionId')} value={header.id} />
          <DetailField label={t('status')} value={status} />
          <DetailField label={t('createdAt')} value={formatTime(header.createdAt)} />
          <DetailField label={t('lastActive')} value={session === undefined ? undefined : formatTime(session.updatedAt)} />
          <DetailField label={t('parentSession')} value={header.parentSession} />
          <DetailField label={t('agentPreset')} value={header.agentPreset} />
        </dl>
      </section>
    </div>
  )
}

function Activity({ history, snapshot, t }: {
  history: HistoryState | undefined
  snapshot: NativeConversationSnapshot
  t: NativeRightbarTranslate
}): ReactNode {
  const selected = snapshot.selected
  if (snapshot.header === undefined) return <p className={css.empty}>{t('noSession')}</p>
  const current = history?.sessionId === selected ? history : undefined
  if (current === undefined || current.kind === 'loading') return <p className={css.empty}>{t('loadingHistory')}</p>
  if (current.kind === 'failed') return <p className={css.empty}>{t('historyUnavailable')}</p>
  const summary = summarizeHistory(current.events)
  if (summary.turns === 0 && summary.userMessages === 0 && summary.assistantMessages === 0 && summary.toolCalls === 0) {
    return <p className={css.empty}>{t('noHistory')}</p>
  }
  return (
    <div className={css.scroll}>
      <section className={css.section}>
        <h3>{t('activity')}</h3>
        <p className={css.scope}>{t('activityScope')}</p>
        <dl className={css.fields}>
          <DetailField label={t('turns')} value={summary.turns} />
          <DetailField label={t('userMessages')} value={summary.userMessages} />
          <DetailField label={t('assistantMessages')} value={summary.assistantMessages} />
          <DetailField label={t('toolCalls')} value={summary.toolCalls} />
          <DetailField label={t('inputTokens')} value={summary.inputTokens} />
          <DetailField label={t('outputTokens')} value={summary.outputTokens} />
        </dl>
      </section>
      {summary.latestRoute === undefined ? null : (
        <section className={css.section}>
          <h3>{t('latestModel')}</h3>
          <dl className={css.fields}>
            <DetailField label={t('provider')} value={summary.latestRoute.provider} />
            <DetailField label={t('model')} value={summary.latestRoute.model} />
            <DetailField label={t('reasoningEffort')} value={summary.latestRoute.reasoningEffort} />
          </dl>
        </section>
      )}
      {summary.contextWindow === undefined ? null : (
        <section className={css.section}>
          <h3>{t('requestContext')}</h3>
          <dl className={css.fields}><DetailField label={t('contextWindow')} value={summary.contextWindow} /></dl>
        </section>
      )}
    </div>
  )
}

function SessionDetails({ useConversation, useLayoutInfo, readHistory, workspaceFiles, close, t }: {
  useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
  useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
  readHistory: NativeSessionClient['history']
  workspaceFiles: NativeWorkspaceFilesClient | undefined
  close: () => void
  t: NativeRightbarTranslate
}) {
  const snapshot = useConversation(value => value)
  const visible = useLayoutInfo(value => value.rightbarShown)
  const [section, setSection] = useState<'overview' | 'activity' | 'files' | 'preview'>('overview')
  const [history, setHistory] = useState<HistoryState>()
  const sessionId = snapshot.selected

  useEffect(() => {
    if (!visible || sessionId === undefined) return undefined
    const controller = new AbortController()
    let active = true
    setHistory({ sessionId, kind: 'loading' })
    void readHistory(sessionId, controller.signal).then(
      (result) => { if (active) setHistory({ sessionId, kind: 'ready', events: result.events }) },
      () => { if (active) setHistory({ sessionId, kind: 'failed' }) },
    )
    return () => { active = false; controller.abort() }
  }, [readHistory, sessionId, visible])

  if (!visible) return null
  return (
    <aside className={css.panel} aria-label={t('details')}>
      <header className={css.header}>
        <h2>{t('details')}</h2>
        <Button variant="ghost" size="sm" onClick={close} aria-label={t('close')}>×</Button>
      </header>
      <div className={css.sections} role="group" aria-label={t('sections')}>
        <Pill active={section === 'overview'} aria-pressed={section === 'overview'} onClick={() => { setSection('overview') }}>{t('overview')}</Pill>
        <Pill active={section === 'activity'} aria-pressed={section === 'activity'} onClick={() => { setSection('activity') }}>{t('activity')}</Pill>
        {workspaceFiles === undefined ? null : <>
          <Pill active={section === 'files'} aria-pressed={section === 'files'} onClick={() => { setSection('files') }}>{t('files')}</Pill>
          <Pill active={section === 'preview'} aria-pressed={section === 'preview'} onClick={() => { setSection('preview') }}>{t('filePreview')}</Pill>
        </>}
      </div>
      <div className={css.content}>
        {section === 'overview' ? <Overview snapshot={snapshot} t={t} /> : null}
        {section === 'activity' ? <Activity history={history} snapshot={snapshot} t={t} /> : null}
        {workspaceFiles === undefined ? null : <NativeFilesPanel
          sessionId={sessionId}
          workspaceRoot={snapshot.header?.cwd}
          section={section}
          service={workspaceFiles}
          onOpenPreview={() => { setSection('preview') }}
          t={t}
        />}
      </div>
    </aside>
  )
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

/** Native right surface over the selected Session's roster and history facts. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-sidebar-right',
  targets: ['client'],
  requires: ['clientSlots', 'clientNativeLayout', 'clientNativeConversation', 'clientNativeSession', 'clientLocale'],
  optional: ['clientNativeWorkspaceFiles'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const layout = context.require('clientNativeLayout')
    const controller = context.require('clientNativeConversation')
    const session = context.require('clientNativeSession')
    const workspaceFiles = context.optional('clientNativeWorkspaceFiles')
    const readHistory: NativeSessionClient['history'] = (sessionId, signal) => session.history(sessionId, signal)
    const locale = context.require('clientLocale')
    context.own(locale.register('nativeSidebarRight', { en: rightbarEn, zh: rightbarZh }))
    context.own(slots.inject('rightbar', () => slots.register({ name: 'rightbar', locale: 'nativeSidebarRight',
      inject: () => ({
        hooks: { conversation: controller, layoutInfo: layout.layoutInfo }, readHistory, workspaceFiles,
        close: () => { layout.closeRightbar() },
      }) },
    ({ useConversation, useLayoutInfo, readHistory: loadHistory, close, t }: {
      useConversation: SnapshotSelectorHook<NativeConversationSnapshot>
      useLayoutInfo: SnapshotSelectorHook<LayoutInfo>
      readHistory: NativeSessionClient['history']
      workspaceFiles: NativeWorkspaceFilesClient | undefined
      close: () => void
      t: NativeRightbarTranslate
    }) => (
      <SessionDetails
        useConversation={useConversation}
        useLayoutInfo={useLayoutInfo}
        readHistory={loadHistory}
        workspaceFiles={workspaceFiles}
        close={close}
        t={t}
      />
    ))))
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
