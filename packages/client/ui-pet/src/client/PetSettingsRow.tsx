/** General > Personalization desktop-pet settings. */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetSnapshot } from './runtime.ts'
import css from './PetSettingsRow.module.css'
import { desktopBridge } from './desktop-bridge.ts'
import { useState } from 'react'
import { importPetPng } from './import-png.ts'

/** Settings actions and shared runtime snapshot. */
export interface PetSettingsInjected {
  hooks: { pet: ObservableSnapshot<PetSnapshot> }
  setEnabled: (enabled: boolean) => void
  setDesktopEnabled: (enabled: boolean) => void
  setPet: (id: string) => void
  setVariant: (id: string) => void
  importPet: (name: string, atlasUrl: string) => Promise<void>
  removePet: (id: string) => Promise<void>
}
/** Full settings row props. */
export type PetSettingsRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'pet'> & InjectFace<PetSettingsInjected>

/** Render the desktop-pet group. */
export function PetSettingsRow(props: PetSettingsRowProps) {
  const state = props.usePet(value => value)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(false)
  const selected = state.pets.find(pet => pet.id === state.petId) ?? state.pets[0]
  const selectedVariant = selected?.variants.find(variant => variant.id === state.variant) ?? selected?.variants[0]
  return (
    <section className={css.group} aria-labelledby="pet-personalization-title">
      <h3 id="pet-personalization-title" className={css.groupTitle}>{props.t('settings.group')}</h3>
      <div className={css.heading}>
        <div><div className={css.title}>{props.t('settings.title')}</div><div className={css.description}>{props.t('settings.description')}</div></div>
        <Switch checked={state.enabled} label={props.t('settings.enable')} onChange={props.setEnabled} />
      </div>
      {desktopBridge() === undefined ? null : <div className={css.field}>
        <span>{props.t('settings.desktop')}</span>
        <Switch checked={state.desktopEnabled} label={props.t('settings.desktop')} onChange={props.setDesktopEnabled} />
      </div>}
      {state.enabled && selected !== undefined ? <>
        <div className={css.field}><span>{props.t('settings.character')}</span><div className={css.choices}>
          {state.pets.map(pet => <button key={pet.id} type="button" aria-pressed={pet.id === selected.id}
            onClick={() => { props.setPet(pet.id) }}>{pet.id === 'redspark-kitsune' ? props.t('character.redspark-kitsune') : pet.name}</button>)}
        </div></div>
        <div className={css.field}><span>{props.t('settings.variant')}</span><div className={css.choices}>
          {selected.variants.map(variant => <button key={variant.id} type="button" aria-pressed={variant.id === selectedVariant?.id}
            onClick={() => { props.setVariant(variant.id) }}>{variant.id === 'normal' ? props.t('settings.normal')
              : variant.id === 'chibi' ? props.t('settings.chibi') : variant.id}</button>)}
        </div></div>
        {state.customPetIds.includes(selected.id) ? <button type="button" disabled={importing} onClick={() => {
          setImporting(true)
          setImportError(false)
          void props.removePet(selected.id).catch(() => { setImportError(true) }).finally(() => { setImporting(false) })
        }}>{props.t('settings.remove')}</button> : null}
      </> : null}
      <label className={css.field}>
        <span>{props.t('settings.import')}</span>
        <input type="file" accept="image/png" disabled={importing} aria-label={props.t('settings.import')} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file === undefined) return
          setImporting(true)
          setImportError(false)
          const name = file.name.trim().replace(/\.png$/i, '').trim().slice(0, 64) || props.t('settings.customName')
          void importPetPng(file).then(atlasUrl => props.importPet(name, atlasUrl))
            .catch(() => { setImportError(true) }).finally(() => { setImporting(false) })
        }} />
      </label>
      <p className={css.description}>{props.t('settings.importHelp')}</p>
      {importError ? <p role="alert">{props.t('settings.importError')}</p> : null}
    </section>
  )
}
