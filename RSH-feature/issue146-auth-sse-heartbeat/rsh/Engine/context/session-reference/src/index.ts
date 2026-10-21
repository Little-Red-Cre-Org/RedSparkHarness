/**
 * Cross-session snapshot preparation. Hosts adapt mentions into structured
 * references; this service owns exact reads, projection, budgets, and durable context.
 *
 * @module @deepseek-ai/dsh-session-reference
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-spill'
import { freezeMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, LlmResolvedModelInfo, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
// Type-only: the `title` projection key plus the live registry and durable
// cache Context merges — the two projection faces discovery labels from.
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { prepareReferenceInput, prepareReferencedMessage } from './prepared-context.ts'
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_MAX_REFERENCE_BYTES,
  MAX_REFERENCES,
  SessionReferenceError,
  type Config,
} from './config.ts'
import type {
  PreparedReferencedMessage, SessionReferenceCandidate, SessionReferenceInput,
  SessionReferenceMentionCandidate,
} from './types.ts'
import { formatSessionReferenceMention, parseSessionReferenceText } from './uri.ts'

export type * from './types.ts'
export type { Config, SessionReferenceErrorCode } from './config.ts'
export {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_MAX_REFERENCE_BYTES,
  MAX_REFERENCES,
  SessionReferenceError,
} from './config.ts'
export {
  SESSION_REFERENCE_SCHEME,
  decodeSessionReferenceUri,
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
  parseSessionReferenceText,
} from './uri.ts'

const DEFAULT_REFERENCE_CONTEXT_FRACTION = 0.2

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionReferenceResolver: SessionReferenceResolver
  }
}

/** Exact-read consumer that prepares immutable cross-session message context. */
export class SessionReferenceResolver extends TypertRemoteService {
  static inject = ['sessionQuery']
  static Config: z<Config> = z.object({
    maxReferences: z.number().step(1).min(1).max(MAX_REFERENCES).default(MAX_REFERENCES),
    candidateLimit: z.number().step(1).min(1).default(DEFAULT_CANDIDATE_LIMIT),
    maxReferenceBytes: z.number().step(1).min(1),
    referenceContextFraction: z.number().min(0).max(1).default(DEFAULT_REFERENCE_CONTEXT_FRACTION),
  })

  private readonly config: Required<Omit<Config, 'maxReferenceBytes'>> & { maxReferenceBytes: number | undefined }
  private readonly assembledRoutes = new WeakMap<Agent, { provider: string | undefined; model: string | undefined }>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionReferenceResolver')
    this.config = {
      maxReferences: config.maxReferences ?? MAX_REFERENCES,
      candidateLimit: config.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
      maxReferenceBytes: config.maxReferenceBytes,
      referenceContextFraction: config.referenceContextFraction ?? DEFAULT_REFERENCE_CONTEXT_FRACTION,
    }
    for (const name of ['maxReferences', 'candidateLimit', 'maxReferenceBytes'] as const) {
      const value = this.config[name]
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new SessionReferenceError(
          `session-reference: ${name} must be a positive safe integer`,
          'SESSION_REFERENCE_INVALID_CONFIG',
        )
      }
    }
    if (this.config.maxReferences > MAX_REFERENCES) {
      throw new SessionReferenceError(
        `session-reference: maxReferences must not exceed ${MAX_REFERENCES}`,
        'SESSION_REFERENCE_INVALID_CONFIG',
      )
    }
    if (!(this.config.referenceContextFraction >= 0 && this.config.referenceContextFraction <= 1)) {
      throw new SessionReferenceError(
        'session-reference: referenceContextFraction must be between zero and one',
        'SESSION_REFERENCE_INVALID_CONFIG',
      )
    }
    // Prepend observes model-selection overrides after downstream assembly completes.
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembly = await next()
      if (context.agent !== undefined) {
        const { provider, model } = assembly.variables
        this.assembledRoutes.set(context.agent, { provider, model })
      }
      return assembly
    }, { prepend: true })
    ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return {
        ...decision,
        messages: await this.prepareDirectMessages(agent, decision.messages, signal),
      }
    }, { prepend: true })
  }

  /**
   * Replace canonical mentions in direct user messages and place each prepared
   * snapshot immediately after the message that cited it.
   * @param agent - agent entering the model step.
   * @param messages - messages accepted by downstream pre-step listeners.
   * @param signal - active turn cancellation.
   * @returns direct messages followed by their session-reference context in citation order.
   */
  private async prepareDirectMessages(
    agent: Agent,
    messages: readonly UserMessage[],
    signal: AbortSignal,
  ): Promise<UserMessage[]> {
    const prepared = await Promise.all(messages.map(async (message): Promise<UserMessage[]> => {
      if (message.source.kind !== 'user') return [message]
      const references: SessionReferenceInput[] = []
      const content = message.content.map((block): ContentBlock => {
        if (block.type !== 'text') return block
        const parsed = parseSessionReferenceText(block.text)
        references.push(...parsed.references)
        return { type: 'text', text: parsed.text }
      })
      if (references.length === 0) return [message]
      const resolved = await this.prepare(agent, content, references, signal)
      const direct = freezeMessage({ ...message, content: resolved.content })
      /* v8 ignore if -- a parsed canonical mention always leaves one normalized reference */
      if (resolved.additionalContext === undefined) {
        throw new Error('session-reference preparation omitted context for a canonical mention')
      }
      return [direct, resolved.additionalContext]
    }))
    return prepared.flat()
  }

  /**
   * List reference candidates, ranked by working-directory affinity.
   *
   * Discovery runs at keystroke rate, so a title only ever comes from a
   * projection read: see {@link SessionReferenceResolver.projectedTitle} for
   * which sessions can answer one and which fall back to their id.
   * @param agent - target agent; self is excluded and its cwd drives ranking.
   * @param query - optional case-insensitive session-id/cwd/title substring.
   * @param limit - optional positive result cap.
   * @param signal - optional cancellation boundary for host autocomplete teardown.
   * @returns candidates labeled by latest title or, when absent, session id.
   */
  async listCandidates(
    agent: Agent,
    query: string = '',
    limit: number = this.config.candidateLimit,
    signal?: AbortSignal,
  ): Promise<SessionReferenceCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new SessionReferenceError('candidate limit must be a positive safe integer', 'SESSION_REFERENCE_INVALID_REFERENCE')
    }
    const needle = query.toLocaleLowerCase()
    const targetCwd = agent.session.header.cwd
    assertNotCancelled(signal)
    const records = (await settleWithCancellation(this.ctx.sessionQuery.listSessions(signal), signal))
      .filter(record => record.header.id !== agent.id)
      .map((record, index) => ({ record, index }))
    const labelled = records.map(({ record, index }) => ({
      record,
      index,
      label: this.projectedTitle(record) ?? record.header.id,
    }))
    return labelled.filter(({ record, label }) => {
      if (needle === '') return true
      return record.header.id.toLocaleLowerCase().includes(needle)
        || record.header.cwd?.toLocaleLowerCase().includes(needle) === true
        || label.toLocaleLowerCase().includes(needle)
    }).sort((a, b) => candidateRank(a.record.header.cwd, targetCwd) - candidateRank(b.record.header.cwd, targetCwd)
      || a.index - b.index)
      .slice(0, limit)
      .map(({ record, label }) => ({
        sessionId: record.header.id,
        label,
        ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
        sameWorkspace: record.header.cwd !== undefined && record.header.cwd === targetCwd,
        createdAt: record.header.createdAt,
      }))
  }

  /**
   * The title a session's projections can answer without reading its log.
   *
   * Attachment is decided by the store at read time, not by the listing:
   * a session that attached in between would otherwise be answered from a
   * checkpoint its live log has already moved past.
   *
   * An attached session answers from its live registry cut, which advances
   * with every committed event, so a rename or a just-generated title is
   * visible immediately; its events are already in memory, so the lazy fold
   * costs no I/O. A cold session answers from the durable checkpoint the
   * projection cache wrote when it went cold.
   *
   * Nothing else is attempted. Folding a title from a log costs the whole
   * log, and this call sits under every keystroke of `@` completion. A
   * session that no projection can answer for — one persisted before the
   * cache was composed, or seeded straight to disk — is labeled by its id
   * and cannot be found by its title until it is opened once, which
   * checkpoints it.
   * @param record - the listed session, live or cold.
   * @returns the projected title, or undefined when no projection holds one.
   */
  private projectedTitle(record: SessionRecord): string | undefined {
    const attached = this.ctx.get('sessions')?.get(record.header.id)
    const projections = this.ctx.get('sessionProjections')
    if (attached !== undefined && projections !== undefined) {
      return titleOf(projections.snapshot(attached, ['title']))
    }
    if (record.header.isSeeded) return undefined
    return titleOf(this.ctx.get('sessionProjectionCache')?.cachedSnapshot(
      record.header,
      SessionLogOffset(0),
      ['title'],
    ))
  }

  /**
   * Remote face of {@link listCandidates}: the configured candidate limit
   * applies, and every candidate carries the canonical mention a host inserts
   * into the prompt draft.
   * @param agent - target agent; self is excluded and its cwd drives ranking.
   * @param query - optional case-insensitive session-id/cwd/title substring.
   * @param signal - caller cancellation.
   * @returns mention-carrying candidates in rank order.
   */
  @Remote('candidates')
  async remoteExportCandidates(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<SessionReferenceMentionCandidate[]> {
    const candidates = await this.listCandidates(agent, query, this.config.candidateLimit, signal)
    return candidates.map(candidate => ({
      ...candidate,
      mention: formatSessionReferenceMention({ sessionId: candidate.sessionId, label: candidate.label }),
    }))
  }

  /**
   * Snapshot all references for one accepted direct message and return one aggregated durable context.
   * Automatic budgets use the last assembled route, or agent options before any assembly.
   * It snapshots direct content and validates references before asynchronous model-budget lookup.
   * Missing model capacity or adapter uses 64 KiB; other metadata lookup failures and cancellation reject preparation.
   * Truncated previews include omission facts and a full-snapshot spill locator, or an explicit unavailable notice.
   * Cancellation or failure waits for started reads and spill writes to settle before returning; cancellation prevents context publication.
   * @param agent - target agent; references to it are rejected.
   * @param content - already host-normalized readable message content.
   * @param references - structured source sessions in mention order.
   * @param signal - optional cancellation boundary for the active turn.
   * @returns detached content and optional referenced-session context.
   */
  async prepare(
    agent: Agent,
    content: ContentBlock[],
    references: SessionReferenceInput[],
    signal?: AbortSignal,
  ): Promise<PreparedReferencedMessage> {
    const preparedInput = prepareReferenceInput(agent.id, content, references, this.config.maxReferences, signal)
    if (preparedInput.references.length === 0) return { content: preparedInput.content }
    const maxReferenceBytes = await this.referenceBudget(agent, signal)
    const spillStore = this.ctx.get('spillStore')
    return prepareReferencedMessage({
      reader: this.ctx.sessionQuery,
      ...(spillStore === undefined ? {} : { spillStore }),
      ownerId: agent.session.id,
      ...preparedInput,
      maxReferenceBytes,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  private async referenceBudget(agent: Agent, signal: AbortSignal | undefined): Promise<number> {
    if (this.config.maxReferenceBytes !== undefined) return this.config.maxReferenceBytes
    // Options seed direct preparation; an assembled route owns model-step preparation.
    const { provider, model } = this.assembledRoutes.get(agent) ?? agent.options
    const llm = this.ctx.get('llm')
    if (provider === undefined || model === undefined || llm === undefined) return DEFAULT_MAX_REFERENCE_BYTES
    let info: LlmResolvedModelInfo
    try {
      info = await settleWithCancellation(llm.resolveModelInfo(provider, model, signal), signal)
    } catch (error: unknown) {
      // Stream middleware can serve routes without a registered adapter.
      if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
      return DEFAULT_MAX_REFERENCE_BYTES
    }
    if (info.context === undefined) return DEFAULT_MAX_REFERENCE_BYTES
    // Context capacity is in tokens; four bytes/token is a sizing heuristic, not token counting.
    return Math.max(DEFAULT_MAX_REFERENCE_BYTES, Math.floor(info.context.contextWindow * 4 * this.config.referenceContextFraction))
  }

}

/** The title in one projection snapshot; undefined when the unit is absent or still untitled. */
function titleOf(snapshot: ProjectionSnapshot | undefined): string | undefined {
  const title = snapshot?.values.title
  return title === undefined || title === null ? undefined : title
}

function candidateRank(candidateCwd: string | undefined, targetCwd: string | undefined): number {
  if (candidateCwd !== undefined && targetCwd !== undefined && candidateCwd === targetCwd) return 0
  if (candidateCwd === undefined) return 1
  return 2
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw cancelled(signal)
}

function settleWithCancellation<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(cancelled(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
    if (signal.aborted) onAbort()
  })
}

function cancelled(signal: AbortSignal): SessionReferenceError {
  return new SessionReferenceError('session reference preparation was cancelled', 'SESSION_REFERENCE_CANCELLED', { cause: signal.reason })
}

export default SessionReferenceResolver
