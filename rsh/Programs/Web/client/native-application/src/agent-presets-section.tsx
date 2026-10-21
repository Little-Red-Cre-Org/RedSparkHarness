/** Agent preset management in Native Web Settings. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconTrashOutline16, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativeAgentPresetDocument, NativeAgentPresetList, NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import css from './agent-presets-section.module.css'

type Translate = (key: ConversationLocaleKey) => string
type AgentPresetsSectionProps = {
  actions: Pick<NativeSessionClient, 'agentPresetsList' | 'agentPresetRead' | 'agentPresetCopy' | 'agentPresetDelete'
    | 'agentPresetsCanOpenDirectory' | 'agentPresetOpenDirectory' | 'settingsEvents'>
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
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [canOpenDirectory, setCanOpenDirectory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NativeAgentPresetDocument | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [copy, setCopy] = useState<CopyDraft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [revealedPaths, setRevealedPaths] = useState<Readonly<Record<string, string>>>({})
  const detailRequest = useRef<string | null>(null)

  useEffect(() => {
    const lifetime = new AbortController()
    let rosterRequest: AbortController | undefined
    const load = async (): Promise<void> => {
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
    void actions.agentPresetsCanOpenDirectory(lifetime.signal).then((canOpen) => {
      if (!lifetime.signal.aborted) setCanOpenDirectory(canOpen)
    }, () => {
      if (!lifetime.signal.aborted) setCanOpenDirectory(false)
    })
    // Subscribe before the first roster read so updates between read and listen are not missed.
    void (async () => {
      try {
        const events = actions.settingsEvents(lifetime.signal)
        const consume = (async () => {
          for await (const event of events) {
            if (event.type === 'agent-presets/updated') void load()
          }
        })()
        void load()
        await consume
      } catch (failure: unknown) {
        if (!lifetime.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => {
      lifetime.abort()
      rosterRequest?.abort()
    }
  }, [actions.agentPresetsList, actions.agentPresetsCanOpenDirectory, actions.settingsEvents])

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
    {loading ? <p role="status">{t('agentPresetsLoading')}</p> : null}
    {failed ? <p className={css.error} role="alert">{t('agentPresetsLoadFailed')}</p> : null}
    {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    {!loading && !failed && presets?.presets.length === 0 ? <p>{t('agentPresetsEmpty')}</p> : null}
    {!loading && !failed && presets !== undefined && presets.presets.length > 0 ? <ul className={css.list}>
      {presets.presets.map(preset => <li key={preset.id} className={css.card}>
        <div className={css.header}>
          <h3 className={css.name}>{preset.name}</h3>
          <Tag>{t(preset.source === 'user' ? 'agentPresetsSourceUser'
            : preset.source === 'system' ? 'agentPresetsSourceSystem' : 'agentPresetsSourceProfile')}</Tag>
          {preset.id === presets.default ? <Tag>{t('agentPresetsDefault')}</Tag> : null}
          <Tag>{statusText(preset.status)}</Tag>
        </div>
        <code className={css.id}>{preset.id}</code>
        {preset.description === undefined ? null : <p className={css.description}>{preset.description}</p>}
        {preset.problem === undefined ? null : <p className={css.problem}>{preset.problem}</p>}
        <div className={css.actions}>
          <Button variant="outline" onClick={() => { void openDetails(preset.id) }}>
            <IconBrowseOutline16 size={14} />{t('agentPresetsView')}
          </Button>
          {preset.source === 'profile' || preset.status !== 'ready' ? null : (
            <Button variant="outline" onClick={() => { setCopy({ from: preset.id, id: '', name: '', saving: false, error: null }) }}>
              <IconCopyOutline16 size={14} />{t('agentPresetsDuplicate')}
            </Button>
          )}
          {preset.source !== 'user' ? null : (
            <>
              <Button variant="outline" onClick={() => { void openLocation(preset.id) }}>
                <IconFolderOpenOutline16 size={14} />{t(canOpenDirectory ? 'agentPresetsOpenFolder' : 'agentPresetsShowLocation')}
              </Button>
              <Button variant="outline" onClick={() => { setPendingDelete(preset.id) }}>
                <IconTrashOutline16 size={14} />{t('agentPresetsDelete')}
              </Button>
            </>
          )}
        </div>
        {revealedPaths[preset.id] === undefined ? null : (
          <p className={css.path}>{t('agentPresetsPath')} <code>{revealedPaths[preset.id]}</code></p>
        )}
      </li>)}
    </ul> : null}

    <Modal open={detailId !== null} onClose={() => { detailRequest.current = null; setDetailId(null) }}
      title={detail?.name ?? detailId ?? t('agentPresetsView')} closeLabel={t('close')} {...dialogProps}>
      {detailLoading ? <p role="status">{t('agentPresetsLoading')}</p> : null}
      {detailError === null ? null : <p className={css.error} role="alert">{detailError}</p>}
      {detail === null ? null : <div className={css.detail}>
        <p>{t('agentPresetsIdentifier')}: <code>{detail.id}</code></p>
        <p>{t('agentPresetsSource')}: {t(detail.source === 'user' ? 'agentPresetsSourceUser'
          : detail.source === 'system' ? 'agentPresetsSourceSystem' : 'agentPresetsSourceProfile')}</p>
        <p>{t('agentPresetsStatus')}: {statusText(detail.status)}</p>
        {detail.description === undefined ? null : <p>{detail.description}</p>}
        {detail.problem === undefined ? null : <p className={css.problem}>{detail.problem}</p>}
        <h3 className={css.compositionTitle}>{t('agentPresetsComposition')}</h3>
        {detail.content === undefined ? <p>{t('agentPresetsNoComposition')}</p> : <pre className={css.composition}><code>{detail.content}</code></pre>}
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
      {copy === null ? null : <div className={css.fields}>
        <label><span>{t('agentPresetsIdentifier')}</span><input autoFocus spellCheck={false} value={copy.id}
          placeholder={t('agentPresetsIdPlaceholder')} onChange={(event) => { setCopy({ ...copy, id: event.target.value, error: null }) }} /></label>
        <label><span>{t('agentPresetsName')}</span><input spellCheck={false} value={copy.name}
          placeholder={t('agentPresetsNamePlaceholder')} onChange={(event) => { setCopy({ ...copy, name: event.target.value, error: null }) }} /></label>
        {copy.error === null ? null : <p className={css.error} role="alert">{copy.error}</p>}
      </div>}
    </Modal>

    <Modal open={pendingDelete !== null} onClose={() => { if (!deleting) setPendingDelete(null) }}
      title={t('agentPresetsDeleteTitle')} closeLabel={t('close')} description={t('agentPresetsDeleteDescription')} {...dialogProps}
      footer={<>
        <Button variant="outline" disabled={deleting} onClick={() => { setPendingDelete(null) }}>{t('modelsCancel')}</Button>
        <Button disabled={deleting} onClick={() => { void remove() }}>{deleting ? t('agentPresetsDeleting') : t('agentPresetsDeleteConfirm')}</Button>
      </>}>
      {pendingDelete === null ? null : <p><code>{pendingDelete}</code></p>}
    </Modal>
  </section>
}
