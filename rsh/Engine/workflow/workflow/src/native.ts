/** Native workflow Definition; selected Providers retain the sole Subagent execution authority. */
import { NativeContributions, type NativePlugin, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { WorkflowAgentInfo, WorkflowAgentEndInfo } from './types.ts'
import type { WorkflowMeta } from './types.ts'
import type { WorkflowRun } from './types.ts'

export type { WorkflowRun } from './types.ts'
export type { WorkflowResult, WorkflowMeta } from './types.ts'

/** Observe-only progress callbacks; Consumer owns durable parent recording. Callback failures are reported without affecting execution. */
export interface NativeWorkflowObserver {
  /** @param title - current script phase. */
  phase(title: string): void | Promise<void>
  /** @param message - script narration. */
  log(message: string): void | Promise<void>
  /** @param agent - published child identity. */
  agentStart(agent: WorkflowAgentInfo): void | Promise<void>
  /** @param agent - paired child settlement. */
  agentEnd(agent: WorkflowAgentEndInfo): void | Promise<void>
}

/** Resolved foreground orchestration request attributed to an admitted tool invocation. */
export interface NativeWorkflowStartRequest {
  readonly parent: NativeToolExecution
  readonly script: string
  readonly meta: WorkflowMeta
  readonly args?: unknown
  readonly signal: AbortSignal
  readonly observer?: NativeWorkflowObserver
  /** Override the selected child transport for an owning Consumer. */
  readonly subagentProvider?: string
  /** Lower the deployment total-child ceiling for this run. */
  readonly maxTotalAgents?: number
}

/** Swappable script execution implementation. */
export interface NativeWorkflowProvider {
  readonly name: string
  /** @param request - admitted parent and script input. @returns holder-owned execution; invalid scripts throw before publication. */
  start(request: NativeWorkflowStartRequest): WorkflowRun
}

/** Native workflow Provider selection consumed by model tools. */
export interface NativeWorkflowOperations {
  /** @param provider - execution implementation. @param scope - visibility scope. @returns exact registration disposer. */
  registerProvider(provider: NativeWorkflowProvider, scope?: NativeScope): () => void
  /** @param name - selected name. @param scope - consuming scope. @returns visible Provider, or undefined. */
  provider(name: string, scope: NativeScope): NativeWorkflowProvider | undefined
  /** @param name - selected Provider. @param request - exact admitted invocation and script. @returns accepted run. */
  start(name: string, request: NativeWorkflowStartRequest): WorkflowRun
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { workflow: NativeWorkflowOperations }
}

/** Scoped execution Provider registry. Accepted runs retain their selected Provider. */
export class NativeWorkflowRegistry implements NativeWorkflowOperations {
  private readonly contributions: NativeContributions<NativeWorkflowProvider>
  private closed = false
  /** @param scope - root visibility scope. */
  constructor(scope: NativeScope) { this.contributions = new NativeContributions(scope) }
  /** @inheritdoc */
  registerProvider(provider: NativeWorkflowProvider, scope?: NativeScope): () => void {
    if (this.closed) throw new Error('native-workflow: registry is disposed')
    return this.contributions.register(provider.name, provider, scope)
  }
  /** @inheritdoc */
  provider(name: string, scope: NativeScope): NativeWorkflowProvider | undefined {
    return this.contributions.visible(scope).get(name)
  }
  /** @inheritdoc */
  start(name: string, request: NativeWorkflowStartRequest): WorkflowRun {
    if (this.closed) throw new Error('native-workflow: registry is disposed')
    request.signal.throwIfAborted()
    const provider = this.provider(name, request.parent.agent.scope)
    if (provider === undefined) throw new Error(`native-workflow: provider ${name} is not visible`)
    return provider.start(request)
  }
  /** Close new admission and remove registrations; Provider installations drain accepted work. */
  dispose(): void { this.closed = true; this.contributions.clear() }
}

/** Native workflow Definition installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-workflow', targets: ['host'], requires: [], provides: ['workflow'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-workflow: configuration must be empty')
    }
    return (context) => {
      const registry = new NativeWorkflowRegistry(context.scope)
      context.own(() => { registry.dispose() })
      context.provide('workflow', registry)
    }
  },
}
