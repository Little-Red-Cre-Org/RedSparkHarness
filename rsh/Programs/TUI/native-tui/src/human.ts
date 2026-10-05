/** Owned terminal presentations; the selected Providers retain authority and audit writes. */
import type { NativeApprovalAnswererRequest, NativeApprovalService, NativeApprovalOutcome } from '@deepseek-ai/dsh-native-approval'
import type { NativeActiveSessionOperations, NativeRootExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
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
  readonly cancel?: () => Promise<void>
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

  private ask(prompt: TerminalHumanPrompt, signal: AbortSignal, cancel?: () => Promise<void>): Promise<string> {
    signal.throwIfAborted()
    if (this.closed) throw new Error(this.copy.closed)
    if (this.pending.length >= this.capacity) throw new Error(this.copy.humanFull)
    return new Promise<string>((resolve, reject) => {
      const entry: Pending = { prompt, signal, resolve, ...cancel === undefined ? {} : { cancel },
        abort: () => { entry.reject(signal.reason) },
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
   * @param cancel - exact root epoch cancellation and drain.
   * @returns one-shot human verdict; cancellation rejects to the existing Provider.
   */
  async approval(request: NativeApprovalAnswererRequest, cancel?: () => Promise<void>): Promise<NativeApprovalOutcome> {
    const answer = await this.ask({ kind: 'approval', toolName: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason } }, request.signal, cancel)
    return answer === '/allow' ? 'allowed-once' : 'rejected'
  }

  /**
   * @param request - exact root Session's questions with Provider-owned cancellation.
   * @param cancel - exact root epoch cancellation and drain.
   * @returns structured answers after the last presentation releases.
   */
  async questions(request: NativeAdmittedUserQuestionRequest, cancel?: () => Promise<void>): Promise<AskUserQuestionAnswer> {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const question of request.questions) {
      const answer = await this.ask({ kind: 'question', question }, request.signal, cancel)
      const options = question.options ?? []
      if (answer.startsWith('/other ')) answers.push({ id: question.id, selected: [], custom: answer.slice(7) })
      else if (options.length === 0) answers.push({ id: question.id, selected: [], custom: answer })
      else answers.push({ id: question.id, selected: options
        .filter((_option, index) => answer.split(',').map(Number).includes(index + 1)).map(option => option.label) })
    }
    return { answers }
  }

  /** Cancel the displayed request's actual root epoch without supplying an answer.
   * @param aborted - observes the exact Provider cancellation cause for locally admitted input.
   * @returns exact root drain, or undefined when no cancellable presentation is displayed.
   */
  cancel(aborted: (reason: unknown) => void): Promise<void> | undefined {
    const entry = this.pending[0]
    if (entry === undefined || entry.cancel === undefined) return undefined
    const cancel = entry.cancel
    return Promise.resolve().then(async () => {
      const onAbort = (): void => { aborted(entry.signal.reason) }
      entry.signal.addEventListener('abort', onAbort, { once: true })
      try { await cancel() } finally { entry.signal.removeEventListener('abort', onAbort) }
    })
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
 * @param executor - selected Program ownership and root epoch settlement.
 * @param owns - current terminal Session selection.
 * @param context - terminal registration ownership and question visibility scope.
 * @param approval - optional existing approval Provider.
 * @param questions - optional existing question Definition.
 */
export function bindTerminalHumanAnswerers(human: TerminalHumanInteraction, active: Pick<NativeActiveSessionOperations, 'owners'>,
  executor: Pick<NativeHeadlessApplication, 'interactionOwner'> & {
    readonly rootExecution: Pick<NativeRootExecutionOperations, 'capture' | 'cancel'>
  },
  owns: (id: SessionId) => boolean, context: Pick<NativeContext, 'own' | 'scope'>,
  approval?: Pick<NativeApprovalService, 'registerAnswerer'>, questions?: Pick<NativeUserQuestionRegistry, 'registerAnswerer'>): void {
  const cancellation = (agent: NativeApprovalAnswererRequest['agent'], session?: NativeAdmittedUserQuestionRequest['session']) => {
    const recipient = executor.interactionOwner(agent)
    if (recipient === undefined || recipient.agent !== recipient.displayRootAgent || !owns(recipient.displayRootSessionId)
      || session !== undefined && session !== recipient.session) return undefined
    const owner = active.owners().find(owner => owner.agent === recipient.agent && owner.session === recipient.session && owner.invocation === 'root')
    if (owner === undefined) return undefined
    executor.rootExecution.capture(owner)
    return (): Promise<void> => executor.rootExecution.cancel(owner)
  }
  if (approval !== undefined) context.own(approval.registerAnswerer((request) => {
    const cancel = cancellation(request.agent)
    return cancel === undefined ? undefined : human.approval(request, cancel)
  }))
  if (questions !== undefined) context.own(questions.registerAnswerer('native-tui', { ask: (request, next) => {
    const cancel = cancellation(request.agent, request.session)
    return cancel === undefined ? next() : human.questions(request, cancel)
  } }, context.scope))
}
