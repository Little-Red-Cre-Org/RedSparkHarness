/** Host-backed model and Session controls for the composer. */
import { useState } from 'react'
import { ChatComposerSelect, IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import type { ConversationLocaleKey } from './locales.ts'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './model-controls.module.css'

/** Render model and available Session controls in the composer. */
export function ModelControls({ snapshot, selectModel, selectPreset, selectPlanMode, selectPermissionPreset,
  refreshModelControls, t }: {
  snapshot: ConversationSnapshot
  selectModel: NativeConversationController['selectModel']
  selectPreset: NativeConversationController['selectPreset']
  selectPlanMode: NativeConversationController['selectPlanMode']
  selectPermissionPreset: NativeConversationController['selectPermissionPreset']
  refreshModelControls: NativeConversationController['refreshModelControls']
  t: (key: ConversationLocaleKey) => string
}) {
  const [selectingPlan, setSelectingPlan] = useState(false)
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
  const efforts = current?.reasoning?.efforts ?? []
  const mode = snapshot.modeControls
  const permission = snapshot.permissionControls
  const planMode = mode?.planMode
  const planSelectable = snapshot.selected !== undefined && snapshot.state !== 'loading' && snapshot.state !== 'closed'
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
        {mode === undefined ? null : <ChatComposerSelect label={t('mode')} className={css.select}
          value={mode.current ?? ''}
          disabled={!ready || !mode.canSelect || mode.locked}
          onChange={(event) => { void selectPreset(event.target.value) }}>
          {mode.current === null ? <option value="">{t('modeUnavailable')}</option>
            : !mode.options.some(item => item.id === mode.current)
              ? <option value={mode.current}>{mode.current}</option> : null}
          {mode.options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </ChatComposerSelect>}
        {planMode?.available === true ? <button type="button" className={css.plan}
          aria-label={t(planMode.active ? 'planModeOn' : 'planModeOff')}
          aria-pressed={planMode.active} aria-busy={planMode.pending === true || selectingPlan}
          data-active={planMode.active || undefined} data-pending={planMode.pending || undefined}
          title={planMode.pending === true ? t('planPending') : t(planMode.active ? 'planModeOn' : 'planModeOff')}
          disabled={!planSelectable || selectingPlan}
          onClick={() => {
            setSelectingPlan(true)
            void selectPlanMode(!planMode.active).finally(() => { setSelectingPlan(false) })
          }}>
          {t('planLabel')}
          {planMode.pending === true ? <span className={css.planPending}>{t('planPending')}</span> : null}
          {planMode.active ? <IconCloseFill14 size={12} /> : null}
        </button> : null}
        {permission?.available === true ? <ChatComposerSelect label={t('permission')} className={css.select}
          value={permission.currentValue ?? ''} disabled={!ready}
          onChange={(event) => { void selectPermissionPreset(event.target.value) }}>
          {permission.currentValue === null ? <option value="">{t('unavailable')}</option>
            : !permission.options.some(item => item.value === permission.currentValue)
              ? <option value={permission.currentValue}>{permission.currentValue}</option> : null}
          {permission.options.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}
        </ChatComposerSelect> : null}
        <button type="button" className={css.refresh} disabled={snapshot.state !== 'ready'}
          onClick={() => { void refreshModelControls() }}>{t('refreshModels')}</button>
      </div>
      {controls?.catalog?.failures.map(failure => <p key={failure.id} className={css.failure} role="alert">
        {failure.name}: {failure.message}
      </p>)}
    </div>
  )
}
