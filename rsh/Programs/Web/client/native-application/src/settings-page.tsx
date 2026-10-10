/** Generic native Settings and write-only credential controls for registered schemas. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeAccountSummary } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeAuthorizationEntry } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { AuthorizationFrame, AuthorizationSettlement } from '@deepseek-ai/dsh-authorization/types'
import type { ConversationLocaleKey } from './locales.ts'
import { AccountCard } from './account-card.tsx'

type Translate = (key: ConversationLocaleKey) => string
type JsonObject = Record<string, unknown>
type SettingsPathOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }
/** Settings, credential, authorization and account operations selected from the Native Session client. */
export type NativeSettingsActions = Pick<NativeSessionClient,
  'settingsDescribe' | 'credentialsDescribe' | 'settingsMutate' | 'credentialsSet' | 'credentialsUnset'
  | 'authorizationList' | 'authorizationBegin' | 'authorizationFrames' | 'authorizationAnswer' | 'authorizationDecline' | 'authorizationCancel'
  | 'accountsList' | 'accountsUsage' | 'accountsSignOut'>

class UnsupportedSettingsEdit extends TypeError {
  constructor(readonly messageKey: 'settingsArrayStructureUnsupported' | 'settingsSecretStructureUnsupported' | 'settingsOperationLimitExceeded', message: string) {
    super(message)
  }
}

function requestError(error: unknown, t: Translate, code: 'native/settings' | 'native/credentials'): string {
  if (error instanceof NativeSessionRpcError && error.code === code) {
    return t(code === 'native/settings' ? 'error' : 'credentialError')
  }
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function secretAtOrBelow(path: readonly string[], secrets: readonly (readonly string[])[]): boolean {
  return secrets.some(secret => path.every((part, index) => secret[index] === part))
}

/** Build minimal path edits from the displayed redacted layer.
 * Non-secret objects use the path where their value changes; secret-bearing ancestors keep visible edits at their leaves.
 * @param before - user layer currently projected by the Host.
 * @param after - parsed user-layer draft.
 * @param secretPaths - schema-declared secret locations never returned by the Host.
 * @returns path operations for changes the Host can apply without replacing a hidden secret.
 * @throws {TypeError} when arrays resize or move, or a hidden secret makes a structural edit unsafe.
 */
export function nativeSettingsDiff(
  before: JsonObject,
  after: JsonObject,
  secretPaths: readonly (readonly string[])[],
): SettingsPathOp[] {
  const operations: SettingsPathOp[] = []
  const visit = (previous: unknown, next: unknown, path: string[]): void => {
    if (JSON.stringify(previous) === JSON.stringify(next)) return
    if (Array.isArray(previous) || Array.isArray(next)) {
      if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
        throw new UnsupportedSettingsEdit('settingsArrayStructureUnsupported', 'Settings arrays must keep their existing row count and order.')
      }
      const moved = next.some((entry, index) => {
        const matches = previous.flatMap((old, oldIndex) => JSON.stringify(old) === JSON.stringify(entry) ? [oldIndex] : [])
        return matches.length === 1 && matches[0] !== index
      })
      if (moved) throw new UnsupportedSettingsEdit('settingsArrayStructureUnsupported', 'Settings arrays must keep their existing row count and order.')
      for (let index = 0; index < next.length; index += 1) visit(previous[index], next[index], [...path, String(index)])
      return
    }
    if (isObject(previous) && isObject(next)) {
      for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        visit(previous[key], next[key], [...path, key])
      }
      return
    }
    if ((previous === undefined && isObject(next) || next === undefined && isObject(previous))
      && secretAtOrBelow(path, secretPaths)) {
      throw new UnsupportedSettingsEdit('settingsSecretStructureUnsupported',
        'Settings objects containing hidden secret fields cannot be added or removed as a whole.')
    }
    if (path.length > 0 && !secretAtOrBelow(path, secretPaths)) {
      if (next === undefined) operations.push({ op: 'unset', path })
      else operations.push({ op: 'set', path, value: next })
      return
    }
    if (isObject(previous) || isObject(next)) {
      if (previous !== undefined && next !== undefined) {
        throw new UnsupportedSettingsEdit('settingsSecretStructureUnsupported',
          'Settings objects containing hidden secret fields cannot be replaced as a whole.')
      }
      const left = isObject(previous) ? previous : {}
      const right = isObject(next) ? next : {}
      const start = operations.length
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        visit(left[key], right[key], [...path, key])
      }
      if (operations.length === start) {
        throw new UnsupportedSettingsEdit('settingsSecretStructureUnsupported',
          'Settings objects containing hidden secret fields cannot be added or removed as a whole.')
      }
      return
    }
    if (path.length === 0 || secretAtOrBelow(path, secretPaths)) {
      throw new UnsupportedSettingsEdit('settingsSecretStructureUnsupported',
        'Settings secret fields cannot be edited in the JSON editor.')
    }
    if (next === undefined) operations.push({ op: 'unset', path })
    else operations.push({ op: 'set', path, value: next })
  }
  visit(before, after, [])
  return operations
}

function AuthorizationRow({ entry, actions, t, onSettled, refreshClick }: {
  entry: NativeAuthorizationEntry
  actions: NativeSettingsActions
  t: Translate
  onSettled: () => Promise<boolean>
  refreshClick: number
}) {
  const [attemptId, setAttemptId] = useState(entry.attemptId)
  const [frames, setFrames] = useState<AuthorizationFrame[]>([])
  const [method, setMethod] = useState(entry.methods[0]?.id)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const [lost, setLost] = useState(false)
  const [stopped, setStopped] = useState<string>()
  const retried = useRef<string>()
  // Parent callbacks may change identity on every render; only a new attempt resubscribes.
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const attemptRef = useRef(attemptId)
  attemptRef.current = attemptId
  const listedAttempt = useRef(entry.attemptId)

  // Undefined means not subscribed; refresh may resubscribe once per attempt.
  // Clearing `stopped` must not replace a Sign in attempt the list does not list yet.
  useEffect(() => {
    const listed = entry.attemptId
    const listedChanged = listed !== listedAttempt.current
    listedAttempt.current = listed
    if (listed === undefined || listed === stopped) return
    if (!listedChanged && attemptRef.current !== undefined && attemptRef.current !== listed) return
    setAttemptId(listed)
  }, [entry, stopped])

  // Only the Settings button increments this; a settled refresh must not clear the cap.
  useEffect(() => {
    setStopped(undefined)
  }, [refreshClick])

  useEffect(() => {
    if (attemptId === undefined) return
    const controller = new AbortController()
    let settlement: AuthorizationSettlement | undefined
    // The attempt may settle before this subscription; the refreshed record then decides what to show.
    const lose = async (): Promise<void> => {
      setAttemptId(undefined)
      setAnswers({})
      if (retried.current === attemptId) {
        setLost(false)
        setStopped(attemptId)
        return
      }
      retried.current = attemptId
      await settledRef.current()
      setLost(true)
    }
    setFrames([])
    setAnswers({})
    setStopped(undefined)
    void (async () => {
      try {
        for await (const frame of actions.authorizationFrames(entry.key, attemptId, controller.signal)) {
          setLost(false)
          setFrames(current => [...current, frame])
          if (frame.type === 'prompt-closed') {
            setAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== frame.promptId)))
          }
          if (frame.type === 'settled') {
            settlement = frame.settlement
            void settledRef.current()
          }
        }
        if (settlement !== undefined) setAttemptId(undefined)
        else if (!controller.signal.aborted) await lose()
      } catch {
        if (!controller.signal.aborted) await lose()
      }
    })()
    return () => { controller.abort() }
  }, [actions, attemptId, entry.key])

  const answer = async (id: string, promptId: string, value: string): Promise<void> => {
    setError(undefined)
    try {
      await actions.authorizationAnswer(entry.key, id, promptId, value)
      setAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== promptId)))
    }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const decline = async (id: string, promptId: string): Promise<void> => {
    setError(undefined)
    try {
      await actions.authorizationDecline(entry.key, id, promptId)
      setAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== promptId)))
    }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const cancel = async (id: string): Promise<void> => {
    setError(undefined)
    try {
      await actions.authorizationCancel(entry.key, id)
      if (attemptRef.current === id) setAnswers({})
    }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const begin = async (): Promise<void> => {
    setError(undefined)
    setLost(false)
    setStopped(undefined)
    try {
      const attempt = await actions.authorizationBegin(entry.key, method)
      setAttemptId(attempt.attemptId)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const settled = [...frames].reverse().find(frame => frame.type === 'settled')
  return <div>
    <p>{entry.label} · {entry.configured ? t('configured') : t('notConfigured')}</p>
    {attemptId === undefined ? <div>
      {entry.methods.length > 1 ? <label>{t('signInMethod')}
        <select aria-label={t('signInMethod')} value={method} onChange={(event) => { setMethod(event.target.value) }}>
          {entry.methods.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label> : null}
      <button type="button" onClick={() => { void begin() }}>{t('signIn')}</button>
    </div> : <>
      <button type="button" onClick={() => { void cancel(attemptId) }}>{t('cancelSignIn')}</button>
      {frames.map((frame, index) => {
        if (frame.type !== 'prompt' || frames.slice(index + 1).some(later => later.type === 'prompt-closed' && later.promptId === frame.promptId)) return null
        const value = answers[frame.promptId] ?? (frame.prompt.kind === 'select' ? frame.prompt.options[0]?.id ?? '' : '')
        return <form key={frame.promptId} onSubmit={(event) => {
          event.preventDefault()
          void answer(attemptId, frame.promptId, value)
        }}>
          <label>{frame.prompt.message}{frame.prompt.kind === 'select'
            ? <select aria-label={frame.prompt.message} value={value} onChange={(event) => {
              setAnswers(current => ({ ...current, [frame.promptId]: event.target.value }))
            }}>
              {frame.prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            : <input type={frame.prompt.kind === 'secret' ? 'password' : 'text'} autoComplete={frame.prompt.kind === 'secret' ? 'off' : undefined}
              placeholder={frame.prompt.placeholder} aria-label={frame.prompt.message} value={value} onChange={(event) => {
                setAnswers(current => ({ ...current, [frame.promptId]: event.target.value }))
              }} />}
          </label>
          <button type="submit">{t('authorizationAnswer')}</button>
          <button type="button" onClick={() => { void decline(attemptId, frame.promptId) }}>{t('decline')}</button>
        </form>
      })}
    </>}
    {frames.map((frame, index) => frame.type === 'notice' ? <p key={index}>
      {frame.notice.message}{frame.notice.url === undefined ? null : <> <a href={frame.notice.url} target="_blank" rel="noreferrer">{frame.notice.url}</a></>}
      {frame.notice.code === undefined ? null : <> <code>{frame.notice.code}</code></>}
    </p> : null)}
    {settled?.type !== 'settled' ? null : <p role="status">{t(settled.settlement === 'authorized' ? 'authorizationAuthorized'
      : settled.settlement === 'cancelled' ? 'authorizationCancelled' : 'authorizationFailed')}
    {settled.settlement === 'failed' && settled.message !== undefined ? <> {settled.message}</> : null}
    {settled.settlement === 'failed' && settled.code !== undefined ? <> <code>{settled.code}</code></> : null}
    </p>}
    {lost && attemptId === undefined && !entry.configured ? <p role="alert">{t('signInIncomplete')}</p> : null}
    {stopped !== undefined && stopped === entry.attemptId ? <p role="alert">{t('authorizationDisconnected')}</p> : null}
    {error === undefined ? null : <p role="alert">{t('authorizationError')}: {error}</p>}
  </div>
}

function userSection(value: unknown): JsonObject {
  if (!isObject(value)) throw new TypeError('Settings user layer must be an object')
  return value
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

/** Registered schema-backed Settings with revision-safe JSON edits and schema-discovered credential refs.
 * @param props - selected native client, localized copy, the route back to the Session page, and an optional authorized callback.
 * @returns the native Settings and write-only credential page.
 */
export function SettingsPage({ actions, t, onBack, onAuthorized }: {
  actions: NativeSettingsActions
  t: Translate
  onBack: () => void
  onAuthorized?: () => void
}) {
  const [namespaces, setNamespaces] = useState<readonly NativeSettingsDescriptor[]>([])
  const [limits, setLimits] = useState<{ maxCredentialRefsPerRead: number; maxSettingsOperations: number }>()
  const [credentials, setCredentials] = useState<Readonly<Record<string, { configured: boolean; source?: string; writable: boolean }>>>({})
  const [authorizationEntries, setAuthorizationEntries] = useState<readonly NativeAuthorizationEntry[]>([])
  const [accounts, setAccounts] = useState<readonly NativeAccountSummary[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string>()
  const [error, setError] = useState<string>()
  const [credentialError, setCredentialError] = useState<string>()
  const [authorizationError, setAuthorizationError] = useState<string>()
  const [accountsError, setAccountsError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [refreshClick, setRefreshClick] = useState(0)
  const [accountRefreshClick, setAccountRefreshClick] = useState(0)
  // Older refreshes cannot replace a newer refresh's results.
  // A superseded refresh(false) still resets drafts on the refresh that lands.
  const refreshes = useRef(0)
  const accountRefreshes = useRef(0)
  const resetDrafts = useRef(false)

  const refreshAccounts = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const request = ++accountRefreshes.current
    const latest = () => request === accountRefreshes.current
    setAccountsError(undefined)
    try {
      const summaries = await actions.accountsList(signal)
      if (latest() && !signal?.aborted) setAccounts(summaries)
    } catch (cause: unknown) {
      if (latest() && !signal?.aborted) setAccountsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (latest() && !signal?.aborted) setAccountRefreshClick(count => count + 1)
    }
  }, [actions])

  const refresh = useCallback(async (keepDrafts: boolean, signal?: AbortSignal): Promise<boolean> => {
    const request = ++refreshes.current
    if (!keepDrafts) resetDrafts.current = true
    const latest = () => request === refreshes.current
    setLoading(true)
    setError(undefined)
    setCredentialError(undefined)
    setAuthorizationError(undefined)
    try {
      const entries = await actions.authorizationList(signal)
      if (latest()) setAuthorizationEntries(entries)
    } catch (cause: unknown) {
      if (latest()) {
        setAuthorizationEntries([])
        setAuthorizationError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    await refreshAccounts(signal)
    try {
      const description = await actions.settingsDescribe(signal)
      const rows = description.namespaces
      if (latest()) {
        const reset = resetDrafts.current
        if (reset) resetDrafts.current = false
        setLimits(description.limits)
        setNamespaces(rows)
        if (reset) setDrafts(Object.fromEntries(rows.map(row => [row.namespace, pretty(row.user)])))
      }
      const refs = [...new Set(rows.flatMap(row => row.credentialRefs))]
      if (refs.length === 0) {
        if (latest()) setCredentials({})
      } else {
        try {
          const aggregate: Record<string, { configured: boolean; source?: string; writable: boolean }> = {}
          for (let offset = 0; offset < refs.length; offset += description.limits.maxCredentialRefsPerRead) {
            Object.assign(aggregate, await actions.credentialsDescribe(
              refs.slice(offset, offset + description.limits.maxCredentialRefsPerRead), signal,
            ))
          }
          if (latest()) setCredentials(aggregate)
        }
        catch (cause: unknown) {
          if (latest()) { setCredentialError(requestError(cause, t, 'native/credentials')); setCredentials({}) }
        }
      }
      return true
    } catch (cause: unknown) {
      if (latest()) {
        resetDrafts.current = false
        setError(requestError(cause, t, 'native/settings'))
      }
      return false
    } finally { if (latest()) setLoading(false) }
  }, [actions, refreshAccounts, t])

  // Any terminal outcome (including failed/cancelled/lost) may follow a committed credential: refresh accounts, then models.
  const authorizationSettled = useCallback(async (): Promise<boolean> => {
    const refreshed = await refresh(true)
    try { onAuthorized?.() } catch { /* model controls refresh only when the conversation is ready */ }
    return refreshed
  }, [onAuthorized, refresh])

  const signOutAccount = useCallback(async (key: string): Promise<void> => {
    await actions.accountsSignOut(key)
    await refresh(true)
  }, [actions, refresh])

  useEffect(() => {
    const lifetime = new AbortController()
    void refresh(false, lifetime.signal)
    return () => { lifetime.abort() }
  }, [refresh])

  const save = async (row: NativeSettingsDescriptor): Promise<void> => {
    setSaving(row.namespace)
    setError(undefined)
    setNotice(undefined)
    try {
      const after = userSection(JSON.parse(drafts[row.namespace] ?? '{}') as unknown)
      const ops = nativeSettingsDiff(userSection(row.user), after, row.secrets.map(secret => secret.path))
      if (limits === undefined || ops.length > limits.maxSettingsOperations) {
        throw new UnsupportedSettingsEdit('settingsOperationLimitExceeded', 'Settings edit exceeds the Host operation limit.')
      }
      if (ops.length > 0) await actions.settingsMutate(row.namespace, ops, row.revision)
      if (await refresh(false)) setNotice(t('settingsSaved'))
    } catch (cause: unknown) {
      if (cause instanceof UnsupportedSettingsEdit) {
        setError(t(cause.messageKey))
        return
      }
      await refresh(true)
      if (cause instanceof NativeSessionRpcError && cause.code === 'native/settings-conflict') setNotice(t('settingsConflict'))
      else setError(requestError(cause, t, 'native/settings'))
    } finally { setSaving(undefined) }
  }

  const writeCredential = async (ref: string, value: string): Promise<void> => {
    setSaving(ref)
    setCredentialError(undefined)
    setNotice(undefined)
    try {
      await actions.credentialsSet(ref, value)
      setCredentialDrafts(current => ({ ...current, [ref]: '' }))
      await refresh(true)
      setNotice(t('credentialSaved'))
    } catch (cause: unknown) {
      await refresh(true)
      setCredentialError(requestError(cause, t, 'native/credentials'))
    } finally { setSaving(undefined) }
  }

  const removeCredential = async (ref: string): Promise<void> => {
    setSaving(ref)
    setCredentialError(undefined)
    setNotice(undefined)
    try {
      await actions.credentialsUnset(ref)
      await refresh(true)
      setNotice(t('credentialRemoved'))
    } catch (cause: unknown) {
      await refresh(true)
      setCredentialError(requestError(cause, t, 'native/credentials'))
    } finally { setSaving(undefined) }
  }

  return <main style={{ margin: 'auto', maxWidth: 1000, padding: 24 }}>
    <button type="button" onClick={onBack}>{t('backToSessions')}</button>
    <h1>{t('settings')}</h1>
    <button type="button" disabled={loading} onClick={() => { setRefreshClick(count => count + 1); void authorizationSettled() }}>{t('refreshSettings')}</button>
    {loading ? <p role="status">{t('loadingSettings')}</p> : null}
    {error === undefined ? null : <p role="alert">{t('error')}: {error}</p>}
    {credentialError === undefined ? null : <p role="alert">{t('credentialError')}: {credentialError}</p>}
    {notice === undefined ? null : <p role="status">{notice}</p>}
    {!loading && error === undefined && namespaces.length === 0 ? <p>{t('noSettings')}</p> : null}
    {namespaces.map(row => <section key={row.namespace} aria-label={row.namespace}>
      <h2>{row.namespace}</h2>
      <p>{t(row.applies === 'live' ? 'appliesLive' : 'appliesRestart')} · {t('revision')}: {row.revision}</p>
      <details><summary>{t('settingsSchema')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.schema, null, 2)}</pre>
      </details>
      <label>{t('userOverrides')}
        <textarea aria-label={`${t('userOverrides')} ${row.namespace}`} rows={14} spellCheck={false}
          value={drafts[row.namespace] ?? pretty(row.user)} disabled={loading || saving === row.namespace}
          onChange={(event) => { setDrafts(current => ({ ...current, [row.namespace]: event.target.value })) }}
          style={{ display: 'block', width: '100%', fontFamily: 'monospace' }} />
      </label>
      <button type="button" disabled={saving !== undefined || loading}
        onClick={() => { void save(row) }}>{saving === row.namespace ? t('savingSettings') : t('saveSettings')}</button>
      {row.credentialRefs.length === 0 ? null : <div>
        <h3>{t('credentials')}</h3>
        {row.credentialRefs.map((ref) => {
          const info = credentials[ref]
          return <form key={ref} aria-label={`${t('credential')} ${ref}`} onSubmit={(event) => {
            event.preventDefault()
            const value = credentialDrafts[ref] ?? ''
            if (value.length > 0) void writeCredential(ref, value)
          }}>
            <p><code>{ref}</code> · {info?.configured === true ? t('configured') : t('notConfigured')}
              {info?.source === undefined ? null : ` · ${info.source}`}</p>
            <label>{t('credentialValue')}
              <input type="password" autoComplete="new-password" aria-label={`${t('credentialValue')} ${ref}`}
                value={credentialDrafts[ref] ?? ''} disabled={saving !== undefined || info?.writable === false}
                onChange={(event) => { setCredentialDrafts(current => ({ ...current, [ref]: event.target.value })) }} />
            </label>
            <button type="submit" disabled={saving !== undefined || info?.writable === false || (credentialDrafts[ref] ?? '').length === 0}>
              {saving === ref ? t('savingCredential') : t('saveCredential')}
            </button>
            {info?.configured === true && info.writable ? <button type="button" disabled={saving !== undefined}
              onClick={() => { void removeCredential(ref) }}>{t('removeCredential')}</button> : null}
          </form>
        })}
      </div>}
    </section>)}
    {accounts.length === 0 && authorizationEntries.length === 0 && authorizationError === undefined && accountsError === undefined ? null : <section aria-label={t('accounts')}>
      <h2>{t('accounts')}</h2>
      {authorizationError === undefined ? null : <p role="alert">{t('authorizationError')}: {authorizationError}</p>}
      {accountsError === undefined ? null : <p role="alert">{t('accountListError')}: {accountsError}</p>}
      {accounts.map((account) => {
        const entry = authorizationEntries.find(candidate => candidate.key === account.key)
        return <AccountCard key={account.key} account={account} actions={actions} t={t} refreshClick={accountRefreshClick}
          onRefreshAccounts={() => refreshAccounts()} onSignOut={signOutAccount}
          signOutAvailable={entry?.configured ?? account.status === 'ready'}
          authorization={entry === undefined ? undefined : <AuthorizationRow entry={entry} actions={actions} t={t}
            onSettled={authorizationSettled} refreshClick={refreshClick} />} />
      })}
      {authorizationEntries.filter(entry => !accounts.some(account => account.key === entry.key)).map(entry => <AuthorizationRow
        key={entry.key} entry={entry} actions={actions} t={t}
        onSettled={authorizationSettled} refreshClick={refreshClick} />)}
    </section>}
  </main>
}
