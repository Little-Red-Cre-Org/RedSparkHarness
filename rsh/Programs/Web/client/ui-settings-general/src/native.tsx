/**
 * Cordis-free General settings content for Native Client consumers.
 *
 * The Cordis half composes its UI from the settings shell's slots: the section
 * column renders `settings.general.item` registrants and the document action
 * renders from a store that talks to `ctx.remote.settings`. A Native host owns
 * neither the slot tree nor that Remote namespace, so both surfaces here take
 * their facts as props and report intent through callbacks.
 *
 * Only the presentational surfaces are exported. {@link NativeGeneralSection}
 * renders an ordered list of already-resolved items, and
 * {@link NativeSettingsDocumentAction} renders the optional document action
 * from a state value; the browser-side stores stay on the Cordis path because
 * they are bound to services a Native composition does not provide.
 */

import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'settings' seat).
import type {} from './client/index.ts'
import sectionCss from './client/GeneralSection.module.css'
import actionCss from './client/SettingsDocumentAction.module.css'

export { en as nativeSettingsEn, zh as nativeSettingsZh, type SettingsKey } from './client/locales.ts'

/** Namespace translator for this package's copy. */
type Translate = TranslateNS<'settings'>

/** Render state of the optional file-backed settings document. */
export interface NativeSettingsDocumentState {
  /** `ready` is the only phase in which the action is offered. */
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Whether one open request is in flight. */
  readonly opening: boolean
  /** Last diagnostic; the surface exposes only localized copy for it. */
  readonly error: string | null
}

/** Props of the General section column: one already-resolved entry per item. */
export interface NativeGeneralSectionProps {
  /** Item nodes in the order the composition wants them rendered. */
  readonly items: readonly ReactNode[]
}

/**
 * Render the General section column from resolved item nodes.
 * @param props - the ordered item nodes.
 * @returns the section element tree.
 */
export function NativeGeneralSection({ items }: NativeGeneralSectionProps): ReactNode {
  return <div className={sectionCss.section}>{items}</div>
}

/** Props of the optional open-document action. */
export interface NativeSettingsDocumentActionProps {
  /** Current document availability and action state. */
  readonly state: NativeSettingsDocumentState
  /** Open the Host-owned settings document. */
  readonly onOpen: () => void
  /** Namespace translator supplied by the caller. */
  readonly t: Translate
}

/**
 * Render the open-document action after the Host confirms a document exists.
 * @param props - document state, the open callback, and the translator.
 * @returns the collapsed action, or null while unavailable or unresolved.
 */
export function NativeSettingsDocumentAction({
  state, onOpen, t,
}: NativeSettingsDocumentActionProps): ReactNode {
  if (state.status !== 'ready') return null
  return (
    <details>
      <summary>{t('general.advanced')}</summary>
      <div className={actionCss.action}>
        {state.error === null ? null : <span className={actionCss.error} role="alert">{t('openDocument.error')}</span>}
        <Button variant="outline" size="sm" disabled={state.opening} onClick={onOpen}>
          {t('openDocument')}
        </Button>
      </div>
    </details>
  )
}
