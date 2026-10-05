/** Native Web conversation application; the renderer and Session transport are selected Providers. */
import { useState, useSyncExternalStore } from 'react'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-native-session/native'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { NativeConversationController } from './controller.ts'
import { HumanInteraction } from './human.tsx'
import { ModelControls } from './model-controls.tsx'
import { en, zh, type ConversationLocaleKey } from './locales.ts'

type Translate = (key: ConversationLocaleKey) => string

function Message({ event, t }: { event: SessionEvent; t: Translate }) {
  const message = isAppendSurfaceEvent(event) ? deriveEventMessage(event) : null
  if (message === null || message.role === 'system') return null
  const role = message.role === 'assistant' ? 'assistant' : event.type === 'tool/result' ? 'tool' : 'user'
  return <article data-event-seq={event.seq}>
    <strong>{t(role)}</strong>
    {message.content.map((block, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {block.type === 'text' ? block.text : JSON.stringify(block, null, 2)}
    </pre>)}
  </article>
}

function Conversation({ controller, t }: { controller: NativeConversationController; t: Translate }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [draft, setDraft] = useState('')
  const ready = snapshot.state === 'ready'
  const sending = snapshot.state === 'sending' || snapshot.state === 'cancelling'
  return <main style={{ margin: 'auto', maxWidth: 1000, padding: 24 }}>
    <h1>{t('title')}</h1>
    <nav aria-label={t('sessions')}>
      <button disabled={!ready} onClick={() => { void controller.create() }}>{t('create')}</button>
      <select aria-label={t('sessions')} value={snapshot.selected ?? ''} disabled={!ready}
        onChange={(event) => {
          const header = snapshot.sessions.find(item => item.id === event.target.value)
          if (header !== undefined) void controller.select(header.id)
        }}>
        <option value="" disabled>{t('choose')}</option>
        {snapshot.sessions.map(header => <option key={header.id} value={header.id}>{header.id}</option>)}
      </select>
    </nav>
    <p role="status">{snapshot.state === 'closed' ? '' : t(snapshot.state)}</p>
    {snapshot.error === undefined ? null : <p role="alert">{t('error')}: {snapshot.error}</p>}
    {snapshot.selected === undefined ? <p>{t('empty')}</p> : <>
      <ModelControls controller={controller} t={t} />
      <section aria-label={t('facts')}>
        {snapshot.events.map(event => <Message key={event.seq} event={event} t={t} />)}
      </section>
      <details><summary>{t('facts')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(snapshot.events, null, 2)}</pre>
      </details>
      {snapshot.liveText === undefined ? null : <article aria-label={t('live')}><strong>{t('assistant')}</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{snapshot.liveText}</pre>
        {snapshot.liveTruncated === true ? <p>{t('truncated')}</p> : null}
      </article>}
      {snapshot.human === undefined ? null : <HumanInteraction key={snapshot.human.id} controller={controller} prompt={snapshot.human}
        disabled={snapshot.answeringHuman === true || snapshot.state !== 'sending'} t={t} />}
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!ready || draft.trim().length === 0) return
        void controller.send(draft).then(() => {
          if (controller.getSnapshot().error === undefined) setDraft('')
        })
      }}>
        <label>{t('prompt')}<textarea aria-label={t('prompt')} value={draft} disabled={!ready}
          onChange={(event) => { setDraft(event.target.value) }} rows={4} style={{ display: 'block', width: '100%' }} /></label>
        <button type="submit" disabled={!ready || draft.trim().length === 0}>{t('send')}</button>
        <button type="button" disabled={!sending || snapshot.state === 'cancelling'} onClick={() => { controller.cancel() }}>{t('cancel')}</button>
      </form>
      <p>{t('settled')}</p>
    </>}
  </main>
}

/** Minimal native application selected by the explicit native-web profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-application', targets: ['client'],
  requires: ['clientNativeSession'], provides: ['clientApplication'],
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
      const selected = locale ?? (globalThis.navigator.languages.some(language => language.toLowerCase().startsWith('zh')) ? 'zh' : 'en')
      const dictionary = selected === 'zh' ? zh : en
      const t: Translate = key => dictionary[key]
      const controller = new NativeConversationController(context.require('clientNativeSession'), { maxLiveTextChars, maxLiveEvents })
      context.own(() => controller.close())
      context.provide('clientApplication', { render: () => <Conversation controller={controller} t={t} /> })
      void controller.load()
    }
  },
}
