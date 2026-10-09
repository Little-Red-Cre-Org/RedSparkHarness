/** Native Web conversation application; the renderer and Session transport are selected Providers. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { foldTodos } from '@deepseek-ai/dsh-tool-todo/client-native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from './controller.ts'
import type { ConversationSnapshot } from './controller.ts'
import { HumanInteraction } from './human.tsx'
import { ToolCard, toolCardRecords } from './tool-cards.tsx'
import { ModelControls } from './model-controls.tsx'
import { en, zh, type ConversationLocaleKey } from './locales.ts'
import { SettingsPage, type NativeSettingsActions } from './settings-page.tsx'

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

function Image({ image, sessionId, loadImage, t }: {
  image: NativeSessionImage
  sessionId: SessionId
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  t: Translate
}) {
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const lifetime = new AbortController()
    let url: string | undefined
    setSrc(undefined)
    setError(undefined)
    void loadImage(sessionId, image, lifetime.signal).then((blob) => {
      if (lifetime.signal.aborted) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }, (error: unknown) => {
      if (!lifetime.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    })
    return () => { lifetime.abort(); if (url !== undefined) URL.revokeObjectURL(url) }
  }, [loadImage, sessionId, image])
  return <figure>{src === undefined ? null : <img src={src} alt={image.name ?? t('image')} width={image.width} height={image.height}
    style={{ maxWidth: '100%', height: 'auto' }} />}
  <figcaption>{image.name ?? t('image')}</figcaption>
  {error === undefined ? null : <p role="alert">{t('error')}: {error}</p>}
  </figure>
}

function Message({ event, t, sessionId, loadImage }: {
  event: SessionEvent
  t: Translate
  sessionId: SessionId
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
}) {
  const message = isAppendSurfaceEvent(event) ? deriveEventMessage(event) : null
  if (message === null || message.role === 'system' || event.type === 'tool/result') return null
  const content = message.content.filter(block => block.type !== 'tool-call')
  if (content.length === 0) return null
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  return <article data-event-seq={event.seq}>
    <strong>{t(role)}</strong>
    {content.map((block, index) => block.type === 'image'
      ? <Image key={index} image={block.attachment} sessionId={sessionId} loadImage={loadImage} t={t} />
      : <pre key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {block.type === 'text' ? block.text : JSON.stringify(block, null, 2)}
      </pre>)}
  </article>
}

function Conversation({ snapshot, useLocale, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
  refreshModelControls, settingsActions, t, renderSlot }: {
  snapshot: ConversationSnapshot
  useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  send: (text: string, files: readonly File[]) => Promise<boolean>
  cancel: () => void
  answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
  selectModel: NativeConversationController['selectModel']
  selectPreset: NativeConversationController['selectPreset']
  refreshModelControls: NativeConversationController['refreshModelControls']
  settingsActions: NativeSettingsActions
  t: Translate
  renderSlot: (key: 'native.conversation.actions', owner: object) => ReactNode
}) {
  const activeLocale = useLocale(value => value.locale)
  const toolCards = useMemo(() => new Map(toolCardRecords(snapshot.events).map(record => [record.seq, record.block])), [snapshot.events])
  const todos = useMemo(() => foldTodos(snapshot.events), [snapshot.events])
  const selected = snapshot.selected
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<readonly File[]>([])
  const [uploadKey, setUploadKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const ready = snapshot.state === 'ready'
  const sending = snapshot.state === 'sending' || snapshot.state === 'cancelling'
  if (showSettings) return <SettingsPage actions={settingsActions} t={t} onBack={() => { setShowSettings(false) }}
    onAuthorized={() => { void refreshModelControls() }} />
  return <main style={{ margin: 'auto', maxWidth: 1000, padding: 24 }}>
    <h1>{t('title')}</h1>
    <nav aria-label={t('sessions')}>
      <button type="button" onClick={() => { setShowSettings(true) }}>{t('settings')}</button>
      {renderSlot('native.conversation.actions', {})}
    </nav>
    <p role="status">{snapshot.state === 'closed' ? '' : t(snapshot.state)}</p>
    {snapshot.error === undefined ? null : <p role="alert">{t('error')}: {snapshot.error}</p>}
    {selected === undefined ? <p>{t('empty')}</p> : <>
      <ModelControls snapshot={snapshot} selectModel={selectModel} selectPreset={selectPreset}
        refreshModelControls={refreshModelControls} t={t} />
      {todos === null ? null : <aside aria-label={t('todos')}>
        <h2>{t('todos')}</h2>
        <ul>{todos.map(todo => <li key={todo.content} data-todo-status={todo.status}>
          <span>{t(todo.status)}</span>: {todo.content}
        </li>)}</ul>
      </aside>}
      <section aria-label={t('facts')}>
        {snapshot.events.map((event) => {
          const card = toolCards.get(event.seq)
          return card === undefined
            ? <Message key={event.seq} event={event} t={t} sessionId={selected} loadImage={loadImage} />
            : <ToolCard key={event.seq} block={card} locale={activeLocale} cwd={snapshot.header?.cwd} />
        })}
      </section>
      <details><summary>{t('facts')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(snapshot.events, null, 2)}</pre>
      </details>
      {snapshot.liveText === undefined ? null : <article aria-label={t('live')}><strong>{t('assistant')}</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{snapshot.liveText}</pre>
        {snapshot.liveTruncated === true ? <p>{t('truncated')}</p> : null}
      </article>}
      {snapshot.human === undefined ? null : <HumanInteraction key={snapshot.human.id} answerHuman={answerHuman} prompt={snapshot.human}
        disabled={snapshot.answeringHuman === true || snapshot.state !== 'sending'} t={t} />}
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!ready || draft.trim().length === 0) return
        void send(draft, files).then((success) => {
          if (success) { setDraft(''); setFiles([]); setUploadKey(key => key + 1) }
        })
      }}>
        <label>{t('prompt')}<textarea aria-label={t('prompt')} value={draft} disabled={!ready}
          onChange={(event) => { setDraft(event.target.value) }} rows={4} style={{ display: 'block', width: '100%' }} /></label>
        {snapshot.modelControls?.images === undefined ? null : <label>{t('images')}
          <input key={uploadKey} type="file" multiple accept={snapshot.modelControls.images.mediaTypes.join(',')} aria-label={t('images')}
            disabled={!ready} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])) }} />
        </label>}
        <button type="submit" disabled={!ready || draft.trim().length === 0}>{t('send')}</button>
        <button type="button" disabled={!sending || snapshot.state === 'cancelling'} onClick={cancel}>{t('cancel')}</button>
      </form>
      <p>{t('settled')}</p>
    </>}
  </main>
}

/** Minimal native application selected by the explicit native-web profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-application', targets: ['client'],
  requires: ['clientNativeSession', 'clientSlots', 'clientLocale'], provides: ['clientApplication', 'clientNativeConversation'],
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
      context.own(clientLocale.register('nativeApplication', { en, zh }))
      if (locale !== undefined) clientLocale.setLocale(locale)
      const controller = new NativeConversationController(client, { maxLiveTextChars, maxLiveEvents })
      context.provide('clientNativeConversation', controller)
      context.own(() => controller.close())
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
          refreshModelControls: controller.refreshModelControls.bind(controller),
          settingsActions: {
            settingsDescribe: client.settingsDescribe.bind(client), settingsMutate: client.settingsMutate.bind(client),
            credentialsDescribe: client.credentialsDescribe.bind(client), credentialsSet: client.credentialsSet.bind(client),
            credentialsUnset: client.credentialsUnset.bind(client),
            authorizationList: client.authorizationList.bind(client),
            authorizationBegin: client.authorizationBegin.bind(client),
            authorizationFrames: client.authorizationFrames.bind(client),
            authorizationAnswer: client.authorizationAnswer.bind(client),
            authorizationDecline: client.authorizationDecline.bind(client),
            authorizationCancel: client.authorizationCancel.bind(client),
          },
        }),
      }, ({ useConversation, useLocale, loadImage, send, cancel, answerHuman, selectModel, selectPreset,
        refreshModelControls, settingsActions, t, renderSlot }: {
        useConversation: SnapshotSelectorHook<ConversationSnapshot>
        useLocale: SnapshotSelectorHook<NativeLocaleSnapshot>
        loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
        send: (text: string, files: readonly File[]) => Promise<boolean>
        cancel: () => void
        answerHuman: (prompt: NonNullable<ConversationSnapshot['human']>, answer: Parameters<NativeConversationController['answerHuman']>[1]) => Promise<void>
        selectModel: NativeConversationController['selectModel']
        selectPreset: NativeConversationController['selectPreset']
        refreshModelControls: NativeConversationController['refreshModelControls']
        settingsActions: NativeSettingsActions
        t: Translate
        renderSlot: (key: 'native.conversation.actions', owner: object) => ReactNode
      }) => <Conversation snapshot={useConversation(value => value)} useLocale={useLocale} loadImage={loadImage} send={send}
        cancel={cancel} answerHuman={answerHuman} selectModel={selectModel} selectPreset={selectPreset}
        refreshModelControls={refreshModelControls} settingsActions={settingsActions} t={t} renderSlot={renderSlot} />)))
      context.provide('clientApplication', { render: () => slots.renderSlot('root', {}) })
      void controller.load()
    }
  },
}
