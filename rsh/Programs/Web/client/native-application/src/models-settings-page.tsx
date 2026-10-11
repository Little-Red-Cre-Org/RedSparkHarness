/** Native API provider settings joined from the Host directory, settings, and credential actions. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, CustomProviderCard, IconPlusOutline16, Modal, ModelsSettingsStyles, ProviderEditor,
  deriveModelCredentialRef, modelProtocolChoices,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCredentialInfo, ModelDiscoveryRequest, ModelSettingsNamespace, ModelSettingsOperations,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  NativeConfigurableModelProvider, NativeLlmProviderInfo, NativeSessionClient,
  NativeSettingsDescriptor,
} from '@deepseek-ai/dsh-client-native-session/native'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import { modelSettingsSchema } from './model-settings-schema.ts'

type Translate = (key: ConversationLocaleKey) => string
type ModelsActions = Pick<NativeSessionClient,
  | 'settingsDescribe' | 'settingsMutate' | 'credentialsDescribe' | 'credentialsSet' | 'credentialsUnset'
  | 'modelsListProviders' | 'modelsListConfigurableProviders' | 'modelsDiscover' | 'settingsEvents'
>
type ProviderEntry = NativeConfigurableModelProvider & { readonly active: boolean }

interface ProviderRow {
  readonly entry: ProviderEntry
  readonly configured: boolean
  readonly removable: boolean
  readonly apiKeyEnv: string | undefined
  readonly credential: ModelCredentialInfo | undefined
}

interface ModelsSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: string
  readonly credentialError?: string
  readonly rows: readonly ProviderRow[]
  readonly namespaces: ReadonlyMap<string, ModelSettingsNamespace>
}

interface EditorTarget {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly credentialRef?: string
  readonly declared?: boolean
}

const styles = ModelsSettingsStyles

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function directoryRows(
  registered: readonly NativeLlmProviderInfo[],
  directory: readonly NativeConfigurableModelProvider[],
): ProviderEntry[] {
  const active = new Set(registered.map(provider => provider.id))
  const declared = new Set(directory.map(entry => entry.provider))
  const rows = directory.map(entry => ({ ...entry, active: active.has(entry.provider) }))
  for (const provider of registered) {
    if (!declared.has(provider.id)) {
      rows.push({
        provider: provider.id,
        displayName: provider.name,
        settingsNs: '',
        settingsPath: [],
        active: true,
      })
    }
  }
  return rows
}

function profileField(namespace: ModelSettingsNamespace | undefined, path: readonly string[], key: string): string | undefined {
  if (namespace === undefined) return undefined
  const profile = modelSettingsSchema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const value = (profile as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function providerRows(
  entries: readonly ProviderEntry[],
  namespaces: ReadonlyMap<string, ModelSettingsNamespace>,
  credentials: Readonly<Record<string, ModelCredentialInfo>>,
): ProviderRow[] {
  return entries.map((entry) => {
    const namespace = namespaces.get(entry.settingsNs)
    const configured = namespace !== undefined
      && (entry.settingsPath.length === 0 || modelSettingsSchema.getPath(namespace.value, entry.settingsPath) !== undefined)
    const removable = namespace !== undefined
      && entry.settingsPath.length > 0
      && modelSettingsSchema.hasPath(namespace.user, entry.settingsPath)
      && !modelSettingsSchema.hasPath(namespace.base, entry.settingsPath)
    const apiKeyEnv = profileField(namespace, entry.settingsPath, 'apiKeyEnv')
    return {
      entry,
      configured,
      removable,
      apiKeyEnv,
      credential: apiKeyEnv === undefined ? undefined : credentials[apiKeyEnv],
    }
  })
}

function isSubscriptionProvider(entry: Pick<ProviderEntry, 'provider' | 'settingsNs'>): boolean {
  return entry.provider === 'openai-codex' && entry.settingsNs === 'llm-pi-ai'
}

function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable || row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveModelCredentialRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...(credentialRef === undefined ? {} : { credentialRef }),
    ...(row.entry.declared === true ? { declared: true } : {}),
  }
}

function targetLabel(target: Pick<EditorTarget, 'provider' | 'displayName'>): string {
  return target.provider === target.displayName ? target.provider : `${target.displayName} (${target.provider})`
}

function providerCopy(template: string, target: Pick<EditorTarget, 'provider' | 'displayName'>): string {
  return template.replace('{provider}', () => targetLabel(target))
}

function asNamespace(descriptor: NativeSettingsDescriptor): ModelSettingsNamespace {
  return {
    ns: descriptor.namespace,
    schema: descriptor.schema,
    value: descriptor.value,
    base: descriptor.base,
    user: descriptor.user,
    revision: descriptor.revision,
  }
}

/** Render provider editors and the native authorization/account area below them. */
export function ModelsSettingsPage({ actions, t, children }: {
  actions: ModelsActions
  t: Translate
  children?: ReactNode
}): ReactNode {
  const [snapshot, setSnapshot] = useState<ModelsSnapshot>({
    status: 'loading', rows: [], namespaces: new Map(),
  })
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const generation = useRef(0)
  const [editing, setEditing] = useState<EditorTarget>()
  const [adding, setAdding] = useState(false)
  const [declaring, setDeclaring] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget>()
  const [deleteFailure, setDeleteFailure] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  const [savedTarget, setSavedTarget] = useState<Pick<EditorTarget, 'provider' | 'displayName'>>()
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const request = ++generation.current
    setSnapshot(current => ({ ...current, status: current.rows.length === 0 ? 'loading' : current.status }))
    try {
      const [registered, directory, description] = await Promise.all([
        actions.modelsListProviders(signal),
        actions.modelsListConfigurableProviders(signal),
        actions.settingsDescribe(signal),
      ])
      const entries = directoryRows(registered, directory)
      const namespaces = new Map(description.namespaces.map((row) => {
        const namespace = asNamespace(row)
        return [namespace.ns, namespace] as const
      }))
      const preliminary = providerRows(entries, namespaces, {})
      const refs = [...new Set(preliminary.map(row => row.apiKeyEnv)
        .filter((ref): ref is string => ref !== undefined))]
      const credentials: Record<string, ModelCredentialInfo> = {}
      let credentialError: string | undefined
      try {
        for (let offset = 0; offset < refs.length; offset += description.limits.maxCredentialRefsPerRead) {
          Object.assign(credentials, await actions.credentialsDescribe(
            refs.slice(offset, offset + description.limits.maxCredentialRefsPerRead), signal,
          ))
        }
      } catch (error: unknown) {
        credentialError = errorText(error)
      }
      if (request !== generation.current || signal?.aborted) return
      setSnapshot({
        status: 'ready',
        ...(credentialError === undefined ? {} : { credentialError }),
        rows: providerRows(entries, namespaces, credentials),
        namespaces,
      })
    } catch (error: unknown) {
      if (request === generation.current && !signal?.aborted) {
        setSnapshot(current => ({ ...current, status: 'error', error: errorText(error) }))
      }
    }
  }, [actions])

  useEffect(() => {
    const lifetime = new AbortController()
    void refresh(lifetime.signal)
    void (async () => {
      try {
        for await (const _event of actions.settingsEvents(lifetime.signal)) await refresh(lifetime.signal)
      } catch (error: unknown) {
        if (!lifetime.signal.aborted) {
          setSnapshot(current => ({ ...current, status: 'error', error: errorText(error) }))
        }
      }
    })()
    return () => { lifetime.abort() }
  }, [actions, refresh])

  const operations = useMemo<ModelSettingsOperations>(() => ({
    async describeCredential(ref) {
      try { return (await actions.credentialsDescribe([ref]))[ref] }
      catch { return undefined }
    },
    async storeCredential(ref, value) {
      try { await actions.credentialsSet(ref, value); return undefined }
      catch (error: unknown) { return errorText(error) }
    },
    async removeCredential(ref) {
      try { await actions.credentialsUnset(ref); return undefined }
      catch (error: unknown) { return errorText(error) }
    },
    async writeSettings(namespace, ops, expectedRevision) {
      const revision = expectedRevision ?? snapshotRef.current.namespaces.get(namespace)?.revision
      if (revision === undefined) throw new Error(`native models: settings namespace ${namespace} is unavailable`)
      try {
        const view = await actions.settingsMutate(namespace, ops, revision)
        return { kind: 'written', view: { user: view.user, revision: view.revision } }
      } catch (error: unknown) {
        return error instanceof NativeSessionRpcError && error.code === 'native/settings-conflict'
          ? { kind: 'conflict', message: error.message }
          : { kind: 'refused', message: errorText(error) }
      }
    },
    async discoverModels(settingsNs, request: ModelDiscoveryRequest, signal?: AbortSignal) {
      try {
        return { kind: 'found', models: await actions.modelsDiscover(settingsNs, request, signal) }
      } catch (error: unknown) {
        return { kind: 'refused', message: errorText(error) }
      }
    },
  }), [actions])

  const announceSaved = (target: EditorTarget): void => {
    void refresh().then(() => { setSavedTarget(target) })
  }
  const closeEditor = (changed: boolean, target: EditorTarget): void => {
    setEditing(undefined)
    setAdding(false)
    if (changed) announceSaved(target)
  }
  const closeSetup = (changed: boolean, target: EditorTarget): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }
  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined) return
    setDeleting(true)
    setDeleteFailure(undefined)
    try {
      if (deleteTarget.credentialRef !== undefined) {
        const credentialFailure = await operations.removeCredential(deleteTarget.credentialRef)
        if (credentialFailure !== undefined) {
          setDeleteFailure(credentialFailure)
          return
        }
      }
      const result = await operations.writeSettings(deleteTarget.settingsNs, [
        { op: 'unset', path: [...deleteTarget.settingsPath] },
      ], undefined)
      if (result.kind !== 'written') {
        setDeleteFailure(result.message)
        return
      }
      setDeleteTarget(undefined)
      await refresh()
    } finally {
      setDeleting(false)
    }
  }

  const targetFor = (provider: string): EditorTarget | undefined => {
    const row = snapshot.rows.find(candidate => candidate.entry.provider === provider)
    return row === undefined ? undefined : targetOf(row)
  }

  if (snapshot.status === 'error') {
    return <div className={styles['section']}>
      <h2 className={styles['title']}>{t('settingsModels')}</h2>
      <section aria-labelledby="native-models-api-title">
        <h3 id="native-models-api-title" className={styles['authorizationTitle']}>{t('apiModelsTitle')}</h3>
        <p className={styles['error']}>{`${t('modelDirectoryLoadFailed')}: ${snapshot.error}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void refresh() }}>{t('retry')}</button>
      </section>
      <section className={styles['authorization']} aria-labelledby="native-models-subscription-title">
        <div>
          <h3 id="native-models-subscription-title" className={styles['authorizationTitle']}>{t('subscriptionModels')}</h3>
          <p className={styles['authorizationIntro']}>{t('subscriptionModelsIntro')}</p>
        </div>
        {children}
      </section>
    </div>
  }

  const savedRow = savedTarget === undefined
    ? undefined
    : snapshot.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }
  const anyUsable = snapshot.rows.some(providerUsable)
  const apiRows = snapshot.rows.filter(row => !isSubscriptionProvider(row.entry))
  const configured = apiRows.filter(row => row.configured)
  const configurable = apiRows.filter(row => snapshot.namespaces.has(row.entry.settingsNs))
  const addable = configurable.filter(row => !row.configured)
  const addTarget = adding && editing !== undefined ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : snapshot.namespaces.get(addTarget.settingsNs)
  const customNamespace = snapshot.namespaces.get('llm-pi-ai')
  const protocols = modelProtocolChoices(customNamespace, modelSettingsSchema)

  return <div className={styles['section']}>
    <h2 className={styles['title']}>{t('settingsModels')}</h2>
    <section aria-labelledby="native-models-api-title">
      <h3 id="native-models-api-title" className={styles['authorizationTitle']}>{t('apiModelsTitle')}</h3>
      <p className={styles['intro']}>{t('modelsIntro')}</p>
      {snapshot.credentialError === undefined ? null : <p role="alert" className={styles['notice']}>{t('credentialError')}: {snapshot.credentialError}</p>}
      {savedIdentity === undefined ? null : <p className={styles['savedNotice']} role="status" aria-live="polite">
        {providerCopy(t('savedProvider'), savedIdentity)}
      </p>}
      <ul className={styles['rows']}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = snapshot.namespaces.get(target.settingsNs)
          if (namespace === undefined) return null
          const entryError = row.entry.error === undefined ? null : <p role="alert" className={styles['error']}>{row.entry.error}</p>
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            return <li key={row.entry.provider} className={styles['setupCard']}>
              {entryError}
              <ProviderEditor provider={target.provider} displayName={target.displayName} declared={target.declared === true}
                namespace={namespace}
                schema={modelSettingsSchema} settingsPath={target.settingsPath} operations={operations} t={t}
                readOnly={false} onClose={(changed) => { closeSetup(changed, target) }} />
            </li>
          }
          const open = !adding && editing?.provider === row.entry.provider
          if (open) {
            return <li key={row.entry.provider} className={styles['setupCard']}>
              {entryError}
              <ProviderEditor provider={target.provider} displayName={target.displayName} declared={target.declared === true}
                namespace={namespace} schema={modelSettingsSchema} settingsPath={target.settingsPath}
                operations={operations} t={t} readOnly={false}
                onClose={(changed) => { closeEditor(changed, target) }} />
            </li>
          }
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured && row.apiKeyEnv !== undefined && row.credential?.configured === false
          return <li key={row.entry.provider} className={styles['rowCard']}>
            <div className={styles['rowHead']}>
              <span className={styles['rowIdentity']}>
                <span className={styles['rowName']}>{row.entry.displayName}</span>
                {row.entry.declared === true ? <span className={styles['rowTag']}>{t('customTag')}</span> : null}
                {credentialConfigured ? <span className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                  role="img" aria-label={t('credentialConfigured')} title={t('credentialConfigured')} />
                  : credentialMissing ? <span className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                    role="img" aria-label={t('credentialMissing')} title={t('credentialMissing')} /> : null}
              </span>
              <span className={styles['rowActions']}>
                <button type="button" className={styles['secondaryButton']}
                  aria-label={providerCopy(t('editProvider'), target)} onClick={() => {
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(false)
                    setEditing(target)
                  }}>{t('edit')}</button>
                {row.removable ? <button type="button" className={styles['dangerButton']}
                  aria-label={providerCopy(t('removeProvider'), target)}
                  onClick={() => { setSavedTarget(undefined); setDeleteFailure(undefined); setDeleteTarget(target) }}>
                  {t('remove')}
                </button> : null}
              </span>
            </div>
            {entryError}
          </li>
        })}
      </ul>
      <div className={styles['addBlock']}>
        {addTarget !== undefined && addNamespace !== undefined
          ? <div className={styles['addCard']}>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('provider')}</span>
              <select className={`${styles['input']} ${styles['selectInput']}`} value={addTarget.provider}
                aria-label={t('provider')} onChange={(event) => {
                  const target = targetFor(event.target.value)
                  if (target !== undefined) setEditing(target)
                }}>
                {addable.map(row => <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>)}
              </select>
            </div>
            <ProviderEditor key={addTarget.provider} provider={addTarget.provider} displayName={addTarget.displayName}
              hideTitle namespace={addNamespace} schema={modelSettingsSchema} settingsPath={addTarget.settingsPath}
              operations={operations} t={t} readOnly={false}
              onClose={(changed) => { closeEditor(changed, addTarget) }} />
          </div>
          : declaring && customNamespace !== undefined ? <div className={styles['addCard']}>
            <CustomProviderCard taken={snapshot.rows.map(row => row.entry.provider)} protocols={protocols}
              revision={customNamespace.revision} operations={operations} t={t}
              readOnly={false} onClose={(changed) => {
                setDeclaring(false)
                if (changed) void refresh()
              }} />
          </div>
            : <div className={styles['addActions']}>
              {configurable.length > 0 ? <button type="button" className={styles['addButton']}
                disabled={addable.length === 0} onClick={() => {
                  const first = addable[0]
                  if (first === undefined) return
                  setSavedTarget(undefined)
                  setDeclaring(false)
                  setAdding(true)
                  setEditing(targetOf(first))
                }}>
                <IconPlusOutline16 size={14} />{t('add')}
              </button> : null}
              {snapshot.namespaces.has('llm-pi-ai') ? <button type="button" className={styles['addButton']}
                disabled={protocols.length === 0} onClick={() => {
                  setSavedTarget(undefined)
                  setAdding(false)
                  setEditing(undefined)
                  setDeclaring(true)
                }}>
                <IconPlusOutline16 size={14} />{t('customAdd')}
              </button> : null}
            </div>}
      </div>
    </section>
    <section className={styles['authorization']} aria-labelledby="native-models-subscription-title">
      <div>
        <h3 id="native-models-subscription-title" className={styles['authorizationTitle']}>{t('subscriptionModels')}</h3>
        <p className={styles['authorizationIntro']}>{t('subscriptionModelsIntro')}</p>
      </div>
      {children}
    </section>
    <Modal open={deleteTarget !== undefined} onClose={() => {
      if (!deleting) { setDeleteTarget(undefined); setDeleteFailure(undefined) }
    }} title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
    closeLabel={t('close')} description={deleteTarget === undefined ? '' : providerCopy(
      deleteTarget.credentialRef === undefined ? t('deleteDescription') : t('deleteDescriptionWithCredential'),
      deleteTarget,
    )} className={styles['deleteDialog'] as string}
    footer={<>
      <Button variant="outline" autoFocus disabled={deleting} onClick={() => {
        setDeleteTarget(undefined); setDeleteFailure(undefined)
      }}>{t('modelsCancel')}</Button>
      <Button variant="outline" className={styles['deleteConfirm']} disabled={deleting}
        onClick={() => { void confirmDelete() }}>
        {deleteTarget === undefined ? '' : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
      </Button>
    </>}>
      {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
    </Modal>
  </div>
}
