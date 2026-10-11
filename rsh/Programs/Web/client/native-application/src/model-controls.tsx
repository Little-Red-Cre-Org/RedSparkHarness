/** Model, reasoning and Agent preset pills backed by existing Native actions. */
import { ChatComposerSelect } from '@deepseek-ai/dsh-client-ui-primitives'
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { ConversationLocaleKey } from './locales.ts'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './model-controls.module.css'

/** Render the available selections in the composer; missing Host facts stay disabled. */
export function ModelControls({ snapshot, selectModel, selectPreset, refreshModelControls, t }: {
  snapshot: ConversationSnapshot
  selectModel: NativeConversationController['selectModel']
  selectPreset: NativeConversationController['selectPreset']
  refreshModelControls: NativeConversationController['refreshModelControls']
  t: (key: ConversationLocaleKey) => string
}) {
  const controls = snapshot.modelControls
  const selected = foldNativeModelSelectionState(snapshot.events).next ?? controls?.catalog?.default
  const catalogModels = controls?.catalog?.groups.flatMap(group => group.models.map(model => ({
    ...model, provider: group.id,
  }))) ?? []
  const current = selected === undefined
    ? undefined
    : catalogModels.find(model => model.provider === selected.provider && model.id === selected.model)
  const encode = (provider: string, model: string): string => JSON.stringify([provider, model])
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const preset = snapshot.header === undefined ? undefined : foldNativeAgentPresetFacts(snapshot.header, snapshot.events)
  const efforts = current?.reasoning?.efforts ?? []
  return (
    <div className={css.root} role="group" aria-label={t('modelControls')}>
      <div className={css.row}>
        <ChatComposerSelect label={t('model')} className={css.select}
          disabled={!ready || !controls?.canSelectModel}
          value={selected === undefined ? '' : encode(selected.provider, selected.model)}
          onChange={(event) => {
            const model = catalogModels.find(item => encode(item.provider, item.id) === event.target.value)
            if (model !== undefined) void selectModel({ provider: model.provider, model: model.id })
          }}>
          {selected === undefined ? <option value="">{t('unavailable')}</option> : current === undefined
            ? <option value={encode(selected.provider, selected.model)}>{selected.model}</option> : null}
          {catalogModels.map(model => <option key={encode(model.provider, model.id)} value={encode(model.provider, model.id)}>
            {model.name}</option>)}
        </ChatComposerSelect>
        {selected !== undefined && (efforts.length > 0 || selected.reasoningEffort !== undefined) && (
          <ChatComposerSelect label={t('reasoning')} className={css.select}
            disabled={!ready || !controls?.canSelectModel}
            value={selected.reasoningEffort ?? ''} onChange={(event) => {
              void selectModel({ provider: selected.provider, model: selected.model,
                ...event.target.value === '' ? {} : { reasoningEffort: event.target.value } })
            }}>
            <option value="">{t('providerDefault')}</option>
            {selected.reasoningEffort !== undefined && !efforts.some(effort => effort.id === selected.reasoningEffort)
              ? <option value={selected.reasoningEffort}>{selected.reasoningEffort}</option> : null}
            {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </ChatComposerSelect>
        )}
        <ChatComposerSelect label={t('preset')} className={css.select}
          value={preset?.preset ?? ''}
          disabled={!ready || preset?.locked !== false || controls?.presets.length === 0}
          onChange={(event) => { void selectPreset(event.target.value) }}>
          {preset?.preset == null ? <option value="">{t('noPreset')}</option> : !controls?.presets.some(item => item.id === preset.preset)
            ? <option value={preset.preset}>{preset.preset}</option> : null}
          {controls?.presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </ChatComposerSelect>
        <button type="button" className={css.refresh} disabled={snapshot.state !== 'ready'}
          onClick={() => { void refreshModelControls() }}>{t('refreshModels')}</button>
      </div>
      {controls?.catalog?.failures.map(failure => <p key={failure.id} className={css.failure} role="alert">
        {failure.name}: {failure.message}
      </p>)}
    </div>
  )
}
