/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — slot-owned text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve from localized content (trigger: shell locale; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ConnectionIndicator, SettingsPanel } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

const RECOVERY_CONFIRMATION_MS = 2_000

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useSessions, renderSlot, t,
  } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(open)
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  // Restore after the close commit, when the dialog can no longer own focus.
  useEffect(() => {
    if (wasOpen.current && !open) triggerButton.current?.focus()
    wasOpen.current = open
  }, [open])
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (connectionState === 'connecting') {
    connectionIndicator = 'connecting'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }
  const activeSectionId = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        <button
          ref={triggerButton}
          type="button"
          className={clsx(css.trigger, !wide && css.rail)}
          aria-label={t('trigger')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          {renderSlot('settings.trigger', { wide })}
        </button>
        <ConnectionIndicator
          state={wide ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          reconnectLabel={t('connection.retry')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
      </div>
      {open && (
        <SettingsPanel
          title={renderSlot('settings.header', {})}
          closeLabel={renderSlot('settings.close', {})}
          rows={rows}
          activeId={activeSectionId}
          onSelect={setActiveId}
          onClose={close}
          actions={renderSlot('settings.action', {})}
        >
          {activeSectionId !== undefined && renderSlot('settings.section', { close }, { only: activeSectionId })}
        </SettingsPanel>
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
