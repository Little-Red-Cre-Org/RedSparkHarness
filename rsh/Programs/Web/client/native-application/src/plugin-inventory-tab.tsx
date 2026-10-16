import { useEffect, useId, useMemo, useState } from 'react'
import type { NativePluginInventory, NativePluginInventoryEntry, NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import { IconChevronDownOutline14, IconSearchOutline16, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocaleKey } from './locales.ts'
import css from './plugin-inventory-tab.module.css'

type Translate = (key: ConversationLocaleKey) => string
type PluginInventoryActions = Pick<NativeSessionClient, 'pluginInventoryList'>
type PluginState = NativePluginInventoryEntry['state']

const STATE_COPY = {
  planned: { labelKey: 'settingsPluginListPlanned', tone: 'warning' },
  activating: { labelKey: 'settingsPluginListActivating', tone: 'warning' },
  ready: { labelKey: 'settingsPluginListReady', tone: 'success' },
  draining: { labelKey: 'settingsPluginListDraining', tone: 'warning' },
  failed: { labelKey: 'settingsPluginListFailed', tone: 'danger' },
  disposed: { labelKey: 'settingsPluginListDisposed', tone: 'neutral' },
} as const satisfies Record<PluginState, { labelKey: ConversationLocaleKey; tone: TagTone }>

// Host runtime and storage packages the user cannot act on; folded until asked for or searched.
const INFRASTRUCTURE = /^(native-|storage-)/

const FAILURE_COPY = {
  activation: 'settingsPluginListFailureActivation',
  cleanup: 'settingsPluginListFailureCleanup',
} as const satisfies Record<NonNullable<NativePluginInventoryEntry['failure']>, ConversationLocaleKey>

function pluginStateLabel(state: PluginState, failure: NativePluginInventoryEntry['failure'], t: Translate): string {
  const label = t(STATE_COPY[state].labelKey)
  return state === 'failed' && failure !== undefined ? `${label} · ${t(FAILURE_COPY[failure])}` : label
}

/** Native plugin list, loaded on first display from the selected Host. */
export function PluginInventoryTab({ actions, t, active }: {
  readonly actions: PluginInventoryActions
  readonly t: Translate
  readonly active: boolean
}) {
  const id = useId()
  const [started, setStarted] = useState(false)
  const [request, setRequest] = useState(0)
  const [inventory, setInventory] = useState<NativePluginInventory>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsedScopes, setCollapsedScopes] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showInfrastructure, setShowInfrastructure] = useState(false)

  useEffect(() => {
    if (active && !started) setStarted(true)
  }, [active, started])

  useEffect(() => {
    if (!started) return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void actions.pluginInventoryList(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setInventory(value) },
      () => { if (!controller.signal.aborted) setFailed(true) },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [actions.pluginInventoryList, request, started])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const foldInfrastructure = !showInfrastructure && normalizedQuery.length === 0
  const infrastructureCount = (inventory?.entries ?? []).filter(entry => INFRASTRUCTURE.test(shortName(entry.name))).length
  const groups = useMemo(() => {
    const grouped = new Map<string, NativePluginInventoryEntry[]>()
    for (const entry of inventory?.entries ?? []) {
      if (!`${entry.name}\n${entry.id}`.toLocaleLowerCase().includes(normalizedQuery)) continue
      if (foldInfrastructure && INFRASTRUCTURE.test(shortName(entry.name))) continue
      const entries = grouped.get(entry.scope)
      if (entries === undefined) grouped.set(entry.scope, [entry])
      else entries.push(entry)
    }
    return [...grouped]
  }, [foldInfrastructure, inventory, normalizedQuery])

  const retry = (): void => { setRequest(value => value + 1) }
  const hasEntries = (inventory?.entries.length ?? 0) > 0

  return <div className={css.section} aria-busy={loading}>
    {loading ? <p className={css.status} role="status">{t('settingsPluginListLoading')}</p> : null}
    {failed ? <div className={css.failure}>
      <p role="alert">{t('settingsPluginListLoadError')}</p>
      <button type="button" onClick={retry}>{t('settingsPluginListRetry')}</button>
    </div> : null}
    {inventory !== undefined ? <div className={css.catalog}>
      <label className={css.search}>
        <IconSearchOutline16 aria-hidden="true" />
        <span className={css.visuallyHidden}>{t('settingsPluginListSearch')}</span>
        <input type="search" value={query} placeholder={t('settingsPluginListSearch')}
          aria-label={t('settingsPluginListSearch')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      </label>
      <p className={css.gapNote}>{t('settingsPluginListFeatureGap')}</p>
      {infrastructureCount > 0 && normalizedQuery.length === 0 ? <p className={css.gapNote}>
        {t(showInfrastructure ? 'settingsPluginListInfrastructureShown' : 'settingsPluginListInfrastructureHidden')} {infrastructureCount}
        {' · '}<button type="button" className={css.inlineAction} aria-expanded={showInfrastructure} onClick={() => { setShowInfrastructure(!showInfrastructure) }}>
          {t(showInfrastructure ? 'settingsPluginListHideInfrastructure' : 'settingsPluginListShowInfrastructure')}
        </button>
      </p> : null}
      {!hasEntries ? <p className={css.status}>{t('settingsPluginListEmpty')}</p> : null}
      {hasEntries && groups.length === 0 && normalizedQuery.length > 0 ? <p className={css.status}>{t('settingsPluginListEmptySearch')}</p> : null}
      {groups.map(([scope, entries]) => {
        const open = normalizedQuery.length > 0 || !collapsedScopes.has(scope)
        const groupId = `${id}-scope-${encodeURIComponent(scope)}`
        return <section className={css.group} data-plugin-scope={scope} key={scope}>
          <div className={css.groupTitleRow}>
            <button type="button" className={css.groupToggle} aria-expanded={open} aria-controls={groupId}
              onClick={() => { setCollapsedScopes((current) => {
                const next = new Set(current)
                if (open) next.add(scope)
                else next.delete(scope)
                return next
              }) }}>
              <IconChevronDownOutline14 className={css.groupChevron} size={12} aria-hidden="true" />
              <span className={css.groupTitle}>
                {t('settingsPluginListScopePrefix')} {scope.slice(0, 8)}
              </span>
            </button>
          </div>
          <p className={css.groupSub}>
            {t('settingsPluginListScopeSubtitle')}
            <span> · {entries.length} {t('settingsPluginListCount')}</span>
          </p>
          {open ? <ul className={css.cards} id={groupId}>
            {entries.map((entry) => {
              const detailId = `${id}-plugin-${encodeURIComponent(entry.id)}`
              const entryOpen = expanded === entry.id
              const state = STATE_COPY[entry.state]
              const failure = entry.failure === undefined ? t('settingsPluginListNoFailure') : t(FAILURE_COPY[entry.failure])
              return <li className={css.card} data-open={entryOpen ? 'true' : undefined} key={entry.id}>
                <button type="button" className={css.cardContent} aria-expanded={entryOpen} aria-controls={detailId}
                  onClick={() => { setExpanded(current => current === entry.id ? null : entry.id) }}>
                  <span className={css.cardMainRow}>
                    <strong className={css.cardTitle} title={entry.name}>{shortName(entry.name)}</strong>
                    <span className={css.cardTrailing}>
                      <Tag tone={state.tone}>{pluginStateLabel(entry.state, entry.failure, t)}</Tag>
                      <IconChevronDownOutline14 className={css.cardChevron} size={12} aria-hidden="true" />
                    </span>
                  </span>
                  <code className={css.cardIdentity} title={entry.name}>{entry.name}</code>
                </button>
                {entryOpen ? <div className={css.cardDetails} id={detailId}>
                  <dl className={css.details}>
                    <Fact label={t('settingsPluginListId')} value={entry.id} />
                    <Fact label={t('settingsPluginListName')} value={entry.name} />
                    <Fact label={t('settingsPluginListScope')} value={entry.scope} />
                    <Fact label={t('settingsPluginListState')} value={pluginStateLabel(entry.state, entry.failure, t)} />
                    <Fact label={t('settingsPluginListFailure')} value={failure} />
                  </dl>
                </div> : null}
              </li>
            })}
          </ul> : null}
        </section>
      })}
    </div> : null}
  </div>
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function shortName(name: string): string {
  const unscoped = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name
  return unscoped.replace(/^cordis:/, '').replace(/^cordis-plugin-/, '').replace(/^dsh-(?:host-|client-)?/, '')
}
