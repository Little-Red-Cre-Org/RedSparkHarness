/**
 * Real-UI assembly closure. The whole layout tree hangs from the built-in
 * `root` slot, which is the only ctx-level slot render in the application.
 */
import type { ReactNode } from 'react'
import type { SlotRuntime } from '../slot-runtime.ts'

/** Inputs available after the UI renderer's inject set activates. */
export interface AssemblyDeps {
  /** Slot runtime used to render the application's root entry. */
  slots: Pick<SlotRuntime, 'renderSlot'>
}

/**
 * Build the assembled application factory.
 * @param deps - Active UI-renderer dependencies.
 * @returns Factory producing the application React tree.
 */
export function buildRenderApp(deps: AssemblyDeps): () => ReactNode {
  const { slots } = deps
  return () => slots.renderSlot('root', {})
}
