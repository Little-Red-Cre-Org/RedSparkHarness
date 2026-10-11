/** Platform Web profile and wallet queries projected for native account consumers. */
import { z } from 'zod'
import type { AccountBalanceResult, AccountProfile, AccountProfileResult } from './index.ts'
import { AccountUnauthorizedError, PlatformAuthError, requestAccount } from './protocol.ts'

const user = z.object({
  id: z.string().nullish(),
  email: z.string(), mobile: z.string().optional(), mobile_number: z.string().optional(),
  id_profile: z.object({ name: z.string().nullable(), picture: z.string().nullish() }).nullish(),
})
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const wallet = z.object({ currency: z.enum(['CNY', 'USD']), balance: z.string().regex(decimal) })
const summary = z.object({ normal_wallets: z.array(wallet), bonus_wallets: z.array(wallet) })

function plainDecimal(value: string): string {
  const unsignedValue = value.startsWith('+') ? value.slice(1) : value
  const negative = unsignedValue.startsWith('-')
  const absoluteValue = negative ? unsignedValue.slice(1) : unsignedValue
  const exponentIndex = absoluteValue.search(/[eE]/)
  const coefficient = exponentIndex < 0 ? absoluteValue : absoluteValue.slice(0, exponentIndex)
  const exponentText = exponentIndex < 0 ? undefined : absoluteValue.slice(exponentIndex + 1)
  const decimalIndex = coefficient.indexOf('.')
  const integerLength = decimalIndex < 0 ? coefficient.length : decimalIndex
  const allDigits = coefficient.replace('.', '')
  const digits = allDigits.replace(/^0+/, '')
  if (digits === '') return '0'
  if (exponentText === undefined) return `${negative ? '-' : ''}${coefficient}`

  const decimalPosition = integerLength + Number(exponentText) - (allDigits.length - digits.length)
  const expanded = decimalPosition <= 0
    ? `0.${'0'.repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? digits.padEnd(decimalPosition, '0')
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
  return `${negative ? '-' : ''}${expanded}`
}

/**
 * Parse a Platform current-user response without retaining unrelated fields.
 * @param value - current-user business payload.
 * @returns the display profile.
 */
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

/**
 * Read one profile or balance field; authenticated rejection remains distinguishable for expiry.
 * @param field - which field to read.
 * @param origin - validated Platform origin.
 * @param token - stored account grant.
 * @param signal - cancellation and timeout.
 * @param headers - client identity headers.
 * @returns the field outcome; failures are `failed`, never a zero balance.
 */
export async function readAccountDetail(
  field: 'profile', origin: string, token: string, signal: AbortSignal, headers: Record<string, string>,
): Promise<AccountProfileResult>
/**
 * Read one profile or balance field; authenticated rejection remains distinguishable for expiry.
 * @param field - which field to read.
 * @param origin - validated Platform origin.
 * @param token - stored account grant.
 * @param signal - cancellation and timeout.
 * @param headers - client identity headers.
 * @returns the field outcome; failures are `failed`, never a zero balance.
 */
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
    const wallets = parsed.data.normal_wallets.map(wallet => ({ ...wallet, balance: plainDecimal(wallet.balance) }))
    const bonusWallets = parsed.data.bonus_wallets.map(wallet => ({ ...wallet, balance: plainDecimal(wallet.balance) }))
    return { status: 'ready', value: wallets, bonusWallets }
  } catch (error) {
    if (error instanceof AccountUnauthorizedError) throw error
    return { status: 'failed' }
  }
}
