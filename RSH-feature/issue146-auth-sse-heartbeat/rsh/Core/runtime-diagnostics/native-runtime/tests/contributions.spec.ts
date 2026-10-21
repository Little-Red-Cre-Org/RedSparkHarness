/** Scope visibility and exact registration ownership. */
import { expect, it } from 'vitest'
import { NativeContributions, NativeScope } from '../src/index.ts'

it('selects the nearest ancestor while isolating siblings and realms', () => {
  const root = new NativeScope()
  const left = new NativeScope(root)
  const right = new NativeScope(root)
  const registry = new NativeContributions<string>(root)
  registry.register('shared', 'root')
  const release = registry.register('shared', 'left', left)
  registry.register('private', 'left-only', left)
  expect([...registry.visible(new NativeScope(left))]).toEqual([['shared', 'left'], ['private', 'left-only']])
  expect([...registry.visible(right)]).toEqual([['shared', 'root']])
  expect(() => registry.register('alien', 'value', new NativeScope())).toThrow('outside the Provider realm')
  expect(() => registry.visible(new NativeScope())).toThrow('outside the Provider realm')
  expect(() => registry.register('shared', 'duplicate', left)).toThrow('duplicate contribution')
  release()
  expect(registry.visible(left).get('shared')).toBe('root')
})

it('keeps a stale disposer from deleting a replacement of the same object', () => {
  const root = new NativeScope()
  const registry = new NativeContributions<object>(root)
  const value = {}
  const stale = registry.register('value', value)
  stale()
  registry.register('value', value)
  stale()
  expect(registry.visible().get('value')).toBe(value)
  registry.clear()
  registry.register('value', value)
  stale()
  expect(registry.visible().get('value')).toBe(value)
})
