import { describe, expect, it } from 'vitest'
import { getSymbolValue, requireSymbolValue, setSymbolValue } from '@deepseek-ai/dsh-util-values'

describe('symbol-keyed values', () => {
  it('retains a value on its target without exposing a writable property', () => {
    const target = {}
    const key = Symbol.for('@deepseek-ai/dsh-util-values/test')
    const value = { owner: 'first' }

    setSymbolValue(target, key, value)

    expect(getSymbolValue(target, key)).toBe(value)
    expect(Object.keys(target)).toEqual([])
    expect(Object.getOwnPropertyDescriptor(target, key)).toMatchObject({
      enumerable: false,
      configurable: false,
      writable: false,
      value,
    })
  })

  it('keeps symbol keys and target objects separate', () => {
    const target = {}
    const otherTarget = {}
    const key = Symbol.for('@deepseek-ai/dsh-util-values/test')

    setSymbolValue(target, key, 'value')

    expect(getSymbolValue(target, Symbol.for('@deepseek-ai/dsh-util-values/other'))).toBeUndefined()
    expect(getSymbolValue(otherTarget, key)).toBeUndefined()
  })

  it('requires an attached value when the caller expects one', () => {
    const target = {}
    const key = Symbol.for('@deepseek-ai/dsh-util-values/test')

    setSymbolValue(target, key, 'value')

    expect(requireSymbolValue(target, key, 'missing')).toBe('value')
    expect(() => { requireSymbolValue(target, Symbol('missing'), 'owner is missing') }).toThrow('owner is missing')
  })
})
