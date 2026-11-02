/**
 * Cordis-free plugin-settings surfaces for Native Client consumers.
 *
 * The Cordis half owns two layers this package cannot carry into a Native
 * composition: the `settings.plugin.item` slot the cards register into, and the
 * per-namespace controllers built over `ctx.settingsScope`. What is left below
 * them is the card chrome and the form controls, which were already
 * props-driven. Both are re-exported here so a Native host can render plugin
 * settings from its own state without the settings shell.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardShell } from './client/card-form.ts'
import type { PluginsSettingsLocaleKey } from './client/locales.ts'
import css from './client/PluginCard.module.css'

export { en as nativePluginsEn, zh as nativePluginsZh } from './client/locales.ts'
export type { PluginsSettingsLocaleKey }
export type { CardActions, CardFieldSpec, CardFieldState, CardSecretSpec, CardShell } from './client/card-form.ts'
export { SecretField, ValueField } from './client/fields.tsx'
export type { FieldProps } from './client/fields.tsx'

/** Card chrome shared by every plugin section. */
export interface NativePluginCardProps {
  /** Locale reader for this section's copy. */
  readonly t: (key: PluginsSettingsLocaleKey) => string
  /** Locale key of the plugin's name. */
  readonly titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what this plugin's settings govern. */
  readonly descriptionKey: PluginsSettingsLocaleKey
  /** The card's form state: availability, writability, and what a save would do. */
  readonly state: CardShell
  /** Write every staged edit. */
  readonly onSave: () => void
  /** Drop every staged edit. */
  readonly onDiscard: () => void
  /** The plugin's controls. */
  readonly children: React.ReactNode
}

/**
 * Render one plugin card from caller-supplied form state.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function NativePluginCard(props: NativePluginCardProps) {
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  const { state } = props
  // Collapse only after Host-confirmed settlement; a rejected write keeps its
  // diagnostics and retained drafts visible for correction.
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])
  if (!state.available) return null
  const title = props.t(props.titleKey)
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{props.t(props.descriptionKey)}</span>
        </span>
        {state.dirty ? <Tag tone="neutral" className={css.pending}>{props.t('unsaved')}</Tag> : null}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.readOnly} role="status">{props.t('readOnly')}</p> : null}
            {props.children}
            <div className={css.footer}>
              {state.failed ? <p className={css.failed} role="status">{props.t('saveFailed')}</p> : null}
              <button
                type="button"
                className={css.discard}
                disabled={!state.dirty || state.saving}
                onClick={props.onDiscard}
              >
                {props.t('discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={props.onSave}
              >
                {props.t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
