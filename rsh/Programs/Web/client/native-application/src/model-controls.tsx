/** Model intent and blank-root composition menus use provider metadata and durable projections. */
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { ConversationLocaleKey } from './locales.ts'
import type { NativeConversationController } from './controller.ts'

/** Shared view reads and mutations stay with the existing conversation controller.
 * @param props - selected controller and locale-owned copy.
 * @returns current route, effort and installed composition choices.
 */
export function ModelControls({ controller, t }: { controller: NativeConversationController; t: (key: ConversationLocaleKey) => string }) {
  const snapshot = controller.getSnapshot()
  const controls = snapshot.modelControls
  const selected = foldNativeModelSelectionState(snapshot.events).next ?? controls?.catalog?.default
  const catalogModels = controls?.catalog?.groups.flatMap(group => group.models.map(model => ({
    ...model, provider: group.id, providerName: group.name,
  }))) ?? []
  const current = selected === undefined ? undefined
    : catalogModels.find(model => model.provider === selected.provider && model.id === selected.model)
  const encode = (provider: string, model: string): string => JSON.stringify([provider, model])
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const preset = snapshot.header === undefined ? undefined : foldNativeAgentPresetFacts(snapshot.header, snapshot.events)
  const efforts = current?.reasoning?.efforts ?? []
  return <fieldset>
    <legend>{t('modelControls')}</legend>
    <label>{t('model')}<select aria-label={t('model')} disabled={!ready || !controls?.canSelectModel}
      value={selected === undefined ? '' : encode(selected.provider, selected.model)}
      onChange={(event) => {
        const model = catalogModels.find(item => encode(item.provider, item.id) === event.target.value)
        if (model !== undefined) void controller.selectModel({ provider: model.provider, model: model.id })
      }}>
      {selected === undefined ? <option value="">{t('unavailable')}</option> : current === undefined
        ? <option value={encode(selected.provider, selected.model)}>{selected.provider} / {selected.model}</option> : null}
      {catalogModels.map(model => <option key={encode(model.provider, model.id)} value={encode(model.provider, model.id)}>
        {model.providerName} / {model.name}</option>)}
    </select></label>
    <label>{t('reasoning')}<select aria-label={t('reasoning')} disabled={!ready || !controls?.canSelectModel || selected === undefined}
      value={selected?.reasoningEffort ?? ''} onChange={(event) => {
        if (selected !== undefined) void controller.selectModel({ provider: selected.provider, model: selected.model,
          ...event.target.value === '' ? {} : { reasoningEffort: event.target.value } })
      }}>
      <option value="">{t('providerDefault')}</option>
      {selected?.reasoningEffort !== undefined && !efforts.some(effort => effort.id === selected.reasoningEffort)
        ? <option value={selected.reasoningEffort}>{selected.reasoningEffort}</option> : null}
      {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
    </select></label>
    <label>{t('preset')}<select aria-label={t('preset')} value={preset?.preset ?? ''}
      disabled={!ready || preset?.locked !== false || controls?.presets.length === 0}
      onChange={(event) => { void controller.selectPreset(event.target.value) }}>
      {preset?.preset == null ? <option value="">{t('noPreset')}</option> : !controls?.presets.some(item => item.id === preset.preset)
        ? <option value={preset.preset}>{preset.preset}</option> : null}
      {controls?.presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <button disabled={snapshot.state !== 'ready'} onClick={() => { void controller.refreshModelControls() }}>{t('refreshModels')}</button>
    {controls?.catalog?.failures.map(failure => <p key={failure.id} role="alert">{failure.name}: {failure.message}</p>)}
  </fieldset>
}
