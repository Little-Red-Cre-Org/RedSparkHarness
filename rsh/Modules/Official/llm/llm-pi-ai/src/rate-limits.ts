/** SIWC rate limits observed on OpenAI Responses requests. */

import type { Quota } from './accounts.ts'

/** The saved OAuth identity used to separate accounts with the same provider key. */
export interface CodexUsageIdentity {
  readonly issuer: string
  readonly subject: string
}

/** One observed update; SSE events update selected fields while headers replace quota groups. */
export interface CodexUsageObservation {
  readonly quotas: readonly Quota[]
  readonly credits?: { readonly unlimited: boolean; readonly balance: string | null } | null
  readonly plan?: string | null
}

/** Latest in-memory quota and credit state for one SIWC account. */
export interface CodexUsageSnapshot {
  readonly quotas: readonly Quota[]
  readonly credits: { readonly unlimited: boolean; readonly balance: string | null } | null
  readonly plan: string | null
}

function identityKey(identity: CodexUsageIdentity): string {
  return JSON.stringify([identity.issuer, identity.subject])
}

function headerNumber(headers: ReadonlyMap<string, string>, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === undefined || raw.trim().length === 0) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function headerBoolean(headers: ReadonlyMap<string, string>, name: string): boolean | undefined {
  const value = headers.get(name)?.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

function headerWindow(
  headers: ReadonlyMap<string, string>, prefix: string, kind: 'primary' | 'secondary', nowSeconds: number,
): Quota['primary'] {
  const usedPercent = headerNumber(headers, `${prefix}-${kind}-used-percent`)
  if (usedPercent === undefined) return null
  const minutes = headerNumber(headers, `${prefix}-${kind}-window-minutes`)
  const resetAt = headerNumber(headers, `${prefix}-${kind}-reset-at`)
  const resetAfter = headerNumber(headers, `${prefix}-${kind}-reset-after-seconds`)
  if (usedPercent === 0 && (minutes ?? 0) === 0 && resetAt === undefined && resetAfter === undefined) return null
  return {
    usedPercent,
    windowSeconds: minutes === undefined ? null : minutes * 60,
    resetsAt: resetAt ?? (resetAfter === undefined ? null : nowSeconds + resetAfter),
  }
}

function eventWindow(value: unknown): Quota['primary'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const window = value as { used_percent?: unknown; window_minutes?: unknown; reset_at?: unknown }
  if (typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) return null
  const minutes = typeof window.window_minutes === 'number' && Number.isFinite(window.window_minutes)
    ? window.window_minutes : null
  const resetsAt = typeof window.reset_at === 'number' && Number.isFinite(window.reset_at)
    ? window.reset_at : null
  return { usedPercent: window.used_percent, windowSeconds: minutes === null ? null : minutes * 60, resetsAt }
}

function eventCredits(value: unknown): CodexUsageObservation['credits'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const credits = value as { has_credits?: unknown; unlimited?: unknown; balance?: unknown }
  if (typeof credits.has_credits !== 'boolean' || typeof credits.unlimited !== 'boolean') return undefined
  const balance = typeof credits.balance === 'string' && credits.balance.trim().length > 0
    ? credits.balance.trim() : null
  if (!credits.has_credits && !credits.unlimited && balance === null) return null
  return { unlimited: credits.unlimited, balance }
}

function normalizedLimitId(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_')
}

/**
 * Parse Codex rate-limit headers from an OpenAI Responses HTTP response.
 * @param values - response headers as a name/value record.
 * @param nowSeconds - receipt time used when the server reports a relative reset delay.
 * @returns parsed quota groups, credits, or undefined when the response reported none.
 */
export function parseCodexRateLimitHeaders(
  values: Readonly<Record<string, string>>,
  nowSeconds = Date.now() / 1000,
): CodexUsageObservation | undefined {
  const headers = new Map<string, string>()
  for (const [name, value] of Object.entries(values)) headers.set(name.toLowerCase(), value)
  const limitIds = new Set(['codex'])
  for (const name of headers.keys()) {
    const match = /^x-(codex(?:-[a-z0-9_-]+)?)-(?:primary|secondary)-used-percent$/.exec(name)
    if (match !== null) {
      const limitId = match[1]
      if (limitId !== undefined) limitIds.add(limitId)
    }
  }

  const quotas: Quota[] = []
  for (const limitId of limitIds) {
    const prefix = `x-${limitId}`
    const primary = headerWindow(headers, prefix, 'primary', nowSeconds)
    const secondary = headerWindow(headers, prefix, 'secondary', nowSeconds)
    if (primary !== null || secondary !== null) {
      quotas.push({ name: normalizedLimitId(limitId), primary, secondary })
    }
  }

  const hasCredits = headerBoolean(headers, 'x-codex-credits-has-credits')
  const unlimited = headerBoolean(headers, 'x-codex-credits-unlimited')
  const balanceValue = headers.get('x-codex-credits-balance')?.trim()
  const credits = hasCredits === undefined || unlimited === undefined
    ? null
    : hasCredits || unlimited || (balanceValue !== undefined && balanceValue.length > 0)
      ? { unlimited, balance: balanceValue === undefined || balanceValue.length === 0 ? null : balanceValue }
      : null
  if (quotas.length === 0 && credits === null) return undefined
  return { quotas, credits }
}

/**
 * Parse one Codex rate-limit SSE event from pi-ai's Responses stream observer.
 * @param value - parsed provider event data.
 * @returns the observed quota update, or undefined for another event type.
 */
export function parseCodexRateLimitEvent(value: unknown): CodexUsageObservation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const event = value as {
    type?: unknown
    plan_type?: unknown
    rate_limits?: unknown
    credits?: unknown
    metered_limit_name?: unknown
    limit_name?: unknown
  }
  if (event.type !== 'codex.rate_limits') return undefined

  const details = event.rate_limits !== null && typeof event.rate_limits === 'object' && !Array.isArray(event.rate_limits)
    ? event.rate_limits as { primary?: unknown; secondary?: unknown }
    : undefined
  const primary = eventWindow(details?.primary)
  const secondary = eventWindow(details?.secondary)
  const rawLimitId = typeof event.metered_limit_name === 'string' && event.metered_limit_name.trim().length > 0
    ? event.metered_limit_name
    : typeof event.limit_name === 'string' && event.limit_name.trim().length > 0
      ? event.limit_name : 'codex'
  const quotas = primary === null && secondary === null
    ? [] : [{ name: normalizedLimitId(rawLimitId), primary, secondary }]
  const credits = event.credits === undefined ? undefined : eventCredits(event.credits)
  const plan = typeof event.plan_type === 'string' && event.plan_type.length > 0 ? event.plan_type : undefined
  return { quotas, ...(credits === undefined ? {} : { credits }), ...(plan === undefined ? {} : { plan }) }
}

/** Retain observed usage in memory, isolated by the saved grant's issuer and subject. */
export class CodexUsageStore {
  private readonly snapshots = new Map<string, CodexUsageSnapshot>()

  /**
   * Read the latest observed state for one SIWC account.
   * @param identity - issuer and subject from its saved grant.
   * @returns the account snapshot, or undefined until a Responses observation arrives.
   */
  get(identity: CodexUsageIdentity): CodexUsageSnapshot | undefined {
    return this.snapshots.get(identityKey(identity))
  }

  /**
   * Apply response headers or an incremental SSE update to one account.
   * @param identity - issuer and subject from the request's saved grant.
   * @param observation - quota, credit and plan values observed on the wire.
   * @param replaceQuotas - replace all quota groups when the observation came from response headers.
   * @returns the account snapshot after applying the observation.
   */
  observe(
    identity: CodexUsageIdentity,
    observation: CodexUsageObservation,
    replaceQuotas = false,
  ): CodexUsageSnapshot {
    const key = identityKey(identity)
    const current = this.snapshots.get(key)
    const quotas = new Map<string, Quota>()
    if (!replaceQuotas) {
      for (const quota of current?.quotas ?? []) quotas.set(quota.name, quota)
    }
    for (const quota of observation.quotas) quotas.set(quota.name, quota)
    const snapshot: CodexUsageSnapshot = {
      quotas: [...quotas.values()].sort((left, right) => left.name.localeCompare(right.name)),
      credits: observation.credits === undefined ? current?.credits ?? null : observation.credits,
      plan: observation.plan === undefined ? current?.plan ?? null : observation.plan,
    }
    this.snapshots.set(key, snapshot)
    return snapshot
  }
}
