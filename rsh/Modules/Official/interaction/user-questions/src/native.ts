/** Native human questions authenticated by the selected Agent and active Session authorities. */
import { NativeContributions, type NativePlugin, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from './protocol.ts'
import { UserQuestionError } from './question-error.ts'

export * from './protocol.ts'
export { UserQuestionError } from './question-error.ts'

/** An exact executing owner asking the human through an application Provider. */
export interface NativeUserQuestionRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly questions: AskUserQuestionItem[]
  readonly signal?: AbortSignal
}

/** Validated Provider invocation with registry, Agent and caller cancellation already merged. */
export interface NativeAdmittedUserQuestionRequest extends Omit<NativeUserQuestionRequest, 'signal'> {
  readonly signal: AbortSignal
}

/** A scoped answerer; cancellation must settle its accepted operation after releasing presentation resources. */
export interface NativeUserQuestionAnswerer {
  /**
   * Answer the request or delegate to the next visible Provider.
   * @param request - exact owner, questions and merged cancellation.
   * @param next - next visible answerer, callable at most once.
   * @returns human answers after the Provider has released pending resources.
   */
  ask(request: NativeAdmittedUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>
}

interface Registration {
  readonly answerer: NativeUserQuestionAnswerer
  readonly cancellation: AbortController
  readonly pending: Set<Promise<AskUserQuestionAnswer>>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { userQuestions: NativeUserQuestionRegistry }
}

/** Native answerer selection; Agent, Session and execution ownership remain with their selected authorities. */
export class NativeUserQuestionRegistry {
  private readonly answerers: NativeContributions<Registration>
  private readonly cancellation = new AbortController()
  private readonly pending = new Set<Promise<AskUserQuestionAnswer>>()
  private disposal: Promise<void> | undefined

  /**
   * @param scope - registration visibility root.
   * @param agents - exact Agent authority.
   * @param sessions - active Program ownership authority.
   */
  constructor(scope: NativeScope, private readonly agents: NativeAgentRegistry, private readonly sessions: NativeActiveSessionOperations) {
    this.answerers = new NativeContributions(scope)
  }

  /**
   * Install an answerer whose removal cancels and drains only its accepted requests.
   * @param name - exact contribution name.
   * @param answerer - UI or application transport implementation.
   * @param scope - visibility scope; omitted uses the registry root.
   * @returns exact idempotent removal and drain.
   */
  registerAnswerer(name: string, answerer: NativeUserQuestionAnswerer, scope?: NativeScope): () => Promise<void> {
    if (this.cancellation.signal.aborted) throw new UserQuestionError('user questions are disposed', 'ASK_ABORTED')
    const entry: Registration = { answerer, cancellation: new AbortController(), pending: new Set() }
    const detach = this.answerers.register(name, entry, scope)
    let removal: Promise<void> | undefined
    return () => {
      if (removal !== undefined) return removal
      detach()
      entry.cancellation.abort(new UserQuestionError('user question answerer was removed', 'ASK_ABORTED'))
      return removal = Promise.allSettled([...entry.pending]).then(() => undefined)
    }
  }

  /**
   * Ask visible Providers only for an exact live root invocation.
   * @param request - executing Agent, Session, questions and cancellation.
   * @returns human answers after pending presentation resources are released.
   */
  async ask(request: NativeUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted || this.cancellation.signal.aborted) throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
    this.assertOwner(request)
    if (request.questions.length === 0) throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    for (const question of request.questions) {
      const intent = question.intent
      if (intent !== undefined && (question.detail === undefined
        || !(question.options ?? []).some(option => option.label === intent.approve))) {
        throw new UserQuestionError(`question ${question.id} has invalid presentation intent`, 'BAD_INTENT')
      }
    }
    const owned = new AbortController()
    const detachOwner = this.agents.onDispose(request.agent, async () => {
      owned.abort(new UserQuestionError('question owner was released', 'ASK_ABORTED'))
      await Promise.allSettled([operation])
    })
    const signal = AbortSignal.any([owned.signal, this.cancellation.signal, ...request.signal === undefined ? [] : [request.signal]])
    const visible = [...this.answerers.visible(request.agent.scope).values()]
    const invoke = (index: number, inheritedSignal: AbortSignal): Promise<AskUserQuestionAnswer> => {
      const entry = visible[index]
      if (entry === undefined) return Promise.reject(new UserQuestionError('no user-questions answerer accepted the request', 'NO_PROVIDER'))
      if (entry.cancellation.signal.aborted) return invoke(index + 1, inheritedSignal)
      const invocationSignal = AbortSignal.any([inheritedSignal, entry.cancellation.signal])
      let delegated = false
      const work = Promise.resolve().then(() => entry.answerer.ask({ ...request,
        signal: invocationSignal,
      }, () => {
        if (delegated) throw new Error('user-questions: next called more than once')
        delegated = true
        return invoke(index + 1, invocationSignal)
      }))
      entry.pending.add(work)
      const settled = (): void => { entry.pending.delete(work) }
      void work.then(settled, settled)
      return work
    }
    const operation = invoke(0, signal)
    this.pending.add(operation)
    try {
      const answer = await operation
      signal.throwIfAborted()
      this.assertOwner(request)
      return answer
    } finally {
      this.pending.delete(operation)
      detachOwner()
    }
  }

  /** Close admission, cancel accepted questions and await Provider cleanup. @returns the memoized drain. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.cancellation.abort(new UserQuestionError('user questions are disposed', 'ASK_ABORTED'))
    return this.disposal = Promise.allSettled([...this.pending]).then(() => undefined)
  }

  private assertOwner(request: NativeUserQuestionRequest): void {
    if (this.agents.get(request.agent.id) !== request.agent) throw new UserQuestionError('human interaction requires the exact live calling agent', 'CALLER_NOT_LIVE')
    const owner = this.sessions.owner(request.agent, request.session)
    if (owner === undefined || !owner.writerAvailable) throw new UserQuestionError('human interaction requires the exact active Session owner', 'CALLER_NOT_LIVE')
    if (owner.invocation === 'delegated') throw new UserQuestionError('human interaction is unavailable to a delegated runtime invocation', 'DELEGATED_CALLER')
  }
}

/** Native Definition installed independently of any human interaction Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: 'user-questions', targets: ['host'], requires: ['agents', 'activeSessions'], provides: ['userQuestions'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('user-questions: configuration must be an empty object')
    }
    return (context) => {
      const service = new NativeUserQuestionRegistry(context.scope, context.require('agents'), context.require('activeSessions'))
      context.provide('userQuestions', service)
      context.own(() => service.dispose())
    }
  },
}
