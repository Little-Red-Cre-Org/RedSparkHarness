/** State-aware RedSpark companion for hero and floating Conversation placements. */
import { useEffect, useRef, useState } from 'react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetKey } from './locales.ts'
import type { PetActivity, PetSnapshot } from './runtime.ts'
import css from './PetView.module.css'
import { desktopBridge } from './desktop-bridge.ts'
import type { PetLifecycle } from './activity-projection.ts'

/** Injected pet runtime source. */
export interface PetViewInjected {
  hooks: { pet: ObservableSnapshot<PetSnapshot>; petLifecycle: ObservableSnapshot<PetLifecycle | undefined> }
  longRunningAfterMs: number
}
/** Full Conversation pet props. */
export type PetViewProps = PropsRuntime<'conversation.pet'> & PropsLocale<'pet'> & InjectFace<PetViewInjected>

/** Derive the generic activity available from standard Session state. */
export function derivePetActivity(session: SessionSnapshot | undefined, waiting: boolean): PetActivity {
  if (session?.lastAgentError !== null && session?.lastAgentError !== undefined) return 'error'
  if (session?.promptError !== null && session?.promptError !== undefined) return 'error'
  if (session?.openState === 'error') return 'error'
  if (waiting) return 'waiting'
  if (session?.running === true || session?.awaitingFirstTurn === true) return 'thinking'
  return 'idle'
}

const COPY: Record<PetActivity, PetKey> = {
  idle: 'speech.idle', thinking: 'speech.thinking', waiting: 'speech.waiting',
  error: 'speech.error', complete: 'speech.complete', coding: 'speech.coding',
  working: 'speech.working', sleeping: 'speech.sleeping',
  planning: 'speech.planning', compacting: 'speech.compacting', focused: 'speech.focused',
}

function initialMotionEnabled(): boolean {
  return !motionQuery()?.matches
}

function motionQuery(): Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> | undefined {
  const matchMedia = window.matchMedia as ((query: string) => MediaQueryList) | undefined
  return matchMedia?.('(prefers-reduced-motion: reduce)')
}

/** Render the selected character from the shared preference source. */
export function PetView(props: PetViewProps) {
  const snapshot = props.usePet(value => value)
  const lifecycle = props.usePetLifecycle(value => value)
  const session = props.useSession(value => value)
  const waiting = props.useSessionPendingInteraction(values =>
    props.sessionId === undefined ? false : values.has(props.sessionId))
  const [happy, setHappy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [motionEnabled, setMotionEnabled] = useState(initialMotionEnabled)
  const [completed, setCompleted] = useState(false)
  const [desktopError, setDesktopError] = useState(false)
  const [longRunning, setLongRunning] = useState(false)
  const previousRun = useRef({ sessionId: props.sessionId, running: session?.running ?? false })

  useEffect(() => {
    const query = motionQuery()
    if (query === undefined) return
    const update = (event: MediaQueryListEvent) => { setMotionEnabled(!event.matches) }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])

  useEffect(() => {
    const finished = previousRun.current.sessionId === props.sessionId && previousRun.current.running
      && session?.running === false && derivePetActivity(session, waiting) === 'idle'
    previousRun.current = { sessionId: props.sessionId, running: session?.running ?? false }
    setCompleted(finished)
    setHappy(false)
    if (finished) {
      const timer = window.setTimeout(() => { setCompleted(false) }, 3200)
      return () => { window.clearTimeout(timer) }
    }
  }, [props.sessionId, session?.running, session?.lastAgentError, session?.promptError, session?.openState, waiting])

  useEffect(() => {
    setLongRunning(false)
    if (session?.running !== true || lifecycle?.active !== true) return
    const delay = Math.max(0, lifecycle.startedAt + props.longRunningAfterMs - Date.now())
    const timer = window.setTimeout(() => { setLongRunning(true) }, delay)
    return () => { window.clearTimeout(timer) }
  }, [props.sessionId, session?.running, lifecycle?.active, lifecycle?.startedAt, props.longRunningAfterMs])

  const pet = snapshot.pets.find(candidate => candidate.id === snapshot.petId) ?? snapshot.pets[0]
  const variant = pet?.variants.find(candidate => candidate.id === snapshot.variant) ?? pet?.variants[0]
  const currentActivity = derivePetActivity(session, waiting)
  const reportedActivity = props.sessionId === undefined ? undefined : snapshot.activities.get(props.sessionId)
  const projectedActivity = lifecycle?.active === true ? lifecycle.activity : undefined
  const activity = currentActivity === 'error' || currentActivity === 'waiting' ? currentActivity
    : reportedActivity ?? (projectedActivity !== undefined && projectedActivity !== 'thinking' ? projectedActivity
      : currentActivity === 'thinking' ? longRunning ? 'focused' : currentActivity : happy || completed ? 'complete' : 'idle')
  const name = pet?.id === 'redspark-kitsune' ? props.t('character.redspark-kitsune') : pet?.name ?? ''
  const label = props.t(COPY[activity], { name })
  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === undefined) return
    let active = true
    void bridge.update({
      visible: snapshot.enabled && snapshot.desktopEnabled && variant !== undefined,
      atlasUrl: variant?.atlasUrl ?? '/brand/kitsune-sprites.png',
      frame: activity === 'complete' ? 3 : activity === 'sleeping' ? 1 : activity === 'idle' ? 0 : 2,
      label,
    }).then(() => { if (active) setDesktopError(false) }, () => { if (active) setDesktopError(true) })
    return () => { active = false }
  }, [snapshot.enabled, snapshot.desktopEnabled, variant?.atlasUrl, activity, label])

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === undefined) return
    return () => {
      void bridge.update({ visible: false, atlasUrl: '/brand/kitsune-sprites.png', frame: 0, label: '' }).catch(() => undefined)
    }
  }, [])

  if (!snapshot.enabled || variant === undefined) return null

  return (
    <div className={css.stage} data-placement={props.placement} data-state={activity}
      data-paused={paused} data-motion-enabled={motionEnabled}>
      <div className={css.orbit} aria-hidden="true" />
      <span className={css.spark} aria-hidden="true">✦</span>
      <span className={css.sparkSmall} aria-hidden="true">✧</span>
      <button type="button" className={css.character} aria-label={props.t('interact', { name })}
        aria-pressed={happy} onClick={() => { setHappy(value => !value) }}>
        <span className={css.sprite} style={{ backgroundImage: `url(${JSON.stringify(variant.atlasUrl)})` }}
          role="img" aria-label={pet?.id === 'redspark-kitsune' ? props.t('character.aria') : name} />
      </button>
      <span className={css.speech} role="status">{desktopError ? props.t('speech.desktopError') : label}</span>
      <button type="button" className={css.pause} aria-pressed={paused} onClick={() => {
        if (!motionEnabled) setMotionEnabled(true)
        else setPaused(value => !value)
      }}>{props.t(!motionEnabled ? 'motion.enable' : paused ? 'motion.resume' : 'motion.pause', { name })}</button>
    </div>
  )
}
