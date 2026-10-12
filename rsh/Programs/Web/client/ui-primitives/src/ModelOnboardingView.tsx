/** Props-only first-run model setup, shared by legacy and Native compositions. */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { CustomProviderCard } from './models-settings/CustomProviderCard.tsx'
import { ProviderEditor } from './models-settings/ProviderEditor.tsx'
import { ModelsSettingsStyles } from './models-settings/styles.ts'
import type {
  ModelEditorCopyKey, ModelSettingsNamespace, ModelSettingsOperations, ModelSettingsSchemaOperations,
} from './models-settings/types.ts'
import css from './ModelOnboardingView.module.css'

/** Copy keys used by the shared model onboarding form. */
export type ModelOnboardingCopyKey =
  | 'onboardingTitle' | 'onboardingDescription' | 'onboardingProvider' | 'onboardingLater' | 'onboardingSave' | 'onboardingSaving'

/** One provider route with its Host-published Settings namespace. */
export interface ModelOnboardingProvider {
  readonly provider: string
  readonly displayName: string
  readonly namespace: ModelSettingsNamespace
  readonly settingsPath: readonly string[]
  readonly declared?: boolean
}

/** Props for {@link ModelOnboardingView}. */
export interface ModelOnboardingViewProps {
  /** Configurable routes and their current Settings views. */
  providers: readonly ModelOnboardingProvider[]
  /** Optional namespace for a user-declared API-compatible route. */
  customProvider?: {
    readonly namespace: ModelSettingsNamespace
    readonly protocols: readonly string[]
  }
  /** Existing provider form operations and schema projection. */
  operations: ModelSettingsOperations
  schema: ModelSettingsSchemaOperations
  /** Complete localized copy for the onboarding step and model editors. */
  t: (key: ModelEditorCopyKey | ModelOnboardingCopyKey) => string
  readOnly: boolean
  onClose: (changed: boolean) => void
}

/** Render provider setup without reading application context or services.
 * @param props - provider views, mutation callbacks, and localized copy.
 * @returns the onboarding provider editor.
 */
export function ModelOnboardingView({
  providers, customProvider, operations, schema, t, readOnly, onClose,
}: ModelOnboardingViewProps): ReactNode {
  const [selected, setSelected] = useState(() => providers.some(row => row.provider === 'deepseek-official')
    ? 'deepseek-official' : providers[0]?.provider ?? '')
  const row = providers.find(candidate => candidate.provider === selected)
  const customAvailable = customProvider !== undefined && customProvider.protocols.length > 0

  return (
    <>
      <p className={css.description}>{t('onboardingDescription')}</p>
      <select className={`${css.provider} ${ModelsSettingsStyles.input} ${ModelsSettingsStyles.selectInput}`}
        aria-label={t('onboardingProvider')} value={selected} onChange={(event) => { setSelected(event.target.value) }}>
        {providers.map(candidate => (
          <option key={candidate.provider} value={candidate.provider}>{candidate.displayName}</option>
        ))}
        {customAvailable ? <option value="">{t('customTitle')}</option> : null}
      </select>
      <div className={css.editor}>
        {selected === '' && customAvailable ? <CustomProviderCard<ModelOnboardingCopyKey>
          taken={providers.map(candidate => candidate.provider)}
          protocols={customProvider.protocols}
          revision={customProvider.namespace.revision}
          operations={operations}
          t={t}
          readOnly={readOnly}
          onClose={onClose}
        /> : row !== undefined ? <ProviderEditor<ModelOnboardingCopyKey>
          key={selected}
          provider={row.provider}
          displayName={row.displayName}
          namespace={row.namespace}
          schema={schema}
          settingsPath={row.settingsPath}
          operations={operations}
          t={t}
          readOnly={readOnly}
          hideTitle
          declared={row.declared === true}
          credentialRequired
          autoFocusCredential
          cancelLabelKey="onboardingLater"
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          onClose={onClose}
        /> : null}
      </div>
    </>
  )
}
