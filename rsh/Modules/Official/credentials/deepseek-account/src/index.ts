/** Sanitized DeepSeek Platform profile and balance results for native account consumers. */
export interface AccountProfile {
  readonly id: string | null
  readonly name: string | null
  readonly contact: string | null
  readonly avatarUrl: string | null
}

/** Platform wallet balance retained as a decimal string. */
export interface AccountWallet {
  readonly currency: 'CNY' | 'USD'
  readonly balance: string
}

/** One account profile query result. */
export type AccountProfileResult =
  | { readonly status: 'ready'; readonly value: AccountProfile }
  | { readonly status: 'failed' }

/** One account balance query result. */
export type AccountBalanceResult =
  | { readonly status: 'ready'; readonly value: readonly AccountWallet[]; readonly bonusWallets: readonly AccountWallet[] }
  | { readonly status: 'failed' }
