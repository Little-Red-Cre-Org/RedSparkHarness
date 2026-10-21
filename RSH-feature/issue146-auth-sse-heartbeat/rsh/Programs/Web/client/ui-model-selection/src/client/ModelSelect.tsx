/** Cordis adapter for the shared composer model picker. */
import { useSyncExternalStore } from 'react'
import {
  ModelPicker,
  type ModelPickerLocaleKey,
  type ModelPickerSelection,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'

/** Render the shared picker from the Session model directory. */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  return <ModelPicker
    locked={locked}
    available={available}
    state={state}
    load={load}
    getError={() => directory.getSnapshot().error}
    select={(selection: ModelPickerSelection) => select(selection)}
    t={(key: ModelPickerLocaleKey, params) => t(key, params)}
  />
}
