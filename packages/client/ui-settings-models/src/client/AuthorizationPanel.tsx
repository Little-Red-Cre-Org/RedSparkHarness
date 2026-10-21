/** Human-guided provider authorization rendered below the model directory. */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthorizationAttemptId, AuthorizationEntryView, AuthorizationFrame,
  AuthorizationPromptId, AuthorizationPromptView, ClientRemote,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthorizationRemote = ClientRemote['authorization']

interface ActivePrompt {
  readonly attemptId: AuthorizationAttemptId
  readonly promptId: AuthorizationPromptId
  readonly prompt: AuthorizationPromptView
}

/** Accept credential-free browser-navigation URLs from provider-owned notices. */
function safeNoticeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === '' && url.password === '' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Props of {@link AuthorizationPanel}. */
export interface AuthorizationPanelProps {
  /** Generated Host authorization namespace. */
  remote: AuthorizationRemote
  /** Models-page dictionary lookup. */
  t: (key: keyof typeof en) => string
  /** Enable the signed-in account's model route; rejects with a displayable failure. */
  onAuthorized: (key: AuthorizationEntryView['key'], signal?: AbortSignal) => Promise<void>
}

/** Render every provider-owned login flow without provider-specific UI knowledge. */
export function AuthorizationPanel({ remote, t, onAuthorized }: AuthorizationPanelProps): ReactNode {
  const [entries, setEntries] = useState<readonly AuthorizationEntryView[]>([])
  const [loading, setLoading] = useState(true)
  const [activeKey, setActiveKey] = useState<string>()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [loginUrl, setLoginUrl] = useState<string>()
  const [notice, setNotice] = useState<Extract<AuthorizationFrame, { type: 'notice' }>['notice']>()
  const [prompt, setPrompt] = useState<ActivePrompt>()
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string>()
  const [enabledKey, setEnabledKey] = useState<string>()
  const [enablingKey, setEnablingKey] = useState<string>()
  const controller = useRef<AbortController>()
  const currentPrompt = useRef<ActivePrompt>()
  const lifetime = useRef<AbortController>()

  const addModels = async (entry: AuthorizationEntryView, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return
    setSelectedKey(entry.key)
    setError(undefined)
    setEnabledKey(undefined)
    setEnablingKey(entry.key)
    try {
      await onAuthorized(entry.key, signal)
      if (!signal?.aborted) setEnabledKey(entry.key)
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!signal?.aborted) setEnablingKey(undefined)
    }
  }

  const load = async (restoreSignal?: AbortSignal): Promise<void> => {
    try {
      const result = await remote.list()
      if (restoreSignal?.aborted) return
      if (result.ok) {
        setEntries(result.value)
        setLoading(false)
        if (restoreSignal !== undefined) {
          for (const entry of result.value) {
            if (entry.configured) await addModels(entry, restoreSignal)
          }
        }
      }
      else setError(result.error.message)
    } catch (cause) {
      if (!restoreSignal?.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!restoreSignal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const restore = new AbortController()
    lifetime.current = restore
    void load(restore.signal)
    return () => {
      restore.abort()
      lifetime.current = undefined
      controller.current?.abort()
      controller.current = undefined
      currentPrompt.current = undefined
    }
  }, [])

  const begin = (entry: AuthorizationEntryView, method: string): void => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setActiveKey(entry.key)
    setSelectedKey(entry.key)
    setLoginUrl(undefined)
    setNotice(undefined)
    currentPrompt.current = undefined
    setPrompt(undefined)
    setAnswer('')
    setError(undefined)
    setEnabledKey(undefined)
    void (async () => {
      try {
        for await (const frame of remote.authorize(entry.key, method, next.signal)) {
          if (next.signal.aborted) break
          if (frame.type === 'notice') {
            setNotice(frame.notice)
            const url = safeNoticeUrl(frame.notice.url)
            if (url !== undefined) setLoginUrl(url)
          } else if (frame.type === 'prompt') {
            const nextPrompt = { attemptId: frame.attemptId, promptId: frame.promptId, prompt: frame.prompt }
            currentPrompt.current = nextPrompt
            setPrompt(nextPrompt)
            setAnswer('')
          } else if (frame.type === 'settled' && frame.status === 'authorized') {
            currentPrompt.current = undefined
            setPrompt(undefined)
            setLoginUrl(undefined)
            setNotice(undefined)
            await addModels(entry, next.signal)
          }
        }
      } catch (cause) {
        if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (controller.current === next) {
          controller.current = undefined
          setActiveKey(undefined)
          currentPrompt.current = undefined
          setPrompt(undefined)
          setLoginUrl(undefined)
          setNotice(undefined)
          await load()
        }
      }
    })()
  }

  const submitPrompt = (value: string): void => {
    if (prompt === undefined) return
    const pending = prompt
    const attempt = controller.current
    const isCurrent = (): boolean => controller.current === attempt
      && attempt?.signal.aborted === false && currentPrompt.current === pending
    void remote.answer(pending.attemptId, pending.promptId, value).then((result) => {
      if (!isCurrent()) return
      if (!result.ok) { setError(result.error.message); return }
      currentPrompt.current = undefined
      setPrompt(current => current === pending ? undefined : current)
    }).catch((cause: unknown) => {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const declinePrompt = (): void => {
    if (prompt === undefined) return
    const pending = prompt
    const attempt = controller.current
    const isCurrent = (): boolean => controller.current === attempt
      && attempt?.signal.aborted === false && currentPrompt.current === pending
    void remote.decline(pending.attemptId, pending.promptId).then((result) => {
      if (!isCurrent()) return
      if (!result.ok) { setError(result.error.message); return }
      currentPrompt.current = undefined
      setPrompt(current => current === pending ? undefined : current)
    }).catch((cause: unknown) => {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  if (loading) return null
  if (entries.length === 0) return error === undefined ? null : <p className={styles['error']} role="alert">{error}</p>
  return (
    <section className={styles['authorization']} aria-labelledby="models-authorization-title">
      <div>
        <h3 id="models-authorization-title" className={styles['authorizationTitle']}>{t('authorizationTitle')}</h3>
        <p className={styles['authorizationIntro']}>{t('authorizationIntro')}</p>
      </div>
      {selectedKey === undefined && error !== undefined ? <p className={styles['error']} role="alert">{error}</p> : null}
      {entries.map(entry => (
        <div key={entry.key} role="group" aria-label={entry.label}>
          <div className={styles['authorizationRow']}>
            <span className={styles['authorizationIdentity']}>
              <span className={styles['rowName']}>{entry.label}</span>
              <span className={styles['authorizationStatus']}>
                {enabledKey === entry.key ? t('authorizationAdded')
                  : entry.configured ? t('authorizationConnected') : t('authorizationNotConnected')}
              </span>
            </span>
            <span className={styles['rowActions']}>
              {entry.configured && selectedKey === entry.key && error !== undefined
                ? <button type="button" className={styles['secondaryButton']}
                  disabled={activeKey !== undefined || enablingKey !== undefined || entry.inFlight}
                  onClick={() => { void addModels(entry, lifetime.current?.signal) }}>{t('authorizationRetryModels')}</button> : null}
              {entry.methods.map(method => (
                <button key={method.id} type="button" className={styles['secondaryButton']}
                  disabled={activeKey !== undefined || enablingKey !== undefined || entry.inFlight}
                  onClick={() => { begin(entry, method.id) }}>
                  {entry.configured ? t('authorizationReconnect') : t('authorizationLoginAdd')}
                  {entry.methods.length > 1 ? ` (${method.label})` : null}
                </button>
              ))}
              {activeKey === entry.key && enablingKey === undefined
                ? <button type="button" className={styles['secondaryButton']}
                  onClick={() => { controller.current?.abort() }}>{t('cancel')}</button>
                : null}
            </span>
          </div>
          {selectedKey === entry.key ? <>
            {enabledKey === entry.key ? <p role="status">{t('authorizationModelsReady')}</p> : null}
            {enablingKey === entry.key ? <p role="status">{t('authorizationAdding')}</p> : null}
            {activeKey === entry.key && enablingKey === undefined && enabledKey !== entry.key
              && notice === undefined && prompt === undefined && error === undefined
              ? <p role="status">{t('authorizationStarting')}</p> : null}
            {notice === undefined ? null : (
              <div className={styles['authorizationMessage']} role="status">
                <span>{notice.message}</span>
                {notice.code === undefined ? null : <code className={styles['authorizationCode']}>{notice.code}</code>}
                {loginUrl === undefined ? null : <a href={loginUrl} target="_blank" rel="noreferrer">{t('authorizationOpenPage')}</a>}
              </div>
            )}
            {prompt === undefined ? null : (
              <div className={styles['authorizationPrompt']}>
                <label className={styles['field']}>
                  <span className={styles['fieldLabel']}>{prompt.prompt.message}</span>
                  {prompt.prompt.kind === 'select' ? (
                    <select className={`${styles['input']} ${styles['selectInput']}`} value={answer}
                      onChange={(event) => { setAnswer(event.target.value) }}>
                      <option value="">{t('authorizationChoose')}</option>
                      {prompt.prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input className={styles['input']} type={prompt.prompt.kind === 'secret' ? 'password' : 'text'}
                      value={answer} placeholder={prompt.prompt.placeholder} onChange={(event) => { setAnswer(event.target.value) }} />
                  )}
                </label>
                <span className={styles['editorActions']}>
                  <button type="button" className={styles['secondaryButton']} onClick={declinePrompt}>{t('cancel')}</button>
                  <button type="button" className={styles['primaryButton']} disabled={answer.length === 0}
                    onClick={() => { submitPrompt(answer) }}>{t('authorizationContinue')}</button>
                </span>
              </div>
            )}
            {error === undefined ? null : <p className={styles['error']} role="alert">{error}</p>}
          </> : null}
        </div>
      ))}
    </section>
  )
}
