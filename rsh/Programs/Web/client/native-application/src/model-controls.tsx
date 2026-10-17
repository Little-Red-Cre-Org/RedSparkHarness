/** Native model picker and Session mode controls for the composer. */
import { useEffect, useRef, useState } from 'react'
import {
  IconChevronDownOutline14, IconCloseFill14, IconShieldOutline16, Menu, ModelPicker, Pill,
  type ModelPickerState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { foldNativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import type { ConversationLocaleKey } from './locales.ts'
import type { ConversationSnapshot, NativeConversationController } from './controller.ts'
import css from './model-controls.module.css'

/** Show the selected Session's mode as a menu chip when the Host allows changes.
 * @param props - selected Session controls, preset action, and localized copy.
 * @returns mode chip and active Plan pill.
 */
export function ConversationModeLabel({ snapshot, selectPreset, t }: {
  snapshot: ConversationSnapshot
  selectPreset: NativeConversationController['selectPreset']
  t: (key: ConversationLocaleKey, params?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const refocus = useRef(false)
  const controls = snapshot.modeControls
  const current = controls?.current
  const name = current === null || current === undefined ? t('chatMode')
    : controls?.options.find(option => option.id === current)?.name ?? current
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined && snapshot.navigationPending !== true
  const canSelect = ready && controls !== undefined && controls.canSelect && !controls.locked
  useEffect(() => { if (!canSelect) setOpen(false) }, [canSelect])
  // The selection reload replaces the trigger with a static chip; refocus the trigger once it returns.
  useEffect(() => {
    if (!canSelect || !refocus.current) return
    refocus.current = false
    trigger.current?.focus()
  }, [canSelect])
  const items = controls?.options.map(option => ({ id: option.id, label: option.name })) ?? []
  return <>
    <Menu className={css.modeMenu} open={open && canSelect} autoFocus compact portal items={items} selectedId={current ?? undefined}
      onSelect={(id) => { setOpen(false); refocus.current = true; void selectPreset(id) }} onClose={() => { setOpen(false) }}
      anchor={canSelect
        ? <button ref={trigger} type="button" className={css.modeTrigger} aria-label={t('modeLabel', { name })}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}>
          <span className={css.modeName}>{name}</span><IconChevronDownOutline14 />
        </button>
        : <span className={css.modeChip}>{name}</span>} />
    {controls?.planMode.active === true ? <Pill active>{t('planLabel')}</Pill> : null}
  </>
}

/** Render the catalog-backed model and reasoning picker.
 * @param props - selected Session state, model mutation actions, and localized copy.
 * @returns the model and reasoning picker.
 */
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

/** Render the selected Session's Plan and permission controls in the composer.
 * @param props - selected Session controls, mutation actions, and localized copy.
 * @returns the available composer controls.
 */
export function ModelControls({ snapshot, selectPlanMode, selectPermissionPreset, t }: {
  snapshot: ConversationSnapshot
  selectPlanMode: NativeConversationController['selectPlanMode']
  selectPermissionPreset: NativeConversationController['selectPermissionPreset']
  t: (key: ConversationLocaleKey, params?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState(false)
  const [selectingPlan, setSelectingPlan] = useState(false)
  const permissionTrigger = useRef<HTMLButtonElement | null>(null)
  const refocusPermission = useRef(false)
  const ready = snapshot.state === 'ready' && snapshot.selected !== undefined && snapshot.navigationPending !== true
  const mode = snapshot.modeControls
  const planMode = mode?.planMode
  const permission = snapshot.permissionControls
  const planSelectable = snapshot.selected !== undefined && snapshot.state !== 'loading' && snapshot.state !== 'closed'
  const currentPermission = permission?.options.find(option => option.value === permission.currentValue)
  const currentPermissionLabel = permission?.currentValue === null || permission?.currentValue === undefined
    ? t('unavailable') : permissionLabel(permission.currentValue, currentPermission?.name ?? permission.currentValue, t)
  useEffect(() => { if (!ready) setOpen(false) }, [ready])
  // The trigger is disabled while the selection applies; refocus it once it is enabled again.
  useEffect(() => {
    if (!ready || !refocusPermission.current) return
    refocusPermission.current = false
    permissionTrigger.current?.focus()
  }, [ready])
  return (
    <div className={css.root} role="group" aria-label={t('modelControls')}>
      <div className={css.row}>
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
        {permission?.available === true ? <Menu className={css.permissionMenu} open={open} autoFocus compact side="top"
          items={permission.options.map(option => ({
            id: option.value,
            label: permissionLabel(option.value, option.name, t),
            icon: <IconShieldOutline16 size={14} />,
          }))}
          selectedId={permission.currentValue ?? undefined}
          onSelect={(value) => {
            setOpen(false)
            if (value === permission.currentValue) permissionTrigger.current?.focus()
            else { refocusPermission.current = true; void selectPermissionPreset(value) }
          }}
          onClose={() => { setOpen(false) }}
          anchor={<button ref={permissionTrigger} type="button" className={css.permissionTrigger} title={currentPermission?.description}
            disabled={!ready} onClick={() => { setOpen(value => !value) }}>
            <IconShieldOutline16 size={14} />
            <span className={css.permissionName}>{currentPermissionLabel}</span>
            <IconChevronDownOutline14 />
          </button>} /> : null}
      </div>
    </div>
  )
}

function permissionLabel(value: string, name: string, t: (key: ConversationLocaleKey) => string): string {
  if (name !== value) return name
  if (value === 'read-only') return t('permissionReadOnly')
  if (value === 'workspace-write') return t('permissionWorkspaceWrite')
  if (value === 'danger-full-access') return t('permissionFullAccess')
  return name
}
