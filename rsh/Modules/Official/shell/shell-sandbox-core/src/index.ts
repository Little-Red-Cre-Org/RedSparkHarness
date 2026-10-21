/** Confinement and result classification shared by shell dialects. */
import type { ShellExecRequest, ShellExecSpec, ShellOperations, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell/native'
import { SandboxUnavailableError, classifyRunnerFailure, isRunnerSpawnFailure } from '@deepseek-ai/dsh-sandbox/native'
import type {
  ConfinedArgv, ConfinedSandboxMode, ProcessSandbox, RunnerFailureRule,
  SandboxEnforcement, SandboxExecutionPolicy, SandboxMode, SandboxPolicy,
} from '@deepseek-ai/dsh-sandbox/native'

function matchesSignature(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some(signature => lowered.includes(signature.toLowerCase()))
}

function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSignature(result.exitCode, result.stderr.text, signatures)
}

/** Local command mechanics needed after the confinement runner selects argv. */
export interface ShellCommands extends ShellOperations {
  runArgv(spec: ShellExecSpec, argv: readonly string[]): Promise<ShellRunResult>
  startArgv(spec: ShellExecSpec, argv: readonly string[]): ShellProcess
}

/** Policy provider selected by the active composition. */
export interface ShellPolicy {
  readonly defaultMode: SandboxMode
  resolve(): SandboxExecutionPolicy
}

interface ProcessFacts {
  mode: ConfinedSandboxMode
  enforcement: SandboxEnforcement
  denialSignatures: readonly string[]
  runnerFailureRules: readonly RunnerFailureRule[]
  runnerProgram: string | undefined
  workdir: string
}

/** Applies one policy to each call without an unconfined fallback. */
export class SandboxShellController implements ShellOperations {
  private readonly processFacts = new Map<ShellProcess, ProcessFacts>()

  constructor(
    private readonly local: ShellCommands,
    private readonly sandbox: ProcessSandbox,
    private readonly policy: ShellPolicy,
    private readonly commandArgv: (spec: ShellExecSpec) => readonly string[],
  ) {}

  get sandboxMode(): SandboxMode { return this.policy.defaultMode }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return { ...this.local.resolve(request), sandboxPolicy: request.sandboxPolicy ?? this.policy.resolve() }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') {
      const result = await this.local.run(spec)
      return { ...result, sandbox: { mode, denied: false } }
    }
    const confined = this.confine(spec, { ...policy, mode })
    let result: ShellRunResult
    try {
      result = await this.local.runArgv(spec, confined.argv)
    } catch (error) {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
      if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error))
      }
      throw error
    }
    const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, confined.runnerFailureRules)
    if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail)
    return { ...result, sandbox: { mode, denied: classifyDenial(result, confined.denialSignatures), enforcement: confined.enforcement } }
  }

  start(spec: ShellExecSpec): ShellProcess {
    const policy = spec.sandboxPolicy as SandboxExecutionPolicy
    const { mode } = policy
    if (mode === 'danger-full-access') return this.local.start(spec)
    const confined = this.confine(spec, { ...policy, mode })
    let proc: ShellProcess
    try {
      proc = this.local.startArgv(spec, confined.argv)
    } catch (error) {
      if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error))
      }
      throw error
    }
    this.processFacts.set(proc, {
      mode, enforcement: confined.enforcement,
      denialSignatures: confined.denialSignatures,
      runnerFailureRules: confined.runnerFailureRules,
      runnerProgram: confined.argv[0], workdir: spec.workdir,
    })
    return proc
  }

  /**
   * Classify the original runner's settlement before its public done promise resolves.
   * @param proc - settled shell process.
   * @param stderr - retained runner stderr.
   * @param providerRejected - whether the subprocess rejected without an outcome.
   * @param providerError - original subprocess rejection, when present.
   */
  onProcessDone(proc: ShellProcess, stderr: string, providerRejected: boolean, providerError?: unknown): void {
    const facts = this.processFacts.get(proc)
    if (facts === undefined) return
    this.processFacts.delete(proc)
    const runnerFailed = providerRejected
      ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
      : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== undefined
    proc.sandbox = {
      mode: facts.mode,
      denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
      enforcement: facts.enforcement,
      ...(runnerFailed ? { runnerFailed } : {}),
    }
  }

  private confine(spec: ShellExecSpec, policy: SandboxPolicy): ConfinedArgv {
    return this.sandbox.confine(this.commandArgv(spec), policy)
  }
}
