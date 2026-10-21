/**
 * First-run model configuration using the Models page's provider editors.
 * Readiness comes from the shared provider/settings/credential join.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness, protocolChoices } from './store.ts'
import { isSubscriptionProvider } from './authorized-provider.ts'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'
import formStyles from './ModelsSection.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/**
 * Offer provider selection and custom model configuration on first launch.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, operations, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const [selected, setSelected] = useState('deepseek-official')
  const readiness = onboardingReadiness(state)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'provider-ready'
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind])

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'provider-ready':
    case 'unavailable':
      return null
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const providers = state.rows.filter(candidate => state.namespaces.has(candidate.entry.settingsNs)
    && !isSubscriptionProvider(candidate.entry))
  const row = providers.find(candidate => candidate.entry.provider === selected)
  const namespace = row === undefined ? undefined : state.namespaces.get(row.entry.settingsNs)
  const customNamespace = state.namespaces.get('llm-pi-ai')
  const protocols = protocolChoices(customNamespace, schema)

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <select className={`${styles.provider} ${formStyles['input']} ${formStyles['selectInput']}`}
        aria-label={t('onboardingProvider')} value={selected} onChange={(event) => { setSelected(event.target.value) }}>
        {providers.map(candidate => (
          <option key={candidate.entry.provider} value={candidate.entry.provider}>{candidate.entry.displayName}</option>
        ))}
        {protocols.length > 0 ? <option value="">{t('customTitle')}</option> : null}
      </select>
      <div className={styles.editor}>
        {selected === '' && customNamespace !== undefined ? <CustomProviderCard
          taken={state.rows.map(candidate => candidate.entry.provider)}
          protocols={protocols}
          revision={customNamespace.revision}
          operations={operations}
          t={t}
          readOnly={!state.writable}
          onClose={finishCredential}
        /> : row !== undefined && namespace !== undefined ? <ProviderEditor
          key={selected}
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          operations={operations}
          t={t}
          readOnly={false}
          hideTitle
          declared={row.entry.declared === true}
          credentialRequired
          autoFocusCredential
          cancelLabelKey="onboardingLater"
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          onClose={finishCredential}
        /> : null}
      </div>
    </OnboardingModal>
  )
}
