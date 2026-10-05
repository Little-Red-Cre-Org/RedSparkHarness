/** Shared local shell process lifecycle over the managed subprocess capability. */
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead, ShellRunResult, CollectedOutput, ShellOperations } from '@deepseek-ai/dsh-shell/native'
import type { SubprocessCollect, SubprocessHandle, SubprocessOperations, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess/native'
import { clampTimeout, deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** Configurable execution budgets. */
export interface Config {
  /** Default working directory; absent uses process.cwd(). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeouts. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap. */
  maxOutputBytes?: number
  /** Per-stream complete spill-file cap. */
  maxSpillBytes?: number
  /** Managed-range termination and pipe-drain grace period. */
  graceMs?: number
}

/** Defaults are applied before constructing the controller. */
export type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

const DEFAULT_CONFIG = {
  timeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 64_000,
  maxSpillBytes: 64 * 1024 * 1024,
  graceMs: 3_000,
} as const

function assertPositiveFinite(label: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}: ${name} must be a positive finite number`)
  }
}

/**
 * Reject unusable resolved budgets before a command starts.
 * @param label - owning Provider name for diagnostics.
 * @param config - resolved executor configuration.
 */
export function assertServiceableConfig(label: string, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite(label, 'timeoutMs', resolved.timeoutMs)
  assertPositiveFinite(label, 'maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveFinite(label, 'maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveFinite(label, 'maxSpillBytes', resolved.maxSpillBytes)
  assertPositiveFinite(label, 'graceMs', resolved.graceMs)
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${label}: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Parse native Provider config before installing a process-capable service.
 * @param input - untrusted profile configuration.
 * @param label - owning Provider name for diagnostics.
 * @param extraFields - dialect-specific fields accepted by the Provider.
 * @returns validated budgets with every numeric field resolved.
 */
export function resolveConfig(input: unknown, label: string, extraFields: readonly string[] = []): ResolvedConfig {
  if (input === undefined) return { ...DEFAULT_CONFIG }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${label}: config must be an object`)
  }
  const values = input as Record<string, unknown>
  for (const key of Object.keys(values)) {
    if (key !== 'cwd' && !extraFields.includes(key) && !(key in DEFAULT_CONFIG)) {
      throw new Error(`${label}: unknown config field ${key}`)
    }
  }
  if (values.cwd !== undefined && typeof values.cwd !== 'string') {
    throw new Error(`${label}: cwd must be a string`)
  }
  const result: ResolvedConfig = { ...DEFAULT_CONFIG }
  if (values.cwd !== undefined) result.cwd = values.cwd
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>) {
    const value = values[key]
    if (value !== undefined) {
      if (typeof value !== 'number') throw new Error(`${label}: ${key} must be a number`)
      result[key] = value
    }
  }
  assertServiceableConfig(label, result)
  return result
}

function finalOutput(reader: SubprocessOutputReader): CollectedOutput {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

/** Shell-specific invocation and environment chosen by the owning Provider. */
export interface ShellDialect {
  /** Error prefix for invalid requests and process-provider failures. */
  label: string
  /** Deadline reason reserved for this executor. */
  timeoutCode: string
  /** Environment defaults before caller and trusted DSH overrides. */
  envOverrides: Readonly<Record<string, string>>
  /** Exact executable and arguments for a resolved command. */
  argv(spec: ShellExecSpec): readonly string[]
}

/** Process mechanics shared by Bash and PowerShell Providers. */
export class LocalShellController implements ShellOperations {
  readonly sandboxMode = undefined

  /**
   * @param subprocess - managed process service that owns background work.
   * @param configSource - validated current budgets; the legacy settings adapter may update them.
   * @param onProcessDone - optional settlement hook for sandbox classification.
   */
  constructor(
    private readonly subprocess: SubprocessOperations,
    private readonly configSource: () => ResolvedConfig,
    private readonly dialect: ShellDialect,
    private readonly onProcessDone: (proc: ShellProcess, stderr: string, rejected: boolean, error?: unknown) => void = () => {},
  ) {}

  /** Validated budgets in effect for the next command. */
  get config(): ResolvedConfig { return this.configSource() }

  resolve(request: ShellExecRequest): ShellExecSpec {
    const timeoutMs = clampTimeout(request.timeoutMs, this.config.timeoutMs, this.config.maxTimeoutMs, `${this.dialect.label}: request.timeoutMs`)
    const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes
    assertPositiveFinite(this.dialect.label, 'request.stdoutMaxBytes', stdoutMaxBytes)
    return {
      command: request.command,
      workdir: request.workdir ?? this.config.cwd ?? process.cwd(),
      timeoutMs,
      stdoutMaxBytes,
      ...request.signal ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  private spawnSpec(
    spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal: AbortSignal | undefined,
  ): SubprocessSpawnSpec {
    const collect = (maxBytes: number): SubprocessCollect =>
      ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes } })
    return {
      argv,
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes),
      },
      graceMs: this.config.graceMs,
      signal,
      env: { ...this.dialect.envOverrides, ...spec.env, ...spec.dshEnv },
    }
  }

  private collected(handle: SubprocessHandle): { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader } {
    const { stdout, stderr } = handle.collected
    /* v8 ignore start -- collect dispositions expose both readers by contract. */
    if (stdout === undefined || stderr === undefined) {
      throw new Error(`${this.dialect.label}: subprocess implementation dropped a requested collect stream`)
    }
    /* v8 ignore stop */
    return { stdout, stderr }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return this.runArgv(spec, this.dialect.argv(spec))
  }

  /**
   * Run explicit argv with the foreground lifecycle and output classification.
   * @param spec - resolved shell request.
   * @param argv - executable and arguments selected by the caller.
   * @returns collected result with timeout and cancellation facts.
   */
  async runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult> {
    using d = deadline(spec.signal, spec.timeoutMs, this.dialect.timeoutCode)
    const handle = this.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, d.signal))
    const outcome = await handle.done
    const collected = this.collected(handle)
    const timedOut = timeoutOf(d.signal, this.dialect.timeoutCode) !== undefined
    return {
      ...outcome,
      timedOut,
      aborted: d.signal.aborted && !timedOut,
      timeoutMs: spec.timeoutMs,
      stdout: finalOutput(collected.stdout),
      stderr: finalOutput(collected.stderr),
    }
  }

  start(spec: ShellExecSpec): ShellProcess {
    return this.startArgv(spec, this.dialect.argv(spec))
  }

  /**
   * Start explicit argv; subprocess owns the resulting process range.
   * @param spec - resolved shell request.
   * @param argv - executable and arguments selected by the caller.
   * @returns live handle with consuming incremental output reads.
   */
  startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess {
    const running = this.subprocess.spawn(this.spawnSpec(spec, argv, this.config.maxOutputBytes, spec.signal))
    const collected = this.collected(running)
    let providerFailureNote: string | undefined
    let stdoutOffset = 0
    let stderrOffset = 0
    const proc: ShellProcess = {
      status: 'running',
      exitCode: null,
      signal: null,
      done: running.done.then((outcome) => {
        if (proc.status === 'running') {
          proc.status = spec.signal?.aborted === true || outcome.signal !== null ? 'killed' : 'completed'
        }
        proc.exitCode = outcome.exitCode
        proc.signal = outcome.signal
        this.onProcessDone(proc, collected.stderr.readFrom(0).text, false)
      }, (error: unknown) => {
        proc.status = 'killed'
        let detail = 'unprintable provider failure'
        try {
          detail = String(error)
        } catch {
          // Provider rejection values cannot make ShellProcess.done reject.
        }
        providerFailureNote = `subprocess failed before reporting an outcome: ${detail}`
        this.onProcessDone(proc, providerFailureNote, true, error)
      }),
      readOutput: (): ShellProcessRead => {
        const out = collected.stdout.readFrom(stdoutOffset)
        const err = collected.stderr.readFrom(stderrOffset)
        stdoutOffset = out.nextOffset
        stderrOffset = err.nextOffset
        const providerFailure = providerFailureNote ?? ''
        providerFailureNote = undefined
        const failureSeparator = err.text.length > 0 && !err.text.endsWith('\n') ? '\n' : ''
        const errText = err.text + (providerFailure.length > 0 ? `${failureSeparator}${providerFailure}` : '')
        const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
        return {
          delta: out.text + (errText.length > 0 ? `${separator}[stderr]\n${errText}` : ''),
          lossy: out.lossy || err.lossy,
          ...out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {},
          ...err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {},
        }
      },
      kill: (): boolean => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        running.terminate()
        return true
      },
    }
    return proc
  }
}
