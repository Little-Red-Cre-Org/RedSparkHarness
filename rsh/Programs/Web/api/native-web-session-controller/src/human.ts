/** Bounded Web presentations owned by existing approval and question Providers. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeApprovalAnswererRequest, NativeApprovalOutcome } from '@deepseek-ai/dsh-approval-definition'
import { parseUserQuestionAnswer, type NativeAdmittedUserQuestionRequest, type AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/native'
import type { NativeWebHumanPrompt, NativeWebHumanId } from '@deepseek-ai/dsh-client-native-session/human'
import type { NativeSessionFeed } from './follow.ts'

interface Pending {
  readonly feed: NativeSessionFeed
  readonly parseAnswer: (value: unknown) => unknown
  readonly agent: NativeAgent
  readonly prompt: NativeWebHumanPrompt
  readonly signal: AbortSignal
  readonly finish: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

/** Holds presentation promises only; the selected Providers own execution and audit writes. */
export class NativeWebHumanInteraction {
  private readonly pending = new Map<NativeWebHumanId, Pending>()
  private closed = false
  /** @param capacity - maximum unanswered presentations across admitted Web turns. */
  constructor(private readonly capacity: number) {}

  private ask(agent: NativeAgent, prompt: NativeWebHumanPrompt,
    signal: AbortSignal, feed: NativeSessionFeed, parseAnswer: (value: unknown) => unknown): Promise<unknown> {
    signal.throwIfAborted()
    if (this.closed || this.pending.size >= this.capacity) throw new Error('native Web human interaction is closed or at capacity')
    const outcome = Promise.withResolvers<unknown>()
    const remove = (): void => {
      this.pending.delete(prompt.id)
      signal.removeEventListener('abort', abort)
      feed.push({ type: 'human-removed', id: prompt.id })
      const next = [...this.pending.values()].find(entry => entry.feed === feed)
      if (next !== undefined && !this.closed) feed.push({ type: 'human', prompt: next.prompt })
    }
    const abort = (): void => { remove(); outcome.reject(signal.reason) }
    const entry: Pending = { feed, agent, prompt, signal, parseAnswer,
      finish: (value) => { remove(); outcome.resolve(value) },
      reject: (error) => { remove(); outcome.reject(error) } }
    this.pending.set(prompt.id, entry)
    signal.addEventListener('abort', abort, { once: true })
    if ([...this.pending.values()].find(entry => entry.feed === feed) === entry) feed.push({ type: 'human', prompt })
    return outcome.promise
  }

  /** @param request - exact Provider-admitted approval.
   * @param feed - owning admitted turn's presentation stream.
   * @returns one-shot verdict after presentation removal.
   */
  async approval(request: NativeApprovalAnswererRequest, feed: NativeSessionFeed): Promise<NativeApprovalOutcome> {
    return await this.ask(request.agent, { kind: 'approval', id: brandString<NativeWebHumanId>(randomUUID()),
      toolName: request.toolName, ...request.reason === undefined ? {} : { reason: request.reason } },
    request.signal, feed, value => value) as NativeApprovalOutcome
  }

  /** @param request - exact root owner's questions and merged Provider cancellation.
   * @param feed - owning admitted turn's presentation stream.
   * @returns validated structured answers after presentation removal.
   */
  async questions(request: NativeAdmittedUserQuestionRequest, feed: NativeSessionFeed): Promise<AskUserQuestionAnswer> {
    return await this.ask(request.agent, { kind: 'questions', id: brandString<NativeWebHumanId>(randomUUID()),
      questions: request.questions },
    request.signal, feed, value => parseUserQuestionAnswer(value, request.questions)) as AskUserQuestionAnswer
  }

  /** @param id - exact browser-observed presentation id.
   * @param agent - exact current active root owner, checked by the admitted-turn controller.
   * @param value - untrusted answer JSON.
   */
  answer(id: NativeWebHumanId, agent: NativeAgent, value: unknown): void {
    const entry = this.pending.get(id)
    if (entry === undefined || entry.agent !== agent || entry.signal.aborted || this.closed) throw new Error('native Web human answer is stale or belongs to another owner')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native Web human answer must be an object')
    const answer = value as Record<string, unknown>
    if (entry.prompt.kind === 'approval') {
      if (Object.keys(answer).some(key => !['kind', 'outcome'].includes(key)) || answer.kind !== 'approval'
        || answer.outcome !== 'allowed-once' && answer.outcome !== 'rejected') throw new TypeError('native Web approval requires an allow or reject verdict')
      entry.finish(answer.outcome)
    } else {
      if (Object.keys(answer).some(key => !['kind', 'answer'].includes(key)) || answer.kind !== 'questions') throw new TypeError('native Web question answer has invalid fields')
      entry.finish(entry.parseAnswer(answer.answer))
    }
  }

  /** Withdraw unanswered presentations before the Program drains its accepted turns. */
  close(): void {
    this.closed = true
    for (const entry of [...this.pending.values()]) entry.reject(new Error('native Web human interaction was disposed'))
  }
}
