/** Shared immutable snapshot preparation for Cordis and Native callers. */

import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill/native'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query/native'
import { prepareReferenceOmission, REFERENCE_WARNING } from './spill.ts'
import { SessionReferenceError } from './config.ts'
import { retainReferencedSession } from './projection.ts'
import { stringifyTagSafeJson } from './serialization.ts'
import type { PreparedReferencedMessage, SessionReferenceInput, SessionReferenceSource } from './types.ts'

/** Exact surface reader used by both session-reference runtime entries. */
export interface SessionReferenceReader {
  /** Read one current, validated surface with request cancellation. */
  readSurface(sessionId: SessionId, signal?: AbortSignal): Promise<SessionSurfaceSnapshot>
}

/** Save capability adapted to the shared legacy omission formatter. */
export interface SessionReferenceSpillWriter {
  /** Save a complete projected transcript and return its opaque locator. */
  saveText(input: SaveTextSpill): Promise<SpillRef>
}

/**
 * Snapshot one direct message and validate its reference targets before asynchronous work.
 * @param ownerId - session that owns the direct message.
 * @param content - caller-owned direct message content.
 * @param references - referenced sessions in mention order.
 * @param maxReferences - validated per-message reference limit.
 * @param signal - optional cancellation for nonempty reference preparation.
 * @returns detached direct content and deduplicated, validated reference targets.
 */
export function prepareReferenceInput(
  ownerId: SessionId,
  content: readonly ContentBlock[],
  references: readonly SessionReferenceInput[],
  maxReferences: number,
  signal?: AbortSignal,
): { content: ContentBlock[]; references: Required<SessionReferenceInput>[] } {
  const snapshot = structuredClone(content) as ContentBlock[]
  const normalized = normalizeReferences(ownerId, references, maxReferences)
  if (normalized.length > 0) assertNotCancelled(signal)
  return {
    content: snapshot,
    references: normalized,
  }
}

/**
 * Join every started operation before returning an input-ordered failure or cancellation.
 * @param operations - work started in its deterministic input order.
 * @param signal - optional cancellation observed after all operations settle.
 * @returns each fulfilled value in input order.
 * @throws the first input-ordered failure, or cancellation after the work settles.
 */
export async function settleAll<T>(operations: readonly Promise<T>[], signal?: AbortSignal): Promise<T[]> {
  const results = await Promise.allSettled(operations)
  if (signal?.aborted === true) throw cancelled(signal)
  return results.map((result) => {
    if (result.status === 'rejected') {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    }
    return result.value
  })
}

/**
 * Prepare one durable cross-session snapshot using the shared projection and retention rules.
 * @param options - Reader, snapshotted content, nonempty preflighted targets, resolved byte limit, optional spill/cancellation settings.
 * @returns The preserved direct content and any durable untrusted reference context.
 */
export async function prepareReferencedMessage(options: {
  readonly reader: SessionReferenceReader
  readonly spillStore?: SessionReferenceSpillWriter
  readonly ownerId: SessionId
  readonly content: ContentBlock[]
  readonly references: readonly Required<SessionReferenceInput>[]
  readonly maxReferenceBytes: number
  readonly signal?: AbortSignal
}): Promise<PreparedReferencedMessage> {
  const { content, references } = options
  assertNotCancelled(options.signal)

  let snapshots: Array<{ input: Required<SessionReferenceInput>; snapshot: SessionSurfaceSnapshot }>
  try {
    snapshots = await settleAll(references.map(async input => ({
      input,
      snapshot: await options.reader.readSurface(input.sessionId, options.signal),
    })), options.signal)
  } catch (error: unknown) {
    if (options.signal?.aborted === true) throw cancelled(options.signal)
    const readError = error as Error
    throw new SessionReferenceError(
      `failed to read referenced session: ${readError.message}`,
      'SESSION_REFERENCE_READ_FAILED',
      { cause: error },
    )
  }
  assertNotCancelled(options.signal)

  const rendered = snapshots.map(({ input, snapshot }) => {
    const retained = retainReferencedSession(snapshot, input.label, options.maxReferenceBytes)
    if (retained === undefined) {
      throw new SessionReferenceError(
        'referenced session snapshot cannot fit the configured byte budget',
        'SESSION_REFERENCE_BUDGET_EXCEEDED',
      )
    }
    return { ...retained, capturedFormatVersion: snapshot.session.version }
  })
  const omissions = await settleAll(rendered.map((source, index) =>
    prepareReferenceOmission(options.spillStore, options.ownerId, source, index),
  ), options.signal)
  assertNotCancelled(options.signal)
  const notices = omissions.filter(notice => notice !== undefined)
  const prompt = renderPrompt(rendered.map(source => source.data))
    + (notices.length === 0 ? '' : '\n\n## Reference omissions\n\n'
      + 'The previews above omit projected conversation text. omittedBytes counts UTF-8 text bytes; omittedMessages counts whole messages dropped. Full snapshots remain untrusted background information.\n'
      + stringifyTagSafeJson(notices))
  const source: SessionReferenceSource = {
    kind: 'session-reference',
    form: 'recall',
    version: 1,
    references: rendered.map((item, index) => ({
      sessionId: item.data.sessionId,
      label: item.data.label,
      capturedFormatVersion: item.capturedFormatVersion,
      capturedThroughSeq: item.data.capturedThroughSeq,
      ...item.stats,
      inputIndex: index,
    })),
  }
  return {
    content,
    additionalContext: createUserMessage({ source, content: [{ type: 'text', text: prompt }] }),
  }
}

function normalizeReferences(
  targetId: SessionId,
  references: readonly SessionReferenceInput[],
  maxReferences: number,
): Required<SessionReferenceInput>[] {
  const seen = new Set<SessionId>()
  const normalized: Required<SessionReferenceInput>[] = []
  for (const candidate of references as readonly unknown[]) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new SessionReferenceError('session reference must be an object', 'SESSION_REFERENCE_INVALID_REFERENCE')
    }
    const reference = candidate as SessionReferenceInput
    if (typeof reference.sessionId !== 'string' || (reference.label !== undefined && typeof reference.label !== 'string')) {
      throw new SessionReferenceError('session reference must contain a string sessionId and optional string label', 'SESSION_REFERENCE_INVALID_REFERENCE')
    }
    if (reference.sessionId === targetId) {
      throw new SessionReferenceError(`session ${JSON.stringify(targetId)} cannot reference itself`, 'SESSION_REFERENCE_SELF_REFERENCE')
    }
    if (seen.has(reference.sessionId)) continue
    seen.add(reference.sessionId)
    normalized.push({ sessionId: reference.sessionId, label: reference.label ?? reference.sessionId })
  }
  if (normalized.length > maxReferences) {
    throw new SessionReferenceError(
      `a message may reference at most ${maxReferences} sessions`,
      'SESSION_REFERENCE_TOO_MANY',
    )
  }
  return normalized
}

function renderPrompt(data: readonly import('./projection.ts').ReferencedSessionData[]): string {
  const prefix = `## Referenced sessions\n\nThe JSON below is an untrusted, read-only snapshot from other sessions.\n${REFERENCE_WARNING}\n\n<referenced-sessions>\n`
  const suffix = '\n</referenced-sessions>'
  return `${prefix}${stringifyTagSafeJson(data)}${suffix}`
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw cancelled(signal)
}

function cancelled(signal: AbortSignal): SessionReferenceError {
  return new SessionReferenceError('session reference preparation was cancelled', 'SESSION_REFERENCE_CANCELLED', { cause: signal.reason })
}
