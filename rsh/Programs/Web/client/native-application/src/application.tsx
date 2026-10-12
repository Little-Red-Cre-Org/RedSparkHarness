/** Native Web conversation application; the renderer and Session transport are selected Providers. */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { foldTodos } from '@deepseek-ai/dsh-tool-todo/client-native'
import {
  ChatComposerButton, ChatComposerCard, ChatComposerToolbar,
  ChatMascotHero, ChatWelcome, FishLogo, IconChevronDownOutline14, IconFolderOpen16, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from './controller.ts'
import type { ConversationSnapshot } from './controller.ts'
import { NativeComposerAttachments } from './attachments.tsx'
import { HumanInteraction } from './human.tsx'
import { NativeTranscript } from './native-transcript.tsx'
import { ModelControls, ModelPickerControl } from './model-controls.tsx'
import { en, zh, type ConversationLocaleKey } from './locales.ts'
import { createNativeSettingsActions, NativeSidebarSettings } from './native-sidebar-settings.tsx'
import css from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

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

function Conversation({ snapshot, useLocale, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
  selectPlanMode, selectPermissionPreset,
  refreshModelControls, t, renderSlot }: {
  snapshot: ConversationSnapshot
  useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  send: (text: string, files: readonly File[]) => Promise<boolean>
  cancel: () => void
  answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
  selectModel: NativeConversationController['selectModel']
  selectPreset: NativeConversationController['selectPreset']
  selectPlanMode: NativeConversationController['selectPlanMode']
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
  const [files, setFiles] = useState<readonly File[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const followsTranscript = useRef(true)
  const followedSession = useRef(snapshot.selected)
  const ready = snapshot.state === 'ready'
  const sending = snapshot.state === 'sending' || snapshot.state === 'cancelling'
  const hasConversation = snapshot.events.some(event => isAppendSurfaceEvent(event)
    && deriveEventMessage(event)?.role !== 'system')
  const petState = snapshot.human !== undefined ? 'waiting' : sending ? 'thinking' : 'idle'
  const workspace = snapshot.header?.cwd?.split(/[\\/]/).at(-1) ?? t('workspaceUnavailable')
  const selectedTitle = snapshot.sessions.find(session => session.header.id === selected)?.titleProjection
  const conversationTitle = selectedTitle?.status === 'resolved' ? selectedTitle.title
    : selectedTitle?.status === 'absent' ? t('untitledSession') : t('titleUnavailable')
  useLayoutEffect(() => {
    if (followedSession.current !== snapshot.selected) {
      followedSession.current = snapshot.selected
      followsTranscript.current = true
    }
    const scroll = scrollRef.current
    if (scroll !== null && hasConversation && followsTranscript.current) scroll.scrollTop = scroll.scrollHeight
  }, [snapshot.selected, snapshot.events, snapshot.liveText, hasConversation])
  const submit = (): void => {
    if (!ready || snapshot.selected === undefined || draft.trim().length === 0) return
    void send(draft, files).then((success) => {
      if (success) { setDraft(''); setFiles([]) }
    })
  }
  const composer = <form className={css.composerForm} onSubmit={(event) => {
    event.preventDefault()
    submit()
  }}>
    <ChatComposerCard>
      <label className={css.editorLabel}>
        <span className={css.visuallyHidden}>{t('prompt')}</span>
        <textarea className={css.editor} aria-label={t('prompt')} placeholder={t('composerPlaceholder')}
          value={draft} disabled={!ready || snapshot.selected === undefined}
          onChange={(event) => { setDraft(event.target.value) }} rows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
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
          {sending
            ? <ChatComposerButton kind="stop" label={t('cancel')} disabled={snapshot.state === 'cancelling'} onClick={cancel} />
            : <ChatComposerButton kind="send" label={t('send')} type="submit"
              disabled={!ready || snapshot.selected === undefined || draft.trim().length === 0} />}
        </div>
      </ChatComposerToolbar>
    </ChatComposerCard>
  </form>
  return <>
    <main className={css.page}>
      <h1 className={css.visuallyHidden}>{t('title')}</h1>
      <header className={css.header}>
        <div className={css.heading}>
          {selected === undefined ? null : <>
            <strong className={css.sessionTitle}>{conversationTitle}</strong>
            <Pill active>{t('chatMode')}</Pill>
          </>}
        </div>
        <nav aria-label={t('conversationActions')} className={css.actions}>{renderSlot('native.conversation.actions', {})}</nav>
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
            <button type="button" className={css.workspace} disabled>
              <IconFolderOpen16 size={16} />
              <span>{workspace}</span>
              <IconChevronDownOutline14 size={12} />
            </button>
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
                disabled={snapshot.answeringHuman === true || snapshot.state !== 'sending'} t={t} /></div>}
            </section>
          </div>
          <div className={css.composerArea}>{composer}</div>
        </>}
    </main>
  </>
}

/** Minimal native application selected by the explicit native-web profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-application', targets: ['client'],
  requires: ['clientNativeSession', 'clientSlots', 'clientLocale', 'clientNativeTheme'], provides: ['clientApplication', 'clientNativeConversation'],
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
      const slots = context.require('clientSlots')
      const clientLocale = context.require('clientLocale')
      const clientTheme = context.require('clientNativeTheme')
      context.own(clientLocale.register('nativeApplication', { en, zh }))
      if (locale !== undefined) clientLocale.setLocale(locale)
      const controller = new NativeConversationController(client, { maxLiveTextChars, maxLiveEvents })
      const refreshModelControls = controller.refreshModelControls.bind(controller)
      const settingsActions = createNativeSettingsActions(client)
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
        }),
      }, NativeSidebarSettings)))
      context.own(slots.inject('main', () => slots.register({
        name: 'main', key: 'conversation', locale: 'nativeApplication',
        children: { 'native.conversation.actions': { kind: 'list', scope: 'root' } },
        inject: () => ({
          hooks: { conversation: controller, locale: clientLocale },
          loadImage: controller.image.bind(controller),
          send: async (text: string, files: readonly File[]) => {
            await controller.send(text, files)
            return controller.getSnapshot().error === undefined
          },
          cancel: () => { controller.cancel() },
          answerHuman: controller.answerHuman.bind(controller),
          selectModel: controller.selectModel.bind(controller),
          selectPreset: controller.selectPreset.bind(controller),
          selectPlanMode: controller.selectPlanMode.bind(controller),
          selectPermissionPreset: controller.selectPermissionPreset.bind(controller),
          refreshModelControls,
        }),
      }, ({ useConversation, useLocale, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
        selectPlanMode, selectPermissionPreset,
        refreshModelControls, t, renderSlot }: {
        useConversation: SnapshotSelectorHook<ConversationSnapshot>
        useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
        loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
        send: (text: string, files: readonly File[]) => Promise<boolean>
        cancel: () => void
        answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
        selectModel: NativeConversationController['selectModel']
        selectPreset: NativeConversationController['selectPreset']
        selectPlanMode: NativeConversationController['selectPlanMode']
        selectPermissionPreset: NativeConversationController['selectPermissionPreset']
        refreshModelControls: NativeConversationController['refreshModelControls']
        t: Translate
        renderSlot: (key: 'native.conversation.actions', owner: object) => ReactNode
      }) => <Conversation snapshot={useConversation(value => value)} useLocale={useLocale} loadImage={loadImage} send={send}
        cancel={cancel} answerHuman={answerHuman} selectModel={selectModel} selectPreset={selectPreset}
        selectPlanMode={selectPlanMode} selectPermissionPreset={selectPermissionPreset}
        refreshModelControls={refreshModelControls} t={t} renderSlot={renderSlot} />)))
      context.provide('clientApplication', { render: () => slots.renderSlot('root', {}) })
      void controller.load()
    }
  },
}
