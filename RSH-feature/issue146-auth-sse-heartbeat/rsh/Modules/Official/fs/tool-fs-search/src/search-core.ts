/** Compatibility adapters over the shared search process and retention implementation. */
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import { runRipgrep as runCore } from './ripgrep-core.ts'
import type { RipgrepRun } from './ripgrep-core.ts'
export * from './ripgrep-core.ts'

/**
 * Run the packaged search process for a compatibility tool call.
 * @param ctx - selected subprocess service.
 * @param exec - invocation supplying workspace and cancellation.
 * @param toolName - diagnostic tool name.
 * @param argv - explicit ripgrep arguments.
 * @param rawOutputMaxBytes - complete stdout cap.
 * @param graceMs - process termination grace period.
 * @param stderrMaxBytes - retained diagnostic cap.
 * @returns complete stdout and workspace.
 */
export function runRipgrep(
  ctx: Context, exec: ToolExecution, toolName: string, argv: readonly string[],
  rawOutputMaxBytes: number, graceMs: number, stderrMaxBytes: number,
): Promise<RipgrepRun> {
  const cwd = exec.agent?.session.header.cwd
  return runCore(ctx.subprocess, { signal: exec.signal, ...cwd === undefined ? {} : { cwd } },
    toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes)
}

/**
 * Best-effort save of one COMPLETE formatted search result through
 * `ctx.spillStore.saveText()` — the model-facing recovery path for a capped
 * result. `spillStore` is read with `ctx.get()` (not static inject) because
 * formatted-result spill is optional; the spill owner is the calling agent's
 * session header id and the source is the tool execution identity. A missing
 * backend, a call with no session owner, or a `saveText()` rejection logs a
 * warning and returns `undefined` — the caller keeps the inline result and
 * reports that the complete result could not be saved; search success never
 * turns into `isError` because spill storage is unavailable.
 *
 * @param ctx - the plugin context; `spillStore` is looked up opportunistically.
 * @param exec - the tool-execution context; supplies the owning session, tool name, and call id.
 * @param suggestedName - the backend-sanitized filename hint (e.g. `grep-results.txt`).
 * @param content - the complete formatted result to persist.
 * @returns the saved spill reference, or `undefined` when the result could not be saved.
 */
export async function trySaveFormattedResult(
  ctx: Context,
  exec: ToolExecution,
  suggestedName: string,
  content: string,
): Promise<SpillRef | undefined> {
  const sessionId = exec.agent?.session.header.id
  if (sessionId === undefined) {
    ctx.logger.warn(`tool-fs-search: no session owner for ${exec.name} result; complete result not saved`)
    return undefined
  }
  const spillStore = ctx.get('spillStore')
  if (!spillStore) {
    ctx.logger.warn(`tool-fs-search: no ctx.spillStore backend loaded; complete ${exec.name} result not saved`)
    return undefined
  }
  const save: SaveTextSpill = {
    owner: { sessionId },
    source: { kind: 'tool', toolName: exec.name, callId: exec.callId, label: 'result' },
    suggestedName,
    content,
  }
  try {
    return await spillStore.saveText(save)
  } catch (error: unknown) {
    // Best-effort: a storage failure must never fail the search or hide the
    // inline result — the footer reports the unsaved remainder instead.
    ctx.logger.warn(`tool-fs-search: saveText failed for ${exec.name}: ${String(error)}; complete result not saved`)
    return undefined
  }
}
