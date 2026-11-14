import { describe, expect, it } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import { plugin } from '../src/native.ts'
import { PythonProcessRuntime } from '../src/runtime.ts'

async function install(config: unknown): Promise<{ runtime: PythonProcessRuntime; owned: Array<() => void | Promise<void>> }> {
  const owned: Array<() => void | Promise<void>> = []
  let runtime: PythonProcessRuntime | undefined
  const activate = plugin.resolve(config)
  await activate({
    own(dispose) { owned.push(dispose) },
    provide(_key, value) { runtime = value as PythonProcessRuntime },
  } as NativeContext)
  if (!(runtime instanceof PythonProcessRuntime)) throw new Error('native python runtime was not provided')
  return { runtime, owned }
}

describe('native python code runtime', () => {
  it('rejects a non-positive cap before providing the runtime', async () => {
    const activate = plugin.resolve({ cpuSeconds: 0 })
    await expect(activate({ own() {}, provide() {} } as unknown as NativeContext)).rejects.toThrow(/cpuSeconds must be a positive number/)
  })

  it('fills defaults when the installation config is omitted', async () => {
    const { runtime } = await install(undefined)
    const result = await runtime.run({ program: 'return 1', bindings: [] })
    expect(result.value).toBe(1)
    expect(result.error).toBeUndefined()
    await runtime.dispose()
  }, 30_000)

  it('notifies a successful stop before the run resolves, and a second dispose joins the first', async () => {
    const { runtime, owned } = await install({})
    let resolved = false
    let notifiedBeforeResolve = false
    let failure: unknown = 'unset'
    const result = await runtime.run({
      program: 'return 1',
      bindings: [],
      onStop(error) {
        notifiedBeforeResolve = !resolved
        failure = error
      },
    }).then((value) => {
      resolved = true
      return value
    })
    expect(result.value).toBe(1)
    expect(failure).toBeUndefined()
    expect(notifiedBeforeResolve).toBe(true)
    await runtime.dispose()
    await owned[0]?.()
    await expect(runtime.run({ program: 'return 1', bindings: [] })).rejects.toThrow('run() after disposal')
  }, 30_000)

  it('does not notify a request that returns before spawn', async () => {
    const { runtime } = await install({})
    const signal = AbortSignal.abort()
    let stops = 0
    const result = await runtime.run({
      program: 'return 1',
      bindings: [],
      signal,
      onStop() { stops += 1 },
    })
    expect(result.error?.kind).toBe('abort')
    expect(stops).toBe(0)
    await runtime.dispose()
  }, 30_000)

  it('notifies an abort after the child has started', async () => {
    const { runtime } = await install({})
    const controller = new AbortController()
    const stops: Array<string | undefined> = []
    const pending = runtime.run({
      program: 'import time\nwhile True:\n    time.sleep(0.05)',
      bindings: [],
      signal: controller.signal,
      onStop(failure) { stops.push(failure?.kind) },
    })
    controller.abort()
    const result = await pending
    expect(result.error?.kind).toBe('abort')
    expect(stops).toEqual(['abort'])
    await runtime.dispose()
  }, 30_000)

  it('rejects the run when the stop callback throws', async () => {
    const { runtime } = await install({})
    await expect(runtime.run({
      program: 'return 1',
      bindings: [],
      onStop() { throw new Error('stop failed') },
    })).rejects.toThrow('stop failed')
    await runtime.dispose()
  }, 30_000)
})
