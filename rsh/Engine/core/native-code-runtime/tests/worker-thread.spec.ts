/** Deterministic host-side worker lifecycle and untrusted-message tests. */
import { EventEmitter } from 'node:events'
import type { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeBindingNamespace, CodeJsonValue, CodeRunRequest } from '../src/types.ts'
import { encodeWorkerJson } from '../src/worker-json.ts'
import { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from '../src/worker-thread.ts'

const state = vi.hoisted(() => ({ workers: [] as unknown[], options: [] as unknown[] }))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  class FakeWorker extends EventEmitter {
    readonly stdout = new PassThrough()
    readonly stderr = new PassThrough()
    readonly posts: unknown[] = []
    readonly performance = { eventLoopUtilization: () => ({ active: this.activeMs, idle: 0 }) }
    activeMs = 0
    closePipesWithError = false
    postFailure: unknown
    terminated = false
    terminateCalls = 0

    constructor(_path: string, options: unknown) {
      super()
      state.workers.push(this)
      state.options.push(options)
    }

    postMessage(message: unknown): void {
      if (this.postFailure !== undefined) throw this.postFailure
      this.posts.push(message)
    }

    send(message: unknown): void { this.emit('message', message) }
    fail(error: Error): void { this.emit('error', error) }
    exit(code: number): void { this.emit('exit', code) }

    terminate(): Promise<number> {
      this.terminateCalls++
      this.terminated = true
      if (this.closePipesWithError) this.stdout.destroy(new Error('pipe ended with error'))
      else this.stdout.end()
      this.stderr.end()
      return new Promise(resolve => setImmediate(() => {
        this.emit('exit', 0)
        resolve(0)
      }))
    }
  }
  return { Worker: FakeWorker }
})

interface ControlledWorker extends EventEmitter {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly posts: unknown[]
  readonly performance: { eventLoopUtilization(): { active: number; idle: number } }
  activeMs: number
  closePipesWithError: boolean
  postFailure: unknown
  terminated: boolean
  terminateCalls: number
  send(message: unknown): void
  fail(error: Error): void
  exit(code: number): void
  terminate(): Promise<number>
}

function workers(): ControlledWorker[] { return state.workers as ControlledWorker[] }
function latestWorker(): ControlledWorker {
  const worker = workers().at(-1)
  if (worker === undefined) throw new Error('worker fixture did not spawn')
  return worker
}
function runtime(config: unknown = { computeMs: 10_000, maxWallMs: 10_000 }): NativeWorkerThreadCodeRuntime {
  return new NativeWorkerThreadCodeRuntime(resolveNativeWorkerThreadConfig(config))
}
function request(overrides: Partial<CodeRunRequest> = {}): CodeRunRequest {
  return { program: 'return 1', bindings: [], ...overrides }
}
async function flush(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)) }

beforeEach(() => {
  state.workers.length = 0
  state.options.length = 0
})

afterEach(async () => {
  for (const worker of workers()) {
    if (!worker.terminated) await worker.terminate()
  }
})

describe('native worker-thread configuration', () => {
  it('resolves explicit defaults and validates every profile field', () => {
    expect(resolveNativeWorkerThreadConfig(undefined)).toEqual({
      computeMs: 60_000,
      maxWallMs: 600_000,
      maxOutputBytes: 67_108_864,
      maxOldGenerationSizeMb: 512,
    })
    expect(resolveNativeWorkerThreadConfig({
      computeMs: 1.5, maxWallMs: 2, maxOutputBytes: 4, maxOldGenerationSizeMb: 16,
    })).toEqual({ computeMs: 1.5, maxWallMs: 2, maxOutputBytes: 4, maxOldGenerationSizeMb: 16 })
    expect(resolveNativeWorkerThreadConfig({ maxWallMs: 2_147_483_647 }).maxWallMs).toBe(2_147_483_647)

    for (const value of [null, 'bad', 1, []]) {
      expect(() => resolveNativeWorkerThreadConfig(value)).toThrow('configuration must be an object')
    }
    expect(() => resolveNativeWorkerThreadConfig({ other: 1 })).toThrow('unknown configuration field other')
    for (const field of ['computeMs', 'maxWallMs', 'maxOutputBytes', 'maxOldGenerationSizeMb']) {
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
        expect(() => resolveNativeWorkerThreadConfig({ [field]: value })).toThrow(`${field} must be a positive finite number`)
      }
    }
    expect(() => resolveNativeWorkerThreadConfig({ maxOutputBytes: 3 })).toThrow('at least 4')
    expect(() => resolveNativeWorkerThreadConfig({ maxOutputBytes: 4.5 })).toThrow('at least 4')
    expect(() => resolveNativeWorkerThreadConfig({ maxWallMs: 2_147_483_648 })).toThrow('at most 2147483647')
  })
})

describe('NativeWorkerThreadCodeRuntime request admission', () => {
  it('rejects invalid namespace and typed-error declarations before spawning', async () => {
    const instance = runtime()
    const invalid: CodeBindingNamespace[][] = [
      [{ global: '$tools', functions: {} }],
      [{ global: 'class', functions: {} }],
      [{ global: 'console', functions: {} }],
      [{ global: 'tools', functions: {} }, { global: 'tools', functions: {} }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'Bad Name', memberNameProperty: 'member' } }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'class', memberNameProperty: 'member' } }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'console', memberNameProperty: 'member' } }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'tools', memberNameProperty: 'member' } }],
      [
        { global: 'tools', functions: {}, errorClass: { name: 'Failure', memberNameProperty: 'member' } },
        { global: 'other', functions: {}, errorClass: { name: 'Failure', memberNameProperty: 'member' } },
      ],
      [{ global: 'tools', functions: {}, errorClass: { name: 'Failure', memberNameProperty: '' } }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'Failure', memberNameProperty: '__proto__' } }],
      [{ global: 'tools', functions: {}, errorClass: { name: 'Failure', memberNameProperty: '__x__' } }],
    ]
    const expected = [
      'not a usable identifier', 'not a usable identifier', 'reserved binding global', 'duplicate binding global',
      'not a usable identifier', 'not a usable identifier', 'reserved binding global', 'duplicate injected global',
      'duplicate injected global', 'is not usable', 'is not usable', 'is not usable',
    ]
    for (let index = 0; index < invalid.length; index++) {
      await expect(instance.run(request({ bindings: invalid[index]! }))).rejects.toThrow(expected[index])
    }
    expect(workers()).toHaveLength(0)
    await instance.dispose()
  })

  it('returns pre-worker abort and TypeScript parse failures as run outcomes', async () => {
    const instance = runtime({ maxOutputBytes: 100 })
    const controller = new AbortController()
    controller.abort('before spawn')
    await expect(instance.run(request({ signal: controller.signal }))).resolves.toEqual({
      logs: [], error: { kind: 'abort', message: 'before spawn' },
    })
    await expect(instance.run(request({ program: 'const = malformed' }))).resolves.toMatchObject({
      logs: [], error: { kind: 'exception' },
    })
    expect(workers()).toHaveLength(0)
    await instance.dispose()
    await expect(instance.run(request())).rejects.toThrow('run() after disposal')
  })
})

describe('worker result and output accounting', () => {
  it('starts hermetic workers and accepts absent or decoded completion values', async () => {
    const instance = runtime({ computeMs: 5_000, maxWallMs: 5_000, maxOutputBytes: 256, maxOldGenerationSizeMb: 64 })
    const absent = instance.run(request({ bindings: [{ global: 'tools', functions: {}, errorClass: { name: 'BindingError', memberNameProperty: 'member' } }] }))
    const first = latestWorker()
    expect(state.options.at(-1)).toMatchObject({ env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 } })
    first.send({ type: 'done' })
    await expect(absent).resolves.toEqual({ logs: [] })

    const present = instance.run(request())
    const second = latestWorker()
    second.send({ type: 'log', text: 'worker log' })
    second.send({ type: 'done', value: encodeWorkerJson({ answer: 42 }) })
    await expect(present).resolves.toEqual({ logs: ['worker log'], value: { answer: 42 } })
    await instance.dispose()
  })

  it('drops malformed worker frames and reports invalid or oversized completion payloads', async () => {
    const instance = runtime({ maxOutputBytes: 48 })
    const run = instance.run(request())
    const worker = latestWorker()
    for (const raw of [
      null,
      4,
      { type: 'call', id: 'bad', global: 'tools', name: 'x', args: [] },
      { type: 'log', text: 4 },
      { type: 'done', error: null },
      { type: 'done', error: { kind: 'unknown', message: 'bad' } },
      { type: 'done', error: { kind: 'exception', message: 4 } },
      { type: 'other' },
    ]) worker.send(raw)
    worker.send({ type: 'done', value: [{}] })
    await expect(run).resolves.toEqual({
      logs: [], error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
    })

    const workerLimit = instance.run(request())
    latestWorker().send({ type: 'output-limit' })
    await expect(workerLimit).resolves.toMatchObject({ logs: [], error: { kind: 'output-limit' } })

    const tooLarge = instance.run(request())
    latestWorker().send({ type: 'done', value: encodeWorkerJson('x'.repeat(100)) })
    await expect(tooLarge).resolves.toMatchObject({ logs: [], error: { kind: 'output-limit' } })

    const failed = instance.run(request())
    latestWorker().send({ type: 'done', error: { kind: 'exception', message: 'ordinary failure' } })
    await expect(failed).resolves.toEqual({ logs: [], error: { kind: 'exception', message: 'ordinary failure' } })

    const tooLongFailure = instance.run(request())
    latestWorker().send({ type: 'done', error: { kind: 'exception', message: 'x'.repeat(100) } })
    await expect(tooLongFailure).resolves.toMatchObject({ logs: [], error: { kind: 'output-limit' } })
    await instance.dispose()
  })

  it('retains a fitting stdout prefix and caps oversized stderr output', async () => {
    const instance = runtime({ maxOutputBytes: 50 })
    const run = instance.run(request())
    const worker = latestWorker()
    worker.stdout.write('ok')
    worker.stderr.write('x'.repeat(100))
    worker.stdout.write('after overflow')
    worker.send({ type: 'done' })
    await expect(run).resolves.toMatchObject({
      logs: ['ok', 'x'.repeat(9)], error: { kind: 'output-limit', message: 'outer output exceeded 50 bytes' },
    })

    const tiny = runtime({ maxOutputBytes: 4 })
    const tinyRun = tiny.run(request())
    const tinyWorker = latestWorker()
    tinyWorker.send({ type: 'log', text: 'x' })
    await expect(tinyRun).resolves.toMatchObject({ logs: [], error: { kind: 'output-limit' } })
    await Promise.all([instance.dispose(), tiny.dispose()])
  })

  it('drains already-ended and erroring worker pipes while terminating', async () => {
    const instance = runtime()
    const alreadyEnded = instance.run(request())
    const first = latestWorker()
    first.stdout.write('stdout')
    first.stderr.write('stderr')
    first.stdout.end()
    first.stderr.end()
    first.send({ type: 'done' })
    await expect(alreadyEnded).resolves.toEqual({ logs: ['stdout', 'stderr'] })

    const erroring = instance.run(request())
    const second = latestWorker()
    second.closePipesWithError = true
    second.send({ type: 'done' })
    await expect(erroring).resolves.toEqual({ logs: [] })
    await instance.dispose()
  })
})

describe('worker binding calls', () => {
  it('answers each valid call once and contains unknown names and malformed arguments', async () => {
    let calls = 0
    const inherited = Object.assign(
      Object.create({ hidden: async () => true }) as Record<string, (args: unknown) => Promise<CodeJsonValue>>,
      { echo: async (args: unknown) => { calls++; return { received: args } } },
    )
    const instance = runtime()
    const run = instance.run(request({ bindings: [{ global: 'tools', functions: inherited }] }))
    const worker = latestWorker()
    worker.send({ type: 'call', id: 1, global: 'tools', name: 'echo', args: encodeWorkerJson({ value: 42 }) })
    worker.send({ type: 'call', id: 1, global: 'tools', name: 'echo', args: encodeWorkerJson({ value: 42 }) })
    worker.send({ type: 'call', id: 2, global: 'tools', name: 'hidden', args: encodeWorkerJson(null) })
    worker.send({ type: 'call', id: 3, global: 'tools', name: 'echo', args: [{}] })
    await flush()
    expect(calls).toBe(1)
    expect(worker.posts).toEqual([
      { type: 'reply', id: 2, ok: false, message: 'unknown binding "tools.hidden"' },
      { type: 'reply', id: 3, ok: false, message: 'binding arguments must be lossless JSON' },
      { type: 'reply', id: 1, ok: true, value: encodeWorkerJson({ received: { value: 42 } }) },
    ])
    worker.send({ type: 'done' })
    await expect(run).resolves.toEqual({ logs: [] })
    await instance.dispose()
  })

  it('returns binding failures as rejected program calls without crashing the host', async () => {
    const instance = runtime()
    const run = instance.run(request({ bindings: [{
      global: 'tools',
      functions: {
        error: async () => { throw new Error('binding failed') },
        value: async () => undefined as never,
        raw: async () => { throw 'raw binding failure' },
      },
    }] }))
    const worker = latestWorker()
    for (const [id, name] of [[1, 'error'], [2, 'value'], [3, 'raw']] as const) {
      worker.send({ type: 'call', id, global: 'tools', name, args: encodeWorkerJson(null) })
    }
    await flush()
    const replies = worker.posts as Array<{ type: string; id: number; ok: boolean; message?: string }>
    expect(replies.sort((left, right) => left.id - right.id)).toEqual([
      { type: 'reply', id: 1, ok: false, message: 'binding failed' },
      { type: 'reply', id: 2, ok: false, message: 'binding resolution must be lossless JSON' },
      { type: 'reply', id: 3, ok: false, message: 'raw binding failure' },
    ])
    worker.send({ type: 'done' })
    await expect(run).resolves.toEqual({ logs: [] })
    await instance.dispose()
  })

  it('ignores late worker calls and binding replies after the run has settled', async () => {
    let resolveBinding!: (value: CodeJsonValue) => void
    let calls = 0
    const instance = runtime()
    const run = instance.run(request({ bindings: [{
      global: 'tools',
      functions: { wait: () => { calls++; return new Promise<CodeJsonValue>((resolve) => { resolveBinding = resolve }) } },
    }] }))
    const worker = latestWorker()
    worker.send({ type: 'call', id: 1, global: 'tools', name: 'wait', args: encodeWorkerJson(null) })
    worker.send({ type: 'done' })
    worker.send({ type: 'call', id: 2, global: 'tools', name: 'wait', args: encodeWorkerJson(null) })
    await expect(run).resolves.toEqual({ logs: [] })
    resolveBinding('late')
    await flush()
    expect(calls).toBe(1)
    expect(worker.posts).toEqual([])
    await instance.dispose()
  })
})

describe('worker failure, cancellation, and teardown', () => {
  it('reports worker errors and early exit, then ignores duplicate terminal events', async () => {
    const instance = runtime()
    const errored = instance.run(request())
    const first = latestWorker()
    first.fail(new Error('worker exploded'))
    await expect(errored).resolves.toEqual({
      logs: [], error: { kind: 'worker-exit', message: 'worker error: worker exploded' },
    })
    first.exit(9)

    const exited = instance.run(request())
    latestWorker().exit(7)
    await expect(exited).resolves.toEqual({
      logs: [], error: { kind: 'worker-exit', message: 'worker exited with code 7 before completing' },
    })
    await instance.dispose()
  })

  it('enforces measured busy time and the wall-clock ceiling', async () => {
    const compute = runtime({ computeMs: 1, maxWallMs: 1_000 })
    const computeRun = compute.run(request())
    latestWorker().activeMs = 2
    await expect(computeRun).resolves.toMatchObject({ logs: [], error: { kind: 'timeout', message: 'compute budget exhausted (1ms busy)' } })
    await compute.dispose()

    const wall = runtime({ computeMs: 1_000, maxWallMs: 10 })
    const wallRun = wall.run(request())
    await expect(wallRun).resolves.toMatchObject({ logs: [], error: { kind: 'timeout', message: 'wall-clock ceiling reached (10ms)' } })
    await wall.dispose()
  }, 5_000)

  it('settles caller cancellation and Host disposal after workers reach quiescence', async () => {
    const instance = runtime()
    const controller = new AbortController()
    const cancelled = instance.run(request({ signal: controller.signal }))
    const worker = latestWorker()
    controller.abort(new Error('caller stopped'))
    await expect(cancelled).resolves.toMatchObject({ logs: [], error: { kind: 'abort', message: 'Error: caller stopped' } })
    expect(worker.terminated).toBe(true)

    const pending = instance.run(request())
    const pendingWorker = latestWorker()
    await instance.dispose()
    await expect(pending).resolves.toEqual({ logs: [], error: { kind: 'abort', message: 'runtime disposed' } })
    expect(pendingWorker.terminated).toBe(true)
    await expect(instance.run(request())).rejects.toThrow('run() after disposal')
  })
})
