/**
 * Cordis adapter for the CPython subprocess code runtime.
 * The implementation lives in ./runtime.ts; the Native installer is ./native.ts.
 * @module @redspark/rsh-experimental-code-runtime-python
 */
import { Context } from '@redspark/cordis'
import { CodeRuntime } from '@redspark/rsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@redspark/rsh-code-runtime'
import { Config, PythonProcessRuntime } from './runtime.ts'

export type { Config } from './runtime.ts'
export {
  detachResidual,
  hostFrameParseCeiling,
  readProcessStart,
  resolvePythonBin,
} from './runtime.ts'
export type { BootMessage, ChildToHost, ReplyMessage } from './protocol.ts'
export {
  checkDoneValue,
  encodeJsonPlain,
  hasNonLosslessNumber,
  hasUnsafeIntegerToken,
  logTruncationMarker,
  validateChildFrame,
} from './protocol.ts'

/**
 * Registers the CPython subprocess runtime as `ctx.codeRuntime`.
 * Program, budget, abort, and substrate failures resolve in the result; only seam misuse rejects.
 */
export class PythonCodeRuntime extends CodeRuntime {
  static Config = Config

  private readonly inner: PythonProcessRuntime

  /**
   * @param ctx - Cordis context that owns this service.
   * @param config - validated plugin config; Cordis applies {@link PythonCodeRuntime.Config} first.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.inner = new PythonProcessRuntime(config, (teardown) => {
      ctx.effect(() => () => teardown(), 'python code-runtime teardown')
    })
  }

  get language(): string {
    return this.inner.language
  }

  get isolation(): string {
    return this.inner.isolation
  }

  /**
   * @param request - source program, host bindings, and cancellation signal.
   * @returns the program's resolved outcome, including any reported run failure.
   */
  run(request: CodeRunRequest): Promise<CodeRunResult> {
    return this.inner.run(request)
  }
}

export default PythonCodeRuntime
