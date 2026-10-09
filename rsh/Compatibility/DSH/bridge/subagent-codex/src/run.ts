/** Cordis-to-Official adapter. Product process, wire, settlement, and cleanup live in Official. */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { ChildConnectionDefinition, ChildConnectionHandle, SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexAppServerArgv,
  disposeCodexChild as disposeOfficialCodexChild,
  startCodexProductRun,
} from '@deepseek-ai/dsh-codex-app-server'
import type { CodexPermissionMode } from '@deepseek-ai/dsh-codex-app-server'
import type { CodexAppServerWire } from './wire.ts'

export { CODEX_PERMISSION_MODES, DEFAULT_CODEX_PERMISSION_MODE, DEFAULT_DISPOSE_GRACE_MS, codexAppServerArgv }
export type { CodexPermissionMode }

/** Resolved Cordis inputs translated into the Official child connection. */
export interface CodexRunSpec {
  readonly cwd: string
  readonly model?: string
  readonly permissionMode: CodexPermissionMode
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** Preserve a safe Cordis startup error while retaining the original as a cause.
 * @param cause - The startup failure returned by the Official product runner.
 * @returns The legacy-prefixed error with the original failure as its cause.
 */
export function codexStartupFailure(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : ''
  const stage = message.includes('thread-start')
    ? 'thread-start'
    : 'initialize'
  const safeDiagnostic = message.match(/Product subagent failure \(product: Codex; [^)]*\)/)?.[0]
  return new Error(
    `subagent-codex: ${safeDiagnostic ?? `Product subagent failure (product: Codex; stage: ${stage}; category: unknown)`}`,
    { cause },
  )
}

function compatibilityError(error: Error): Error {
  return error.message.startsWith('codex-app-server:')
    ? new Error(error.message.replace(/^codex-app-server:/, 'subagent-codex:'), { cause: error })
    : error
}

function compatibilityAggregate(error: AggregateError): AggregateError {
  const errors = error.errors.map((entry: unknown) => compatibilityError(
    entry instanceof Error ? entry : new Error(String(entry)),
  ))
  const mapped = error.message.replace(/codex-app-server:/g, 'subagent-codex:')
  const message = mapped.startsWith('subagent-codex:') ? mapped : `subagent-codex: ${mapped}`
  return new AggregateError(errors, message, { cause: error })
}

/** Validate and preserve the text-only Cordis task at the compatibility boundary.
 * @param prompt - The legacy request's content blocks.
 * @returns The text blocks in their original order.
 */
export function textTask(prompt: readonly ContentBlock[]): string[] {
  if (prompt.length === 0 || prompt.some(block => block.type !== 'text')) {
    throw new Error('subagent-codex: the one-shot task must contain only text blocks')
  }
  const texts = prompt.map(block => block.type === 'text' ? block.text : '')
  if (texts.every(text => text.trim().length === 0)) throw new Error('subagent-codex: the one-shot task must not be empty')
  return texts
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Delegate the whole product run to Official, then adapt its result to Cordis' run handle.
 * @param request - The legacy Cordis subagent request and cancellation signal.
 * @param spec - Resolved provider settings and the legacy child spawner.
 * @returns The compatible subagent run handle backed by the Official product run.
 */
export async function startCodexRun(request: SubagentStartRequest, spec: CodexRunSpec): Promise<SubagentRun> {
  const texts = textTask(request.prompt)
  if (isSignalAborted(request.signal)) {
    throw new Error('subagent-codex: request was aborted before app-server startup')
  }
  const connection: ChildConnectionDefinition = {
    connect: (childSpec): ChildConnectionHandle => {
      const child = spec.spawn({
        argv: childSpec.argv,
        cwd: childSpec.cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        graceMs: childSpec.graceMs,
        signal: childSpec.signal,
        env: childSpec.env,
        envMode: childSpec.envMode,
      })
      return child as ChildConnectionHandle
    },
  }
  let app: Awaited<ReturnType<typeof startCodexProductRun>>
  try {
    app = await startCodexProductRun(texts, {
      connection,
      cwd: spec.cwd,
      ...spec.model === undefined ? {} : { model: spec.model },
      permissionMode: spec.permissionMode,
      env: spec.env,
      disposeGraceMs: spec.disposeGraceMs,
      ...spec.onError === undefined ? {} : {
        onError: (error: Error, reason: SubagentStopReason) => spec.onError?.(compatibilityError(error), reason),
      },
    }, request.signal)
  } catch (error: unknown) {
    if (isSignalAborted(request.signal)) {
      throw new Error('subagent-codex: request was aborted before run publication', { cause: error })
    }
    if (error instanceof AggregateError) throw compatibilityAggregate(error)
    throw codexStartupFailure(error)
  }
  const result: Promise<SubagentResult> = app.result.then(value => ({
    ...value,
    output: [...value.output],
  }))
  const teardown = (): Promise<void> => app.dispose().catch((error: unknown) => {
    throw compatibilityError(error instanceof Error ? error : new Error(String(error)))
  })
  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort: () => {},
    requestCancel: () => { void app.dispose() },
    teardown,
  })
}

/** Keep the legacy helper surface as a type-only bridge to the Official cleanup owner. */
/** Keep legacy cleanup callers on the Official managed-range owner.
 * @param wire - The Official protocol adapter for the run.
 * @param child - The compatibility child handle for the same managed range.
 * @param graceMs - Optional grace period passed to the Official cleanup owner.
 * @returns Resolves after the protocol and child range are released.
 */
export function disposeCodexChild(
  wire: CodexAppServerWire,
  child: SubprocessHandle,
  graceMs?: number,
): Promise<void> {
  return disposeOfficialCodexChild(wire, child as ChildConnectionHandle, graceMs)
    .catch((error: unknown) => {
      throw compatibilityError(error instanceof Error ? error : new Error(String(error)))
    })
}
