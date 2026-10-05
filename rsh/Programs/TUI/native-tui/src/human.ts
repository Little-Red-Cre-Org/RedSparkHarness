/** Owned terminal presentations; the selected Providers retain authority and audit writes. */
import type { NativeApprovalAnswererRequest, NativeApprovalService, NativeApprovalOutcome } from '@deepseek-ai/dsh-native-approval'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAdmittedUserQuestionRequest, NativeUserQuestionRegistry, AskUserQuestionItem,
  AskUserQuestionAnswer, AskUserQuestionAnswerItem } from '@deepseek-ai/dsh-user-questions/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { terminalCopy } from './locale.ts'

/** Only presentation data crosses into Ink; Agent and writer objects remain in the answerers. */
export type TerminalHumanPrompt =
  | { readonly kind: 'approval'; readonly toolName: string; readonly reason?: string }
  | { readonly kind: 'question'; readonly question: AskUserQuestionItem }

interface Pending {
  readonly prompt: TerminalHumanPrompt
  readonly signal: AbortSignal
  readonly abort: () => void
  readonly resolve: (value: string) => void
  readonly reject: (reason: unknown) => void
}

/** Bounded FIFO human input, cancelled synchronously before terminal execution drains. */
export class TerminalHumanInteraction {
  private readonly pending: Pending[] = []
  private closed = false
  /**
   * @param capacity - maximum unanswered presentations.
   * @param copy - selected locale's input diagnostics.
   * @param publish - renderer observation without execution authority.
   */
  constructor(private readonly capacity: number, private readonly copy: ReturnType<typeof terminalCopy>,
    private readonly publish: (prompt: TerminalHumanPrompt | undefined) => void) {}

  private ask(prompt: TerminalHumanPrompt, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    if (this.closed) throw new Error(this.copy.closed)
    if (this.pending.length >= this.capacity) throw new Error(this.copy.humanFull)
    return new Promise<string>((resolve, reject) => {
      const entry: Pending = { prompt, signal, resolve, abort: () => { entry.reject(signal.reason) },
        reject: (reason) => { this.remove(entry)
          // Preserve the Provider's exact cancellation reason, including non-Error reasons.
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors
          reject(reason) } }
      this.pending.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      this.publish(this.pending[0]?.prompt)
    })
  }

  private remove(entry: Pending): void {
    entry.signal.removeEventListener('abort', entry.abort)
    this.pending.splice(this.pending.indexOf(entry), 1)
    this.publish(this.pending[0]?.prompt)
  }

  /**
   * @param request - exact Provider-admitted tool approval.
   * @returns one-shot human verdict; cancellation rejects to the existing Provider.
   */
  async approval(request: NativeApprovalAnswererRequest): Promise<NativeApprovalOutcome> {
    const answer = await this.ask({ kind: 'approval', toolName: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason } }, request.signal)
    return answer === '/allow' ? 'allowed-once' : 'rejected'
  }

  /**
   * @param request - exact root Session's questions with Provider-owned cancellation.
   * @returns structured answers after the last presentation releases.
   */
  async questions(request: NativeAdmittedUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const question of request.questions) {
      const answer = await this.ask({ kind: 'question', question }, request.signal)
      const options = question.options ?? []
      if (answer.startsWith('/other ')) answers.push({ id: question.id, selected: [], custom: answer.slice(7) })
      else if (options.length === 0) answers.push({ id: question.id, selected: [], custom: answer })
      else answers.push({ id: question.id, selected: options
        .filter((_option, index) => answer.split(',').map(Number).includes(index + 1)).map(option => option.label) })
    }
    return { answers }
  }

  /**
   * @param value - terminal input for the currently displayed request.
   * @param expected - exact presentation observed by the renderer; stale answers refuse.
   */
  answer(value: string, expected: TerminalHumanPrompt): void {
    const entry = this.pending[0]
    if (entry === undefined || entry.prompt !== expected) throw new Error(this.copy.noHuman)
    const text = value.trim()
    if (entry.prompt.kind === 'approval') {
      if (text !== '/allow' && text !== '/deny') throw new Error(this.copy.approvalHint)
    } else {
      const question = entry.prompt.question
      const options = question.options ?? []
      if (text === '' || text === '/other' || text.startsWith('/other ') && text.slice(7).trim() === '') {
        throw new Error(this.copy.answerHint)
      }
      if (options.length !== 0 && !text.startsWith('/other ')) {
        const indices = text.split(',').map(Number)
        if (indices.some(index => !Number.isSafeInteger(index) || index < 1 || index > options.length)
          || new Set(indices).size !== indices.length || !question.multiSelect && indices.length !== 1) {
          throw new Error(this.copy.answerHint)
        }
      }
    }
    this.remove(entry)
    entry.resolve(text)
  }

  /** Reject every unanswered presentation before waiting for execution cleanup. */
  close(): void {
    this.closed = true
    for (const entry of [...this.pending]) { entry.reject(new Error(this.copy.closed)) }
  }
}

/** Register scoped answerers only for this terminal's exact active root Session.
 * @param human - terminal-owned input presentations.
 * @param active - existing exact active Session authority.
 * @param owns - current terminal Session selection.
 * @param context - terminal registration ownership and question visibility scope.
 * @param approval - optional existing approval Provider.
 * @param questions - optional existing question Definition.
 */
export function bindTerminalHumanAnswerers(human: TerminalHumanInteraction, active: Pick<NativeActiveSessionOperations, 'owners'>,
  owns: (id: SessionId) => boolean, context: Pick<NativeContext, 'own' | 'scope'>,
  approval?: Pick<NativeApprovalService, 'registerAnswerer'>, questions?: Pick<NativeUserQuestionRegistry, 'registerAnswerer'>): void {
  if (approval !== undefined) context.own(approval.registerAnswerer((request) => {
    const owner = active.owners().find(owner => owner.agent === request.agent && owner.invocation === 'root' && owns(owner.session.id))
    return owner === undefined ? undefined : human.approval(request)
  }))
  if (questions !== undefined) context.own(questions.registerAnswerer('native-tui', { ask: (request, next) =>
    owns(request.session.id) ? human.questions(request) : next() }, context.scope))
}
