/** The Native present contribution registers and validates deliveries. */
import { describe, expect, it } from 'vitest'
import { plugin } from '../src/native.ts'

describe('native present', () => {
  it('declares the present tool and the services it needs', () => {
    expect(plugin.name).toBe('@redspark/rsh-tool-present')
    expect(plugin.targets).toEqual(['host'])
    expect(plugin.requires).toEqual(['fs', 'tools'])
  })

  it('rejects a non-positive delivery limit at resolve time', () => {
    expect(() => plugin.resolve({ maxFiles: 0 })).toThrow('present requires a positive integer maxFiles')
    expect(() => plugin.resolve({ maxFiles: 2.5 })).toThrow('present requires a positive integer maxFiles')
  })

  it('accepts an omitted limit and uses the default', () => {
    expect(() => plugin.resolve({})).not.toThrow()
    expect(() => plugin.resolve(undefined)).not.toThrow()
  })

  it('installs exactly one tool registration', () => {
    const registered: unknown[] = []
    const context = {
      require: (name: string) => (name === 'tools'
        ? { registerValueTool: (tool: unknown) => { registered.push(tool); return () => Promise.resolve() } }
        : { lstat: async () => undefined, resolve: async () => ({}), stat: async () => ({ type: 'file' }) }),
      effect: (disposer: unknown) => disposer,
      scope: undefined,
    }
    const install = plugin.resolve({}) as (context: unknown) => void
    install(context)
    expect(registered).toHaveLength(1)
    expect((registered[0] as { schema: { name: string } }).schema.name).toBe('present')
  })
})
