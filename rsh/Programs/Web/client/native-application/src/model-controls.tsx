/** Native model picker and Agent preset control backed by existing Session actions. */
import { ChatComposerSelect, ModelPicker, type ModelPickerState } from '@deepseek-ai/dsh-client-ui-primitives'
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { ConversationLocaleKey } from './locales.ts'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './model-controls.module.css'

/** Render the catalog-backed model and reasoning picker. */
export function ModelPickerControl({ snapshot, selectModel, refreshModelControls, t }: {
  snapshot: ConversationSnapshot
  selectModel: NativeConversationController['selectModel']
  refreshModelControls: NativeConversationController['refreshModelControls']
  t: (key: ConversationLocaleKey, params?: Record<string, unknown>) => string
}) {
  const controls = snapshot.modelControls
  const selected = foldNativeModelSelectionState(snapshot.events).next ?? controls?.catalog?.default
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const state: ModelPickerState = {
    current: selected ?? null,
    groups: controls?.catalog?.groups ?? [],
    failures: controls?.catalog?.failures ?? [],
    status: snapshot.state === 'ready' ? 'ready' : controls === undefined ? 'loading' : 'selecting',
    error: null,
  }
  return <ModelPicker
    available
    locked={!ready || !controls?.canSelectModel}
    state={state}
    load={() => { void refreshModelControls() }}
    select={async selection => {
      await selectModel(selection)
      return true
    }}
    t={t}
  />
}

/** Render the Agent preset selector from the selected Host's roster. */
export function ModelControls({ snapshot, selectPreset, t }: {
  snapshot: ConversationSnapshot
  selectPreset: NativeConversationController['selectPreset']
  t: (key: ConversationLocaleKey) => string
}) {
  const controls = snapshot.modelControls
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const preset = snapshot.header === undefined ? undefined : foldNativeAgentPresetFacts(snapshot.header, snapshot.events)
  return (
    <div className={css.root}>
      <div className={css.row}>
        <ChatComposerSelect label={t('preset')} className={css.select}
          value={preset?.preset ?? ''}
          disabled={!ready || preset?.locked !== false || controls?.presets.length === 0}
          onChange={(event) => { void selectPreset(event.target.value) }}>
          {preset?.preset == null ? <option value="">{t('noPreset')}</option> : !controls?.presets.some(item => item.id === preset.preset)
            ? <option value={preset.preset}>{preset.preset}</option> : null}
          {controls?.presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </ChatComposerSelect>
      </div>
    </div>
  )
}
