/** Native token-meter configuration accepts no settings. */
import { expect, it } from 'vitest'
import { plugin } from '../src/native.ts'

it.each([
  { kind: 'non-object', config: 0 },
  { kind: 'null', config: null },
  { kind: 'array', config: [] },
  { kind: 'nonempty object', config: { unexpected: true } },
])('accepts an empty object and rejects $kind configuration', ({ config }) => {
  expect(plugin.resolve(undefined)).toBeTypeOf('function')
  expect(plugin.resolve({})).toBeTypeOf('function')
  expect(() => plugin.resolve(config)).toThrow('token-meter: native configuration must be empty')
})
