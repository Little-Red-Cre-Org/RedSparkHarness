/** Generic native Settings and write-only credential controls for registered schemas. */
import { useCallback, useEffect, useState } from 'react'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'

type Translate = (key: ConversationLocaleKey) => string
type JsonObject = Record<string, unknown>
type SettingsPathOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

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

function userSection(value: unknown): JsonObject {
  if (!isObject(value)) throw new TypeError('Settings user layer must be an object')
  return value
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

/** Registered schema-backed Settings with revision-safe JSON edits and schema-discovered credential refs.
 * @param props - selected native client, localized copy, and the route back to the Session page.
 * @returns the native Settings and write-only credential page.
 */
export function SettingsPage({ client, t, onBack }: {
  client: NativeSessionClient
  t: Translate
  onBack: () => void
}) {
  const [namespaces, setNamespaces] = useState<readonly NativeSettingsDescriptor[]>([])
  const [limits, setLimits] = useState<{ maxCredentialRefsPerRead: number; maxSettingsOperations: number }>()
  const [credentials, setCredentials] = useState<Readonly<Record<string, { configured: boolean; source?: string; writable: boolean }>>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string>()
  const [error, setError] = useState<string>()
  const [credentialError, setCredentialError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async (keepDrafts: boolean, signal?: AbortSignal): Promise<boolean> => {
    setLoading(true)
    setError(undefined)
    setCredentialError(undefined)
    try {
      const description = await client.settingsDescribe(signal)
      const rows = description.namespaces
      setLimits(description.limits)
      setNamespaces(rows)
      setDrafts(current => keepDrafts ? current : Object.fromEntries(rows.map(row => [row.namespace, pretty(row.user)])))
      const refs = [...new Set(rows.flatMap(row => row.credentialRefs))]
      if (refs.length === 0) setCredentials({})
      else {
        try {
          const aggregate: Record<string, { configured: boolean; source?: string; writable: boolean }> = {}
          for (let offset = 0; offset < refs.length; offset += description.limits.maxCredentialRefsPerRead) {
            Object.assign(aggregate, await client.credentialsDescribe(
              refs.slice(offset, offset + description.limits.maxCredentialRefsPerRead), signal,
            ))
          }
          setCredentials(aggregate)
        }
        catch (cause: unknown) { setCredentialError(requestError(cause, t, 'native/credentials')); setCredentials({}) }
      }
      return true
    } catch (cause: unknown) {
      setError(requestError(cause, t, 'native/settings'))
      return false
    } finally { setLoading(false) }
  }, [client])

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
      if (ops.length > 0) await client.settingsMutate(row.namespace, ops, row.revision)
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
      await client.credentialsSet(ref, value)
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
      await client.credentialsUnset(ref)
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
    <button type="button" disabled={loading} onClick={() => { void refresh(true) }}>{t('refreshSettings')}</button>
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
          value={drafts[row.namespace] ?? pretty(row.user)} disabled={saving === row.namespace}
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
  </main>
}
