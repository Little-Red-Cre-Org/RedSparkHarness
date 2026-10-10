/** Platform Web profile and wallet queries projected for native account consumers. */
import { z } from 'zod'
import type { AccountBalanceResult, AccountProfile, AccountProfileResult } from './index.ts'
import { AccountUnauthorizedError, PlatformAuthError, requestAccount } from './protocol.ts'

const user = z.object({
  id: z.string().nullish(),
  email: z.string(), mobile: z.string().optional(), mobile_number: z.string().optional(),
  id_profile: z.object({ name: z.string().nullable(), picture: z.string().nullish() }).nullish(),
})
const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const wallet = z.object({ currency: z.enum(['CNY', 'USD']), balance: z.string().regex(decimal) })
const summary = z.object({ normal_wallets: z.array(wallet), bonus_wallets: z.array(wallet) })

/** Parse a Platform current-user response without retaining unrelated fields. */
export function profile(value: unknown): AccountProfile {
  const parsed = user.safeParse(value)
  if (!parsed.success) throw new PlatformAuthError('protocol')
  const { email, mobile, mobile_number: mobileNumber, id_profile: identity } = parsed.data
  return {
    id: parsed.data.id ?? null,
    avatarUrl: identity?.picture || null,
    name: identity?.name || null,
    contact: mobile || mobileNumber || email || null,
  }
}

/** Read one profile or balance field; authenticated rejection remains distinguishable for expiry. */
export async function readAccountDetail(
  field: 'profile', origin: string, token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<AccountProfileResult>
export async function readAccountDetail(
  field: 'balance', origin: string, token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<AccountBalanceResult>
export async function readAccountDetail(
  field: 'profile' | 'balance', origin: string, token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<AccountProfileResult | AccountBalanceResult> {
  const path = field === 'profile' ? '/auth-api/v0/users/current' : '/api/v0/users/get_user_summary'
  try {
    const value = await requestAccount(origin, path, token, signal, headers)
    if (field === 'profile') return { status: 'ready', value: profile(value) }
    const parsed = summary.safeParse(value)
    if (!parsed.success) throw new PlatformAuthError('protocol')
    return { status: 'ready', value: parsed.data.normal_wallets, bonusWallets: parsed.data.bonus_wallets }
  } catch (error) {
    if (error instanceof AccountUnauthorizedError) throw error
    return { status: 'failed' }
  }
}
