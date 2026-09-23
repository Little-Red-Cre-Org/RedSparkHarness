/** Native tool-approval policy, answerer dispatch, and durable audit vocabulary. */
import { randomUUID } from 'node:crypto'
import { type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import * as approvalTypes from './types.ts'

export {
  NativeApprovalRequestId,
  type NativeApprovalDecision,
  type NativeApprovalOutcome,
  type NativeApprovalPolicy,
} from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { approval: NativeApprovalService }
}

/** One exact operation that requires an approval decision. */
export interface NativeApprovalRequest {
  /** Registered Agent that owns the requested operation. */
  readonly agent: NativeAgent
  /** Model-visible tool name the application is about to execute. */
  readonly toolName: string
  /** Model tool-call identifier, when the application has one. */
  readonly callId?: ToolCallId
  /** User-facing reason supplied by the tool contribution or application. */
  readonly reason?: string
  /** Cancels the unanswered request and prevents a late answer from applying. */
  readonly signal?: AbortSignal
}

/** The immutable request passed to one native answerer. */
export interface NativeApprovalAnswererRequest extends NativeApprovalRequest {
  /** Fresh identifier for the request and its durable audit pair. */
  readonly id: approvalTypes.NativeApprovalRequestId
  /** Effective policy selected before answerer dispatch. */
  readonly policy: approvalTypes.NativeApprovalPolicy
}

/** One answerer may claim a request with an outcome or return undefined to delegate. */
export type NativeApprovalAnswerer = (request: NativeApprovalAnswererRequest) =>
  approvalTypes.NativeApprovalOutcome | undefined | Promise<approvalTypes.NativeApprovalOutcome | undefined>

/** Optional native-provider configuration. */
export interface Config {
  /** Default policy; ask delegates to registered answerers and otherwise fails closed. */
  readonly policy?: approvalTypes.NativeApprovalPolicy
}

function resolveConfig(input: unknown): Required<Config> {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('native-approval: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  for (const key of Object.keys(fields ?? {})) {
    if (key !== 'policy') throw new Error(`native-approval: unknown configuration field ${key}`)
  }
  const policy = fields?.policy ?? 'ask'
  if (policy !== 'ask' && policy !== 'never') throw new Error('native-approval: policy must be ask or never')
  return { policy }
}

/**
 * Applies one deployment policy, dispatches answerers in registration order,
 * and cancels unsettled requests before its Provider releases the Agent authority.
 */
export class NativeApprovalService {
  private readonly answerers = new Set<NativeApprovalAnswerer>()
  private readonly controller = new AbortController()
  private readonly active = new Set<Promise<approvalTypes.NativeApprovalDecision>>()
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param agents - registry that confirms the exact requesting Agent remains live.
   * @param policy - deployment policy before answerer dispatch.
   */
  constructor(private readonly agents: NativeAgentRegistry, readonly policy: approvalTypes.NativeApprovalPolicy) {}

  /**
   * Register one ordered answerer; returning undefined delegates to the next answerer.
   * @param answerer - deployment-owned decision callback.
   * @returns idempotent removal of this exact answerer.
   */
  registerAnswerer(answerer: NativeApprovalAnswerer): () => void {
    this.assertOpen()
    this.answerers.add(answerer)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      this.answerers.delete(answerer)
    }
  }

  /**
   * Resolve one approval request with policy, cancellation, and the selected answerer chain.
   * @param request - exact live Agent and operation awaiting one decision.
   * @returns a closed decision for the consumer to audit and enforce.
   */
  request(request: NativeApprovalRequest): Promise<approvalTypes.NativeApprovalDecision> {
    this.assertOpen()
    if (this.agents.get(request.agent.id) !== request.agent) {
      throw new Error(`native-approval: Agent "${request.agent.id}" is not registered`)
    }
    const task = this.decide({ ...request, id: approvalTypes.NativeApprovalRequestId(randomUUID()), policy: this.policy })
    this.active.add(task)
    void task.then(() => this.active.delete(task), () => this.active.delete(task))
    return task
  }

  /**
   * Stop new requests and cancel every unsettled decision.
   * @returns completion after all active request decisions have settled.
   */
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.closing = true
      this.controller.abort()
      await Promise.allSettled([...this.active])
      this.answerers.clear()
    })()
  }

  private async decide(request: NativeApprovalAnswererRequest): Promise<approvalTypes.NativeApprovalDecision> {
    if (this.isAborted(request.signal)) return this.decision(request, 'cancelled')
    if (request.policy === 'never') return this.decision(request, 'rejected')
    for (const answerer of [...this.answerers]) {
      const outcome = await this.answer(answerer, request)
      if (outcome !== undefined) return this.decision(request, outcome)
    }
    return this.decision(request, 'unavailable')
  }

  private answer(
    answerer: NativeApprovalAnswerer, request: NativeApprovalAnswererRequest,
  ): Promise<approvalTypes.NativeApprovalOutcome | undefined> {
    if (this.isAborted(request.signal)) return Promise.resolve('cancelled')
    return new Promise((resolve) => {
      let settled = false
      const complete = (outcome: approvalTypes.NativeApprovalOutcome | undefined): void => {
        if (settled) return
        settled = true
        request.signal?.removeEventListener('abort', onAbort)
        this.controller.signal.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => { complete('cancelled') }
      request.signal?.addEventListener('abort', onAbort, { once: true })
      this.controller.signal.addEventListener('abort', onAbort, { once: true })
      void Promise.resolve(answerer(request)).then(
        (outcome) => { complete(outcome) },
        () => { complete('unavailable') },
      )
    })
  }

  private decision(
    request: NativeApprovalAnswererRequest, outcome: approvalTypes.NativeApprovalOutcome,
  ): approvalTypes.NativeApprovalDecision {
    return { id: request.id, policy: request.policy, outcome }
  }

  private isAborted(signal: AbortSignal | undefined): boolean {
    return this.controller.signal.aborted || signal?.aborted === true
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('native-approval: service is disposed')
  }
}

/** Native approval Provider with explicit deployment policy and answerer registration. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-approval', targets: ['host'],
  requires: ['agents'], provides: ['approval'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const service = new NativeApprovalService(context.require('agents'), config.policy)
      context.own(() => service.dispose())
      context.provide('approval', service)
    }
  },
}
