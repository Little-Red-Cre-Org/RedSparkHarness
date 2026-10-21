/** Cordis-free process-confinement types, path rules, and unavailable error. */
import { HarnessError } from '@deepseek-ai/dsh-errors'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { ConfinedArgv, ConfinedSandboxMode, SandboxPolicy } from './native-types.ts'

/** Native service implemented by a process-confinement Provider. */
export interface ProcessSandbox {
  /**
   * Wrap exact argv under a per-call file policy or fail closed.
   * @param argv - original program and arguments.
   * @param policy - complete confined policy for this call.
   * @returns enforcing runner argv and classification facts.
   */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
  /**
   * Confine a fixed child runtime while exposing its selected cwd and private home.
   * The launcher-owned `privateHome` is an additional writable path. Existing
   * policy grants, including backend-managed temporary paths, remain in force.
   * The selected cwd is visible and read-only unless an existing policy grant
   * contains it.
   * @param argv - the exact child program and arguments.
   * @param policy - the child's resolved file-effect policy.
   * @param paths - canonical child cwd and launcher-owned private home.
   * @returns enforcing runner argv and classification facts.
   */
  confineChildProcess(argv: readonly string[], policy: SandboxPolicy, paths: ProcessSandboxChildPaths): ConfinedArgv
  /**
   * Prepare and return the existing per-session writable temp root for a policy, when this backend owns one.
   * @param policy - complete workspace-write policy for the owning session.
   * @returns the runner temp root reused by {@link confine}, or `undefined` when this backend does not expose one.
   */
  prepareWritableTempRoot?(policy: SandboxPolicy): string | undefined
}

/** Canonical paths required to start one confined SDK child. */
export interface ProcessSandboxChildPaths {
  /** Existing canonical directory used as the child's process cwd. */
  cwd: string
  /** Existing canonical directory created and owned by the child launcher. */
  privateHome: string
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Selected process-confinement Provider for the current native scope. */
    sandbox: ProcessSandbox
  }
}

export { canonicalPath, writableRoots } from './roots.ts'
export { classifyRunnerFailure, isRunnerSpawnFailure } from './runner-failure.ts'
export {
  ESCALATION_TARGETS, WIDER_MODES, approveEscalation,
  escalationHintMarker, sandboxDenialMarker, validateEscalationArgs,
} from './escalation.ts'
export type { EscalationApproval, EscalationApprover, EscalationOutcome, EscalationRequest } from './escalation.ts'
export type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxEnforcement,
  SandboxExecutionPolicy,
  SandboxMode,
  SandboxPolicy,
} from './native-types.ts'

/** Error code for a confined mode with no usable process-sandbox backend. */
export const SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/** A requested confined mode cannot run without weakening its file policy. */
export class SandboxUnavailableError extends HarnessError {
  /**
   * @param mode - the file-effect mode that could not be enforced.
   * @param detail - optional failure reported by the selected runner.
   */
  constructor(mode: ConfinedSandboxMode, detail?: string) {
    super(
      `sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; `
      + 'refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing '
      + 'kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL '
      + 'restricted-token runner can start (Windows) — otherwise switch the consumer to '
      + 'danger-full-access.'
      + (detail === undefined ? '' : ` Runner failure: ${detail}`),
      SANDBOX_UNAVAILABLE,
    )
    this.name = 'SandboxUnavailableError'
  }
}
