/** Process-confined native TypeScript code runtime. */
import { isAbsolute } from 'node:path'
import type { Writable } from 'node:stream'
import {
  nativeCodeRuntimeChildPath, resolveNativeWorkerThreadConfig,
  snapshotCodeJsonValue,
  type NativeCodeRuntime, type ResolvedNativeWorkerThreadCodeRuntimeConfig,
  type CodeBindingNamespace, type CodeJsonValue, type CodeRunFailure, type CodeRunRequest, type CodeRunResult,
} from '@deepseek-ai/dsh-native-code-runtime'
import { classifyRunnerFailure, isRunnerSpawnFailure, SandboxUnavailableError, type ProcessSandbox } from '@deepseek-ai/dsh-sandbox/native'
import type { SubprocessHandle, SubprocessOperations } from '@deepseek-ai/dsh-subprocess/native'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'

interface LiveRun {
  stop(failure: CodeRunFailure): void
  finished: Promise<void>
}

type ChildFrame =
  | { type: 'call'; id: number; global: string; name: string; args: CodeJsonValue }
  | { type: 'done'; result: CodeRunResult }
  | { type: 'misuse'; message: string }

function failure(kind: CodeRunFailure['kind'], message: string): CodeRunResult {
  return { logs: [], error: { kind, message } }
}

function writeFrame(stream: Writable, frame: object): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(frame)}\n`, (error) => { if (error) reject(error); else resolve() })
  })
}

function parseFrame(text: string): ChildFrame {
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('frame must be an object')
  const frame = raw as Record<string, unknown>
  if (frame.type === 'call') {
    if (!Number.isSafeInteger(frame.id) || (frame.id as number) <= 0 || typeof frame.global !== 'string' || typeof frame.name !== 'string') {
      throw new Error('invalid call frame')
    }
    const args = snapshotCodeJsonValue(frame.args)
    if (args === undefined) throw new Error('invalid call arguments')
    return { type: 'call', id: frame.id as number, global: frame.global, name: frame.name, args }
  }
  if (frame.type === 'misuse' && typeof frame.message === 'string') return { type: 'misuse', message: frame.message }
  if (frame.type === 'done') {
    if (typeof frame.result !== 'object' || frame.result === null || Array.isArray(frame.result)) throw new Error('invalid result frame')
    const result = frame.result as Record<string, unknown>
    if (!Array.isArray(result.logs) || !result.logs.every(value => typeof value === 'string')) throw new Error('invalid result logs')
    const value = result.value === undefined ? undefined : snapshotCodeJsonValue(result.value)
    if (result.value !== undefined && value === undefined) throw new Error('invalid result value')
    let error: CodeRunFailure | undefined
    if (result.error !== undefined) {
      if (typeof result.error !== 'object' || result.error === null || Array.isArray(result.error)) throw new Error('invalid result error')
      const fields = result.error as Record<string, unknown>
      if (!['exception', 'timeout', 'abort', 'worker-exit', 'invalid-output', 'output-limit'].includes(String(fields.kind))
        || typeof fields.message !== 'string') throw new Error('invalid result failure')
      error = { kind: fields.kind as CodeRunFailure['kind'], message: fields.message }
    }
    return { type: 'done', result: { logs: result.logs, ...value === undefined ? {} : { value }, ...error === undefined ? {} : { error } } }
  }
  throw new Error('unknown child frame')
}

/** Runs each program in a managed child whose complete process range carries the selected file policy. */
export class ProcessSandboxCodeRuntime implements NativeCodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'process-sandbox'
  private disposed = false
  private readonly live = new Set<LiveRun>()

  constructor(
    private readonly subprocess: SubprocessOperations,
    private readonly sandbox: ProcessSandbox,
    private readonly policy: NativeSandboxPolicy,
    private readonly config: ResolvedNativeWorkerThreadCodeRuntimeConfig,
  ) {}

  /** @returns completion after every owned process range has been terminated and observed. */
  async dispose(): Promise<void> {
    this.disposed = true
    const runs = [...this.live]
    for (const run of runs) run.stop({ kind: 'abort', message: 'runtime disposed' })
    await Promise.all(runs.map(run => run.finished))
  }

  /** @param request - one model program and the bindings it can call. @returns the bounded program outcome. */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) throw new Error('code-runtime-process-sandbox: run() after disposal')
    if (request.signal?.aborted) return failure('abort', String(request.signal.reason))
    const executionPolicy = this.policy.resolve()
    if (executionPolicy.mode === 'danger-full-access') {
      throw new Error('code-runtime-process-sandbox: confined policy required')
    }
    if (!isAbsolute(executionPolicy.workspaceRoot)) throw new Error('code-runtime-process-sandbox: workspace root must be absolute')
    const child = nativeCodeRuntimeChildPath()
    const sourceLoader = child.endsWith('.ts') ? ['--import', import.meta.resolve('tsx/esm')] : []
    const confined = this.sandbox.confine([process.execPath, ...sourceLoader, child], { ...executionPolicy, mode: executionPolicy.mode })
    const namespaces = request.bindings.map(namespace => ({
      global: namespace.global, names: Object.keys(namespace.functions),
      ...namespace.errorClass === undefined ? {} : { errorClass: namespace.errorClass },
    }))
    const start = { type: 'start', program: request.program, namespaces, config: this.config }
    let handle: SubprocessHandle
    try {
      handle = this.subprocess.spawn({
        argv: confined.argv, cwd: executionPolicy.workspaceRoot,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: this.config.maxOutputBytes } },
        graceMs: this.config.maxWallMs,
      })
    } catch (error: unknown) {
      if (isRunnerSpawnFailure(error, confined.argv[0], executionPolicy.workspaceRoot)) {
        throw new SandboxUnavailableError(executionPolicy.mode, String(error))
      }
      throw error
    }
    if (handle.stdin === undefined || handle.stdout === undefined) {
      handle.terminate()
      await handle.waitForExit()
      throw new Error('code-runtime-process-sandbox: subprocess provider did not supply protocol pipes')
    }
    const stdin = handle.stdin

    let override: CodeRunFailure | undefined
    let settled: ChildFrame | undefined
    let finishedResolve!: () => void
    const finished = new Promise<void>((resolve) => { finishedResolve = resolve })
    let notified = false
    const notificationFailures: unknown[] = []
    const notifyStop = (reason?: CodeRunFailure): void => {
      if (notified) return
      notified = true
      try { request.onStop?.(reason) }
      catch (error: unknown) { notificationFailures.push(error) }
    }
    const live: LiveRun = { finished, stop: (reason) => {
      if (!notified) {
        override ??= reason
        notifyStop(override)
      }
      handle.terminate()
    } }
    this.live.add(live)
    const onAbort = (): void => {
      if (!notified) live.stop({ kind: 'abort', message: String(request.signal?.reason) })
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    if (request.signal?.aborted) onAbort()
    const wallTimer = setTimeout(() => {
      live.stop({ kind: 'timeout', message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)` })
    }, this.config.maxWallMs)
    const bindings = new Map(request.bindings.map(namespace => [namespace.global, namespace] as const))
    const answered = new Set<number>()
    const pendingBindings = new Set<Promise<void>>()
    let pending = Buffer.alloc(0)
    const answer = (frame: Extract<ChildFrame, { type: 'call' }>): void => {
      if (answered.has(frame.id)) return
      answered.add(frame.id)
      const namespace: CodeBindingNamespace | undefined = bindings.get(frame.global)
      const fn = namespace && Object.hasOwn(namespace.functions, frame.name) ? namespace.functions[frame.name] : undefined
      const task = (async () => {
        let reply: object
        if (typeof fn !== 'function') {
          reply = { type: 'reply', id: frame.id, ok: false, message: `unknown binding ${JSON.stringify(`${frame.global}.${frame.name}`)}` }
        } else {
          try {
            const value = snapshotCodeJsonValue(await fn(frame.args))
            reply = value === undefined
              ? { type: 'reply', id: frame.id, ok: false, message: 'binding resolution must be lossless JSON' }
              : { type: 'reply', id: frame.id, ok: true, value }
          } catch (error: unknown) {
            reply = { type: 'reply', id: frame.id, ok: false, message: error instanceof Error ? error.message : String(error) }
          }
        }
        if (override === undefined && settled === undefined) {
          try {
            await writeFrame(stdin, reply)
          } catch {
            live.stop({ kind: 'worker-exit', message: 'code runtime protocol write failed' })
          }
        }
      })()
      pendingBindings.add(task)
      void task.then(() => { pendingBindings.delete(task) }, () => {
        // A rejected task stays owned until the final drain observes it.
      })
    }

    let primaryFailure: unknown
    try {
      await writeFrame(stdin, start)
      for await (const chunk of handle.stdout) {
        const bytes = chunk as Buffer
        let offset = 0
        for (let end = bytes.indexOf(10, offset); end >= 0; end = bytes.indexOf(10, offset)) {
          pending = Buffer.concat([pending, bytes.subarray(offset, end)])
          const line = pending.toString('utf8')
          pending = Buffer.alloc(0)
          const frame = parseFrame(line)
          if (settled !== undefined) throw new Error('code runtime sent a frame after completion')
          if (frame.type === 'call') answer(frame)
          else {
            settled = frame
            if (frame.type === 'done') notifyStop(frame.result.error)
            if (frame.type === 'misuse') notifyStop({ kind: 'worker-exit', message: frame.message })
          }
          offset = end + 1
        }
        pending = Buffer.concat([pending, bytes.subarray(offset)])
      }
      const outcome = await handle.done
      await handle.waitForExit()
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const fatal = classifyRunnerFailure(outcome.exitCode, stderr, confined.runnerFailureRules)
      if (fatal !== undefined) throw new SandboxUnavailableError(executionPolicy.mode, fatal.detail)
      if (override !== undefined) return failure(override.kind, override.message)
      if (settled?.type === 'misuse') throw new Error(settled.message)
      if (settled?.type === 'done' && outcome.exitCode === 0) return settled.result
      const message = `code runtime process exited with code ${outcome.exitCode} before completing${stderr === '' ? '' : `: ${stderr.trim()}`}`
      notifyStop({ kind: 'worker-exit', message })
      return failure('worker-exit', message)
    } catch (error: unknown) {
      notifyStop({ kind: 'worker-exit', message: error instanceof Error ? error.message : String(error) })
      handle.terminate()
      try { await handle.done } catch { /* The original protocol or spawn failure remains authoritative. */ }
      await handle.waitForExit()
      if (override !== undefined) return failure(override.kind, override.message)
      if (error instanceof SandboxUnavailableError) { primaryFailure = error; throw error }
      if (isRunnerSpawnFailure(error, confined.argv[0], executionPolicy.workspaceRoot)) {
        primaryFailure = new SandboxUnavailableError(executionPolicy.mode, String(error))
        throw primaryFailure
      }
      if (settled?.type === 'misuse') { primaryFailure = error; throw error }
      return failure('worker-exit', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(wallTimer)
      request.signal?.removeEventListener('abort', onAbort)
      const drained = await Promise.allSettled([...pendingBindings])
      this.live.delete(live)
      finishedResolve()
      const failures = [...notificationFailures, ...drained.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])]
      if (failures.length > 0) {
        if (primaryFailure !== undefined) failures.unshift(primaryFailure)
        throw new AggregateError(failures, 'code-runtime-process-sandbox: binding drain failed')
      }
    }
  }
}

export { resolveNativeWorkerThreadConfig }
