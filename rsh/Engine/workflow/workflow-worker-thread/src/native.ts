/** Native worker-thread Provider sharing the existing worker controller and script runtime. */
import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import * as vm from 'node:vm'
import z from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeSubagentOperations, NativeSubagentRequest, NativeSubagentRun } from '@deepseek-ai/dsh-native-subagent/native'
import type { NativeWorkflowProvider, NativeWorkflowStartRequest, WorkflowRun } from '@deepseek-ai/dsh-workflow/native'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow/types'
import { WorkflowError } from '@deepseek-ai/dsh-workflow/errors'
import { WorkerRun, type WorkflowHostChildren, type WorkflowHostContext } from './host.ts'
import { validateMeta } from './meta.ts'

const Configuration = z.object({
  name: z.string().min(1).default('worker-thread'),
  subagentProvider: z.string().min(1),
  maxDepth: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(3),
  maxConcurrentAgents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  maxTotalAgents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1000),
  maxItemsPerCall: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(4096),
  syncTimeoutMs: z.number().int().positive().max(2_147_483_647).default(5000),
  disposeGraceMs: z.number().int().nonnegative().max(2_147_483_647).default(5000),
}).strict()

/** Deployment-resolved child transport and orchestration resource ceilings. */
export type NativeWorkflowWorkerConfig = z.output<typeof Configuration>

/** Resolve child transport and worker resource limits before installation.
 * @param input - profile configuration.
 * @returns validated explicit deployment values.
 */
export function resolveNativeWorkflowWorkerConfig(input: unknown): NativeWorkflowWorkerConfig { return Configuration.parse(input) }

/** Worker owner with Provider-scoped cancellation and exact parent initiator restoration for child RPC. */
export class NativeWorkflowWorkerProvider implements NativeWorkflowProvider {
  readonly name: string
  private readonly runs = new Set<WorkflowRun>()
  private closing: Promise<void> | undefined
  /**
   * @param config - resolved deployment limits.
   * @param agents - shared Agent authority.
   * @param subagents - selected child Definition.
   * @param host - logger.
   */
  constructor(private readonly config: NativeWorkflowWorkerConfig, private readonly agents: NativeAgentRegistry,
    private readonly subagents: NativeSubagentOperations, private readonly host: WorkflowHostContext) {
    this.name = config.name
  }
  /** @inheritdoc */
  start(request: NativeWorkflowStartRequest): WorkflowRun {
    if (this.closing !== undefined) throw new Error('native-workflow: worker Provider is disposed')
    request.signal.throwIfAborted()
    const meta = validateMeta(request.meta)
    try {
      void new vm.Script(`(async () => {\n${request.script}\n})()`, { filename: `workflow:${meta.name}`, lineOffset: -1 })
    } catch (error: unknown) {
      throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
    }
    const subagentProvider = request.subagentProvider ?? this.config.subagentProvider
    const maxTotalAgents = request.maxTotalAgents ?? this.config.maxTotalAgents
    if (!Number.isSafeInteger(maxTotalAgents) || maxTotalAgents < 1) {
      throw new WorkflowError('workflow maxTotalAgents must be a positive safe integer', 'INVALID_ARGUMENT')
    }
    if (maxTotalAgents > this.config.maxTotalAgents) {
      throw new WorkflowError('workflow maxTotalAgents exceeds the deployment ceiling', 'INVALID_ARGUMENT')
    }
    if (subagentProvider !== this.subagents.providerName) {
      throw new WorkflowError(`selected subagent transport is "${this.subagents.providerName}", not "${subagentProvider}"`, 'AGENT_START')
    }
    const children: WorkflowHostChildren<NativeToolExecution> = {
      start: (provider, child) => this.agents.withInitiator(child.parent.agent, async () => {
        if (provider !== this.subagents.providerName) {
          throw new WorkflowError(`selected subagent transport is "${this.subagents.providerName}", not "${provider}"`, 'AGENT_START')
        }
        const options = {
          maxDepth: this.config.maxDepth,
          ...child.agentOptions?.provider === undefined ? {} : { provider: child.agentOptions.provider },
          ...child.agentOptions?.model === undefined ? {} : { model: child.agentOptions.model },
          ...child.outputSchema === undefined ? {} : { outputSchema: child.outputSchema },
        }
        const request: NativeSubagentRequest = this.subagents.resolve({
          agent: child.parent.agent,
          session: child.parent.session,
          label: `workflow:${meta.name}`,
          prompt: child.prompt,
          options,
        })
        const run: NativeSubagentRun = await this.subagents.start(request, child.signal)
        return {
          id: run.id,
          result: run.result.then(result => ({
            output: result.output,
            ...result.structured === undefined ? {} : { structured: result.structured },
            stopReason: result.stopReason,
          })),
          dispose: () => run.dispose(),
        }
      }),
    }
    const run = new WorkerRun(this.host, children, WorkflowRunId(randomUUID()), meta, request.parent,
      { meta, body: request.script, ...request.args === undefined ? {} : { args: request.args }, limits: {
        maxConcurrentAgents: this.config.maxConcurrentAgents === 0
          ? Math.min(16, Math.max(1, availableParallelism() - 2)) : this.config.maxConcurrentAgents,
        maxTotalAgents, maxItemsPerCall: this.config.maxItemsPerCall,
        syncTimeoutMs: this.config.syncTimeoutMs,
      } }, subagentProvider, this.config.disposeGraceMs,
      request.observer ?? { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} }, request.signal, true)
    this.runs.add(run)
    const removeParent = this.agents.onDispose(request.parent.agent, () => run.dispose())
    const dispose = run.dispose.bind(run)
    let trackedDispose: Promise<void> | undefined
    run.dispose = () => {
      trackedDispose ??= dispose().then(() => {
        removeParent()
        this.runs.delete(run)
      }, (error: unknown) => {
        this.host.logger.warn(`native-workflow: run cleanup failed; retaining ownership: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      })
      return trackedDispose
    }
    return run
  }
  /** Close admission, cancel workers and await owned child cleanup. @returns the same drain promise. */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const completion = Promise.withResolvers<void>()
    this.closing = completion.promise
    void Promise.allSettled([...this.runs].map(run => run.dispose())).then((outcomes) => {
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length > 0) completion.reject(new AggregateError(failures, 'native-workflow: worker cleanup failed'))
      else completion.resolve()
    }, completion.reject)
    return completion.promise
  }
}

/** Native workflow execution Provider; worker lifecycle belongs to its installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-workflow-worker-thread', targets: ['host'],
  requires: ['workflow', 'agents', 'subagents'], provides: [],
  resolve(input) {
    const config = resolveNativeWorkflowWorkerConfig(input)
    return (context) => {
      const subagents = context.require('subagents')
      if (subagents.providerName !== config.subagentProvider) throw new Error('native-workflow: selected child transport does not match the configured provider')
      const provider = new NativeWorkflowWorkerProvider(config, context.require('agents'), subagents,
        { logger: { warn: (message) => { console.warn(message) } } })
      context.own(() => provider.dispose())
      context.effect(context.require('workflow').registerProvider(provider, context.scope))
    }
  },
}
