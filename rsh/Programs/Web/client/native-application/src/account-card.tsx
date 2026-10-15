import { useEffect, useState } from 'react'
import { ModelsSettingsStyles, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NativeAccountBalance, NativeAccountSummary, NativeAccountUsage, NativeQuota, NativeQuotaWindow } from '@deepseek-ai/dsh-client-native-session/native'
import type { ConversationLocaleKey } from './locales.ts'
import type { NativeSettingsActions } from './settings-page.tsx'
import css from './account-card.module.css'

type Translate = (key: ConversationLocaleKey) => string
const styles = ModelsSettingsStyles
type ReadyUsage = Extract<NativeAccountUsage, { status: 'ready' }>
type ReadyBalance = Extract<NativeAccountBalance, { status: 'ready' }>
type CachedAccountData = { accountKey: string; identity: string | null; value: ReadyUsage | ReadyBalance }

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

/** Render one native account summary and its last ready provider data.
 * @param props.account - Host-projected account identity and status.
 * @param props.actions - Native account operations.
 * @param props.refreshClick - changes after account summaries are reloaded.
 * @param props.onRefreshAccounts - reload account summaries and every card's provider data.
 * @param props.onSignOut - sign out this account and reload authorization state.
 * @param props.signOutAvailable - whether the Host reports a configured account credential.
 * @param props.t - localized copy.
 * @returns the account card.
 */
export function AccountCard({ account, actions, refreshClick, onRefreshAccounts, onSignOut, signOutAvailable, t }: {
  account: NativeAccountSummary
  actions: NativeSettingsActions
  refreshClick: number
  onRefreshAccounts: () => Promise<void>
  onSignOut: (key: string) => Promise<void>
  signOutAvailable: boolean
  t: Translate
}) {
  const [data, setData] = useState<CachedAccountData>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'unavailable' | 'usage-pending' | 'stale'>('loading')
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState(false)
  const identity = account.provider === 'deepseek-account'
    ? account.identity.contact : account.identity.email

  // Settings and Models remount this read; after a chat turn, USAGE_PENDING clears on the next open (the Host has no push).
  useEffect(() => {
    const lifetime = new AbortController()
    setData(current => current?.accountKey === account.key && identity !== null && current.identity === identity ? current : undefined)
    setStatus(current => current === 'ready' || current === 'stale' ? current : 'loading')
    const read = account.provider === 'deepseek-account'
      ? actions.accountsBalance(account.key, lifetime.signal) : actions.accountsUsage(account.key, lifetime.signal)
    void read.then((result) => {
      if (lifetime.signal.aborted) return
      if (result.status === 'ready') {
        setData({ accountKey: account.key, identity, value: result })
        setStatus('ready')
      } else if (account.provider === 'openai-codex' && result.status === 'failed' && 'reason' in result && result.reason === 'USAGE_PENDING') {
        setData(undefined)
        setStatus('usage-pending')
      } else if (result.status === 'signed-out') {
        setData(undefined)
        setStatus('signed-out')
      } else if (result.status === 'unsupported' && account.provider === 'deepseek-account') {
        setData(undefined)
        setStatus('unavailable')
      } else {
        setStatus(current => current === 'ready' || current === 'stale' ? 'stale' : 'unavailable')
      }
    }, () => {
      if (!lifetime.signal.aborted) {
        setStatus(current => current === 'ready' || current === 'stale' ? 'stale' : 'unavailable')
      }
    })
    return () => { lifetime.abort() }
  }, [actions, account.key, account.provider, account.status, identity, refreshClick])

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

  // The effect drops a null-identity cache before each read, so it only shows that read's result.
  const currentData = data?.accountKey === account.key && data.identity === identity ? data.value : undefined
  const currentUsage = account.provider === 'openai-codex' && currentData !== undefined && 'quotas' in currentData
    ? currentData : undefined
  const currentBalance = account.provider === 'deepseek-account' && currentData !== undefined && 'wallets' in currentData
    ? currentData : undefined
  const currentStatus = currentData === undefined && status === 'stale' ? 'unavailable' : status
  const email = currentUsage?.email ?? account.identity.email
  const plan = currentUsage?.plan ?? account.plan
  const identityName = account.provider === 'deepseek-account'
    ? account.identity.name ?? (account.status === 'ready' ? t('signedIn') : null)
    : account.identity.name
  const identityContact = account.provider === 'deepseek-account' ? account.identity.contact : email
  return <article className={styles['rowCard']}>
    <div className={styles['rowHead']}>
      <span className={styles['rowIdentity']}>
        {account.identity.avatarUrl === null ? <svg className={css.avatar} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.75V21h15v-2.25C19.5 16.1 16.2 14 12 14Z" fill="currentColor" />
        </svg> : <img className={css.avatar} src={account.identity.avatarUrl} referrerPolicy="no-referrer" alt="" />}
        <div className={css.identityText}>
          <h3 className={`${styles['rowName']} ${css.identityTitle}`}>
            {account.provider === 'deepseek-account' ? t('deepSeekAccount') : t('chatGptAccount')}
          </h3>
          <div className={`${styles['authorizationStatus']} ${css.accountDetails}`}>
            {identityName === null ? null : <span>{identityName}</span>}
            {identityName !== null && identityContact !== null ? <span aria-hidden="true"> · </span> : null}
            {identityContact === null ? null : <span>{identityContact}</span>}
            {plan === null ? null : <Tag tone="neutral">{t('plan')}: {plan}</Tag>}
          </div>
        </div>
      </span>
      <span className={styles['rowActions']}>
        <button type="button" className={styles['secondaryButton']} disabled={currentStatus === 'loading'} onClick={() => { void refresh() }}>
          {t('refreshAccount')}
        </button>
        {signOutAvailable ? <button type="button" className={styles['secondaryButton']} disabled={signingOut} onClick={() => { void signOut() }}>
          {signingOut ? t('signingOut') : t('signOut')}
        </button> : null}
      </span>
    </div>
    {account.provider === 'deepseek-account'
      ? currentBalance === undefined
        ? <div className={styles['authorizationStatus']} role={currentStatus === 'unavailable' ? 'status' : undefined}>{currentStatus === 'signed-out' ? t('accountSignedOut')
          : currentStatus === 'unavailable' ? t('balanceUnavailable') : t('loadingBalance')}</div>
        : <>
          {currentStatus === 'stale' ? <div className={styles['authorizationStatus']} role="status">{t('balanceStale')}</div> : null}
          {currentBalance.wallets.length > 0 || currentBalance.bonusWallets.length > 0 ? <div className={css.balances}>
            {currentBalance.wallets.length > 0 ? <div className={css.balanceRow}>
              <span>{t('balance')}</span>
              <span className={css.balanceAmounts}>{currentBalance.wallets.map(wallet => <span key={wallet.currency}>
                {wallet.currency === 'CNY' ? '¥' : '$'}{wallet.balance}
              </span>)}</span>
            </div> : null}
            {currentBalance.bonusWallets.length > 0 ? <div className={css.balanceRow}>
              <span>{t('bonusBalance')}</span>
              <span className={css.balanceAmounts}>{currentBalance.bonusWallets.map(wallet => <span key={wallet.currency}>
                {wallet.currency === 'CNY' ? '¥' : '$'}{wallet.balance}
              </span>)}</span>
            </div> : null}
          </div> : null}
        </>
      : currentStatus === 'signed-out' ? <div className={styles['authorizationStatus']}>{t('signedOut')}</div> : currentUsage === undefined
        ? <div className={styles['authorizationStatus']} role={currentStatus === 'unavailable' || currentStatus === 'usage-pending' ? 'status' : undefined}>
          {currentStatus === 'usage-pending' ? t('usagePending') : currentStatus === 'unavailable' ? t('accountUnavailable') : t('loadingAccount')}
        </div>
        : <>
          {currentStatus === 'stale' ? <div className={styles['authorizationStatus']} role="status">{t('usageStale')}</div> : null}
          <Quotas quotas={currentUsage.quotas} t={t} />
          {currentUsage.credits === null ? null : <p className={css.credits}>
            <strong>{t('credits')}</strong> {currentUsage.credits.unlimited ? t('unlimited') : currentUsage.credits.balance ?? '—'}
          </p>}
        </>}
    {error ? <p className={styles['error']} role="alert">{t('accountError')}</p> : null}
  </article>
}
