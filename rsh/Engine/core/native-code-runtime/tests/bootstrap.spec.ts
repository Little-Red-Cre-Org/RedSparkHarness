/** In-process worker bootstrap coverage with controllable port and streams. */
import { describe, expect, it } from 'vitest'
import {
  LogBuffer,
  captureStreamWrites,
  makeBindingErrorClasses,
  makeConsoleShim,
  makeNamespaces,
  prepareCompletion,
  prepareException,
  runWorkerMain,
  wireReplies,
  type BootstrapPort,
  type PatchableStream,
  type PendingCall,
} from '../src/bootstrap.ts'
import type { ReplyMessage, WorkerBootData, WorkerToHost } from '../src/protocol.ts'
import { encodeWorkerJson } from '../src/worker-json.ts'

class FakePort implements BootstrapPort {
  readonly sent: WorkerToHost[] = []
  private listener: ((message: ReplyMessage) => void) | undefined
  failPosts: unknown = false
  replyToCall: (message: Extract<WorkerToHost, { type: 'call' }>) => ReplyMessage = message => ({
    type: 'reply', id: message.id, ok: true, value: encodeWorkerJson(null),
  })

  postMessage(message: WorkerToHost): void {
    if (this.failPosts) throw this.failPosts
    this.sent.push(message)
    if (message.type === 'call') {
      queueMicrotask(() => { this.receive(this.replyToCall(message)) })
    }
  }

  on(_event: 'message', listener: (message: ReplyMessage) => void): void {
    this.listener = listener
  }

  receive(message: ReplyMessage): void {
    this.listener?.(message)
  }
}

function testStream(): { readonly stream: PatchableStream; readonly writes: unknown[] } {
  const writes: unknown[] = []
  return {
    writes,
    stream: {
      write(chunk: unknown, ...rest: unknown[]): boolean {
        writes.push([chunk, ...rest])
        return false
      },
    },
  }
}

describe('LogBuffer', () => {
  it('counts the JSON array envelope and emits only the fitting prefix on overflow', () => {
    const emitted: string[] = []
    let limits = 0
    const logs = new LogBuffer(10, text => emitted.push(text), () => { limits++ })
    logs.push('ok')
    logs.push('abc')
    logs.push('ignored')
    expect(emitted).toEqual(['ok', 'a'])
    expect(logs.remainingOutputBytes()).toBe(0)
    expect(limits).toBe(1)
  })

  it('calls the limit callback when even an empty next JSON string does not fit', () => {
    const emitted: string[] = []
    let limits = 0
    const logs = new LogBuffer(5, text => emitted.push(text), () => { limits++ })
    logs.push('a')
    logs.push('b')
    expect(emitted).toEqual(['a'])
    expect(limits).toBe(1)
  })

  it('uses the optional no-op limit callback when output fits', () => {
    const emitted: string[] = []
    const logs = new LogBuffer(8, text => emitted.push(text))
    logs.push('x')
    logs.push('too long')
    expect(emitted).toEqual(['x'])
  })
})

describe('console and stream capture', () => {
  it('renders all console levels and restores stdout after callback forms settle', async () => {
    const emitted: string[] = []
    const logs = new LogBuffer(1024, text => emitted.push(text))
    const consoleShim = makeConsoleShim(logs)
    consoleShim.log('hello', { answer: 42 })
    consoleShim.info('info')
    consoleShim.warn('warn')
    consoleShim.error('error')
    consoleShim.debug('debug')
    expect(emitted).toEqual(['hello { answer: 42 }', 'info', 'warn', 'error', 'debug'])

    const { stream, writes } = testStream()
    const restore = captureStreamWrites(logs, stream)
    stream.write('text')
    await new Promise<void>((resolve, reject) => {
      stream.write(Buffer.from('buffer'), 'utf8', (error: Error | null | undefined) => {
        if (error) reject(error)
        else resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      stream.write('callback', (error: Error | null | undefined) => {
        if (error) reject(error)
        else resolve()
      })
    })
    expect(emitted.slice(-3)).toEqual(['text', 'buffer', 'callback'])
    restore()
    expect(stream.write('original')).toBe(false)
    expect(writes).toEqual([['original']])
  })
})

describe('completion and exception fragments', () => {
  it('accepts absent and lossless JSON completion and rejects invalid or oversized values', () => {
    expect(prepareCompletion(undefined, 20)).toEqual({})
    expect(prepareCompletion({ answer: 42 }, 64)).toEqual({ value: encodeWorkerJson({ answer: 42 }) })
    expect(prepareCompletion(() => {}, 64)).toEqual({
      error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
    })
    expect(prepareCompletion({ answer: 42 }, 2, 12)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 12 bytes' },
    })
    const hostile = new Proxy({}, { ownKeys() { throw new Error('trap') } })
    expect(prepareCompletion(hostile, 64)).toEqual({
      error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
    })
  })

  it('bounds thrown messages and replaces values that cannot be rendered', () => {
    expect(prepareException(new Error('broken'), 4096)).toMatchObject({ error: { kind: 'exception' } })
    expect(prepareException('plain failure', 1024)).toEqual({ error: { kind: 'exception', message: 'plain failure' } })
    const noStack = new Error('no stack')
    Object.defineProperty(noStack, 'stack', { value: undefined })
    expect(prepareException(noStack, 1024)).toEqual({ error: { kind: 'exception', message: 'no stack' } })
    const unreadable = Object.create(Error.prototype) as Error
    Object.defineProperty(unreadable, 'stack', { get() { throw new Error('stack trap') } })
    expect(prepareException(unreadable, 1024)).toEqual({
      error: { kind: 'exception', message: 'program threw an unrenderable value' },
    })
    const unstringifiable = { toString() { throw new Error('toString trap') } }
    expect(prepareException(unstringifiable, 1024)).toEqual({
      error: { kind: 'exception', message: 'program threw an unrenderable value' },
    })
    expect(prepareException('too long', 2, 30)).toEqual({
      error: { kind: 'output-limit', message: 'outer output exceeded 30 bytes' },
    })
  })
})

describe('binding bridge', () => {
  const data: Pick<WorkerBootData, 'namespaces'> = {
    namespaces: [
      { global: 'tools', names: ['__proto__', 'constructor', 'invoke'], errorClass: { name: 'BindingError', memberNameProperty: 'member' } },
      { global: 'plain', names: ['run'] },
    ],
  }

  it('builds null-prototype namespaces and resolves or rejects each call once', async () => {
    const port = new FakePort()
    const pending = new Map<number, PendingCall>()
    const errorClasses = makeBindingErrorClasses(data)
    const namespaces = makeNamespaces(data, port, pending, { value: 1 }, errorClasses)
    wireReplies(port, pending)
    const tools = namespaces[0]!
    expect(Object.getPrototypeOf(tools)).toBeNull()
    expect(Object.hasOwn(tools, '__proto__')).toBe(true)
    expect(Object.hasOwn(tools, 'constructor')).toBe(true)
    expect(errorClasses.get('plain')).toBeUndefined()

    const invoke = tools.invoke as (args: unknown) => Promise<unknown>
    const resolved = invoke({ input: 'x' })
    expect(port.sent[0]).toMatchObject({ type: 'call', id: 1, global: 'tools', name: 'invoke' })
    port.receive({ type: 'reply', id: 1, ok: true, value: encodeWorkerJson({ accepted: true }) })
    await expect(resolved).resolves.toEqual({ accepted: true })
    port.receive({ type: 'reply', id: 1, ok: false, message: 'late duplicate' })
    expect(pending.size).toBe(0)

    const rejected = invoke({ input: 'y' })
    port.receive({ type: 'reply', id: 2, ok: false, message: 'denied' })
    await expect(rejected).rejects.toMatchObject({ name: 'BindingError', member: 'invoke', message: 'denied' })

    const plain = namespaces[1]!.run as (args: unknown) => Promise<unknown>
    const malformed = plain(null)
    port.receive({ type: 'reply', id: 3, ok: true, value: [{}] as never })
    await expect(malformed).rejects.toThrow('binding resolution must be lossless JSON')
    const ordinaryFailure = plain(null)
    port.receive({ type: 'reply', id: 4, ok: false, message: 'plain denied' })
    await expect(ordinaryFailure).rejects.toMatchObject({ name: 'Error', message: 'plain denied' })
  })

  it('rejects lossy arguments and contains port post failures with the declared binding error', async () => {
    const port = new FakePort()
    const pending = new Map<number, PendingCall>()
    const namespaces = makeNamespaces(data, port, pending, { value: 1 })
    const invoke = namespaces[0]!.invoke as (args: unknown) => Promise<unknown>
    await expect(invoke(() => {})).rejects.toMatchObject({ name: 'BindingError', member: 'invoke' })
    const hostile = new Proxy({}, { ownKeys() { throw new Error('trap') } })
    await expect(invoke(hostile)).rejects.toMatchObject({ name: 'BindingError', member: 'invoke' })
    expect(port.sent).toEqual([])

    port.failPosts = new Error('port exploded')
    const postError: unknown = await invoke({ ok: true }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(postError).toBeInstanceOf(Error)
    if (!(postError instanceof Error)) throw new Error('expected binding post failure')
    expect(postError.name).toBe('BindingError')
    expect((postError as Error & { member: string }).member).toBe('invoke')
    expect(postError.message).toContain('port exploded')
    expect(pending.size).toBe(0)

    port.failPosts = 'raw port failure'
    const rawPostError: unknown = await invoke({ ok: true }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rawPostError).toBeInstanceOf(Error)
    if (!(rawPostError instanceof Error)) throw new Error('expected raw binding post failure')
    expect(rawPostError.name).toBe('BindingError')
    expect((rawPostError as Error & { member: string }).member).toBe('invoke')
    expect(rawPostError.message).toContain('raw port failure')
    expect(pending.size).toBe(0)
  })
})

describe('runWorkerMain', () => {
  const boot = (code: string, maxOutputBytes = 1024): WorkerBootData => ({
    code,
    namespaces: [{
      global: 'tools', names: ['echo'],
      errorClass: { name: 'BindingError', memberNameProperty: 'member' },
    }, { global: 'plain', names: ['noop'] }],
    maxOutputBytes,
  })

  it('runs an async program, captures writes, and bridges a lossless binding call', async () => {
    const port = new FakePort()
    port.replyToCall = message => ({
      type: 'reply', id: message.id, ok: true, value: encodeWorkerJson({ echoed: true }),
    })
    const stdout = testStream()
    const stderr = testStream()
    await runWorkerMain(port, boot([
      'console.log("before", { answer: 42 })',
      'const result = await tools.echo({ input: "x" })',
      'return result',
    ].join('\n')), { stdout: stdout.stream, stderr: stderr.stream })
    expect(port.sent.filter(message => message.type === 'call')).toHaveLength(1)
    expect(port.sent.filter(message => message.type === 'log').map(message => message.type === 'log' ? message.text : ''))
      .toEqual(['before { answer: 42 }'])
    expect(port.sent.at(-1)).toEqual({ type: 'done', value: encodeWorkerJson({ echoed: true }) })
  })

  it('returns exception, invalid-output, and output-limit terminal messages', async () => {
    const stdout = testStream()
    const stderr = testStream()
    const thrown = new FakePort()
    await runWorkerMain(thrown, boot('throw "program failed"'), { stdout: stdout.stream, stderr: stderr.stream })
    expect(thrown.sent.at(-1)).toMatchObject({ type: 'done', error: { kind: 'exception', message: 'program failed' } })

    const invalid = new FakePort()
    await runWorkerMain(invalid, boot('return () => {}'), { stdout: stdout.stream, stderr: stderr.stream })
    expect(invalid.sent.at(-1)).toEqual({
      type: 'done', error: { kind: 'invalid-output', message: 'program completion must be lossless JSON' },
    })

    const limited = new FakePort()
    await runWorkerMain(limited, boot('console.log("oversized")', 5), { stdout: stdout.stream, stderr: stderr.stream })
    expect(limited.sent.some(message => message.type === 'output-limit')).toBe(true)
    expect(limited.sent.at(-1)).toEqual({ type: 'done' })
  })
})
