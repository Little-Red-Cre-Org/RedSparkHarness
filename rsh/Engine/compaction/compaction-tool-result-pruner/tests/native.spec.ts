/** Native pruner configuration and installation contract. */
import { describe, expect, it } from 'vitest'
import { DEFAULTS, plugin, resolveNativeToolResultPrunerConfig } from '../src/native.ts'

describe('native tool-result pruner', () => {
  it('declares the token meter it prices shadowed results with', () => {
    expect(plugin).toMatchObject({ targets: ['host'], requires: ['tokenMeter'], provides: ['toolResultPruner'] })
  })

  it('resolves the shared budgets and rejects malformed configuration', () => {
    expect(resolveNativeToolResultPrunerConfig(undefined)).toEqual(DEFAULTS)
    expect(resolveNativeToolResultPrunerConfig({ thresholdChars: 4_000, headChars: 1_000, tailChars: 1_000 }))
      .toEqual({ thresholdChars: 4_000, headChars: 1_000, tailChars: 1_000 })
    expect(() => resolveNativeToolResultPrunerConfig('8192')).toThrow(/must be an object/)
    expect(() => resolveNativeToolResultPrunerConfig({ threshold: 1 })).toThrow(/unknown key/)
    expect(() => resolveNativeToolResultPrunerConfig({ thresholdChars: 100, headChars: 100 })).toThrow(/at most thresholdChars/)
  })
})
