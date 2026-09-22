/** Event mode, ordering, error and scope semantics. */
import { expect, it } from 'vitest'
import { NativeScope, RuntimeEvents } from '../src/index.ts'

declare module '../src/events.ts' {
  interface NativeEvents {
    observed: { mode: 'sync'; args: [number]; result: undefined }
    flush: { mode: 'parallel'; args: []; result: undefined }
    stopping: { mode: 'serial'; args: []; result: undefined }
    request: { mode: 'waterfall'; args: [number]; result: number }
  }
}

it('filters ancestors and realms and removes only the owned listener', async () => {
  const events = new RuntimeEvents()
  const parent = new NativeScope()
  const child = new NativeScope(parent)
  const other = new NativeScope()
  const seen: string[] = []
  events.on(parent, 'observed', (n) => { seen.push(`parent:${n}`) })
  const off = events.on(child, 'observed', (n) => { seen.push(`child:${n}`) })
  events.on(other, 'observed', () => { throw new Error('unreachable realm') })
  events.emit(child, 'observed', 1)
  await off()
  await off()
  events.emit(child, 'observed', 2)
  expect(seen).toEqual(['parent:1', 'child:1', 'parent:2'])
})

it('propagates synchronous errors and stops serial delivery on failure', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  const seen: number[] = []
  events.on(scope, 'observed', () => { throw new Error('observation') })
  events.on(scope, 'observed', () => { seen.push(1) })
  expect(() =>{  events.emit(scope, 'observed', 1) }).toThrow('observation')
  events.on(scope, 'stopping', async () => { seen.push(2); throw new Error('stop') })
  events.on(scope, 'stopping', () => { seen.push(3) })
  await expect(events.serial(scope, 'stopping')).rejects.toThrow('stop')
  expect(seen).toEqual([2])
})

it('waits for outstanding parallel listeners before reporting a rejection', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  const pending = Promise.withResolvers<undefined>()
  let settled = false
  events.on(scope, 'flush', () => { throw new Error('flush failed') })
  events.on(scope, 'flush', async () => { await pending.promise; settled = true })
  const flushing = events.parallel(scope, 'flush')
  const failure = expect(flushing).rejects.toThrow('listeners failed')
  expect(settled).toBe(false)
  pending.resolve(undefined)
  await failure
  expect(settled).toBe(true)
})

it('requires explicit delegation and rejects repeated next calls', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  let terminalCalls = 0
  const terminal = () => { terminalCalls++; return 4 }
  const off = events.on(scope, 'request', n => n)
  expect(await events.waterfall(scope, 'request', terminal, 2)).toBe(2)
  expect(terminalCalls).toBe(0)
  await off()
  const delegate = events.on(scope, 'request', async (n, next) => n + await next())
  expect(await events.waterfall(scope, 'request', terminal, 2)).toBe(6)
  await delegate()
  events.on(scope, 'request', async (_n, next) => { await next(); return next() })
  await expect(events.waterfall(scope, 'request', terminal, 2)).rejects.toThrow('next() called twice')
  expect(terminalCalls).toBe(2)
})

it('closes admission and waits for an already executing callback', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let completed = false
  events.on(scope, 'flush', async () => { entered.resolve(undefined); await release.promise; completed = true })
  const delivery = events.parallel(scope, 'flush')
  await entered.promise
  const closing = events.close()
  expect(completed).toBe(false)
  expect(() =>{  events.emit(scope, 'observed', 0) }).toThrow('closed')
  expect(() => events.on(scope, 'observed', () => {})).toThrow('closed')
  release.resolve(undefined)
  await Promise.all([delivery, closing])
  expect(completed).toBe(true)
})

it('retains downstream completion when a waterfall callback starts next without awaiting it', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let completed = false
  events.on(scope, 'request', (_n, next) => { void next(); return 1 })
  const call = events.waterfall(scope, 'request', async () => {
    entered.resolve(undefined)
    await release.promise
    completed = true
    return 2
  }, 0)
  await entered.promise
  expect(completed).toBe(false)
  release.resolve(undefined)
  expect(await call).toBe(1)
  expect(completed).toBe(true)
})

it('preserves a waterfall listener recovery and its own failure after downstream settlement', async () => {
  const events = new RuntimeEvents()
  const scope = new NativeScope()
  const failure = new Error('downstream')
  const off = events.on(scope, 'request', async (_value, next) => {
    try { return await next() } catch { return 7 }
  })
  expect(await events.waterfall(scope, 'request', () => { throw failure }, 0)).toBe(7)
  await off()
  const outer = new Error('outer')
  events.on(scope, 'request', async (_value, next) => {
    try { await next() } finally { throw outer }
  })
  await expect(events.waterfall(scope, 'request', () => { throw failure }, 0)).rejects.toBe(outer)
})
