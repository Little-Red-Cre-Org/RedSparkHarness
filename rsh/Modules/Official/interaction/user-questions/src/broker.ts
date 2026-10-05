/** Native application Provider for displaying pending questions and accepting wire answers. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { AskUserQuestionAnswer, NativeQuestionRequestId as QuestionId } from './protocol.ts'
import { UserQuestionError, type NativeUserQuestionAnswerer, type NativeUserQuestionRequest } from './native.ts'

/** Opaque identity of one pending human interaction. */
export type NativeQuestionRequestId = QuestionId

/**
 * Admit an opaque interaction identity from a transport message.
 * @param value - nonempty wire interaction id.
 * @returns the branded id; existence and ownership are checked by answer().
 */
export function NativeQuestionRequestId(value: string): NativeQuestionRequestId {
  if (value.length === 0) throw new UserQuestionError('human answer requires a request id', 'UNKNOWN_REQUEST')
  return brandString<NativeQuestionRequestId>(value)
}

/** Pending presentation retaining the exact executing Agent and questions. */
export interface NativePendingQuestion {
  readonly id: NativeQuestionRequestId
  readonly request: NativeUserQuestionRequest
}

interface Pending {
  readonly presentation: NativePendingQuestion
  readonly outcome: PromiseWithResolvers<AskUserQuestionAnswer>
  readonly listeners: Set<Listener>
}
interface Listener {
  readonly agent: NativeAgent | undefined
  readonly receive: (question: NativePendingQuestion) => void
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAnswer(value: unknown, pending: NativePendingQuestion): AskUserQuestionAnswer {
  if (!record(value) || Object.keys(value).some(key => key !== 'answers') || !Array.isArray(value.answers)) {
    throw new UserQuestionError('human answer must contain an answers array', 'BAD_ANSWER')
  }
  const seen = new Set<string>()
  const answers = value.answers.map((item) => {
    if (!record(item) || Object.keys(item).some(key => !['id', 'selected', 'custom'].includes(key))
      || typeof item.id !== 'string' || !Array.isArray(item.selected)
      || !item.selected.every(label => typeof label === 'string')
      || item.custom !== undefined && typeof item.custom !== 'string') {
      throw new UserQuestionError('human answer contains invalid fields', 'BAD_ANSWER')
    }
    const question = pending.request.questions.find(candidate => candidate.id === item.id)
    if (question === undefined || seen.has(item.id)) throw new UserQuestionError('human answer contains an unknown or duplicate question id', 'BAD_ANSWER')
    seen.add(item.id)
    const selected = item.selected
    if (new Set(selected).size !== selected.length || selected.some(label => !question.options?.some(option => option.label === label))
      || !question.multiSelect && (selected.length > 1 || item.custom !== undefined && selected.length > 0)) {
      throw new UserQuestionError('human answer selects invalid choices', 'BAD_ANSWER')
    }
    return { id: item.id, selected: [...selected], ...item.custom === undefined ? {} : { custom: item.custom } }
  })
  if (answers.length !== pending.request.questions.length) throw new UserQuestionError('human answer must include every requested question', 'BAD_ANSWER')
  return { answers }
}

/** Application-owned pending interaction Provider; it never creates Agent or Session execution. */
export class NativeQuestionBroker implements NativeUserQuestionAnswerer {
  private readonly listeners = new Set<Listener>()
  private readonly pending = new Map<NativeQuestionRequestId, Pending>()
  private readonly active = new Set<Promise<AskUserQuestionAnswer>>()
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * Subscribe a transport to future pending interactions.
   * @param receive - synchronous presentation dispatch; answer() may be called synchronously.
   * @param agent - exact recipient, or omitted for an application-wide authenticated transport.
   * @returns listener removal; requests with no remaining presentation recipient are cancelled.
   */
  onRequest(receive: (question: NativePendingQuestion) => void, agent?: NativeAgent): () => void {
    if (this.closing) throw new UserQuestionError('question broker is disposed', 'ASK_ABORTED')
    const listener = { agent, receive }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      for (const [id, pending] of this.pending) {
        pending.listeners.delete(listener)
        if (pending.listeners.size === 0) {
          this.pending.delete(id)
          pending.outcome.reject(new UserQuestionError('question presentation transport was removed', 'ASK_ABORTED'))
        }
      }
    }
  }

  /** @inheritdoc */
  ask(request: NativeUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer> {
    if (this.closing || request.signal?.aborted) return Promise.reject(new UserQuestionError('question broker request was aborted', 'ASK_ABORTED'))
    const listeners = [...this.listeners].filter(listener => listener.agent === undefined || listener.agent === request.agent)
    if (listeners.length === 0) return next()
    const id = brandString<NativeQuestionRequestId>(randomUUID())
    const outcome = Promise.withResolvers<AskUserQuestionAnswer>()
    const presentation = { id, request }
    this.pending.set(id, { presentation, outcome, listeners: new Set(listeners) })
    const cancel = (): void => {
      this.pending.delete(id)
      outcome.reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED', { cause: request.signal?.reason }))
    }
    request.signal?.addEventListener('abort', cancel, { once: true })
    const work = outcome.promise.finally(() => {
      this.pending.delete(id)
      this.active.delete(work)
      request.signal?.removeEventListener('abort', cancel)
    })
    this.active.add(work)
    for (const listener of listeners) {
      try {
        listener.receive(presentation)
      } catch (error) {
        outcome.reject(error)
      }
    }
    return work
  }

  /**
   * Accept a JSON answer for the pending request's exact Agent.
   * @param id - broker-issued interaction identity.
   * @param agent - authenticated exact live recipient retained by the transport.
   * @param answer - untrusted transport JSON, validated against the presented questions.
   */
  answer(id: NativeQuestionRequestId, agent: NativeAgent, answer: unknown): void {
    const pending = this.pending.get(id)
    if (pending === undefined) throw new UserQuestionError('human answer references no pending question', 'UNKNOWN_REQUEST')
    if (this.closing || pending.presentation.request.signal?.aborted) throw new UserQuestionError('human answer references a cancelled question', 'ASK_ABORTED')
    if (pending.presentation.request.agent !== agent) throw new UserQuestionError('human answer belongs to another Agent', 'CALLER_NOT_LIVE')
    const value = parseAnswer(answer, pending.presentation)
    this.pending.delete(id)
    pending.outcome.resolve(value)
  }

  /** Cancel pending presentations and await settlement. @returns the memoized drain promise. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    this.listeners.clear()
    for (const pending of this.pending.values()) pending.outcome.reject(new UserQuestionError('question broker was removed', 'ASK_ABORTED'))
    this.pending.clear()
    return this.disposal = Promise.allSettled([...this.active]).then(() => undefined)
  }
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { userQuestionBroker: NativeQuestionBroker }
}

/** Optional application Provider; a transport must subscribe before any human question can be accepted. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: 'user-question-broker', targets: ['host'], requires: ['userQuestions'], provides: ['userQuestionBroker'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('user-question-broker: configuration must be an empty object')
    }
    return (context) => {
      const broker = new NativeQuestionBroker()
      context.provide('userQuestionBroker', broker)
      context.own(() => broker.dispose())
      context.effect(context.require('userQuestions').registerAnswerer('broker', broker, context.scope))
    }
  },
}
