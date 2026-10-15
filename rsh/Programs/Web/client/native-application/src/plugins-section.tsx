/** Native plugin settings cards backed by the selected Host's Settings and Credentials actions. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NativeModelControls, NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import { PluginInventoryTab } from './plugin-inventory-tab.tsx'
import css from './plugins-section.module.css'

type Translate = (key: ConversationLocaleKey) => string
type PluginActions = Pick<NativeSessionClient,
  'settingsDescribe' | 'settingsMutate' | 'credentialsDescribe' | 'credentialsSet' | 'settingsEvents' | 'modelCatalog' | 'pluginInventoryList'>
type PluginNamespace = 'shell' | 'agent-loop' | 'subagent-model-selection' | 'web-search-deepseek'
type ModelRoute = { provider: string; model: string }
type PluginDraft = {
  revision?: number
  fields: Readonly<Record<string, string>>
  clears: ReadonlySet<string>
  enabled?: boolean
  models?: readonly ModelRoute[]
  apiKey: string
}
type PluginStatus = 'failed' | 'conflict' | undefined
type PluginField = {
  name: string
  label: ConversationLocaleKey
  hint: ConversationLocaleKey
  numeric: boolean
}
type PluginDefinition = {
  namespace: PluginNamespace
  title: ConversationLocaleKey
  description: ConversationLocaleKey
  fields: readonly PluginField[]
}
type CredentialInfo = { ref: string; configured: boolean; writable: boolean }
type CredentialRead = { kind: 'read'; info: CredentialInfo } | { kind: 'superseded' } | { kind: 'failed' }
type CredentialReadRequest = { request: number; ref: string; result: Promise<CredentialRead> }
type ModelCatalog = NativeModelControls['catalog']
type Candidate = ModelRoute & {
  key: string
  providerName: string
  modelName: string
  available: boolean
  selected: boolean
}

const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'
const PLUGINS: readonly PluginDefinition[] = [
  {
    namespace: 'shell', title: 'settingsPluginShellTitle', description: 'settingsPluginShellDescription', fields: [
      { name: 'timeoutMs', label: 'settingsPluginShellTimeoutMs', hint: 'settingsPluginShellTimeoutMsHint', numeric: true },
      { name: 'maxOutputBytes', label: 'settingsPluginShellMaxOutputBytes', hint: 'settingsPluginShellMaxOutputBytesHint', numeric: true },
    ],
  },
  {
    namespace: 'agent-loop', title: 'settingsPluginAgentLoopTitle', description: 'settingsPluginAgentLoopDescription', fields: [
      { name: 'maxParallelToolCalls', label: 'settingsPluginAgentLoopMaxParallel', hint: 'settingsPluginAgentLoopMaxParallelHint', numeric: true },
    ],
  },
  {
    namespace: 'subagent-model-selection', title: 'settingsPluginSubagentTitle', description: 'settingsPluginSubagentDescription', fields: [],
  },
  {
    namespace: 'web-search-deepseek', title: 'settingsPluginWebSearchTitle', description: 'settingsPluginWebSearchDescription', fields: [
      { name: 'baseURL', label: 'settingsPluginWebSearchBaseUrl', hint: 'settingsPluginWebSearchBaseUrlHint', numeric: false },
      { name: 'maxUses', label: 'settingsPluginWebSearchMaxUses', hint: 'settingsPluginWebSearchMaxUsesHint', numeric: true },
    ],
  },
]

function emptyDraft(): PluginDraft {
  return { fields: {}, clears: new Set(), apiKey: '' }
}

function draftHasValues(draft: PluginDraft): boolean {
  return Object.keys(draft.fields).length > 0 || draft.clears.size > 0 || draft.enabled !== undefined
    || draft.models !== undefined || draft.apiKey.trim() !== ''
}

function routeKey(route: ModelRoute): string {
  return `${route.provider}\0${route.model}`
}

function sameRoutes(left: readonly ModelRoute[], right: readonly ModelRoute[]): boolean {
  if (left.length !== right.length) return false
  const rightKeys = new Set(right.map(routeKey))
  return left.every(route => rightKeys.has(routeKey(route)))
}

function candidatesFor(catalog: ModelCatalog, stored: readonly ModelRoute[], selected: readonly ModelRoute[]): Candidate[] {
  const retained = new Map(stored.map(route => [routeKey(route), route]))
  for (const route of selected) retained.set(routeKey(route), route)
  const candidates = (catalog?.groups ?? []).flatMap(group => group.models.map((model): Candidate => {
    const route = { provider: group.id, model: model.id }
    const key = routeKey(route)
    retained.delete(key)
    return {
      ...route, key, providerName: group.name, modelName: model.name, available: true,
      selected: selected.some(choice => routeKey(choice) === key),
    }
  }))
  for (const route of retained.values()) {
    candidates.push({ ...route, key: routeKey(route), providerName: route.provider, modelName: route.model,
      available: false, selected: selected.some(choice => routeKey(choice) === routeKey(route)) })
  }
  return candidates
}

function credentialRef(row: NativeSettingsDescriptor): string {
  const configured = row.value.apiKeyEnv
  return typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_API_KEY_REF
}

function fieldText(value: unknown, numeric: boolean): string {
  return numeric ? typeof value === 'number' ? String(value) : '' : typeof value === 'string' ? value : ''
}

function parseField(text: string, numeric: boolean): { kind: 'set'; value: string | number } | { kind: 'clear' } | undefined {
  if (numeric) {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
  }
  const trimmed = text.trim()
  return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
}

function settingsOps(
  plugin: PluginDefinition,
  row: NativeSettingsDescriptor,
  draft: PluginDraft,
): { ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>; invalid: boolean } {
  if (plugin.namespace === 'subagent-model-selection') {
    const currentEnabled = row.value.enabled === true
    const enabled = draft.enabled ?? currentEnabled
    const currentModels = (row.value.allowedModels as readonly ModelRoute[] | undefined) ?? []
    const models = draft.models ?? currentModels
    const ops = [] as Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>
    if (enabled !== currentEnabled) ops.push({ op: 'set', path: ['enabled'], value: enabled })
    if (!sameRoutes(models, currentModels)) {
      ops.push({ op: 'set', path: ['allowedModels'], value: models.map(route => ({ provider: route.provider, model: route.model })) })
    }
    return { ops, invalid: enabled && models.length === 0 }
  }

  const ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> = []
  for (const field of plugin.fields) {
    const hasDraft = Object.hasOwn(draft.fields, field.name)
    if (!hasDraft && !draft.clears.has(field.name)) continue
    const path = [field.name]
    if (draft.clears.has(field.name)) {
      if (Object.hasOwn(row.user, field.name)) ops.push({ op: 'unset', path })
      continue
    }
    const text = draft.fields[field.name] as string
    if (text === fieldText(row.value[field.name], field.numeric)) continue
    const parsed = parseField(text, field.numeric)
    if (parsed === undefined) return { ops: [], invalid: true }
    if (parsed.kind === 'clear') {
      if (Object.hasOwn(row.user, field.name)) ops.push({ op: 'unset', path })
    } else {
      ops.push({ op: 'set', path, value: parsed.value })
    }
  }
  return { ops, invalid: false }
}

function conflictError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'native/settings-conflict'
}

function credentialReferenceConflict(): Error {
  return Object.assign(new Error('Credential reference changed while saving.'), { code: 'native/settings-conflict' })
}

function cardDraftIsDirty(plugin: PluginDefinition, row: NativeSettingsDescriptor | undefined, draft: PluginDraft): boolean {
  if (row === undefined) return false
  const { ops, invalid } = settingsOps(plugin, row, draft)
  return invalid || ops.length > 0 || (plugin.namespace === 'web-search-deepseek' && draft.apiKey.trim() !== '')
}

function PluginCard({
  plugin, row, loaded, loading, announcedRevision, draft, status, saving, credential, credentialLoading, credentialFailed,
  catalog, catalogStatus, catalogPartial,
  t, onDraft, onSave, onDiscard, onRetryCatalog,
}: {
  plugin: PluginDefinition
  row: NativeSettingsDescriptor | undefined
  loaded: boolean
  loading: boolean
  announcedRevision: number | undefined
  draft: PluginDraft
  status: PluginStatus
  saving: boolean
  credential: CredentialInfo | undefined
  credentialLoading: boolean
  credentialFailed: boolean
  catalog: ModelCatalog
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  catalogPartial: boolean
  t: Translate
  onDraft: (draft: PluginDraft) => void
  onSave: () => void
  onDiscard: () => void
  onRetryCatalog: () => void
}) {
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  const dirty = cardDraftIsDirty(plugin, row, draft)
  const invalid = row === undefined ? false : settingsOps(plugin, row, draft).invalid
  const values = row?.value
  const currentEnabled = values?.enabled === true
  const enabled = draft.enabled ?? currentEnabled
  const storedModels = (values?.allowedModels as readonly ModelRoute[] | undefined) ?? []
  const selectedModels = draft.models ?? storedModels
  const choices = candidatesFor(catalog, storedModels, selectedModels)
  const activeCredentialRef = row === undefined ? undefined : credentialRef(row)
  const credentialMatches = activeCredentialRef !== undefined && credential?.ref === activeCredentialRef
  const keyConfigured = credentialMatches ? credential.configured : false
  const keyWritable = credentialMatches ? credential.writable : true
  const keyStatus = credentialMatches
    ? keyConfigured ? 'settingsPluginWebSearchApiKeySet' : 'settingsPluginWebSearchApiKeyUnset'
    : credentialLoading ? 'settingsPluginCredentialLoading'
      : credentialFailed ? 'settingsPluginCredentialLoadFailed' : 'settingsPluginWebSearchApiKeyUnset'
  const keyInvalid = plugin.namespace === 'web-search-deepseek' && draft.apiKey.trim() !== '' && !keyWritable
  const revisionUnread = row !== undefined && announcedRevision !== undefined && row.revision < announcedRevision
  const blocked = !dirty || invalid || keyInvalid || saving || row === undefined || revisionUnread

  useEffect(() => {
    if (saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!dirty && status === undefined) setOpen(false)
  }, [dirty, saving, status])

  const toggleRoute = (route: ModelRoute): void => {
    const key = routeKey(route)
    onDraft({
      ...draft,
      models: selectedModels.some(candidate => routeKey(candidate) === key)
        ? selectedModels.filter(candidate => routeKey(candidate) !== key)
        : [...selectedModels, route],
    })
  }

  return <li className={`${css.card} ${open ? css.cardOpen : ''}`}>
    <button type="button" className={css.header} aria-expanded={open}
      aria-label={`${t(open ? 'settingsPluginCollapse' : 'settingsPluginExpand')}: ${t(plugin.title)}`}
      onClick={() => { setOpen(!open) }}>
      <span className={css.headText}>
        <span className={css.name}>{t(plugin.title)}</span>
        <span className={css.description}>{t(plugin.description)}</span>
      </span>
      {dirty ? <span className={css.pending}>{t('settingsPluginUnsaved')}</span> : null}
      <span aria-hidden="true" className={`${css.chevron} ${open ? css.chevronOpen : ''}`} />
    </button>
    {open ? <div className={css.body}>
      {!loaded ? loading ? <p className={css.notice} role="status">{t('settingsPluginLoading')}</p> : null
        : row === undefined ? loading
          ? <p className={css.notice} role="status">{t('settingsPluginRefreshPending')}</p>
          : <p className={css.notice} role="status">{t('settingsPluginHostGap')}</p>
          : <>
            {revisionUnread ? <p className={css.notice} role="status">{t('settingsPluginRefreshPending')}</p> : null}
            {plugin.namespace === 'subagent-model-selection' ? <>
              <label className={css.toggleRow}>
                <span>{t('settingsPluginSubagentToggle')}</span>
                <input type="checkbox" checked={enabled} disabled={saving}
                  onChange={() => { onDraft({ ...draft, enabled: !enabled }) }} />
              </label>
              <p className={css.hint}>{t(enabled ? 'settingsPluginSubagentChoose' : 'settingsPluginSubagentOff')}</p>
              {enabled ? <div className={css.selection}>
                {catalogStatus === 'loading' ? <p className={css.notice} role="status">{t('settingsPluginSubagentLoading')}</p> : null}
                {catalogStatus === 'error' ? <div className={css.catalogError} role="alert">
                  <span>{t('settingsPluginSubagentLoadFailed')}</span>
                  <button type="button" disabled={saving} onClick={onRetryCatalog}>{t('settingsPluginSubagentRetry')}</button>
                </div> : null}
                {catalogPartial ? <p className={css.notice}>{t('settingsPluginSubagentPartial')}</p> : null}
                {choices.length > 0 ? <fieldset className={css.models}>
                  <legend>{t('settingsPluginSubagentAllowed')}</legend>
                  {catalog?.groups.map((group) => {
                    const groupChoices = choices.filter(candidate => candidate.available && candidate.provider === group.id)
                    return groupChoices.length === 0 ? null : <div key={group.id} className={css.modelGroup}>
                      <div className={css.providerName}>{group.name}</div>
                      {groupChoices.map(candidate => <label key={candidate.key} className={css.model}>
                        <input type="checkbox" checked={candidate.selected} disabled={saving}
                          onChange={() => { toggleRoute(candidate) }} />
                        <span><span className={css.modelName}>{candidate.modelName}</span>
                          <span className={css.route}>{`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}</span></span>
                      </label>)}
                    </div>
                  })}
                  {choices.some(candidate => !candidate.available) ? <div className={css.modelGroup}>
                    <div className={css.providerName}>{t('settingsPluginSubagentUnavailableGroup')}</div>
                    {choices.filter(candidate => !candidate.available).map(candidate => <label key={candidate.key} className={css.model}>
                      <input type="checkbox" checked={candidate.selected} disabled={saving}
                        onChange={() => { toggleRoute(candidate) }} />
                      <span><span className={css.modelName}>{candidate.modelName}</span>
                        <span className={css.route}>{`${candidate.provider}/${candidate.model}`}</span></span>
                      <span className={css.unavailable}>{t('settingsPluginSubagentUnavailable')}</span>
                    </label>)}
                  </div> : null}
                </fieldset> : catalogStatus === 'ready' ? <p className={css.notice}>{t('settingsPluginSubagentEmpty')}</p> : null}
                {invalid ? <p className={css.invalid}>{t('settingsPluginSubagentRequired')}</p> : null}
              </div> : null}
            </> : null}
            {plugin.fields.map((field) => {
              const hasDraft = Object.hasOwn(draft.fields, field.name)
              const isClear = draft.clears.has(field.name)
              const text = isClear ? fieldText(row.base[field.name], field.numeric)
                : hasDraft ? draft.fields[field.name] as string : fieldText(values?.[field.name], field.numeric)
              const parsed = hasDraft && !isClear ? parseField(text, field.numeric) : undefined
              const fieldInvalid = hasDraft && !isClear && text !== fieldText(values?.[field.name], field.numeric) && parsed === undefined
              const overridden = isClear ? false : hasDraft ? parsed?.kind === 'set' : Object.hasOwn(row.user, field.name)
              return <div key={field.name} className={css.field}>
                <div className={css.fieldHead}>
                  <label className={css.label} htmlFor={`${plugin.namespace}-${field.name}`}>{t(field.label)}</label>
                  {overridden ? <span className={css.badges}>
                    <span className={css.override}>{t('settingsPluginOverridden')}</span>
                    <button type="button" className={css.reset} disabled={saving}
                      onClick={() => { onDraft({ ...draft, clears: new Set([...draft.clears, field.name]) }) }}>
                      {t('settingsPluginReset')}
                    </button>
                  </span> : null}
                </div>
                <input id={`${plugin.namespace}-${field.name}`} className={fieldInvalid ? css.inputInvalid : css.input}
                  type="text" {...field.numeric ? { inputMode: 'numeric' as const } : {}}
                  {...fieldInvalid ? { 'aria-invalid': true } : {}} value={text} disabled={saving}
                  onChange={(event) => {
                    const clears = new Set(draft.clears)
                    clears.delete(field.name)
                    onDraft({ ...draft, fields: { ...draft.fields, [field.name]: event.target.value }, clears })
                  }} />
                <p className={fieldInvalid ? css.invalid : css.hint}>{fieldInvalid ? t('settingsPluginInvalidNumber') : t(field.hint)}</p>
              </div>
            })}
            {plugin.namespace === 'web-search-deepseek' ? <div className={css.field}>
              <div className={css.fieldHead}>
                <label className={css.label} htmlFor="web-search-api-key">{t('settingsPluginWebSearchApiKey')}</label>
                <span className={css.override}>{t(keyStatus)}</span>
              </div>
              <input id="web-search-api-key" className={css.input} type="password" autoComplete="off"
                value={draft.apiKey} disabled={saving || !keyWritable}
                onChange={(event) => { onDraft({ ...draft, apiKey: event.target.value }) }} />
              <p className={css.hint}>{t('settingsPluginWebSearchApiKeyHint')}</p>
            </div> : null}
          </>}
      {row === undefined || !loaded ? null : <div className={css.footer}>
        {status === 'failed' ? <p className={css.failed} role="status">{t('settingsPluginSaveFailed')}</p> : null}
        {status === 'conflict' ? <p className={css.conflict} role="status">{t('settingsPluginConflict')}</p> : null}
        {keyInvalid ? <p className={css.failed} role="status">{t('settingsPluginCredentialReadOnly')}</p> : null}
        <button type="button" className={css.discard} disabled={!dirty || saving} onClick={onDiscard}>{t('settingsPluginDiscard')}</button>
        <button type="button" className={css.save} disabled={blocked} onClick={onSave}>
          {t(saving ? 'settingsPluginSaving' : 'settingsPluginSave')}
        </button>
      </div>}
    </div> : null}
  </li>
}

/** Render the legacy-style configurable cards and the deferred inventory tab.
 * @param props - Native Host actions and locale copy.
 * @returns the Plugins Settings section.
 */
export function PluginsSection({ actions, t }: { actions: PluginActions; t: Translate }) {
  const [tab, setTab] = useState<'config' | 'inventory'>('config')
  const [descriptors, setDescriptors] = useState<readonly NativeSettingsDescriptor[]>([])
  const descriptorsRef = useRef<readonly NativeSettingsDescriptor[]>([])
  const [announcedRevisions, setAnnouncedRevisions] = useState<Readonly<Record<string, number>>>({})
  const announcedRevisionsRef = useRef<Readonly<Record<string, number>>>({})
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [credential, setCredential] = useState<CredentialInfo>()
  const [credentialLoadingRef, setCredentialLoadingRef] = useState<string>()
  const [credentialFailed, setCredentialFailed] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog>(null)
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [catalogPartial, setCatalogPartial] = useState(false)
  const [drafts, setDrafts] = useState<Readonly<Record<string, PluginDraft>>>({})
  const [statuses, setStatuses] = useState<Readonly<Record<string, PluginStatus>>>({})
  const [saving, setSaving] = useState<PluginNamespace>()
  const lifetime = useRef<AbortController>()
  const settingsRequest = useRef(0)
  const credentialRequest = useRef(0)
  const credentialRead = useRef<CredentialReadRequest>()
  const catalogRequest = useRef(0)
  const catalogStatusRef = useRef(catalogStatus)
  catalogStatusRef.current = catalogStatus

  const publishDescriptors = useCallback((rows: readonly NativeSettingsDescriptor[]): void => {
    const nextByNamespace = new Map(descriptorsRef.current.map(row => [row.namespace, row]))
    for (const row of rows) {
      const previous = nextByNamespace.get(row.namespace)
      nextByNamespace.set(row.namespace, previous !== undefined && previous.revision > row.revision ? previous : row)
    }
    const next = [...nextByNamespace.values()]
    descriptorsRef.current = next
    setDescriptors(next)
  }, [])

  const readCredential = useCallback((ref: string, signal?: AbortSignal): Promise<CredentialRead> => {
    const request = ++credentialRequest.current
    setCredentialFailed(false)
    setCredentialLoadingRef(ref)
    const pending = (async (): Promise<CredentialRead> => {
      try {
        const result = await actions.credentialsDescribe([ref], signal)
        if (signal?.aborted) return { kind: 'superseded' }
        if (request !== credentialRequest.current) {
          const latest = credentialRead.current
          return latest !== undefined && latest.request > request && latest.ref === ref
            ? await latest.result : { kind: 'superseded' }
        }
        const currentRow = descriptorsRef.current.find(row => row.namespace === 'web-search-deepseek')
        if (currentRow === undefined || credentialRef(currentRow) !== ref) return { kind: 'superseded' }
        const view = result[ref]
        const info = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
        setCredential(info)
        setCredentialLoadingRef(undefined)
        return { kind: 'read', info }
      } catch {
        if (signal?.aborted) return { kind: 'superseded' }
        if (request !== credentialRequest.current) {
          const latest = credentialRead.current
          return latest !== undefined && latest.request > request && latest.ref === ref
            ? latest.result : { kind: 'superseded' }
        }
        const currentRow = descriptorsRef.current.find(row => row.namespace === 'web-search-deepseek')
        if (currentRow === undefined || credentialRef(currentRow) !== ref) return { kind: 'superseded' }
        setCredentialLoadingRef(undefined)
        setCredentialFailed(true)
        return { kind: 'failed' }
      }
    })()
    credentialRead.current = { request, ref, result: pending }
    return pending
  }, [actions.credentialsDescribe])

  const loadCatalog = useCallback(async (force = false): Promise<void> => {
    if (!force && (catalogStatusRef.current === 'loading' || catalogStatusRef.current === 'ready')) return
    const request = ++catalogRequest.current
    catalogStatusRef.current = 'loading'
    setCatalogStatus('loading')
    try {
      const result = await actions.modelCatalog(lifetime.current?.signal)
      if (lifetime.current?.signal.aborted || request !== catalogRequest.current) return
      if (result !== null) {
        setCatalog(result)
        setCatalogPartial(result.failures.length > 0)
      }
      catalogStatusRef.current = 'ready'
      setCatalogStatus('ready')
    } catch {
      if (lifetime.current?.signal.aborted || request !== catalogRequest.current) return
      catalogStatusRef.current = 'error'
      setCatalogStatus('error')
    }
  }, [actions.modelCatalog])

  const refreshNamespace = useCallback(async (): Promise<void> => {
    const signal = lifetime.current?.signal
    const request = ++settingsRequest.current
    setLoading(true)
    setLoadFailed(false)
    try {
      const description = await actions.settingsDescribe(signal)
      if (signal?.aborted || request !== settingsRequest.current) return
      publishDescriptors(description.namespaces)
      setLoaded(true)
      const nextAnnouncedRevisions = Object.fromEntries(Object.entries(announcedRevisionsRef.current).filter(([namespace, revision]) => {
        const row = descriptorsRef.current.find(candidate => candidate.namespace === namespace)
        return row !== undefined && row.revision < revision
      }))
      announcedRevisionsRef.current = nextAnnouncedRevisions
      setAnnouncedRevisions(nextAnnouncedRevisions)
      setLoadFailed(false)
      const webSearch = descriptorsRef.current.find(row => row.namespace === 'web-search-deepseek')
      if (webSearch === undefined) {
        credentialRequest.current += 1
        setCredentialLoadingRef(undefined)
      } else {
        await readCredential(credentialRef(webSearch), signal)
      }
    } catch {
      if (!signal?.aborted && request === settingsRequest.current) setLoadFailed(true)
    } finally {
      if (!signal?.aborted && request === settingsRequest.current) setLoading(false)
    }
  }, [actions.settingsDescribe, publishDescriptors, readCredential])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const load = async (): Promise<void> => { await refreshNamespace() }
    const consume = async (): Promise<void> => {
      try {
        for await (const event of actions.settingsEvents(controller.signal)) {
          if (event.type === 'settings/document-updated') {
            const nextAnnouncedRevisions = {
              ...announcedRevisionsRef.current,
              [event.namespace]: Math.max(announcedRevisionsRef.current[event.namespace] ?? 0, event.revision),
            }
            announcedRevisionsRef.current = nextAnnouncedRevisions
            setAnnouncedRevisions(nextAnnouncedRevisions)
            void refreshNamespace()
          } else if (event.type === 'credentials/reference-updated') {
            const row = descriptorsRef.current.find(candidate => candidate.namespace === 'web-search-deepseek')
            if (row !== undefined && credentialRef(row) === event.ref) void readCredential(event.ref, controller.signal)
          } else if (event.type === 'llm/adapters-updated') {
            if (catalogStatusRef.current !== 'idle') void loadCatalog(true)
          }
        }
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true)
      }
    }
    void consume()
    void load()
    return () => {
      controller.abort()
      if (lifetime.current === controller) lifetime.current = undefined
      catalogRequest.current += 1
      settingsRequest.current += 1
      credentialRequest.current += 1
    }
  }, [actions.settingsEvents, loadCatalog, readCredential, refreshNamespace])

  const descriptorByNamespace = new Map(descriptors.map(row => [row.namespace, row]))
  const subagent = descriptorByNamespace.get('subagent-model-selection')
  const currentSubagentEnabled = subagent?.value.enabled === true
  const enabledDraft = drafts['subagent-model-selection']?.enabled
  useEffect(() => {
    if ((enabledDraft ?? currentSubagentEnabled) && catalogStatus === 'idle') void loadCatalog()
  }, [catalogStatus, currentSubagentEnabled, enabledDraft, loadCatalog])

  const save = async (plugin: PluginDefinition, row: NativeSettingsDescriptor, draft: PluginDraft): Promise<void> => {
    const plan = settingsOps(plugin, row, draft)
    if (plan.invalid || saving !== undefined) return
    setSaving(plugin.namespace)
    setStatuses(current => ({ ...current, [plugin.namespace]: undefined }))
    try {
      let updated = row
      if (plan.ops.length > 0) {
        updated = await actions.settingsMutate(plugin.namespace, plan.ops, draft.revision ?? row.revision)
        const next = descriptorsRef.current.filter(candidate => candidate.namespace !== plugin.namespace)
        next.push(updated)
        publishDescriptors(next)
      }
      if (plugin.namespace === 'web-search-deepseek' && draft.apiKey.trim() !== '') {
        const latestRow = descriptorsRef.current.find(candidate => candidate.namespace === plugin.namespace)
        const ref = latestRow === undefined ? undefined : credentialRef(latestRow)
        const announcedRevision = announcedRevisionsRef.current[plugin.namespace]
        if (ref === undefined || latestRow === undefined || ref !== credentialRef(row) || ref !== credentialRef(updated)
          || (announcedRevision !== undefined && latestRow.revision < announcedRevision)) {
          throw credentialReferenceConflict()
        }
        await actions.credentialsSet(ref, draft.apiKey.trim())
        const result = await readCredential(ref, lifetime.current?.signal)
        const latestRead = credentialRead.current
        const currentRow = descriptorsRef.current.find(candidate => candidate.namespace === plugin.namespace)
        const currentAnnouncedRevision = announcedRevisionsRef.current[plugin.namespace]
        if (latestRead?.ref !== ref || currentRow === undefined || credentialRef(currentRow) !== ref
          || (currentAnnouncedRevision !== undefined && currentRow.revision < currentAnnouncedRevision)) {
          throw credentialReferenceConflict()
        }
        if (result.kind === 'failed' || (result.kind === 'read' && !result.info.configured)) {
          throw new Error('Credential was not reported as configured after saving.')
        }
      }
      setDrafts(current => ({ ...current, [plugin.namespace]: emptyDraft() }))
    } catch (cause: unknown) {
      await refreshNamespace()
      setStatuses(current => ({ ...current, [plugin.namespace]: conflictError(cause) ? 'conflict' : 'failed' }))
    } finally {
      setSaving(undefined)
    }
  }

  const updateDraft = (namespace: PluginNamespace, draft: PluginDraft): void => {
    const row = descriptorsRef.current.find(candidate => candidate.namespace === namespace)
    setDrafts((current) => {
      const revision = draft.revision ?? current[namespace]?.revision
        ?? (draftHasValues(draft) ? row?.revision : undefined)
      const nextDraft = { ...draft }
      if (revision === undefined) delete nextDraft.revision
      else nextDraft.revision = revision
      return { ...current, [namespace]: nextDraft }
    })
    setStatuses(current => ({ ...current, [namespace]: undefined }))
  }
  const tTabs = t('settingsPluginTabs')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % 2; break
      case 'ArrowLeft': nextIndex = (index - 1 + 2) % 2; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = 1; break
      default: return
    }
    event.preventDefault()
    const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
    setTab(nextIndex === 0 ? 'config' : 'inventory')
    nextTab.focus()
  }

  return <section className={css.section}>
    <h2 className={css.heading}>{t('settingsPluginTitle')}</h2>
    <p className={css.intro}>{t('settingsPluginIntro')}</p>
    {loadFailed ? <p className={css.error} role="alert">{t('settingsPluginLoadFailed')}</p> : null}
    {credentialFailed ? <p className={css.error} role="alert">{t('settingsPluginCredentialLoadFailed')}</p> : null}
    <div className={css.tabs} role="tablist" aria-label={tTabs}>
      <button type="button" role="tab" aria-selected={tab === 'config'} aria-controls="plugins-config-panel"
        id="plugins-config-tab" data-active={tab === 'config' ? 'true' : undefined} className={css.tab}
        ref={(element) => { tabRefs.current[0] = element }} tabIndex={tab === 'config' ? 0 : -1}
        onClick={() => { setTab('config') }} onKeyDown={(event) => { moveTab(event, 0) }}>{t('settingsPluginConfigTab')}</button>
      <button type="button" role="tab" aria-selected={tab === 'inventory'} aria-controls="plugins-inventory-panel"
        id="plugins-inventory-tab" data-active={tab === 'inventory' ? 'true' : undefined} className={css.tab}
        ref={(element) => { tabRefs.current[1] = element }} tabIndex={tab === 'inventory' ? 0 : -1}
        onClick={() => { setTab('inventory') }} onKeyDown={(event) => { moveTab(event, 1) }}>{t('settingsPluginInventoryTab')}</button>
    </div>
    <div id="plugins-config-panel" role="tabpanel" aria-labelledby="plugins-config-tab" hidden={tab !== 'config'} className={css.panel}>
      <ul className={css.cards}>
        {PLUGINS.map((plugin) => {
          const row = descriptorByNamespace.get(plugin.namespace)
          const draft = drafts[plugin.namespace] ?? emptyDraft()
          const activeCredentialRef = row === undefined ? undefined : credentialRef(row)
          return <PluginCard key={plugin.namespace} plugin={plugin} row={row} loaded={loaded} loading={loading}
            announcedRevision={announcedRevisions[plugin.namespace]} draft={draft}
            status={statuses[plugin.namespace]} saving={saving === plugin.namespace} credential={credential}
            credentialLoading={activeCredentialRef !== undefined && credentialLoadingRef === activeCredentialRef}
            credentialFailed={credentialFailed}
            catalog={catalog} catalogStatus={catalogStatus} catalogPartial={catalogPartial} t={t}
            onDraft={(next) => { updateDraft(plugin.namespace, next) }}
            onSave={() => { if (row !== undefined) void save(plugin, row, draft) }}
            onDiscard={() => {
              setDrafts(current => ({ ...current, [plugin.namespace]: emptyDraft() }))
              setStatuses(current => ({ ...current, [plugin.namespace]: undefined }))
            }}
            onRetryCatalog={() => { void loadCatalog(true) }} />
        })}
      </ul>
    </div>
    <div id="plugins-inventory-panel" role="tabpanel" aria-labelledby="plugins-inventory-tab" hidden={tab !== 'inventory'} className={css.panel}>
      <PluginInventoryTab actions={actions} t={t} active={tab === 'inventory'} />
    </div>
  </section>
}
