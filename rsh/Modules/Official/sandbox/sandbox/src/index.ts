/**
 * Service Definition for the same-world process-confinement capability seam: wrap exact subprocess argv under a
 * host-path file policy. Containers, microVMs, and remote execution replace the
 * surrounding capability seam instead; this service shares the host kernel and filesystem.
 * @module @deepseek-ai/dsh-sandbox
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ConfinedSandboxMode, ConfinedArgv, SandboxPolicy } from './native-types.ts'

export {
  ESCALATION_TARGETS,
  WIDER_MODES,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from './escalation.ts'
export type { EscalationApproval, EscalationApprover, EscalationOutcome, EscalationRequest } from './escalation.ts'
export { canonicalPath, writableRoots } from './roots.ts'
export type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxEnforcement,
  SandboxExecutionPolicy,
  SandboxMode,
  SandboxPolicy,
} from './native-types.ts'

/**
 * Error code for a requested confined mode when no backend is usable. The
 * provider fails closed, and `HarnessError` carries the code through
 * `tool/result` so callers can distinguish missing confinement from command
 * failure.
 */
export const SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/**
 * Thrown when {@link SandboxProvider.confine} cannot enforce the requested
 * mode. Carries {@link SANDBOX_UNAVAILABLE} through the structured error
 * channel.
 */
export class SandboxUnavailableError extends HarnessError {
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandbox: SandboxProvider
  }
}

/**
 * Abstract process-sandbox service. {@link confine} must return enforcing argv
 * or fail closed at wrap or runner-execution time; silent unconfined passthrough
 * is forbidden. Functional probes arbitrate multi-runner chains and may be
 * skipped for a sole candidate, whose own refusal remains the fail-closed end.
 */
export abstract class SandboxProvider extends Service {
  /* v8 ignore next -- abstract service construction is covered through concrete provider packages. */
  constructor(ctx: Context) {
    super(ctx, 'sandbox')
  }

  /**
   * Wrap `argv` so it executes confined under `policy` on this host; the
   * caller spawns the returned argv in place of its own.
   * @param argv - the exact argv the caller is about to spawn (program plus
   *   arguments), NOT a shell string — a shell-shaped consumer passes
   *   `['bash', '-c', command]`.
   * @param policy - the file-effect policy this execution runs under,
   *   carried per call (see {@link SandboxPolicy}).
   * @returns the argv to spawn instead, plus the enforcement completeness
   *   the selected backend achieves for it.
   */
  abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
}

export default SandboxProvider
