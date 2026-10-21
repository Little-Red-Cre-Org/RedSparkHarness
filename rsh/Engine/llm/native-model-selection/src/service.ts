/** Model intent admission and step snapshots without independent Session storage. */
import { createUserMessage, boundContextSummary, ReasoningEffortId, resolveCallConfigWithModel,
  type LlmCallConfig, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { NativeModelSelectionOperations, NativeModelSelectionSnapshot } from './definition.ts'
import type { NativeModelSelectionState, NativeModelSelectionRequest, NativeModelSelectionReceipt } from './types.ts'
import { foldNativeModelSelectionState as stateOf } from './types.ts'

function requestedConfig(selected: ModelSelection, defaults: LlmCallConfig): LlmCallConfig {
  const { reasoningEffort: _effort, ...base } = defaults
  return { ...base, provider: selected.provider, model: selected.model,
    ...selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) },
    ...selected.maxTokens === undefined ? {} : { maxTokens: selected.maxTokens },
  }
}

function resolveConfig(selected: ModelSelection, defaults: LlmCallConfig, info: LlmResolvedModelInfo): LlmCallConfig {
  return resolveCallConfigWithModel(requestedConfig(selected, defaults), info)
}

function selectionOf(config: LlmCallConfig): ModelSelection {
  return { provider: config.provider, model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens } }
}

/** A resolved choice lost comparison against a newer durable selection intent. */
export class NativeModelSelectionConflict extends Error {
  /** @param expected - revision observed by the caller. @param actual - latest durable intent revision. */
  constructor(readonly expected: NativeModelSelectionState['revision'], readonly actual: NativeModelSelectionState['revision']) {
    super('native-model-selection: stale selection revision')
    this.name = 'NativeModelSelectionConflict'
  }
}

/** Session intent Provider; all history and writes stay with the selected Program owner. */
export class NativeModelSelectionService implements NativeModelSelectionOperations {
  private readonly cancellation = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly commits = new WeakMap<NativeActiveSessionOwner, Promise<unknown>>()
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * @param active - exact active Session registry owned by the selected executor.
   * @param agents - registry that owns the original Agent identity.
   * @param directory - provider-owned exact model resolution and advisory catalog.
   * @param lifetime - installation lifetime; unload rejects in-flight admissions before append.
   */
  constructor(private readonly active: Pick<NativeActiveSessionOperations, 'owner'>,
    private readonly agents: Pick<NativeAgentRegistry, 'get' | 'execution'>,
    private readonly directory: NativeModelDirectory, private readonly lifetime: AbortSignal) {}

  state(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<NativeModelSelectionState> {
    return this.run(owner, signal, async (effective) => {
      const events = await owner.readEvents()
      this.assertOwner(owner, effective)
      return stateOf(events)
    })
  }

  select(owner: NativeActiveSessionOwner, request: NativeModelSelectionRequest, signal: AbortSignal): Promise<NativeModelSelectionReceipt> {
    return this.run(owner, signal, async (effective) => {
      if (request.selected.maxTokens !== undefined
        && (!Number.isSafeInteger(request.selected.maxTokens) || request.selected.maxTokens <= 0)) {
        throw new RangeError('native-model-selection: maxTokens must be a positive safe integer')
      }
      const info = await this.directory.resolve(request.selected.provider, request.selected.model, effective)
      const proposed = { provider: request.selected.provider, model: request.selected.model,
        ...request.selected.maxTokens === undefined ? {} : { maxTokens: request.selected.maxTokens } }
      const selected = selectionOf(requestedConfig(request.selected, proposed))
      resolveConfig(selected, proposed, info)
      this.assertOwner(owner, effective)
      const previous = this.commits.get(owner)
      const commit = Promise.resolve(previous).then(async () => {
        this.assertOwner(owner, effective)
        const state = stateOf(await owner.readEvents())
        this.assertOwner(owner, effective)
        if (state.revision !== request.expectedRevision) throw new NativeModelSelectionConflict(request.expectedRevision, state.revision)
        const event = owner.append('model/selection', selected)
        await owner.flush()
        return { selected, revision: event.seq }
      })
      // A refused intent cannot prevent the next independent comparison from running.
      this.commits.set(owner, commit.then(() => undefined, () => undefined))
      return commit
    })
  }

  capture(owner: NativeActiveSessionOwner, defaults: LlmCallConfig, signal: AbortSignal): Promise<NativeModelSelectionSnapshot> {
    return this.run(owner, signal, async (effective) => {
      const events = await owner.readEvents()
      this.assertOwner(owner, effective)
      const selected = events.findLast(event => event.type === 'model/selection')?.data ?? selectionOf(defaults)
      const info = await this.directory.resolve(selected.provider, selected.model, effective)
      this.assertOwner(owner, effective)
      const config = deepFreeze(structuredClone(resolveConfig(selected, defaults, info)))
      const requested = deepFreeze(structuredClone(requestedConfig(selected, defaults)))
      const previous = owner.session.requestHeader()?.config
      if (previous === undefined || previous.provider === config.provider && previous.model === config.model) {
        return { config, requestedConfig: requested }
      }
      const from = previous.provider === config.provider ? previous.model : `${previous.provider}/${previous.model}`
      const to = previous.provider === config.provider ? config.model : `${config.provider}/${config.model}`
      const notice = createUserMessage({ content: [{ type: 'text', text: `[model changed: assistant turns above this point were generated by ${from}; the session continues with ${to}]` }],
        source: { kind: 'plugin', plugin: 'model-selection', form: 'notice', summary: boundContextSummary(`${from} → ${to}`) } })
      return { config, requestedConfig: requested, notice }
    })
  }

  /** Stop admission, cancel pending resolution and await accepted operations. @returns completion after all admitted operations settle. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    this.cancellation.abort(new Error('native-model-selection: Provider disposed'))
    return this.disposal = Promise.allSettled([...this.pending]).then(() => undefined)
  }

  private run<T>(owner: NativeActiveSessionOwner, signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertOwner(owner, signal)
    const effective = AbortSignal.any([signal, this.lifetime, this.cancellation.signal, this.agents.execution(owner.agent).signal])
    this.assertOwner(owner, effective)
    const result = Promise.resolve().then(() => operation(effective))
    this.pending.add(result)
    void result.then(() => { this.pending.delete(result) }, () => { this.pending.delete(result) })
    return result
  }

  private assertOwner(owner: NativeActiveSessionOwner, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (this.closing || owner.invocation !== 'root' || !owner.writerAvailable
      || this.agents.get(owner.agent.id) !== owner.agent || this.active.owner(owner.agent, owner.session) !== owner) {
      throw new Error('native-model-selection: exact active root owner is unavailable')
    }
  }
}
