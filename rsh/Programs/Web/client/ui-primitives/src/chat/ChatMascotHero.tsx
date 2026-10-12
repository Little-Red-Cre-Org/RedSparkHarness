/** Cordis-free mascot presentation shared by the legacy and Native chat views. */
import { useEffect, useState } from 'react'
import css from './ChatMascotHero.module.css'

function motionQuery(): Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> | undefined {
  const matchMedia = window.matchMedia as ((query: string) => MediaQueryList) | undefined
  return matchMedia?.('(prefers-reduced-motion: reduce)')
}

/** Present a mascot sprite with the hero or floating Conversation layout.
 * @param props - sprite URL, state, labels and placement.
 * @returns animated mascot presentation.
 */
export function ChatMascotHero({ atlasUrl, state, placement, characterLabel, interactionLabel, speech, pauseLabel,
  enableMotionLabel, resumeLabel, happy = false, onInteract }: {
  atlasUrl: string
  state: 'idle' | 'thinking' | 'waiting' | 'error' | 'complete' | 'coding' | 'working' | 'sleeping' | 'planning' | 'compacting' | 'focused'
  placement: 'hero' | 'floating'
  characterLabel: string
  interactionLabel?: string
  speech: string
  pauseLabel: string
  enableMotionLabel: string
  resumeLabel: string
  happy?: boolean
  onInteract?: () => void
}) {
  const [paused, setPaused] = useState(false)
  const [motionEnabled, setMotionEnabled] = useState(() => !motionQuery()?.matches)
  const pauseText = !motionEnabled ? enableMotionLabel : paused ? resumeLabel : pauseLabel

  useEffect(() => {
    const query = motionQuery()
    if (query === undefined) return
    const update = (event: MediaQueryListEvent) => { setMotionEnabled(!event.matches) }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])

  const sprite = <span className={css.sprite} role="img" aria-label={characterLabel}
    style={{ backgroundImage: `url(${JSON.stringify(atlasUrl)})` }} />

  return (
    <div className={css.stage} data-placement={placement} data-state={state}
      data-paused={paused} data-motion-enabled={motionEnabled}>
      <div className={css.orbit} aria-hidden="true" />
      <span className={css.spark} aria-hidden="true">✦</span>
      <span className={css.sparkSmall} aria-hidden="true">✧</span>
      {onInteract === undefined
        ? <span className={css.character} role="img" aria-label={characterLabel}>{sprite}</span>
        : <button type="button" className={css.character} aria-label={interactionLabel}
          aria-pressed={happy} onClick={onInteract}>{sprite}</button>}
      <span className={css.speech} role="status">{speech}</span>
      <button type="button" className={css.pause} aria-pressed={paused} onClick={() => {
        if (!motionEnabled) setMotionEnabled(true)
        else setPaused(value => !value)
      }}>{pauseText}</button>
    </div>
  )
}
