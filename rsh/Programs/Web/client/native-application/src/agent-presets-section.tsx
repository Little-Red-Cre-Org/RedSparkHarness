/** Read-only Agent preset roster in Native Web Settings. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { NativeAgentPresetList, NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import css from './agent-presets-section.module.css'

type Translate = (key: ConversationLocaleKey) => string
type AgentPresetsSectionProps = {
  actions: Pick<NativeSessionClient, 'agentPresetsList'>
  t: Translate
}

/** Present the selected Host's preset roster without editing it.
 * @param props - Host list action and locale translator.
 * @returns The roster, or its loading, error or empty state.
 */
export function AgentPresetsSection(props: AgentPresetsSectionProps): ReactNode {
  const { actions, t } = props
  const [presets, setPresets] = useState<NativeAgentPresetList>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const request = new AbortController()
    setPresets(undefined)
    setLoading(true)
    setFailed(false)
    void actions.agentPresetsList(request.signal).then((result) => {
      if (request.signal.aborted) return
      setPresets(result)
      setLoading(false)
    }, () => {
      if (request.signal.aborted) return
      setFailed(true)
      setLoading(false)
    })
    return () => { request.abort() }
  }, [actions.agentPresetsList])

  return <section className={css.section}>
    <h2 className={css.title}>{t('settingsAgentPresets')}</h2>
    {loading ? <p role="status">{t('agentPresetsLoading')}</p> : null}
    {failed ? <p className={css.error} role="alert">{t('agentPresetsLoadFailed')}</p> : null}
    {!loading && !failed && presets?.presets.length === 0 ? <p>{t('agentPresetsEmpty')}</p> : null}
    {!loading && !failed && presets !== undefined && presets.presets.length > 0 ? <ul className={css.list}>
      {presets.presets.map(preset => <li key={preset.id} className={css.card}>
        <div className={css.header}>
          <h3 className={css.name}>{preset.name}</h3>
          {preset.id === presets.default ? <span className={`${css.badge} ${css.default}`}>{t('agentPresetsDefault')}</span> : null}
          {preset.status === 'needs-migration' ? <span className={`${css.badge} ${css.migration}`}>{t('agentPresetsNeedsMigration')}</span> : null}
          {preset.status === 'invalid' ? <span className={`${css.badge} ${css.broken}`}>{t('agentPresetsBroken')}</span> : null}
        </div>
        {preset.description === undefined ? null : <p className={css.description}>{preset.description}</p>}
        {preset.problem === undefined ? null : <p className={css.problem}>{preset.problem}</p>}
      </li>)}
    </ul> : null}
  </section>
}
