/** Native tool-approval policy, answerer dispatch, and durable audit vocabulary. */
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {
  NativeApprovalAnswerer,
  NativeApprovalAnswererRequest,
  NativeApprovalRequest,
  NativeApprovalServiceDefinition,
} from '@deepseek-ai/dsh-approval-definition'
import * as approvalTypes from './types.ts'

export {
  NativeApprovalRequestId,
} from './types.ts'
export type {
  NativeApprovalAnswerer,
  NativeApprovalAnswererRequest,
  NativeApprovalDecision,
  NativeApprovalOutcome,
  NativeApprovalPolicy,
  NativeApprovalRequest,
  NativeApprovalServiceDefinition,
} from './types.ts'

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
  const policy = fields?.policy === undefined ? 'ask' : fields.policy
  if (policy !== 'ask' && policy !== 'never') throw new Error('native-approval: policy must be ask or never')
  return { policy }
}

/**
 * Applies one deployment policy, dispatches answerers in registration order,
 * and cancels unsettled requests before its Provider releases the Agent authority.
 */
export class NativeApprovalService implements NativeApprovalServiceDefinition {
  private readonly answerers = new Set<NativeApprovalAnswerer>()
  private readonly controller = new AbortController()
  private readonly active = new Set<Promise<approvalTypes.NativeApprovalDecision>>()
  private readonly answererWork = new Set<Promise<void>>()
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param agents - registry that confirms the exact requesting Agent remains live.
   * @param policy - deployment policy before answerer dispatch.
   */
  constructor(private readonly agents: NativeAgentRegistry, readonly policy: approvalTypes.NativeApprovalPolicy) {}

  /**
   * Register one ordered answerer; returning undefined delegates to the next answerer.
   * The request signal is aborted when its caller cancels or this Provider is disposed.
   * Answerers must stop their owned work and settle after that signal aborts.
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
   * @param request - exact live Agent, operation, and id already recorded by its Session owner.
   * @returns a closed decision for the consumer to audit and enforce.
   */
  request(request: NativeApprovalRequest): Promise<approvalTypes.NativeApprovalDecision> {
    this.assertOpen()
    if (this.agents.get(request.agent.id) !== request.agent) {
      throw new Error(`native-approval: Agent "${request.agent.id}" is not registered`)
    }
    const controller = new AbortController()
    const abortFromService = (): void => { controller.abort(this.controller.signal.reason) }
    const abortFromCaller = (): void => { controller.abort(request.signal?.reason) }
    this.controller.signal.addEventListener('abort', abortFromService, { once: true })
    if (request.signal?.aborted) abortFromCaller()
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const answererRequest: NativeApprovalAnswererRequest = {
      ...request,
      signal: controller.signal,
      policy: request.sessionPolicy ?? this.policy,
    }
    const task = this.decide(answererRequest)
    this.active.add(task)
    const cleanup = (): void => {
      this.active.delete(task)
      this.controller.signal.removeEventListener('abort', abortFromService)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }
    void task.then(cleanup, cleanup)
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
      await Promise.allSettled([...this.answererWork])
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
        request.signal.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => { complete('cancelled') }
      request.signal.addEventListener('abort', onAbort, { once: true })
      let work: Promise<approvalTypes.NativeApprovalOutcome | undefined>
      try {
        work = Promise.resolve(answerer(request))
      } catch {
        work = Promise.resolve<approvalTypes.NativeApprovalOutcome>('unavailable')
      }
      const quiescence = work.then(() => undefined, () => undefined)
      this.answererWork.add(quiescence)
      void quiescence.then(() => this.answererWork.delete(quiescence))
      void work.then(
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

  private isAborted(signal: AbortSignal): boolean {
    return signal.aborted
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
