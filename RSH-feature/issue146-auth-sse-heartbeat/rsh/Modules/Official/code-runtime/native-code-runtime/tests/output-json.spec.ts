/** Exact JSON byte accounting and code-point-safe truncation for worker output. */
import { describe, expect, it } from 'vitest'
import type { CodeJsonValue } from '../src/types.ts'
import { jsonStringBytesUpTo, jsonValueBytesUpTo, truncateJsonStringBytes } from '../src/output-json.ts'

describe('jsonStringBytesUpTo', () => {
  it('counts quotes, escapes, UTF-8 code points, and lone surrogates exactly', () => {
    const values = ['plain', '"\\', '\b\t\n\f\r\0', 'é雪', 'A🔥B', '\ud800', '\udfff']
    for (const value of values) {
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8')
      expect(jsonStringBytesUpTo(value, expected)).toBe(expected)
      expect(jsonStringBytesUpTo(value, expected - 1)).toBeUndefined()
    }
  })

  it('rejects a budget that cannot hold an empty JSON string', () => {
    expect(jsonStringBytesUpTo('', 1)).toBeUndefined()
    expect(jsonStringBytesUpTo('', 2)).toBe(2)
  })
})

describe('jsonValueBytesUpTo', () => {
  it('counts scalar and nested values exactly like compact JSON serialization', () => {
    const values: CodeJsonValue[] = [
      null,
      true,
      false,
      0,
      -12.5,
      'é🔥',
      [],
      {},
      [null, true, 'x'],
      { a: 1, b: 2 },
      { nested: [1, { label: 'snow 雪' }] },
    ]
    for (const value of values) {
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8')
      expect(jsonValueBytesUpTo(value, expected)).toBe(expected)
      expect(jsonValueBytesUpTo(value, expected - 1)).toBeUndefined()
    }
  })

  it('stops at sparse array slots and undefined object values', () => {
    const sparse = new Array(1) as CodeJsonValue[]
    const undefinedField = { value: undefined } as unknown as CodeJsonValue
    expect(jsonValueBytesUpTo(sparse, 100)).toBeUndefined()
    expect(jsonValueBytesUpTo(undefinedField, 100)).toBeUndefined()
    expect(jsonValueBytesUpTo([1, 2], 3)).toBeUndefined()
    expect(jsonValueBytesUpTo({ a: 1 }, 3)).toBeUndefined()
    expect(jsonValueBytesUpTo({ a: 1 }, 5)).toBeUndefined()
  })
})

describe('truncateJsonStringBytes', () => {
  it('keeps the longest prefix that fits without splitting a code point', () => {
    expect(truncateJsonStringBytes('A🔥B', 7)).toBe('A🔥')
    expect(truncateJsonStringBytes('A🔥B', 6)).toBe('A')
    expect(truncateJsonStringBytes('🔥', 5)).toBe('')
  })

  it('preserves complete values and returns empty when quotes cannot fit', () => {
    const text = 'quote " and slash \\'
    expect(truncateJsonStringBytes(text, Buffer.byteLength(JSON.stringify(text), 'utf8'))).toBe(text)
    expect(truncateJsonStringBytes('content', 1)).toBe('')
  })
})
