/** Native model picker and Session mode controls for the composer. */
import { useState } from 'react'
import { ChatComposerSelect, IconCloseFill14, ModelPicker, type ModelPickerState } from '@deepseek-ai/dsh-client-ui-primitives'
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
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
  const catalogUnavailable = controls === undefined || controls.catalog === null
  const selected = foldNativeModelSelectionState(snapshot.events).next ?? controls?.catalog?.default
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const canRetryCatalog = snapshot.state === 'ready' && catalogUnavailable
  const state: ModelPickerState = {
    current: selected ?? null,
    groups: controls?.catalog?.groups ?? [],
    failures: controls?.catalog?.failures ?? [],
    status: snapshot.state === 'ready' ? 'ready' : controls === undefined ? 'loading' : 'selecting',
    error: catalogUnavailable ? snapshot.error ?? null : null,
  }
  return <ModelPicker
    available
    locked={!canRetryCatalog && (!ready || !controls?.canSelectModel)}
    state={state}
    load={() => { void refreshModelControls() }}
    select={async (selection) => {
      await selectModel(selection)
      return true
    }}
    t={t}
  />
}

/** Render the selected Session's mode and permission controls. */
export function ModelControls({ snapshot, selectPreset, selectPlanMode, selectPermissionPreset, t }: {
  snapshot: ConversationSnapshot
  selectPreset: NativeConversationController['selectPreset']
  selectPlanMode: NativeConversationController['selectPlanMode']
  selectPermissionPreset: NativeConversationController['selectPermissionPreset']
  t: (key: ConversationLocaleKey) => string
}) {
  const [selectingPlan, setSelectingPlan] = useState(false)
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined
  const mode = snapshot.modeControls
  const planMode = mode?.planMode
  const permission = snapshot.permissionControls
  const planSelectable = snapshot.selected !== undefined && snapshot.state !== 'loading' && snapshot.state !== 'closed'
  return (
    <div className={css.root} role="group" aria-label={t('modelControls')}>
      <div className={css.row}>
        {snapshot.selected === undefined ? null : mode === undefined
          ? <ChatComposerSelect label={t('mode')} className={css.select} disabled value="">
            <option value="">{t('modeUnavailable')}</option>
          </ChatComposerSelect>
          : <ChatComposerSelect label={t('mode')} className={css.select}
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
      </div>
    </div>
  )
}
