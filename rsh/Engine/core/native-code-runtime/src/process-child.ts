/** Private subprocess entry for a process-confined native code runtime. */
import { createInterface } from 'node:readline'
import { NativeWorkerThreadCodeRuntime, resolveNativeWorkerThreadConfig } from './worker-thread.ts'
import { snapshotCodeJsonValue } from './worker-json.ts'
import type { CodeBindingNamespace, CodeJsonValue, CodeRunResult } from './types.ts'

interface StartFrame {
  type: 'start'
  program: string
  config: ReturnType<typeof resolveNativeWorkerThreadConfig>
  namespaces: Array<{ global: string; names: string[]; errorClass?: CodeBindingNamespace['errorClass'] }>
}

interface ReplyFrame {
  type: 'reply'
  id: number
  ok: boolean
  value?: CodeJsonValue
  message?: string
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const pending = new Map<number, { resolve(value: CodeJsonValue): void; reject(error: Error): void }>()
let nextId = 1
let started = false

function write(frame: object): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(frame)}\n`, (error) => { if (error) reject(error); else resolve() })
  })
}

function binding(global: string, name: string): (args: unknown) => Promise<CodeJsonValue> {
  return args => new Promise((resolve, reject) => {
    const value = snapshotCodeJsonValue(args)
    if (value === undefined) {
      reject(new Error('binding arguments must be lossless JSON'))
      return
    }
    const id = nextId++
    pending.set(id, { resolve, reject })
    void write({ type: 'call', id, global, name, args: value }).catch((error: unknown) => {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

function reply(frame: ReplyFrame): void {
  const call = pending.get(frame.id)
  if (call === undefined) return
  pending.delete(frame.id)
  if (frame.ok && frame.value !== undefined) call.resolve(frame.value)
  else call.reject(new Error(frame.message ?? 'binding failed'))
}

async function run(frame: StartFrame): Promise<void> {
  const runtime = new NativeWorkerThreadCodeRuntime(resolveNativeWorkerThreadConfig(frame.config))
  try {
    const bindings: CodeBindingNamespace[] = frame.namespaces.map(namespace => ({
      global: namespace.global,
      functions: Object.fromEntries(namespace.names.map(name => [name, binding(namespace.global, name)])),
      ...namespace.errorClass === undefined ? {} : { errorClass: namespace.errorClass },
    }))
    const result: CodeRunResult = await runtime.run({ program: frame.program, bindings })
    await write({ type: 'done', result })
  } catch (error: unknown) {
    await write({ type: 'misuse', message: error instanceof Error ? error.message : String(error) })
  } finally {
    await runtime.dispose()
    input.close()
    process.stdin.pause()
  }
}

function parseFrame(line: string): StartFrame | ReplyFrame {
  const raw: unknown = JSON.parse(line)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('frame must be an object')
  const frame = raw as Record<string, unknown>
  if (frame.type === 'start') {
    if (typeof frame.program !== 'string' || !Array.isArray(frame.namespaces)) throw new Error('invalid start frame')
    const namespaces = frame.namespaces.map((rawNamespace: unknown) => {
      if (typeof rawNamespace !== 'object' || rawNamespace === null || Array.isArray(rawNamespace)) {
        throw new Error('invalid binding namespace')
      }
      const namespace = rawNamespace as Record<string, unknown>
      if (typeof namespace.global !== 'string' || !Array.isArray(namespace.names)
        || !namespace.names.every((name: unknown) => typeof name === 'string')) throw new Error('invalid binding names')
      let errorClass: CodeBindingNamespace['errorClass']
      if (namespace.errorClass !== undefined) {
        if (typeof namespace.errorClass !== 'object' || namespace.errorClass === null || Array.isArray(namespace.errorClass)) {
          throw new Error('invalid binding error class')
        }
        const fields = namespace.errorClass as Record<string, unknown>
        if (typeof fields.name !== 'string' || typeof fields.memberNameProperty !== 'string') throw new Error('invalid binding error fields')
        errorClass = { name: fields.name, memberNameProperty: fields.memberNameProperty }
      }
      return { global: namespace.global, names: namespace.names, ...errorClass === undefined ? {} : { errorClass } }
    })
    return { type: 'start', program: frame.program, namespaces, config: resolveNativeWorkerThreadConfig(frame.config) }
  }
  if (frame.type !== 'reply' || typeof frame.id !== 'number' || !Number.isSafeInteger(frame.id) || frame.id <= 0
    || typeof frame.ok !== 'boolean') throw new Error('invalid reply frame')
  if (frame.ok) {
    const value = snapshotCodeJsonValue(frame.value)
    if (value === undefined) throw new Error('invalid binding reply value')
    return { type: 'reply', id: frame.id, ok: true, value }
  }
  if (typeof frame.message !== 'string') throw new Error('invalid binding failure message')
  return { type: 'reply', id: frame.id, ok: false, message: frame.message }
}

function failed(error: unknown): void {
  process.stderr.write(`native-code-runtime child protocol error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
  input.close()
  process.stdin.pause()
}

input.on('line', (line: string) => {
  try {
    const frame = parseFrame(line)
    if (!started) {
      if (frame.type !== 'start') throw new Error('expected start frame')
      started = true
      void run(frame).catch(failed)
    } else {
      if (frame.type !== 'reply') throw new Error('expected reply frame')
      reply(frame)
    }
  } catch (error: unknown) {
    failed(error)
  }
})
input.once('error', failed)
