/** Native Web conversation application; the renderer and Session transport are selected Providers. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { foldTodos } from '@deepseek-ai/dsh-tool-todo/client-native'
import { Button, SettingsPanel } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type { ChatMessageImagesProps, ChatRenderMessageImages } from '@deepseek-ai/dsh-client-ui-chat/native'
import { ConversationShellView } from '@deepseek-ai/dsh-client-ui-conversation/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeConversationController } from './controller.ts'
import type { ConversationSnapshot } from './controller.ts'
import { HumanInteraction } from './human.tsx'
import { ModelControls } from './model-controls.tsx'
import { en, zh, type ConversationLocaleKey } from './locales.ts'
import { SettingsPage, type NativeSettingsActions } from './settings-page.tsx'
import { NativeTranscript } from './native-transcript.tsx'

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
  const todos = useMemo(() => foldTodos(snapshot.events), [snapshot.events])
  const selected = snapshot.selected
  const renderMessageImages = useCallback<ChatRenderMessageImages>(({ images }: ChatMessageImagesProps) => (
    selected === undefined ? null : images.map((source, index) => 'attachment' in source
      ? <Image key={index} image={source.attachment} sessionId={selected} loadImage={loadImage} t={t} />
      : <img key={index} src={source.preview.url} alt={source.preview.name ?? t('image')}
        width={source.preview.width} height={source.preview.height} />)
  ), [loadImage, selected, t])
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<readonly File[]>([])
  const [uploadKey, setUploadKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const ready = snapshot.state === 'ready'
  const sending = snapshot.state === 'sending' || snapshot.state === 'cancelling'
  return <>
    <main style={{ margin: 'auto', maxWidth: 1000, padding: 24 }}>
      <h1>{t('title')}</h1>
      <nav aria-label={t('sessions')} style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" size="sm" onClick={() => { setSettingsSection('general'); setShowSettings(true) }}>{t('settings')}</Button>
        {renderSlot('native.conversation.actions', {})}
      </nav>
      <p role="status">{snapshot.state === 'closed' ? '' : t(snapshot.state)}</p>
      {snapshot.error === undefined ? null : <p role="alert">{t('error')}: {snapshot.error}</p>}
      {selected === undefined ? <p>{t('empty')}</p> : <ConversationShellView>
        <ModelControls snapshot={snapshot} selectModel={selectModel} selectPreset={selectPreset}
          refreshModelControls={refreshModelControls} t={t} />
        {todos === null ? null : <aside aria-label={t('todos')}>
          <h2>{t('todos')}</h2>
          <ul>{todos.map(todo => <li key={todo.content} data-todo-status={todo.status}>
            <span>{t(todo.status)}</span>: {todo.content}
          </li>)}</ul>
        </aside>}
        <NativeTranscript snapshot={snapshot} locale={activeLocale} renderMessageImages={renderMessageImages} t={t} />
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
      </ConversationShellView>}
    </main>
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
    >
      <SettingsPage actions={settingsActions} t={t} section={settingsSection}
        onAuthorized={() => { void refreshModelControls() }} />
    </SettingsPanel> : null}
  </>
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
            accountsList: client.accountsList.bind(client),
            accountsUsage: client.accountsUsage.bind(client),
            accountsBalance: client.accountsBalance.bind(client),
            accountsSignOut: client.accountsSignOut.bind(client),
            modelsListProviders: client.modelsListProviders.bind(client),
            modelsListConfigurableProviders: client.modelsListConfigurableProviders.bind(client),
            modelsDiscover: client.modelsDiscover.bind(client),
            settingsEvents: client.settingsEvents.bind(client),
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
