import { describe, expect, it } from 'vitest'
import { parseCodexRateLimitEvent, parseCodexRateLimitHeaders } from '../src/rate-limits.ts'

describe('Codex rate-limit observations', () => {
  it.each([
    {
      name: 'default primary and secondary windows with absolute and relative resets',
      headers: {
        'x-codex-primary-used-percent': '17.5',
        'x-codex-primary-window-minutes': '60',
        'x-codex-primary-reset-at': '1700',
        'x-codex-secondary-used-percent': '80',
        'x-codex-secondary-window-minutes': '10080',
        'x-codex-secondary-reset-after-seconds': '15',
      },
      expected: {
        quotas: [{
          name: 'codex', primary: { usedPercent: 17.5, windowSeconds: 3600, resetsAt: 1700 },
          secondary: { usedPercent: 80, windowSeconds: 604800, resetsAt: 1015 },
        }],
        credits: null,
      },
      event: {
        type: 'codex.rate_limits', plan_type: 'plus', metered_limit_name: 'codex-weekly',
        rate_limits: {
          primary: { used_percent: 25, window_minutes: 60, reset_at: 1700000000 },
          secondary: null,
        },
        credits: { has_credits: true, unlimited: false, balance: '4.00' },
      },
      expectedEvent: {
        quotas: [{ name: 'codex_weekly', primary: { usedPercent: 25, windowSeconds: 3600, resetsAt: 1700000000 }, secondary: null }],
        plan: 'plus', credits: { unlimited: false, balance: '4.00' },
      },
    },
    {
      name: 'additional limit IDs and credits',
      headers: {
        'x-codex-bengalfox-primary-used-percent': '80',
        'x-codex-bengalfox-primary-window-minutes': '120',
        'x-codex-credits-has-credits': 'true',
        'x-codex-credits-unlimited': 'false',
        'x-codex-credits-balance': ' 12.50 ',
      },
      expected: {
        quotas: [{ name: 'codex_bengalfox', primary: { usedPercent: 80, windowSeconds: 7200, resetsAt: null }, secondary: null }],
        credits: { unlimited: false, balance: '12.50' },
      },
      event: { type: 'response.completed' },
      expectedEvent: undefined,
    },
  ])('parses $name', ({ headers, expected, event, expectedEvent }) => {
    expect(parseCodexRateLimitHeaders(headers, 1000)).toEqual(expected)
    expect(parseCodexRateLimitEvent(event)).toEqual(expectedEvent)
  })
})
