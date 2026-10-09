import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { ChildConnectionDefinition, ChildConnectionHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess/native'
import { disposeChildConnection } from '@deepseek-ai/dsh-subprocess/native'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { CodexAppServerWire } from './wire.ts'
import type { CodexWireFailureFacts, CodexWireResult } from './wire.ts'
import { DEFAULT_DISPOSE_GRACE_MS, type CodexPermissionMode } from './types.ts'

interface CodexPackageManifest { readonly bin: { readonly codex: string } }

const codexPackageJsonPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
const codexPackageManifest = JSON.parse(readFileSync(codexPackageJsonPath, 'utf8')) as CodexPackageManifest
const CODEX_PACKAGE_BIN = resolve(dirname(codexPackageJsonPath), codexPackageManifest.bin.codex)

/** Fixed package-local app-server command, independent of the host PATH.
 * @returns The Node argv that starts the pinned package-local app-server.
 */
export function codexAppServerArgv(): string[] {
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}

/** Product-level terminal reason returned for one Codex run. */
export type CodexRunStopReason = 'completed' | 'max-tokens' | 'aborted' | 'refusal' | 'error'

/** Selected answer and terminal state returned by the Codex product run.
 * A safe diagnostic is present for non-success outcomes when available.
 */
export interface CodexProductResult {
  readonly output: CodexWireResult['output']
  readonly stopReason: CodexRunStopReason
  readonly diagnostic?: string
}

/** Published app-server run and its caller-owned result and cleanup handles. */
export interface CodexProductRun {
  readonly remoteId: string
  readonly result: Promise<CodexProductResult>
  collectOutput(): CodexWireResult['output']
  dispose(): Promise<void>
}

/** Process, routing, permission, and diagnostic inputs for a Codex product run. */
export interface CodexProductRunSpec {
  readonly connection: ChildConnectionDefinition
  readonly cwd: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly permissionMode: CodexPermissionMode
  readonly env?: Record<string, string>
  readonly disposeGraceMs?: number
  readonly onStderr?: (chunk: Buffer) => void
  readonly onError?: (error: Error, stopReason: CodexRunStopReason) => void
}

type CodexFailureStage = 'initialize' | 'thread-start' | CodexWireFailureFacts['stage'] | 'process' | 'teardown'
type CodexFailureCategory = CodexWireFailureFacts['category'] | 'process'

interface CodexFailureFacts {
  readonly stage: CodexFailureStage
  readonly category: CodexFailureCategory
  readonly httpStatus?: number | undefined
  readonly outcome?: SubprocessOutcome
}

function failureDiagnostic(facts: CodexFailureFacts): string {
  const fields = [
    'product: Codex',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.httpStatus !== undefined) fields.push(`HTTP status: ${facts.httpStatus}`)
  for (const [label, value] of [['exit code', facts.outcome?.exitCode], ['signal', facts.outcome?.signal]] as const) {
    if (value !== null && value !== undefined) fields.push(`${label}: ${value}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

function safeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** Close the protocol and release the whole process range through Core.
 * @param wire - This run's app-server protocol adapter.
 * @param child - The Core-managed child connection to release.
 * @param graceMs - Grace period used by the managed-range termination tiers.
 * @returns Resolves after protocol listeners and the child range are released.
 */
export async function disposeCodexChild(
  wire: CodexAppServerWire,
  child: ChildConnectionHandle,
  graceMs = DEFAULT_DISPOSE_GRACE_MS,
): Promise<void> {
  wire.close()
  let outcome: SubprocessOutcome | undefined
  void child.done.then((value) => { outcome = value }, () => {})
  try {
    await disposeChildConnection(child, { eofGraceMs: graceMs, terminationGraceMs: graceMs })
  } catch (error: unknown) {
    child.terminate()
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort() }, Math.min(graceMs * 2, MAX_TIMER_DELAY_MS))
    try {
      if (!await child.waitForExit(timeout.signal)) {
        throw new Error('managed subprocess range did not exit after termination')
      }
    } catch (terminationError: unknown) {
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      const diagnostic = failureDiagnostic({
        stage: 'teardown',
        category: 'unknown',
        ...outcome === undefined ? {} : { outcome },
      })
      throw new Error(`codex-app-server: ${diagnostic}`, { cause: safeError(terminationError ?? error) })
    } finally {
      clearTimeout(timer)
    }
  }
  await child.done.catch(() => {})
}

/** Start the official app-server, publish its ephemeral thread, and run one task.
 * @param texts - The text blocks submitted as the one-shot task.
 * @param spec - Process connection, product routing, and lifecycle options.
 * @param signal - Startup and published-run cancellation signal.
 * @returns The published run, including completion, output collection, and disposal.
 */
export async function startCodexProductRun(
  texts: readonly string[],
  spec: CodexProductRunSpec,
  signal: AbortSignal,
): Promise<CodexProductRun> {
  if (texts.length === 0 || texts.every(text => text.trim().length === 0)) {
    throw new Error('codex-app-server: the one-shot task must not be empty')
  }
  signal.throwIfAborted()
  const graceMs = spec.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  let child: ChildConnectionHandle
  try {
    child = spec.connection.connect({
      argv: codexAppServerArgv(),
      cwd: spec.cwd,
      graceMs,
      signal,
      env: spec.env,
      envMode: 'scrub-overlay',
    })
  } catch (error: unknown) {
    throw new Error('codex-app-server: failed to start the official app-server', { cause: error })
  }

  const wire = new CodexAppServerWire(child.stdout, child.stdin, spec.permissionMode, spec.model)
  const stderr = (chunk: Buffer | string): void => {
    try {
      if (spec.onStderr !== undefined) spec.onStderr(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      else writeFileSync(process.stderr.fd, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    } catch {
      // stderr is an observation stream; it does not own run settlement.
    }
  }
  const onStderrError = (): void => {}
  child.stderr.on('data', stderr)
  child.stderr.on('error', onStderrError)
  let processFailureFacts: CodexFailureFacts | undefined
  const processFailure: Promise<never> = child.done.then(
    (outcome) => {
      processFailureFacts = { stage: 'process', category: 'process', outcome }
      throw new Error(`codex-app-server: process exited (${String(outcome.exitCode)})`)
    },
    (error: unknown) => {
      processFailureFacts = { stage: 'process', category: 'process' }
      throw safeError(error)
    },
  )
  processFailure.catch(() => {})
  wire.start()

  const disposeProcess = async (): Promise<void> => {
    try {
      await disposeCodexChild(wire, child, graceMs)
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    } finally {
      child.stderr.off('data', stderr)
      child.stderr.off('error', onStderrError)
    }
  }

  let startupStage: 'initialize' | 'thread-start' = 'initialize'
  try {
    await Promise.race([wire.initialize(signal), processFailure])
    startupStage = 'thread-start'
    await Promise.race([wire.startThread(spec.cwd, signal), processFailure])
  } catch (error: unknown) {
    if (!(error instanceof Error && error.message.startsWith('codex-app-server: process exited'))) {
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    }
    const startupFacts: CodexFailureFacts = {
      stage: startupStage,
      category: 'unknown',
      ...processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome },
    }
    const failure = new Error(`codex-app-server: ${failureDiagnostic(startupFacts)}`, { cause: safeError(error) })
    try {
      await disposeProcess()
    } catch (disposeError: unknown) {
      const cleanupMessage = safeError(disposeError).message.replace(/^codex-app-server:\s*/, '')
      throw new AggregateError(
        [failure, safeError(disposeError)],
        `${failureDiagnostic({ stage: startupStage, category: 'unknown' })}\n${cleanupMessage}`,
      )
    }
    throw failure
  }

  const remoteId = wire.remoteId
  if (remoteId === undefined) {
    await disposeProcess()
    throw new Error('codex-app-server: thread/start returned no thread id')
  }

  const runController = new AbortController()
  const runSignal = AbortSignal.any([signal, runController.signal])
  let settled = false
  let resultValue: CodexProductResult | undefined
  const publishedProcessFailure = processFailure.catch(async (error: unknown): Promise<never> => {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    throw error
  })
  const result = (async (): Promise<CodexProductResult> => {
    const collectOutput = (): CodexWireResult['output'] => wire.collectOutput()
    try {
      const turnSettlement = wire.runTurn(texts, runSignal, spec.reasoningEffort).then(
        value => ({ kind: 'turn' as const, value }),
        (error: unknown) => ({ kind: 'turn-error' as const, error }),
      )
      const processSettlement = publishedProcessFailure.then(
        () => { throw new Error('codex-app-server: process failure promise resolved unexpectedly') },
        (error: unknown) => ({ kind: 'process-error' as const, error }),
      )
      const winner = await Promise.race([turnSettlement, processSettlement])
      let terminal: CodexWireResult
      if (winner.kind === 'turn') {
        terminal = winner.value
      } else if (winner.kind === 'turn-error') {
        throw winner.error
      } else {
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        if (!wire.hasTerminalNotification()) throw winner.error
        const turn = await turnSettlement
        if (turn.kind === 'turn-error') throw turn.error
        terminal = turn.value
      }
      if (runSignal.aborted) return { output: collectOutput(), stopReason: 'aborted' }
      if (terminal.stopReason === 'completed') return terminal
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      const facts = wire.collectFailure()
      const failure: CodexFailureFacts = {
        stage: facts.stage,
        category: facts.category,
        ...facts.httpStatus === undefined ? {} : { httpStatus: facts.httpStatus },
        ...processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome },
      }
      const permission = wire.collectDiagnostic()
      return {
        ...terminal,
        diagnostic: permission === undefined
          ? failureDiagnostic(failure)
          : `${failureDiagnostic(failure)}\n${permission}`,
      }
    } catch (error: unknown) {
      if (!runSignal.aborted && wire.hasInputEnded() && processFailureFacts === undefined) {
        let timer: ReturnType<typeof setTimeout> | undefined
        let removeWaitAbort: (() => void) | undefined
        const abortWait = new Promise<void>((resolve) => {
          const onWaitAbort = (): void =>{  resolve() }
          if (runSignal.aborted) resolve()
          else {
            runSignal.addEventListener('abort', onWaitAbort, { once: true })
            removeWaitAbort = () =>{  runSignal.removeEventListener('abort', onWaitAbort) }
          }
        })
        try {
          await Promise.race([
            child.done.then(() => {}, () => {}),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, Math.max(1, Math.min(graceMs, MAX_TIMER_DELAY_MS)))
            }),
            abortWait,
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
          removeWaitAbort?.()
        }
      }
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      if (runSignal.aborted) return { output: collectOutput(), stopReason: 'aborted' }
      const wireFailure = wire.collectFailure()
      const failure: CodexFailureFacts = wire.hasTerminalNotification()
        ? {
          ...wireFailure,
          ...processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome },
        }
        : processFailureFacts ?? wireFailure
      const permission = wire.collectDiagnostic()
      const diagnostic = permission === undefined
        ? failureDiagnostic(failure)
        : `${failureDiagnostic(failure)}\n${permission}`
      try {
        spec.onError?.(new Error(`codex-app-server: ${failureDiagnostic(failure)}`, { cause: safeError(error) }), 'error')
      } catch {
        // A host diagnostic sink does not decide the product result.
      }
      return { output: collectOutput(), diagnostic, stopReason: 'error' }
    } finally {
      settled = true
      signal.removeEventListener('abort', onAbort)
    }
  })()

  function onAbort(): void {
    if (runController.signal.aborted) return
    runController.abort(new Error('codex-app-server: run cancelled locally'))
    wire.interrupt()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal
    if (!settled) {
      runController.abort(new Error('codex-app-server: run disposed'))
      wire.interrupt()
    }
    return disposal = disposeProcess()
  }

  void result.then((value) => { resultValue = value })
  return {
    remoteId,
    result,
    collectOutput: () => resultValue?.output ?? wire.collectOutput(),
    dispose,
  }
}
