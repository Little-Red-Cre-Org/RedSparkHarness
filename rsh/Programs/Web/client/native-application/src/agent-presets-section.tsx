/** Agent preset management in Native Web Settings. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconTrashOutline16, Modal, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  NativeAgentPresetDocument, NativeAgentPresetList, NativeSessionClient, NativeSettingsDescriptor,
} from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import css from './agent-presets-section.module.css'

type Translate = (key: ConversationLocaleKey) => string
type AgentPresetsSectionProps = {
  actions: Pick<NativeSessionClient, 'agentPresetsList' | 'agentPresetRead' | 'agentPresetCopy' | 'agentPresetDelete'
    | 'agentPresetsCanOpenDirectory' | 'agentPresetOpenDirectory' | 'settingsDescribe' | 'settingsMutate' | 'settingsEvents'>
  t: Translate
}
type CopyDraft = { from: string; id: string; name: string; saving: boolean; error: string | null }

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Present and manage the selected Host's native preset folders.
 * @param props - Host actions and locale translator.
 * @returns the roster, its loading or error state, and management dialogs.
 */
export function AgentPresetsSection({ actions, t }: AgentPresetsSectionProps): ReactNode {
  const [presets, setPresets] = useState<NativeAgentPresetList>()
  const [settings, setSettings] = useState<NativeSettingsDescriptor>()
  const [announcedSettingsRevision, setAnnouncedSettingsRevision] = useState(0)
  const [settingsLoadState, setSettingsLoadState] = useState<'loading' | 'absent' | 'failed' | 'loaded'>('loading')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [canOpenDirectory, setCanOpenDirectory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsWriting, setSettingsWriting] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NativeAgentPresetDocument | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [copy, setCopy] = useState<CopyDraft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [revealedPaths, setRevealedPaths] = useState<Readonly<Record<string, string>>>({})
  const detailRequest = useRef<string | null>(null)
  const reloadRoster = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    const lifetime = new AbortController()
    let rosterRequest: AbortController | undefined
    let settingsRequest: AbortController | undefined
    const loadRoster = async (): Promise<void> => {
      rosterRequest?.abort()
      const request = new AbortController()
      rosterRequest = request
      setLoading(true)
      setFailed(false)
      try {
        const result = await actions.agentPresetsList(request.signal)
        if (lifetime.signal.aborted || request.signal.aborted) return
        setPresets(result)
        setRevealedPaths(paths => Object.fromEntries(Object.entries(paths).filter(([id]) => result.presets.some(row => row.id === id))))
        setLoading(false)
      } catch {
        if (lifetime.signal.aborted || request.signal.aborted) return
        setFailed(true)
        setLoading(false)
      }
    }
    const loadSettings = async (): Promise<void> => {
      settingsRequest?.abort()
      const request = new AbortController()
      settingsRequest = request
      setSettingsError(null)
      setSettingsLoadState('loading')
      try {
        const result = await actions.settingsDescribe(request.signal)
        if (lifetime.signal.aborted || request.signal.aborted) return
        const found = result.namespaces.find(row => row.namespace === 'agent-presets') ?? null
        if (found === null) {
          setSettingsLoadState('absent')
        } else {
          setSettings(current => current === undefined || current.revision <= found.revision ? found : current)
          setSettingsLoadState('loaded')
        }
      } catch (failure: unknown) {
        if (lifetime.signal.aborted || request.signal.aborted) return
        setSettingsError(failure instanceof Error ? failure.message : String(failure))
        setSettingsLoadState('failed')
      }
    }
    reloadRoster.current = loadRoster
    void actions.agentPresetsCanOpenDirectory(lifetime.signal).then((canOpen) => {
      if (!lifetime.signal.aborted) setCanOpenDirectory(canOpen)
    }, () => {
      if (!lifetime.signal.aborted) setCanOpenDirectory(false)
    })
    // Subscribe before the first reads so updates between read and listen are not missed.
    void (async () => {
      try {
        const events = actions.settingsEvents(lifetime.signal)
        const consume = (async () => {
          for await (const event of events) {
            if (event.type === 'agent-presets/updated') void loadRoster()
            if (event.type === 'settings/document-updated' && event.namespace === 'agent-presets') {
              setAnnouncedSettingsRevision(current => Math.max(current, event.revision))
              void loadSettings()
              void loadRoster()
            }
          }
        })()
        void loadRoster()
        void loadSettings()
        await consume
      } catch (failure: unknown) {
        if (!lifetime.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => {
      lifetime.abort()
      rosterRequest?.abort()
      settingsRequest?.abort()
      reloadRoster.current = undefined
    }
  }, [actions.agentPresetsList, actions.agentPresetsCanOpenDirectory, actions.settingsDescribe, actions.settingsEvents])

  const settingsAvailable = settingsLoadState === 'loaded' && settings !== undefined
    && settings.revision >= announcedSettingsRevision
  const modeSelectionEnabled = settings?.value.modeSelectionEnabled === true

  const openDetails = async (id: string): Promise<void> => {
    detailRequest.current = id
    setDetailId(id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const document = await actions.agentPresetRead(id)
      if (detailRequest.current !== id) return
      setDetail(document)
    } catch (failure: unknown) {
      if (detailRequest.current !== id) return
      setDetailError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (detailRequest.current === id) setDetailLoading(false)
    }
  }

  const openLocation = async (id: string): Promise<void> => {
    setError(null)
    try {
      const result = await actions.agentPresetOpenDirectory(id)
      if (!result.opened) setRevealedPaths(paths => ({ ...paths, [id]: result.path }))
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const submitCopy = async (): Promise<void> => {
    if (copy === null || copy.saving) return
    const blocker = copy.id === '' ? 'agentPresetsIdRequired'
      : !PRESET_ID.test(copy.id) ? 'agentPresetsIdInvalid'
        : presets?.presets.some(row => row.id === copy.id) ? 'agentPresetsIdTaken' : undefined
    if (blocker !== undefined) {
      setCopy({ ...copy, error: t(blocker) })
      return
    }
    setCopy({ ...copy, saving: true, error: null })
    try {
      await actions.agentPresetCopy(copy.from, copy.id, copy.name.trim() || undefined)
      setCopy(null)
      await openLocation(copy.id)
    } catch (failure: unknown) {
      setCopy({ ...copy, saving: false, error: failure instanceof Error ? failure.message : String(failure) })
    }
  }

  const writeSetting = async (path: string[], value: string | boolean): Promise<void> => {
    if (!settingsAvailable || settingsWriting) return
    setSettingsWriting(true)
    setSettingsError(null)
    try {
      const result = await actions.settingsMutate('agent-presets', [{ op: 'set', path, value }], settings.revision)
      // A settings event may already have read a newer revision; never step back to this write's view.
      setSettings(current => current === undefined || current.revision <= result.revision ? result : current)
      await reloadRoster.current?.()
    } catch (failure: unknown) {
      setSettingsError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSettingsWriting(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (pendingDelete === null || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await actions.agentPresetDelete(pendingDelete)
      setPendingDelete(null)
    } catch (failure: unknown) {
      setPendingDelete(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setDeleting(false)
    }
  }

  const statusText = (status: NativeAgentPresetList['presets'][number]['status']): string =>
    t(status === 'ready' ? 'agentPresetsReady' : status === 'needs-migration' ? 'agentPresetsNeedsMigration' : 'agentPresetsBroken')
  const dialogProps = css.dialog === undefined ? {} : { className: css.dialog }

  return <section className={css.section}>
    <h2 className={css.title}>{t('settingsAgentPresets')}</h2>
    <p className={css.intro}>{t('agentPresetsIntro')}</p>
    <div className={css.pickerPreference}>
      <div className={css.pickerPreferenceCopy}>
        <span className={css.pickerPreferenceTitleRow}>
          <span className={css.pickerPreferenceTitle}>{t('agentPresetsShowPicker')}</span>
          <Tag>{t('agentPresetsBeta')}</Tag>
        </span>
        <p className={css.pickerPreferenceDescription}>{t('agentPresetsShowPickerDescription')}</p>
        {settingsLoadState === 'absent' ? <p className={css.hostGap}>{t('agentPresetsHostGap')}</p> : null}
      </div>
      <Switch
        checked={modeSelectionEnabled}
        label={t('agentPresetsShowPicker')}
        disabled={!settingsAvailable || settingsWriting}
        title={settingsLoadState === 'absent' ? t('agentPresetsHostGap') : undefined}
        onChange={(next) => { void writeSetting(['modeSelectionEnabled'], next) }}
      />
    </div>
    {loading ? <p role="status">{t('agentPresetsLoading')}</p> : null}
    {failed ? <p className={css.error} role="alert">{t('agentPresetsLoadFailed')}</p> : null}
    {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    {settingsError === null ? null : <p className={css.error} role="alert">{settingsError}</p>}
    {!loading && !failed && presets?.presets.length === 0 ? <p>{t('agentPresetsEmpty')}</p> : null}
    {!loading && !failed && presets !== undefined && presets.presets.length > 0 ? <>
      {([
        ['built-in', 'agentPresetsBuiltInGroup'],
        ['custom', 'agentPresetsCustomGroup'],
      ] as const).map(([group, heading]) => {
        const rows = presets.presets.filter(preset => group === 'custom' ? preset.source === 'user' : preset.source !== 'user')
        if (rows.length === 0) return null
        return <section className={css.group} key={group}>
          <h3 className={css.groupHead}>{t(heading)}</h3>
          <ul className={css.cards}>
            {rows.map((preset) => {
              const isDefault = preset.id === presets.default
              const isReady = preset.status === 'ready'
              const selectionDisabled = !settingsAvailable || !modeSelectionEnabled || settingsWriting
              const selectionLabel = !isReady ? statusText(preset.status)
                : isDefault ? t('agentPresetsDefault')
                  : settingsLoadState === 'absent' ? t('agentPresetsSettingUnavailable')
                    : !settingsAvailable ? t('agentPresetsSettingsRefreshing')
                      : modeSelectionEnabled ? t('agentPresetsSetDefault') : t('agentPresetsEnablePickerToSetDefault')
              const sourceTag = preset.source === 'user' ? 'agentPresetsCustomTag' : 'agentPresetsBuiltInTag'
              return <li key={preset.id} className={[
                css.card,
                !isReady ? css.cardBroken : undefined,
                isDefault ? css.cardActive : undefined,
                !modeSelectionEnabled && !isDefault && isReady ? css.cardSelectionDisabled : undefined,
              ].filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className={css.cardMain}
                  aria-pressed={isDefault}
                  disabled={isDefault || (isReady && selectionDisabled)}
                  aria-disabled={!isReady}
                  aria-label={`${selectionLabel}: ${preset.name}`}
                  title={selectionLabel}
                  onClick={() => {
                    if (!isReady || !modeSelectionEnabled || settingsWriting) return
                    void writeSetting(['default'], preset.id)
                  }}
                >
                  <span className={css.cardHead}>
                    <span className={css.cardName}>{preset.name}</span>
                    {!isReady ? <Tag tone="danger" className={css.brokenBadge}>
                      {preset.status === 'needs-migration' ? t('agentPresetsNeedsMigration') : t('agentPresetsBrokenBadge')}
                    </Tag> : null}
                    <Tag>{t(sourceTag)}</Tag>
                    {isDefault ? <Tag tone="solid" className={css.cardDefault}>{t('agentPresetsDefault')}</Tag> : null}
                  </span>
                  <span className={css.cardDesc}>{preset.description ?? t('agentPresetsNoDescription')}</span>
                  {!isReady && preset.problem !== undefined
                    ? <span className={css.cardProblem} role="alert">{preset.problem}</span> : null}
                  <code className={css.cardId}>{preset.id}</code>
                </button>
                <div className={css.cardFoot}>
                  <button type="button" className={css.iconButton}
                    data-tip={t('agentPresetsView')} aria-label={`${t('agentPresetsView')}: ${preset.name}`}
                    onClick={() => { void openDetails(preset.id) }}><IconBrowseOutline16 /></button>
                  {preset.source !== 'profile' && isReady ? <button type="button" className={css.iconButton}
                    data-tip={t('agentPresetsDuplicate')} aria-label={`${t('agentPresetsDuplicate')}: ${preset.name}`}
                    onClick={() => { setCopy({ from: preset.id, id: '', name: '', saving: false, error: null }) }}>
                    <IconCopyOutline16 />
                  </button> : null}
                  {preset.source === 'user' ? <>
                    <button type="button" className={css.iconButton}
                      data-tip={t(canOpenDirectory ? 'agentPresetsOpenFolder' : 'agentPresetsShowLocation')}
                      aria-label={`${t(canOpenDirectory ? 'agentPresetsOpenFolder' : 'agentPresetsShowLocation')}: ${preset.name}`}
                      onClick={() => { void openLocation(preset.id) }}><IconFolderOpenOutline16 /></button>
                    <button type="button" className={`${css.iconButton} ${css.iconDanger}`}
                      data-tip={t('agentPresetsDelete')} aria-label={`${t('agentPresetsDelete')}: ${preset.name}`}
                      onClick={() => { setPendingDelete(preset.id) }}><IconTrashOutline16 /></button>
                  </> : null}
                </div>
                {revealedPaths[preset.id] === undefined ? null : <p className={css.revealedPath}>
                  <span>{t('agentPresetsPath')}</span><code>{revealedPaths[preset.id]}</code>
                </p>}
              </li>
            })}
          </ul>
        </section>
      })}
    </> : null}

    <Modal open={detailId !== null} onClose={() => { detailRequest.current = null; setDetailId(null) }}
      title={detailId === null ? '' : `${t('agentPresetsView')} · ${detail?.name ?? detailId}`}
      closeLabel={t('close')} {...dialogProps}>
      {detailLoading ? <p role="status">{t('agentPresetsLoading')}</p> : null}
      {detailError === null ? null : <p className={css.error} role="alert">{detailError}</p>}
      {detail === null ? null : <div className={css.detail}>
        <p>{t('agentPresetsIdentifier')}: <code>{detail.id}</code></p>
        <p>{t('agentPresetsSource')}: {t(detail.source === 'user' ? 'agentPresetsSourceUser'
          : detail.source === 'system' ? 'agentPresetsSourceSystem' : 'agentPresetsSourceProfile')}</p>
        <p>{t('agentPresetsStatus')}: {statusText(detail.status)}</p>
        {detail.description === undefined ? null : <p>{detail.description}</p>}
        {detail.problem === undefined ? null : <p className={css.problem}>{detail.problem}</p>}
        {detail.content === undefined ? <p>{t(detail.source === 'profile' && detail.status === 'ready'
          ? 'agentPresetsNoComposition'
          : detail.status === 'needs-migration' ? 'agentPresetsCompositionNeedsMigration'
            : detail.status === 'invalid' ? 'agentPresetsCompositionNeedsRepair' : 'agentPresetsNoCompositionFile')}</p>
          : <pre className={css.composition}><code>{detail.content}</code></pre>}
      </div>}
    </Modal>

    <Modal open={copy !== null} onClose={() => { if (!copy?.saving) setCopy(null) }}
      title={t('agentPresetsCopyTitle')} closeLabel={t('close')} description={t('agentPresetsCopyIntro')} {...dialogProps}
      footer={<>
        <Button variant="outline" disabled={copy?.saving} onClick={() => { setCopy(null) }}>{t('modelsCancel')}</Button>
        <Button disabled={copy === null || copy.saving} onClick={() => { void submitCopy() }}>
          {copy?.saving ? t('agentPresetsCreating') : t('agentPresetsCreate')}
        </Button>
      </>}>
      {copy === null ? null : <div className={css.dialogFields}>
        <label className={css.field}><span className={css.fieldLabel}>{t('agentPresetsIdentifier')}</span>
          <input className={css.input} autoFocus spellCheck={false} value={copy.id}
            placeholder={t('agentPresetsIdPlaceholder')} onChange={(event) => { setCopy({ ...copy, id: event.target.value, error: null }) }} />
        </label>
        <label className={css.field}><span className={css.fieldLabel}>{t('agentPresetsName')}</span>
          <input className={css.input} spellCheck={false} value={copy.name}
            placeholder={t('agentPresetsNamePlaceholder')} onChange={(event) => { setCopy({ ...copy, name: event.target.value, error: null }) }} />
        </label>
        {copy.error === null ? null : <p className={css.error} role="alert">{copy.error}</p>}
      </div>}
    </Modal>

    <Modal open={pendingDelete !== null} onClose={() => { if (!deleting) setPendingDelete(null) }}
      title={t('agentPresetsDeleteTitle')} closeLabel={t('close')} description={t('agentPresetsDeleteDescription')} {...dialogProps}
      footer={<>
        <Button variant="outline" disabled={deleting} onClick={() => { setPendingDelete(null) }}>{t('modelsCancel')}</Button>
        <Button variant="outline" className={css.deleteConfirm} disabled={deleting}
          onClick={() => { void remove() }}>{deleting ? t('agentPresetsDeleting') : t('agentPresetsDeleteConfirm')}</Button>
      </>}>
      {pendingDelete === null ? null : <p><code>{pendingDelete}</code></p>}
    </Modal>
  </section>
}
