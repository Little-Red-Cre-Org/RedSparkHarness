/**
 * The preset-selection settings identity, shared by both runtimes.
 *
 * The namespace name and the shape of its user section must agree between the
 * Cordis service and the Native registry — the Host resolves the same field for
 * both. They live here rather than in either entry so a change to one runtime
 * cannot leave the other reading a different name.
 *
 * @module @redspark/rsh-agent-presets/settings-namespace
 */

/** Settings namespace carrying the user's preset-picker preference and chosen default. */
export const SETTINGS_NAMESPACE = 'agent-presets'

/** The user-writable slice of the preset-selection policy. */
export interface AgentPresetSettings {
  /** Saved default used while mode selection is enabled. */
  default: string
  /** Whether visible mode selection and the saved default govern unnamed new Sessions. */
  modeSelectionEnabled: boolean
}
