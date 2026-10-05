/** ACP configuration projected from the selected native Session and model Providers. */
import { RequestError, type SessionConfigOption } from '@agentclientprotocol/sdk'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection'

/** Protocol projection only; the selected Provider owns all durable choices. */
export class NativeAcpModelControls {
  /** @param selection - sole Session selection Provider. @param directory - actual Provider catalogs.
   * @param defaults - explicit Program route.
   */
  constructor(private readonly selection: NativeModelSelectionOperations,
    private readonly directory: NativeModelDirectory, private readonly defaults: ModelSelection) {}

  /** Read the complete current ACP options under owned Session maintenance.
   * @param owner - exact root writer. @param signal - maintenance cancellation. @returns current protocol options.
   */
  async options(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<SessionConfigOption[]> {
    return (await this.state(owner, signal)).options
  }

  /** Persist one advertised selection and project its complete resulting state.
   * @param owner - exact root writer. @param id - protocol option id. @param value - opaque advertised choice.
   * @param signal - maintenance cancellation. @returns options after durable selection.
   */
  async set(owner: NativeActiveSessionOwner, id: string, value: unknown, signal: AbortSignal): Promise<SessionConfigOption[]> {
    if (typeof value !== 'string') throw RequestError.invalidParams(undefined, 'configuration requires a select value')
    const state = await this.state(owner, signal)
    let selected: ModelSelection | undefined
    if (id === 'model') selected = state.choices.get(value)
    else if (id === 'reasoning_effort') {
      const option = state.options.find(item => item.id === id)
      if (option?.type === 'select' && option.options.some(item => 'value' in item && item.value === value)) {
        selected = { provider: state.selected.provider, model: state.selected.model,
          ...value === '' ? {} : { reasoningEffort: value } }
      }
    }
    if (selected === undefined) throw RequestError.invalidParams(undefined, `unknown configuration choice: ${id}`)
    await this.selection.select(owner, { selected, expectedRevision: state.revision }, signal)
    return this.options(owner, signal)
  }

  private async state(owner: NativeActiveSessionOwner, signal: AbortSignal) {
    const state = await this.selection.state(owner, signal)
    const selected = state.next ?? this.defaults
    const catalog = await this.directory.catalog(this.defaults, signal)
    const choices = new Map<string, ModelSelection>()
    const groups = catalog.groups.map(group => ({ group: group.id, name: group.name,
      options: group.models.map((model) => {
        const value = JSON.stringify([group.id, model.id])
        choices.set(value, { provider: group.id, model: model.id })
        return { value, name: model.name, ...model.description === undefined ? {} : { description: model.description } }
      }) }))
    const currentValue = JSON.stringify([selected.provider, selected.model])
    if (!choices.has(currentValue)) {
      choices.set(currentValue, { provider: selected.provider, model: selected.model })
      let group = groups.find(item => item.group === selected.provider)
      if (group === undefined) { group = { group: selected.provider, name: selected.provider, options: [] }; groups.push(group) }
      group.options.unshift({ value: currentValue, name: selected.model })
    }
    const options: SessionConfigOption[] = [{ id: 'model', name: 'Model', category: 'model', type: 'select',
      currentValue, options: groups.filter(group => group.options.length > 0) }]
    const info = await this.directory.resolve(selected.provider, selected.model, signal)
    if (info.reasoning !== undefined) options.push({ id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select',
      currentValue: selected.reasoningEffort ?? info.reasoning.defaultEffort ?? '', options: [
        ...info.reasoning.defaultEffort === undefined ? [{ value: '', name: 'Provider default' }] : [],
        ...info.reasoning.efforts.map(effort => ({ value: String(effort.id), name: effort.name,
          ...effort.description === undefined ? {} : { description: effort.description } })),
      ] })
    return { options, choices, selected, revision: state.revision }
  }
}
