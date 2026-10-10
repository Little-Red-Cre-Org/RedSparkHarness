import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativeAccountSummary, NativeAccountUsage, NativeQuota, NativeQuotaWindow } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import type { NativeSettingsActions } from './settings-page.tsx'
import css from './account-card.module.css'

type Translate = (key: ConversationLocaleKey) => string
type ReadyUsage = Extract<NativeAccountUsage, { status: 'ready' }>
type CachedUsage = { accountKey: string; identityEmail: string | null; value: ReadyUsage }

function windowLength(seconds: number | null, t: Translate): string | undefined {
  if (seconds === null) return undefined
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}${t('minutes')}`
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}${t('hours')}`
  return `${Math.ceil(seconds / 86400)}${t('days')}`
}

function resetTime(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(seconds * 1000))
}

function QuotaWindow({ quota, window, t }: { quota: NativeQuota; window: NativeQuotaWindow; t: Translate }) {
  const remaining = Math.min(100, Math.max(0, 100 - window.usedPercent))
  const length = windowLength(window.windowSeconds, t)
  return <div className={css.quotaWindow}>
    <div className={css.quotaHeading}>
      <span>{length === undefined ? quota.name : `${quota.name} · ${length}`}</span>
      <span>{t('remaining')} {remaining}%</span>
    </div>
    <progress value={remaining} max={100} aria-label={`${quota.name} ${t('remaining')}`} />
    {window.resetsAt === null ? null : <p>{t('resetsAt')} {resetTime(window.resetsAt)}</p>}
  </div>
}

function Quotas({ quotas, t }: { quotas: readonly NativeQuota[]; t: Translate }) {
  return <div className={css.quotas}>
    {quotas.flatMap(quota => [
      quota.primary === null ? null : <QuotaWindow key={`${quota.name}-primary`} quota={quota} window={quota.primary} t={t} />,
      quota.secondary === null ? null : <QuotaWindow key={`${quota.name}-secondary`} quota={quota} window={quota.secondary} t={t} />,
    ])}
  </div>
}

/** Render one ChatGPT account summary and its last ready subscription usage.
 * @param props.account - Host-projected account identity and status.
 * @param props.actions - Native account operations.
 * @param props.authorization - Existing authorization row for this credential key, when available.
 * @param props.refreshClick - changes after account summaries are reloaded.
 * @param props.onRefreshAccounts - reload account summaries and every card's usage.
 * @param props.onSignOut - sign out this account and reload authorization state.
 * @param props.signOutAvailable - whether the Host reports a configured account credential.
 * @param props.t - localized copy.
 * @returns the account card.
 */
export function AccountCard({ account, actions, authorization, refreshClick, onRefreshAccounts, onSignOut, signOutAvailable, t }: {
  account: NativeAccountSummary
  actions: NativeSettingsActions
  authorization?: ReactNode
  refreshClick: number
  onRefreshAccounts: () => Promise<void>
  onSignOut: (key: string) => Promise<void>
  signOutAvailable: boolean
  t: Translate
}) {
  const [usage, setUsage] = useState<CachedUsage>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'unavailable' | 'stale'>('loading')
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const lifetime = new AbortController()
    setUsage(current => current?.accountKey === account.key && account.identity.email !== null
      && current.identityEmail === account.identity.email ? current : undefined)
    setStatus(current => current === 'ready' || current === 'stale' ? current : 'loading')
    void actions.accountsUsage(account.key, lifetime.signal).then((result) => {
      if (lifetime.signal.aborted) return
      if (result.status === 'ready') {
        setUsage({ accountKey: account.key, identityEmail: account.identity.email, value: result })
        setStatus('ready')
      } else if (result.status === 'signed-out') {
        setUsage(undefined)
        setStatus('signed-out')
      } else {
        setStatus(current => current === 'ready' || current === 'stale' ? 'stale' : 'unavailable')
      }
    }, () => {
      if (!lifetime.signal.aborted) {
        setStatus(current => current === 'ready' || current === 'stale' ? 'stale' : 'unavailable')
      }
    })
    return () => { lifetime.abort() }
  }, [actions, account.key, account.identity.email, account.status, refreshClick])

  const refresh = async (): Promise<void> => {
    setError(false)
    await onRefreshAccounts()
  }

  const signOut = async (): Promise<void> => {
    setError(false)
    setSigningOut(true)
    try { await onSignOut(account.key) }
    catch { setError(true) }
    finally { setSigningOut(false) }
  }

  // The effect drops a null-email cache before each read, so it only shows that read's result.
  const currentUsage = usage?.accountKey === account.key && usage.identityEmail === account.identity.email ? usage.value : undefined
  const currentStatus = currentUsage === undefined && status === 'stale' ? 'unavailable' : status
  const email = currentUsage?.email ?? account.identity.email
  const plan = currentUsage?.plan ?? account.plan
  return <article className={css.card}>
    <header className={css.header}>
      <div className={css.identity}>
        {account.identity.avatarUrl === null ? <svg className={css.avatar} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.75V21h15v-2.25C19.5 16.1 16.2 14 12 14Z" fill="currentColor" />
        </svg> : <img className={css.avatar} src={account.identity.avatarUrl} referrerPolicy="no-referrer" alt="" />}
        <div>
          <h3>{t('chatGptAccount')}</h3>
          {email === null ? null : <p>{email}</p>}
          {plan === null ? null : <Tag tone="neutral">{t('plan')}: {plan}</Tag>}
        </div>
      </div>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={currentStatus === 'loading'} onClick={() => { void refresh() }}>{t('refreshAccount')}</Button>
        {signOutAvailable ? <Button variant="outline" size="sm" disabled={signingOut} onClick={() => { void signOut() }}>
          {signingOut ? t('signingOut') : t('signOut')}
        </Button> : null}
      </div>
    </header>
    {currentStatus === 'signed-out' ? <p>{t('signedOut')}</p> : currentUsage === undefined
      ? <p role={currentStatus === 'unavailable' ? 'status' : undefined}>{currentStatus === 'unavailable' ? t('accountUnavailable') : t('loadingAccount')}</p>
      : <>
        {currentStatus === 'stale' ? <p role="status">{t('usageStale')}</p> : null}
        <Quotas quotas={currentUsage.quotas} t={t} />
        {currentUsage.credits === null ? null : <p className={css.credits}>
          <strong>{t('credits')}</strong> {currentUsage.credits.unlimited ? t('unlimited') : currentUsage.credits.balance ?? '—'}
        </p>}
      </>}
    {error ? <p role="alert">{t('accountError')}</p> : null}
    {authorization === undefined ? null : <div className={css.authorization}>{authorization}</div>}
  </article>
}
