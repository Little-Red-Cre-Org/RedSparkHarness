/** Lossless snapshot and flat worker-wire behavior, including hostile graph shapes. */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { CodeJsonValue } from '../src/types.ts'
import { decodeWorkerJson, encodeWorkerJson, snapshotCodeJsonValue } from '../src/worker-json.ts'

function foreign(source: string): unknown {
  return runInNewContext(source) as unknown
}

describe('snapshotCodeJsonValue', () => {
  it('detaches scalar, nested, null-prototype, foreign-realm, and shared values', () => {
    const shared = { label: 'same source' }
    const source = Object.assign(Object.create(null) as Record<string, unknown>, {
      scalar: [null, true, false, 0, -12.5, 'é🔥'],
      sharedA: shared,
      sharedB: shared,
    })
    const copy = snapshotCodeJsonValue(source)
    expect(copy).toEqual({ scalar: [null, true, false, 0, -12.5, 'é🔥'], sharedA: { label: 'same source' }, sharedB: { label: 'same source' } })
    expect(copy).not.toBe(source)
    const copiedShared = copy !== undefined && copy !== null && typeof copy === 'object' && !Array.isArray(copy)
      ? copy.sharedA
      : undefined
    expect(copiedShared).not.toBe(shared)
    expect(snapshotCodeJsonValue(foreign('({ nested: [1, { ok: true }] })')))
      .toEqual({ nested: [1, { ok: true }] })
    expect(snapshotCodeJsonValue(foreign('[1, { ok: true }]'))).toEqual([1, { ok: true }])
  })

  it('rejects cycles, sparse or decorated arrays, non-finite values, and non-JSON data', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const decorated: unknown[] = [1]
    Object.defineProperty(decorated, 'extra', { value: true })
    const sparseWithExtra = new Array(2) as unknown[]
    sparseWithExtra[0] = 1
    Object.defineProperty(sparseWithExtra, 'extra', { value: true })
    const symbolKey = Symbol('hidden')
    const symbolValue = { visible: true, [symbolKey]: 1 }
    const nonEnumerable = { visible: true }
    Object.defineProperty(nonEnumerable, 'hidden', { value: 1 })
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter') } })
    const subclass = new (class CustomArray extends Array<number> {}) (1, 2)
    const cases: unknown[] = [
      cycle,
      new Array(1),
      decorated,
      sparseWithExtra,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      undefined,
      1n,
      Symbol('value'),
      () => {},
      new Date(0),
      new Map(),
      subclass,
      symbolValue,
      nonEnumerable,
      getter,
    ]
    for (const value of cases) expect(snapshotCodeJsonValue(value)).toBeUndefined()
  })

  it('rejects forged realm constructors, throwing reflection traps, and mismatched array slots', () => {
    const fakeConstructor = function FakeObject() {}
    Object.defineProperty(fakeConstructor, 'name', { get() { throw new Error('name trap') } })
    const forgedObjectPrototype = Object.create(null) as object
    Object.defineProperty(forgedObjectPrototype, 'constructor', { value: fakeConstructor })
    const forgedObject = Object.create(forgedObjectPrototype) as object
    const missingConstructorPrototype = Object.create(null) as object
    const missingConstructor = Object.create(missingConstructorPrototype) as object
    const nonFunctionConstructorPrototype = Object.create(null) as Record<string, unknown>
    Object.defineProperty(nonFunctionConstructorPrototype, 'constructor', { value: 'no' })
    const nonFunctionConstructor = Object.create(nonFunctionConstructorPrototype) as object
    const arrayWithGapAndExtra = new Array(2) as unknown[]
    arrayWithGapAndExtra[0] = 1
    Object.defineProperty(arrayWithGapAndExtra, 'extra', { value: true })
    const reflected = new Proxy({}, { getPrototypeOf() { throw new Error('prototype trap') } })
    const keys = new Proxy({}, { ownKeys() { throw new Error('keys trap') } })
    expect(snapshotCodeJsonValue(forgedObject)).toBeUndefined()
    expect(snapshotCodeJsonValue(missingConstructor)).toBeUndefined()
    expect(snapshotCodeJsonValue(nonFunctionConstructor)).toBeUndefined()
    expect(snapshotCodeJsonValue(arrayWithGapAndExtra)).toBeUndefined()
    expect(snapshotCodeJsonValue(reflected)).toBeUndefined()
    expect(snapshotCodeJsonValue(keys)).toBeUndefined()
  })
})

describe('encodeWorkerJson', () => {
  it('flattens nested arrays and objects into one pre-order token list', () => {
    const value: CodeJsonValue = { nested: [null, true, { label: '雪' }] }
    const wire = encodeWorkerJson(value)
    expect(wire).toEqual([
      { kind: 'object', keys: ['nested'] },
      { kind: 'array', length: 3 },
      null,
      true,
      { kind: 'object', keys: ['label'] },
      '雪',
    ])
    expect(decodeWorkerJson(wire)).toEqual(value)
    expect(encodeWorkerJson(null)).toEqual([null])
    expect(encodeWorkerJson(false)).toEqual([false])
    expect(encodeWorkerJson(7)).toEqual([7])
    expect(encodeWorkerJson('x')).toEqual(['x'])
  })

  it('refuses sparse arrays and undefined object members', () => {
    const sparse = new Array(1) as CodeJsonValue[]
    expect(() => encodeWorkerJson(sparse)).toThrow('cannot encode a sparse JSON array')
    expect(() => encodeWorkerJson({ value: undefined } as unknown as CodeJsonValue))
      .toThrow('cannot encode an undefined JSON object property')
  })
})

describe('decodeWorkerJson', () => {
  it('rebuilds nested, empty, and deeply nested values without recursion', () => {
    const value: CodeJsonValue = { emptyArray: [], emptyObject: {}, nested: [1, { label: 'deep' }] }
    expect(decodeWorkerJson(encodeWorkerJson(value))).toEqual(value)
    let deep: CodeJsonValue = null
    for (let index = 0; index < 5_000; index++) deep = [deep]
    let cursor = decodeWorkerJson(encodeWorkerJson(deep))
    for (let index = 0; index < 5_000; index++) {
      expect(Array.isArray(cursor)).toBe(true)
      cursor = (cursor as CodeJsonValue[])[0]
    }
    expect(cursor).toBe(null)
    expect(decodeWorkerJson(encodeWorkerJson([]))).toEqual([])
    expect(decodeWorkerJson(encodeWorkerJson({}))).toEqual({})
  })

  it('drops malformed envelopes, markers, scalar tokens, and incomplete or extra data', () => {
    const invalid: unknown[] = [
      null,
      'not wire',
      [],
      [undefined],
      [() => {}],
      [Symbol('token')],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [-0],
      [{ kind: 'array', length: -1 }],
      [{ kind: 'array', length: 1.5 }, null],
      [{ kind: 'array', length: Number.MAX_SAFE_INTEGER + 1 }],
      [{ kind: 'array', length: 1 }],
      [{ kind: 'array', length: 0, extra: true }],
      [{ kind: 'array', extra: true }],
      [[]],
      [{ kind: 'object', keys: ['a'], extra: true }, 1],
      [{ kind: 'object', keys: ['a', 'a'] }, 1, 2],
      [{ kind: 'object', keys: ['a', 1] }, 1, 2],
      [{ kind: 'object', keys: new Array(1) }],
      [{ kind: 'object', keys: Object.assign(new Array(2), { 0: 'a', extra: true }) }, 1, 2],
      [Object.setPrototypeOf({ kind: 'array', length: 0 }, { custom: true })],
      [{ kind: 'object', keys: ['a'] }],
      [{ kind: 'unknown' }],
      [{ kind: 'array', length: 0 }, null],
      [{ kind: 'array', length: 2 }, { kind: 'array', length: 1 }, 1],
      [{ kind: 'array', length: 2 }, 1],
    ]
    for (const value of invalid) expect(decodeWorkerJson(value)).toBeUndefined()
  })

  it('rejects custom arrays, invalid marker prototypes, and reflection failures without throwing', () => {
    const customWire = new (class Wire extends Array<unknown> {})(null)
    const forgedWire = [null]
    Object.setPrototypeOf(forgedWire, { custom: true })
    const symbolKey = Symbol('wire')
    const symbolMarker = { kind: 'array', length: 0, [symbolKey]: 1 }
    const hiddenMarker = { kind: 'array', length: 0 }
    Object.defineProperty(hiddenMarker, 'hidden', { value: true })
    const throwingWire = new Proxy([null], { ownKeys() { throw new Error('wire trap') } })
    const throwingMarker = new Proxy({ kind: 'array', length: 0 }, { ownKeys() { throw new Error('marker trap') } })
    expect(decodeWorkerJson(customWire)).toBeUndefined()
    expect(decodeWorkerJson(forgedWire)).toBeUndefined()
    expect(decodeWorkerJson([symbolMarker])).toBeUndefined()
    expect(decodeWorkerJson([hiddenMarker])).toBeUndefined()
    expect(decodeWorkerJson(throwingWire)).toBeUndefined()
    expect(decodeWorkerJson([throwingMarker])).toBeUndefined()
  })

  it('accepts foreign intrinsic arrays in object markers and rejects duplicate or discarded keys', () => {
    const marker = foreign('({ kind: "object", keys: ["answer"] })')
    expect(decodeWorkerJson([marker, 42])).toEqual({ answer: 42 })
    const markerKeys = ['answer']
    Object.defineProperty(markerKeys, 'extra', { value: true })
    expect(decodeWorkerJson([{ kind: 'object', keys: markerKeys }, 42])).toBeUndefined()
  })
})
