/** Native Web conversation application; the renderer and Session transport are selected Providers. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { foldTodos } from '@deepseek-ai/dsh-tool-todo/client-native'
import {
  Button, ChatComposerButton, ChatComposerCard, ChatComposerToolbar,
  ChatMascotHero, ChatWelcome, FishLogo,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryBrowserListing, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  NativeAgentPresetList, NativeDirectoryPickerClient, NativeSessionImage, NativeWorkspace,
} from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from './controller.ts'
import type { ConversationSnapshot } from './controller.ts'
import { NativeComposerAttachments } from './attachments.tsx'
import { NativePendingSubmissions } from './submissions.tsx'
import { NativeSessionGoal } from './goal.tsx'
import { HumanInteraction } from './human.tsx'
import { NativeTranscript } from './native-transcript.tsx'
import { NativeOnboarding } from './onboarding.tsx'
import { NativeTrajectoryInspector } from './trajectory.tsx'
import { ConversationModeLabel, ModelControls, ModelPickerControl } from './model-controls.tsx'
import { AgentPresetSeat, WorkspaceChooser } from './workspace-chooser.tsx'
import { en, zh, type ConversationLocaleKey } from './locales.ts'
import {
  announcePendingDefaultChanged, composerPendingDefault, readPendingDefault, subscribePendingDefault,
  type BusyEnterBehavior,
} from './pending-default.ts'
import { createNativeSettingsActions, NativeSidebarSettings } from './native-sidebar-settings.tsx'
import type { NativeSettingsActions } from './settings-page.tsx'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>
type WorkspaceStart = (trust?: boolean) => Promise<SessionId | undefined>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native conversation vocabulary and settings copy. */
    nativeApplication: ConversationLocaleKey
  }
  interface SlotMap {
    /** Frame-owned central panel, keyed by a matching sidebar panel id. */
    main: { kind: 'keyed'; scope: 'root' }
  }
}

function Conversation({ snapshot, useLocale, settingsActions, listWorkspaces, chooseWorkspace, addWorkspace, listDirectory,
  createDirectory, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
  selectPlanMode, selectPermissionPreset, submitPending, changePending, editPending, refreshPendingSubmissions,
  refreshModelControls, t, renderSlot }: {
  snapshot: ConversationSnapshot
  useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
  settingsActions: NativeSettingsActions
  listWorkspaces: () => Promise<readonly NativeWorkspace[]>
  chooseWorkspace: (id: NativeWorkspace['workspaceId'], trust?: boolean) => Promise<SessionId | undefined>
  addWorkspace: (path: string, trust?: boolean) => Promise<SessionId | undefined>
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryBrowserListing>
  createDirectory: NativeDirectoryPickerClient['createDirectory']
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  send: (text: string, files: readonly File[]) => Promise<boolean>
  cancel: () => void
  answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
  selectModel: NativeConversationController['selectModel']
  selectPreset: NativeConversationController['selectPreset']
  selectPlanMode: NativeConversationController['selectPlanMode']
  submitPending: NativeConversationController['submitPending']
  changePending: NativeConversationController['changePending']
  editPending: NativeConversationController['editPending']
  refreshPendingSubmissions: NativeConversationController['refreshPendingSubmissions']
  selectPermissionPreset: NativeConversationController['selectPermissionPreset']
  refreshModelControls: NativeConversationController['refreshModelControls']
  t: Translate
  renderSlot: (key: 'native.conversation.actions', owner: object) => ReactNode
}) {
  const activeLocale = useLocale(value => value.locale)
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') },
    footnotes: t('markdownFootnotes'),
  }), [activeLocale, t])
  const todos = useMemo(() => foldTodos(snapshot.events), [snapshot.events])
  const selected = snapshot.selected
  const [draft, setDraft] = useState('')
  const draftVersion = useRef(0)
  const [files, setFiles] = useState<readonly File[]>([])
  const [pendingDefault, setPendingDefault] = useState<BusyEnterBehavior>(readPendingDefault)
  const [pendingDefaultError, setPendingDefaultError] = useState(false)
  const [presetSeat, setPresetSeat] = useState<NativeAgentPresetList>()
  const [stagedPreset, setStagedPreset] = useState<string>()
  const [pendingPreset, setPendingPreset] = useState<{ readonly sessionId: SessionId; readonly preset: string }>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const followsTranscript = useRef(true)
  const followedSession = useRef(snapshot.selected)
  const ready = snapshot.state === 'ready' && snapshot.navigationPending !== true
  const acceptsPending = snapshot.state === 'sending' && snapshot.navigationPending !== true
  const inputReady = ready || acceptsPending
  const sending = snapshot.state === 'sending' || snapshot.state === 'cancelling'
  const hasConversation = snapshot.events.some(event => event.type === 'tool-workflow/run-start'
    || (isAppendSurfaceEvent(event) && deriveEventMessage(event)?.role !== 'system'))
  const petState = snapshot.human !== undefined ? 'waiting' : sending ? 'thinking' : 'idle'
  const workspace = snapshot.header?.cwd?.split(/[\\/]/).at(-1) ?? t('workspaceUnavailable')
  const selectedTitle = snapshot.sessions.find(session => session.header.id === selected)?.titleProjection
  const conversationTitle = selectedTitle?.status === 'resolved' ? selectedTitle.title
    : selectedTitle?.status === 'absent' ? t('untitledSession') : t('titleUnavailable')
  useEffect(() => {
    if (pendingPreset === undefined) return
    if (selected !== pendingPreset.sessionId) {
      setPendingPreset(undefined)
      return
    }
    const mode = snapshot.modeControls
    if (snapshot.state !== 'ready' || mode === undefined) return
    setPendingPreset(undefined)
    const preset = pendingPreset.preset
    if (!mode.locked && mode.canSelect && mode.current !== preset
      && mode.options.some(option => option.id === preset)) {
      void selectPreset(preset)
    }
  }, [selected, snapshot.state, snapshot.modeControls, pendingPreset, selectPreset])
  const stagePreset = (id: string): void => {
    setStagedPreset(id)
  }
  const startWorkspaceWithPreset = (start: WorkspaceStart): WorkspaceStart => {
    const preset = stagedPreset
    setStagedPreset(undefined)
    return async (trust) => {
      const sessionId = await start(trust)
      if (sessionId !== undefined && preset !== undefined) setPendingPreset({ sessionId, preset })
      return sessionId
    }
  }
  useEffect(() => {
    const lifetime = new AbortController()
    const unsubscribe = subscribePendingDefault(setPendingDefault)
    const refreshPreference = async (): Promise<void> => {
      const description = await settingsActions.settingsDescribe(lifetime.signal)
      if (lifetime.signal.aborted) return
      const namespace = description.namespaces.find(row => row.namespace === 'ui-conversation')
      const value = namespace === undefined ? readPendingDefault() : namespace.value.busyEnter as BusyEnterBehavior
      setPendingDefault(value)
      announcePendingDefaultChanged(value)
      setPendingDefaultError(false)
    }
    const refreshPresetSeat = async (): Promise<void> => {
      try {
        const roster = await settingsActions.agentPresetsList(lifetime.signal)
        if (lifetime.signal.aborted) return
        setPresetSeat(roster)
      } catch {
        if (!lifetime.signal.aborted) setPresetSeat(undefined)
      }
    }
    void (async () => {
      try {
        void refreshPresetSeat()
        await refreshPreference()
        for await (const event of settingsActions.settingsEvents(lifetime.signal)) {
          if (event.type === 'settings/document-updated' && event.namespace === 'ui-conversation') {
            await refreshPreference()
          }
          if (event.type === 'agent-presets/updated') {
            await refreshPresetSeat()
          }
          if (event.type === 'llm/adapters-updated' || event.type === 'accounts/changed'
            || event.type === 'settings/document-updated' && event.namespace === 'agent-default-model') {
            void Promise.resolve().then(refreshModelControls).catch(() => {
              // A catalog refresh failure must not stop preference updates.
            })
          }
        }
      } catch {
        if (!lifetime.signal.aborted) setPendingDefaultError(true)
      }
    })()
    return () => { lifetime.abort(); unsubscribe() }
  }, [settingsActions, refreshModelControls])
  useLayoutEffect(() => {
    if (followedSession.current !== snapshot.selected) {
      followedSession.current = snapshot.selected
      draftVersion.current++
      setDraft('')
      setFiles([])
      followsTranscript.current = true
    }
    const scroll = scrollRef.current
    if (scroll !== null && hasConversation && followsTranscript.current) scroll.scrollTop = scroll.scrollHeight
  }, [snapshot.selected, snapshot.events, snapshot.liveText, hasConversation])
  const submit = (placement?: 'queued' | 'steering'): void => {
    if (!inputReady || snapshot.selected === undefined || draft.trim() === '' || snapshot.submissionBusy) return
    if (acceptsPending && files.length > 0) return
    const version = ++draftVersion.current
    if (acceptsPending) {
      void submitPending(draft, placement ?? composerPendingDefault(pendingDefault)).then((success) => {
        if (success && draftVersion.current === version) { setDraft(''); setFiles([]) }
      })
    } else {
      const text = draft
      const attachments = files
      setDraft('')
      setFiles([])
      void send(text, attachments).then((success) => {
        if (!success && draftVersion.current === version) { setDraft(text); setFiles(attachments) }
      })
    }
  }
  const composer = <form className={css.composerForm} onSubmit={(event) => {
    event.preventDefault()
    submit()
  }}>
    <NativePendingSubmissions snapshot={snapshot} changePending={changePending} editPending={editPending}
      refresh={refreshPendingSubmissions} t={t} />
    <ChatComposerCard>
      <label className={css.editorLabel}>
        <span className={css.visuallyHidden}>{t('prompt')}</span>
        <textarea className={css.editor} aria-label={t('prompt')}
          placeholder={t(snapshot.selected === undefined ? 'composerChooseWorkspace' : 'composerPlaceholder')}
          value={draft} disabled={!inputReady || snapshot.selected === undefined || snapshot.submissionBusy}
          onChange={(event) => { draftVersion.current++; setDraft(event.target.value) }} rows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (acceptsPending && (event.metaKey || event.ctrlKey)) {
                const alternate = composerPendingDefault(pendingDefault) === 'steering' ? 'queued' : 'steering'
                submit(alternate)
              } else {
                submit()
              }
            }
          }} />
      </label>
      <ChatComposerToolbar>
        <div className={css.toolbarOptions}>
          {snapshot.modelControls?.images === undefined ? null : <NativeComposerAttachments
            files={files} onChange={setFiles} limits={snapshot.modelControls.images}
            disabled={!ready || snapshot.selected === undefined} t={t}
          />}
          <ModelControls snapshot={snapshot} selectPreset={selectPreset}
            selectPlanMode={selectPlanMode} selectPermissionPreset={selectPermissionPreset} t={t} />
        </div>
        <div className={css.toolbarActions}>
          <ModelPickerControl snapshot={snapshot} selectModel={selectModel} refreshModelControls={refreshModelControls} t={t} />
          {acceptsPending ? <>
            <Button type="button" size="sm" disabled={snapshot.submissionBusy || draft.trim() === '' || files.length > 0}
              onClick={() => { submit('queued') }}>{t('queueMessage')}</Button>
            <Button type="button" size="sm" disabled={snapshot.submissionBusy || draft.trim() === '' || files.length > 0}
              onClick={() => { submit('steering') }}>{t('steerMessage')}</Button>
          </> : null}
          {sending
            ? <ChatComposerButton kind="stop" label={t('cancel')} disabled={snapshot.state === 'cancelling'} onClick={cancel} />
            : <ChatComposerButton kind="send" label={t('send')} type="submit"
              disabled={!ready || snapshot.selected === undefined || draft.trim().length === 0} />}
        </div>
      </ChatComposerToolbar>
    </ChatComposerCard>
    {acceptsPending ? <p className={css.inputHint}>{t(files.length > 0 ? 'pendingTextOnly'
      : pendingDefaultError ? 'busySendPreferenceUnavailable'
        : pendingDefault === 'steer' ? 'pendingInputHintSteer' : 'pendingInputHint')}</p> : null}
  </form>
  return <>
    <main className={css.page}>
      <h1 className={css.visuallyHidden}>{t('title')}</h1>
      <header className={css.header}>
        <div className={css.heading}>
          {selected === undefined ? null : <>
            <strong className={css.sessionTitle}>{conversationTitle}</strong>
            <ConversationModeLabel snapshot={snapshot} t={t} />
          </>}
        </div>
        <nav aria-label={t('conversationActions')} className={css.actions}>{selected === undefined ? null : <><NativeTrajectoryInspector events={snapshot.events} locale={activeLocale} openLabel={t('trajectoryOpen')} title={t('trajectoryTitle')} closeLabel={t('trajectoryClose')} />{renderSlot('native.conversation.actions', {})}</>}</nav>
      </header>
      {snapshot.error === undefined ? null : <p className={css.error} role="alert">{t('error')}: {snapshot.error}</p>}
      {selected === undefined || !hasConversation
        ? <section className={css.empty}>
          <ChatMascotHero atlasUrl="/brand/kitsune-sprites.png" placement="hero" state="idle"
            characterLabel={t('petCharacter')} speech={t('petSpeech')}
            pauseLabel={t('petPause')} enableMotionLabel={t('petEnableMotion')} resumeLabel={t('petResume')} />
          <div className={css.welcome}>
            <ChatWelcome eyebrow={t('heroEyebrow')} title={t('heroHeadline')} badge={t('heroPreview')}
              tagline={t('heroTagline')} mark={<FishLogo size={34} />} />
          </div>
          <div className={css.contextRow}>
            <WorkspaceChooser label={selected === undefined ? t('chooseWorkspace') : workspace}
              currentWorkspaceId={snapshot.sessions.find(session => session.header.id === selected)?.workspaceId}
              selected={selected !== undefined} ready={ready} listWorkspaces={listWorkspaces}
              chooseWorkspace={id => startWorkspaceWithPreset(trust => chooseWorkspace(id, trust))}
              addWorkspace={path => startWorkspaceWithPreset(trust => addWorkspace(path, trust))}
              listDirectory={listDirectory} createDirectory={createDirectory}
              t={t} />
            {selected === undefined ? <AgentPresetSeat roster={presetSeat}
              stagedPreset={stagedPreset} stagePreset={stagePreset} t={t} /> : null}
          </div>
          {composer}
        </section>
        : <>
          <ChatMascotHero atlasUrl="/brand/kitsune-sprites.png" placement="floating" state={petState}
            characterLabel={t('petCharacter')} speech={sending ? t('petThinking') : t('petSpeech')}
            pauseLabel={t('petPause')} enableMotionLabel={t('petEnableMotion')} resumeLabel={t('petResume')} />
          <div ref={scrollRef} className={css.scroll} onScroll={(event) => {
            const element = event.currentTarget
            followsTranscript.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
          }}>
            {todos === null ? null : <aside className={css.todos} aria-label={t('todos')}>
              <h2>{t('todos')}</h2>
              <ul>{todos.map(todo => <li key={todo.content} data-todo-status={todo.status}>
                <span>{t(todo.status)}</span>: {todo.content}
              </li>)}</ul>
            </aside>}
            <section aria-label={t('facts')}>
              <NativeTranscript snapshot={snapshot} sessionId={selected} locale={activeLocale} loadImage={loadImage}
                markdownLabels={markdownLabels} imageGroupClassName={css.images} truncatedClassName={css.extra}
                activity={sending && snapshot.liveText === undefined ? t(snapshot.state) : undefined} t={t} />
              {snapshot.human === undefined ? null : <div className={css.human}><HumanInteraction key={snapshot.human.id}
                answerHuman={answerHuman} prompt={snapshot.human}
                disabled={snapshot.answeringHuman === true || snapshot.state !== 'sending'} locale={activeLocale} /></div>}
            </section>
          </div>
          <div className={css.composerArea}><NativeSessionGoal events={snapshot.events} locale={activeLocale} />{composer}</div>
        </>}
    </main>
  </>
}

/** Minimal native application selected by the explicit native-web profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-application', targets: ['client'],
  requires: ['clientNativeSession', 'clientNativeWorkspace', 'clientNativeDirectoryPicker', 'clientSlots', 'clientLocale', 'clientNativeTheme'], provides: ['clientApplication', 'clientNativeConversation'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['locale', 'maxLiveTextChars', 'maxLiveEvents'].includes(key)))) throw new TypeError('native conversation: invalid configuration')
    const locale = input !== undefined && 'locale' in input ? input.locale : undefined
    if (locale !== undefined && locale !== 'en' && locale !== 'zh') throw new TypeError('native conversation: locale must be en or zh')
    const maxLiveTextChars = input !== undefined && 'maxLiveTextChars' in input ? input.maxLiveTextChars : undefined
    const maxLiveEvents = input !== undefined && 'maxLiveEvents' in input ? input.maxLiveEvents : undefined
    if (typeof maxLiveTextChars !== 'number' || !Number.isSafeInteger(maxLiveTextChars) || maxLiveTextChars < 1
      || typeof maxLiveEvents !== 'number' || !Number.isSafeInteger(maxLiveEvents) || maxLiveEvents < 1) throw new TypeError('native conversation: invalid live presentation limits')
    return (context) => {
      const client = context.require('clientNativeSession')
      const workspaceClient = context.require('clientNativeWorkspace')
      const directoryPicker = context.require('clientNativeDirectoryPicker')
      const slots = context.require('clientSlots')
      const clientLocale = context.require('clientLocale')
      const clientTheme = context.require('clientNativeTheme')
      context.own(clientLocale.register('nativeApplication', { en, zh }))
      if (locale !== undefined) clientLocale.setLocale(locale)
      const controller = new NativeConversationController(client, { maxLiveTextChars, maxLiveEvents })
      const refreshModelControls = controller.refreshModelControls.bind(controller)
      const settingsActions = createNativeSettingsActions(client)
      let homeDirectory: string | undefined
      const listDirectory = async (path?: string, signal?: AbortSignal): Promise<DirectoryBrowserListing> => {
        const listing = await directoryPicker.list(path, signal ?? context.signal)
        if (path === undefined) homeDirectory = listing.path
        return {
          path: listing.path,
          home: homeDirectory ?? listing.path,
          crumbs: listing.crumbs.map(crumb => ({ ...crumb, hidden: false })),
          entries: listing.entries.filter(entry => entry.kind === 'directory')
            .map(entry => ({ name: entry.name, path: entry.path, hidden: entry.name.startsWith('.') })),
          truncated: false,
        }
      }
      context.provide('clientNativeConversation', controller)
      context.own(() => controller.close())
      context.own(slots.inject('sidebar.settings', () => slots.register({
        name: 'sidebar.settings', locale: 'nativeApplication',
        inject: () => ({
          hooks: { locale: clientLocale, theme: clientTheme },
          settingsActions,
          refreshModelControls,
          setLocale: clientLocale.setLocale.bind(clientLocale),
          toggleTheme: clientTheme.toggle.bind(clientTheme),
          setThemePreference: clientTheme.setPreference.bind(clientTheme),
          setFontSize: clientTheme.setFontSize.bind(clientTheme),
        }),
      }, NativeSidebarSettings)))
      context.own(slots.inject('main', () => slots.register({
        name: 'main', key: 'conversation', locale: 'nativeApplication',
        children: { 'native.conversation.actions': { kind: 'list', scope: 'root' } },
        inject: () => ({
          hooks: { conversation: controller, locale: clientLocale },
          settingsActions,
          listWorkspaces: async () => (await workspaceClient.list(context.signal)).workspaces,
          chooseWorkspace: async (id: NativeWorkspace['workspaceId'], trust?: boolean) => {
            const navigation = controller.beginNavigation(true)
            try {
              const { sessionId } = trust === undefined
                ? await workspaceClient.connectWorkspace(id, context.signal)
                : await workspaceClient.connectWorkspace(id, context.signal, trust)
              await controller.idle()
              if (!controller.isCurrentNavigation(navigation)) return undefined
              await controller.select(sessionId)
              return controller.getSnapshot().selected === sessionId ? sessionId : undefined
            } catch (error: unknown) {
              if (!controller.isCurrentNavigation(navigation)) return undefined
              controller.releaseNavigation(navigation)
              throw error
            }
          },
          addWorkspace: async (path: string, trust?: boolean) => {
            const navigation = controller.beginNavigation(true)
            try {
              const { workspace } = await workspaceClient.create({ path, ...trust === undefined ? {} : { trust } }, context.signal)
              if (!controller.isCurrentNavigation(navigation)) return undefined
              const { sessionId } = trust === undefined
                ? await workspaceClient.connectWorkspace(workspace.workspaceId, context.signal)
                : await workspaceClient.connectWorkspace(workspace.workspaceId, context.signal, trust)
              await controller.idle()
              if (!controller.isCurrentNavigation(navigation)) return undefined
              await controller.select(sessionId)
              return controller.getSnapshot().selected === sessionId ? sessionId : undefined
            } catch (error: unknown) {
              if (!controller.isCurrentNavigation(navigation)) return undefined
              controller.releaseNavigation(navigation)
              throw error
            }
          },
          listDirectory,
          createDirectory: (path: string, name: string) => directoryPicker.createDirectory(path, name, context.signal),
          loadImage: controller.image.bind(controller),
          send: async (text: string, files: readonly File[]) => {
            await controller.send(text, files)
            return controller.getSnapshot().error === undefined
          },
          submitPending: controller.submitPending.bind(controller),
          changePending: controller.changePending.bind(controller),
          editPending: controller.editPending.bind(controller),
          refreshPendingSubmissions: controller.refreshPendingSubmissions.bind(controller),
          cancel: () => { controller.cancel() },
          answerHuman: controller.answerHuman.bind(controller),
          selectModel: controller.selectModel.bind(controller),
          selectPreset: controller.selectPreset.bind(controller),
          selectPlanMode: controller.selectPlanMode.bind(controller),
          selectPermissionPreset: controller.selectPermissionPreset.bind(controller),
          refreshModelControls,
        }),
      }, ({ useConversation, useLocale, settingsActions, listWorkspaces, chooseWorkspace, addWorkspace, listDirectory,
        createDirectory, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
        selectPlanMode, selectPermissionPreset, submitPending, changePending, editPending, refreshPendingSubmissions,
        refreshModelControls, t, renderSlot }: {
        useConversation: SnapshotSelectorHook<ConversationSnapshot>
        useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
        settingsActions: NativeSettingsActions
        listWorkspaces: () => Promise<readonly NativeWorkspace[]>
        chooseWorkspace: (id: NativeWorkspace['workspaceId'], trust?: boolean) => Promise<SessionId | undefined>
        addWorkspace: (path: string, trust?: boolean) => Promise<SessionId | undefined>
        listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryBrowserListing>
        createDirectory: NativeDirectoryPickerClient['createDirectory']
        loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
        send: (text: string, files: readonly File[]) => Promise<boolean>
        cancel: () => void
        answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
        selectModel: NativeConversationController['selectModel']
        selectPreset: NativeConversationController['selectPreset']
        selectPlanMode: NativeConversationController['selectPlanMode']
        submitPending: NativeConversationController['submitPending']
        changePending: NativeConversationController['changePending']
        editPending: NativeConversationController['editPending']
        refreshPendingSubmissions: NativeConversationController['refreshPendingSubmissions']
        selectPermissionPreset: NativeConversationController['selectPermissionPreset']
        refreshModelControls: NativeConversationController['refreshModelControls']
        t: Translate
        renderSlot: (key: 'native.conversation.actions', owner: object) => ReactNode
      }) => <Conversation snapshot={useConversation(value => value)} useLocale={useLocale}
        settingsActions={settingsActions} listWorkspaces={listWorkspaces} chooseWorkspace={chooseWorkspace}
        addWorkspace={addWorkspace} listDirectory={listDirectory} createDirectory={createDirectory}
        loadImage={loadImage} send={send}
        cancel={cancel} answerHuman={answerHuman} selectModel={selectModel} selectPreset={selectPreset}
        selectPlanMode={selectPlanMode} selectPermissionPreset={selectPermissionPreset}
        submitPending={submitPending} changePending={changePending} editPending={editPending}
        refreshPendingSubmissions={refreshPendingSubmissions}
        refreshModelControls={refreshModelControls} t={t} renderSlot={renderSlot} />)))
      context.provide('clientApplication', { render: () => <NativeOnboarding client={client} localeService={clientLocale}
        themeService={clientTheme}>{slots.renderSlot('root', {})}</NativeOnboarding> })
      void controller.load()
    }
  },
}
