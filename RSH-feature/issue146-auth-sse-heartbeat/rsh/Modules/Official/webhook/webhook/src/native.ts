/** Native trusted Webhook rules with ordinary root Session execution. */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title/normalize'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner, NativeRootExecutionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativePermissionPresetOperations } from '@deepseek-ai/dsh-permission-presets/native-definition'
import type { WorkspaceRegistryRuntime } from '@deepseek-ai/dsh-workspace/native'
import type { WebhookRuleId } from './brand.ts'
import type { NativeWebhookRuleOperations } from './native-definition.ts'
import type { VerifiedWebhookDelivery, WebhookRule, WebhookSessionRequest } from './types.ts'
import type {} from '@deepseek-ai/dsh-permission-presets/native-definition'
import type {} from '@deepseek-ai/dsh-session-title/types'
import type {} from './types.ts'

interface AnyRule {
  readonly id: WebhookRuleId
  readonly kind: string
  run(delivery: Readonly<VerifiedWebhookDelivery>, signal: AbortSignal):
    WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

interface Registration {
  readonly rule: AnyRule
  readonly controller: AbortController
  readonly active: Set<Promise<void>>
  closing: boolean
  disposal?: Promise<void>
}

interface ResolvedWebhookSessionRequest extends WebhookSessionRequest {
  readonly title: string
  readonly prompt: string
}

function snapshotDelivery(delivery: VerifiedWebhookDelivery): Readonly<VerifiedWebhookDelivery> {
  if (typeof delivery.kind !== 'string' || delivery.kind.trim() === ''
    || typeof delivery.source !== 'string' || delivery.source.trim() === ''
    || typeof delivery.deliveryId !== 'string' || delivery.deliveryId.trim() === ''
    || !Number.isSafeInteger(delivery.receivedAt) || delivery.receivedAt < 0) {
    throw new TypeError('webhook: invalid verified delivery')
  }
  const snapshot = snapshotJsonValue(delivery)
  if (snapshot === undefined) throw new TypeError('webhook: delivery is not lossless JSON')
  return deepFreeze(snapshot)
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`webhook Session request ${field} must be non-empty`)
  return value
}

/** Detach rule-owned values before awaiting any Native Provider. */
function resolveRequest(input: WebhookSessionRequest): ResolvedWebhookSessionRequest {
  const candidate: unknown = input
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('webhook rule result must be null or a Session request object')
  }
  const record = candidate as Record<string, unknown>
  const workspacePath = requiredString(record, 'workspacePath')
  if (!isAbsolute(workspacePath)) throw new TypeError('webhook Session request workspacePath must be absolute')
  const title = normalizeSessionTitle(requiredString(record, 'title'), 120)
  if (title.length === 0) throw new TypeError('webhook Session request title is empty after normalization')
  const prompt = requiredString(record, 'prompt')
  const agentPreset = requiredString(record, 'agentPreset')
  const permissionPreset = requiredString(record, 'permissionPreset')
  const rawModel = record['model']
  if (rawModel === undefined) return { workspacePath, title, prompt, agentPreset, permissionPreset }
  if (rawModel === null || typeof rawModel !== 'object' || Array.isArray(rawModel)) {
    throw new TypeError('webhook Session request model must be an object')
  }
  const model = rawModel as Record<string, unknown>
  const provider = requiredString(model, 'provider')
  const modelId = requiredString(model, 'model')
  const maxTokens = model['maxTokens']
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new TypeError('webhook Session request model.maxTokens must be a positive safe integer')
  }
  return { workspacePath, title, prompt, agentPreset, permissionPreset,
    model: { provider, model: modelId, ...maxTokens === undefined ? {} : { maxTokens } } }
}

/** Trusted-rule registry and the Webhook feature's sole Session-action adapter. */
export class NativeWebhookRuleRegistry implements NativeWebhookRuleOperations {
  private readonly rules = new Map<WebhookRuleId, Registration>()
  private readonly registrations = new Set<Registration>()
  private readonly cancellation = new AbortController()
  private readonly routes = new Map<NativeRootRouteId, { readonly route: NativeRootRouteId; users: number; releasing?: Promise<void> }>()
  private closing = false
  private closePromise: Promise<void> | undefined

  constructor(private readonly root: NativeRootExecutionOperations,
    private readonly workspaces: WorkspaceRegistryRuntime,
    private readonly presets: NativeAgentPresetOperations,
    private readonly permissions: NativePermissionPresetOperations,
    private readonly models?: NativeModelSelectionOperations,
    private readonly directory?: NativeModelDirectory) {}

  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.closing) throw new Error('webhook: Native registry is closing')
    if (typeof rule.id !== 'string' || rule.id.trim() === '' || typeof rule.kind !== 'string' || rule.kind.trim() === ''
      || typeof rule.run !== 'function') throw new TypeError('webhook: invalid trusted rule')
    if (this.rules.has(rule.id)) throw new Error(`webhook: rule ${JSON.stringify(rule.id)} is already registered`)
    const registration: Registration = { rule,
      controller: new AbortController(), active: new Set(), closing: false }
    this.rules.set(rule.id, registration)
    this.registrations.add(registration)
    return () => this.disposeRegistration(registration)
  }

  async dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>, route: NativeRootRouteId): Promise<void> {
    if (this.closing) throw new Error('webhook: Native registry is closing')
    const snapshot = snapshotDelivery(delivery)
    const selectedRoute = this.root.resolve(route)
    const matched = [...this.rules.values()].filter(registration =>
      !registration.closing && registration.rule.kind === snapshot.kind)
    const holds = matched.map((registration) => {
      let release!: () => void
      const drain = new Promise<void>((resolve) => { release = resolve })
      registration.active.add(drain)
      return { registration, drain, release }
    })
    try {
      // Resolve every trusted callback before creating any Session, so a rule exception has no partial actions.
      const outcomes = await Promise.allSettled(holds.map(async ({ registration }) => {
        const signal = AbortSignal.any([registration.controller.signal, this.cancellation.signal])
        signal.throwIfAborted()
        const request = await registration.rule.run(snapshot, signal)
        signal.throwIfAborted()
        return { registration, request: request === null ? null : resolveRequest(request) }
      }))
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'webhook: trusted rule dispatch failed')
      const results = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
      const actions = await Promise.allSettled(results.flatMap(({ registration, request }) => request === null ? [] : [
        this.createWebhookSession(registration, selectedRoute.id, snapshot, registration.rule.id, request,
          AbortSignal.any([registration.controller.signal, this.cancellation.signal])),
      ]))
      const actionFailures = actions.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (actionFailures.length > 0) {
        throw new AggregateError(actionFailures, 'webhook: one or more Session requests failed; accepted inbox messages remain durable')
      }
    } finally {
      for (const { registration, drain, release } of holds) {
        registration.active.delete(drain)
        release()
      }
    }
  }

  /**
   * Stop registry admission, cancel its owned executions, and wait for every rule drain.
   * @returns completion after every accepted root execution and cleanup has settled.
   */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    const completion = Promise.withResolvers<void>()
    this.closePromise = completion.promise
    this.closing = true
    this.cancellation.abort(new Error('webhook: Native registry is closing'))
    void Promise.all([...this.registrations].map(registration => this.disposeRegistration(registration)))
      .then(() => { completion.resolve() }, (error: unknown) => { completion.reject(error) })
    return this.closePromise
  }

  private async createWebhookSession(registration: Registration, baseRoute: NativeRootRouteId,
    delivery: Readonly<VerifiedWebhookDelivery>, ruleId: WebhookRuleId,
    request: ResolvedWebhookSessionRequest, caller: AbortSignal): Promise<void> {
    const deletions = this.root.deletions
    if (deletions === undefined || this.root.createWorkspaceRoute === undefined) {
      throw new Error('webhook: complete root Session execution is unavailable')
    }
    caller.throwIfAborted()
    const selectedPreset = this.presets.resolvePreset({ fresh: true,
      facts: { preset: null, revision: null, locked: false }, preset: request.agentPreset })
    if (selectedPreset === null) throw new Error('webhook: requested Agent preset is unavailable')
    this.permissions.resolve(request.permissionPreset)
    if (request.model !== undefined) {
      if (this.models === undefined || this.directory === undefined) throw new Error('webhook: explicit model selection is unavailable')
      await this.directory.resolve(request.model.provider, request.model.model, caller)
      caller.throwIfAborted()
    }

    const routeLease = await this.acquireRoute(baseRoute, request.workspacePath, (routeRequest, routeSignal) =>
      this.root.createWorkspaceRoute?.(routeRequest, routeSignal)
        ?? Promise.reject(new Error('webhook: Workspace route creation became unavailable')), caller)
    const route = this.root.resolve(routeLease.route)
    const workspace = route.workspaceId === undefined ? undefined : this.workspaces.get(route.workspaceId)
    if (workspace === undefined) {
      await routeLease.release()
      throw new Error('webhook: admitted Workspace is no longer registered')
    }

    const id = SessionId(`webhook-${randomUUID()}`)
    const executionController = new AbortController()
    const acknowledged = Promise.withResolvers<void>()
    let admitted = false
    let attached = false
    let settled: Promise<void> | undefined
    let sessionOwner: NativeActiveSessionOwner | undefined
    const stopExecution = (): void => {
      executionController.abort(caller.reason ?? new Error('webhook request cancelled'))
    }
    caller.addEventListener('abort', stopExecution, { once: true })
    try {
      caller.throwIfAborted()
      await this.root.maintenance({ route: route.id, id, resume: false, preset: selectedPreset.id }, async (owner) => {
        sessionOwner = owner
        owner.append('session/title', { title: request.title, messageSeqs: [], source: { kind: 'user' } })
        await this.permissions.apply(owner, request.permissionPreset, caller)
        if (request.model !== undefined) {
          const models = this.models
          if (models === undefined) throw new Error('webhook: explicit model selection is unavailable')
          const current = await models.state(owner, caller)
          await models.select(owner, { selected: request.model, expectedRevision: current.revision }, caller)
        }
      }, caller)
      caller.throwIfAborted()
      await workspace.attachSession(id)
      attached = true
      caller.throwIfAborted()
      const message = createUserMessage({
        content: [{ type: 'text', text: request.prompt }],
        source: { kind: 'webhook', provider: delivery.kind, source: delivery.source, deliveryId: delivery.deliveryId,
          ruleId, form: 'notice', summary: boundContextSummary(`${delivery.kind} webhook handled by ${ruleId}`) },
      })
      const execution = this.root.execute({ route: route.id, id, resume: true, message, onEvent: (event) => {
        if (event.type !== 'agent/inbox/spliced' || !event.data.inserted.some(item => item.id === message.id)) return
        admitted = true
        acknowledged.resolve()
      } }, executionController.signal)
      const cleanup = async (): Promise<void> => {
        caller.removeEventListener('abort', stopExecution)
        const failures: unknown[] = []
        let retired = sessionOwner === undefined
        if (sessionOwner !== undefined) {
          try {
            await this.root.releaseIdle({ route: route.id, id, expectedOwner: sessionOwner }, new AbortController().signal)
            retired = true
          } catch (error: unknown) { failures.push(error) }
        }
        if (!admitted && retired && sessionOwner !== undefined) {
          if (attached) {
            try { await workspace.detachSession(id) } catch (error: unknown) { failures.push(error) }
          }
          try { await deletions.delete({ route: route.id, id }, new AbortController().signal) }
          catch (error: unknown) { failures.push(error) }
        }
        try { await routeLease.release() } catch (error: unknown) { failures.push(error) }
        if (failures.length > 0) throw new AggregateError(failures, 'webhook: Session cleanup failed')
      }
      const executionSettled = (async () => {
        try {
          const result = await execution
          acknowledged.reject(new Error('webhook: root completed without durable inbox admission'))
          if (result.exitCode !== 0) console.warn('webhook: Native root execution settled with a non-zero exit code')
        } catch (error: unknown) {
          acknowledged.reject(new Error('webhook: root failed before durable inbox admission', { cause: error }))
          console.warn('webhook: Native root execution failed after dispatch', {
            name: error instanceof Error ? error.name : 'UnknownError',
          })
        } finally {
          await cleanup()
        }
      })()
      settled = executionSettled
      registration.active.add(executionSettled)
      void executionSettled.then(() => registration.active.delete(executionSettled), () => registration.active.delete(executionSettled))
      void executionSettled.catch((error: unknown) => {
        console.warn('webhook: Session cleanup failed after dispatch', {
          name: error instanceof Error ? error.name : 'UnknownError',
        })
      })
      await acknowledged.promise
    } catch (error: unknown) {
      caller.removeEventListener('abort', stopExecution)
      if (settled !== undefined) {
        try { await settled } catch (cleanupError: unknown) {
          throw new AggregateError([error, cleanupError], 'webhook: request and cleanup failed')
        }
      } else {
        const failures: unknown[] = []
        let retired = sessionOwner === undefined
        if (sessionOwner !== undefined) {
          try {
            await this.root.releaseIdle({ route: route.id, id, expectedOwner: sessionOwner }, new AbortController().signal)
            retired = true
          } catch (failure: unknown) { failures.push(failure) }
        }
        if (retired && sessionOwner !== undefined) {
          if (attached) {
            try { await workspace.detachSession(id) } catch (failure: unknown) { failures.push(failure) }
          }
          try { await deletions.delete({ route: route.id, id }, new AbortController().signal) }
          catch (failure: unknown) { failures.push(failure) }
        }
        try { await routeLease.release() } catch (failure: unknown) { failures.push(failure) }
        if (failures.length > 0) throw new AggregateError([error, ...failures], 'webhook: request and rollback failed')
      }
      throw error
    }
  }

  private async acquireRoute(baseRoute: NativeRootRouteId, path: string,
    create: NonNullable<NativeRootExecutionOperations['createWorkspaceRoute']>, caller: AbortSignal): Promise<{
    readonly route: NativeRootRouteId
    release(): Promise<void>
  }> {
    caller.throwIfAborted()
    const route = await create({ baseRoute, path }, caller)
    const current = this.routes.get(route.id)
    if (current?.releasing !== undefined) {
      await current.releasing
      return this.acquireRoute(baseRoute, path, create, caller)
    }
    const lease = current ?? { route: route.id, users: 0 }
    lease.users++
    this.routes.set(route.id, lease)
    let released = false
    return { route: route.id, release: async () => {
      if (released) return
      released = true
      lease.users--
      if (lease.users !== 0) return
      lease.releasing = this.root.releaseWorkspace(lease.route, new AbortController().signal)
      try { await lease.releasing } finally {
        if (this.routes.get(lease.route) === lease) this.routes.delete(lease.route)
      }
    } }
  }

  private disposeRegistration(registration: Registration): Promise<void> {
    registration.disposal ??= (async () => {
      registration.closing = true
      this.rules.delete(registration.rule.id)
      registration.controller.abort(new Error(`webhook rule ${JSON.stringify(registration.rule.id)} was disposed`))
      try {
        while (registration.active.size > 0) await Promise.allSettled([...registration.active])
      } finally {
        this.registrations.delete(registration)
      }
    })()
    return registration.disposal
  }
}

/** Native provider that exposes the one trusted-rule registry over selected root authorities. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-webhook',
  targets: ['host'],
  requires: ['rootExecution', 'workspaceRegistry', 'agentPresets', 'permissionPresets'],
  optional: ['modelSelection', 'modelDirectory'],
  provides: ['webhookRules'],
  resolve() {
    return (context) => {
      const root = context.require('rootExecution')
      if (root.createWorkspaceRoute === undefined) throw new Error('webhook: configured root does not support admitted Workspace creation')
      const registry = new NativeWebhookRuleRegistry(root, context.require('workspaceRegistry'),
        context.require('agentPresets'), context.require('permissionPresets'), context.optional('modelSelection'), context.optional('modelDirectory'))
      context.provide('webhookRules', registry)
      context.own(() => registry.close())
    }
  },
}

export type { NativePlugin, NativeWebhookRuleOperations } from './native-definition.ts'
