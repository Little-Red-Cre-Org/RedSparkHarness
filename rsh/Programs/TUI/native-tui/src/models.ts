/** Provider-owned model menus over the existing exclusive Session maintenance operation. */
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/native'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeAgent, NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { ModelCatalog } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeModelSelectionRequest, NativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Config } from './config.ts'

/** Exact durable selection and actual advisory capabilities displayed by the terminal. */
export interface TerminalModelState {
  readonly state: NativeModelSelectionState
  readonly catalog: ModelCatalog
  readonly resolved: LlmResolvedModelInfo
}

/** Narrow menu operations; no Session writer or catalog registry is transferred to Ink. */
export interface TerminalModelOperations {
  /**
   * @param id - existing terminal Session.
   * @param signal - menu cancellation.
   * @returns durable choice and current Provider facts.
   */
  read(id: SessionId, signal: AbortSignal): Promise<TerminalModelState>
  /**
   * @param id - existing terminal Session.
   * @param request - complete choice and observed revision.
   * @param signal - selection cancellation.
   * @returns committed choice and current Provider facts.
   */
  select(id: SessionId, request: NativeModelSelectionRequest, signal: AbortSignal): Promise<TerminalModelState>
}

/** Bind menus to the selected executor's idle maintenance and actual model Providers.
 * @param executor - existing sole root execution authority.
 * @param selection - Session-local durable selection Provider.
 * @param directory - actual model adapter directory.
 * @param config - explicit Program model defaults.
 * @param executionFor - selected Agent's existing maintenance admission authority.
 * @returns maintenance operations preserving one writer and expected revision.
 */
export function terminalModelOperations(executor: Pick<NativeHeadlessApplication, 'executeSessionOperation'>, selection: NativeModelSelectionOperations,
  directory: NativeModelDirectory, config: Config,
  executionFor: (agent: NativeAgent) => Pick<NativeAgentExecution, 'status' | 'runMaintenance'>): TerminalModelOperations {
  const defaults = { provider: config.provider, model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) } }
  const run = (id: SessionId, signal: AbortSignal, request?: NativeModelSelectionRequest) => executor.executeSessionOperation(
    { id, resume: true }, async (owner, effective) => {
      const transaction = async (signal: AbortSignal): Promise<TerminalModelState> => {
        const previous = await selection.state(owner, signal)
        const next = request?.selected ?? previous.next ?? defaults
        const [catalog, resolved] = await Promise.allSettled([
          directory.catalog(defaults, signal), directory.resolve(next.provider, next.model, signal),
        ])
        if (catalog.status === 'rejected') throw catalog.reason
        if (resolved.status === 'rejected') throw resolved.reason
        if (request !== undefined) await selection.select(owner, request, signal)
        const state = request === undefined ? previous : await selection.state(owner, signal)
        return { state, catalog: catalog.value, resolved: resolved.value }
      }
      const execution = executionFor(owner.agent)
      // Cold Session operations already hold maintenance; retained owners need idle admission.
      return execution.status === 'maintenance' ? transaction(effective)
        : execution.runMaintenance(signal => transaction(AbortSignal.any([effective, signal])))
    }, signal,
  )
  return { read: (id, signal) => run(id, signal), select: (id, request, signal) => run(id, signal, request) }
}
