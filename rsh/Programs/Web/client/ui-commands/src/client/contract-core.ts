/**
 * Command-UI contract elements that do not depend on a client framework.
 *
 * The Cordis build hands business packages a {@link ClientSessionContext}; a
 * Native build hands them a Session id. Everything else a contribution
 * declares — option rows, the confirmation gate, the two UI kinds — is the
 * same data either way, so one generic definition serves both and
 * `contract.ts` specializes it for Cordis.
 */
import type { ComponentType } from 'react'
import type { IconProps } from '@redspark/rsh-client-ui-primitives'
import type { SessionId } from '@redspark/rsh-session/types'

/** Copy for an option that must be acknowledged before onSelect can run. */
export interface SelectConfirmation {
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly cancelLabel: string
  readonly confirmLabel: string
}

/** One option row of a popupSelect shell. */
export interface SelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly active?: boolean
  /** Optional in-page risk gate owned by the shared popup shell. */
  readonly confirmation?: SelectConfirmation
}

/**
 * Business registration for the popupSelect command kind. Data is
 * self-served: options/onSelect use the business package's own protocol.
 * Both callbacks receive the context captured at popup open.
 * @typeParam Context - the value the opener captures for its settlement.
 */
export interface PopupSelectSpec<Context = SessionId> {
  readonly kind: 'popupSelect'
  options(context: Context, signal: AbortSignal): Promise<readonly SelectOption[]>
  onSelect(option: SelectOption, context: Context): void | Promise<void>
}

/**
 * Business registration for the action command kind: a bare invocation
 * consumes the trigger token and runs one client-side callback. It submits
 * nothing, so an attachment-carrying draft never refuses it.
 * @typeParam Context - the value the opener captures for its settlement.
 */
export interface ActionSpec<Context = SessionId> {
  readonly kind: 'action'
  /**
   * Run the action for one session.
   * @param context - the context captured at invocation.
   */
  run(context: Context): void
}

/** The UI behavior of a contribution or decoration. */
export type CommandUiSpec<Context = SessionId> = PopupSelectSpec<Context> | ActionSpec<Context>

/**
 * One client-owned command contribution: a slash-menu entry whose behavior
 * lives entirely on the client (no host descriptor). Merged with the host
 * catalog by name — a collision with a host command fails loud at candidate
 * synthesis, never shadows. Row copy is read on every candidate pass, so a
 * locale change reaches the next menu open without re-registration.
 * @typeParam Context - the value a pick hands to the UI behavior.
 */
export interface CommandContribution<Context = SessionId> {
  /** Command name without the leading slash (unique across contributions). */
  readonly name: string
  /** Localized menu row title; the name itself when absent. */
  label?(): string
  /** Localized menu row description; the row shows none when absent. */
  description?(): string
  /** Menu row glyph from the shared icon set. */
  readonly icon?: ComponentType<IconProps>
  /** Capability filter, called with a fresh projection per candidate pass. */
  available(context: Context): boolean
  /** The command's UI behavior. */
  readonly ui: CommandUiSpec<Context>
}

/**
 * A UI decoration hung on one HOST command: what its BARE invocation does on
 * this client. Not a second command — the host command keeps its catalog
 * row, its argument claim (space / argued enter), and its lifecycle logging;
 * the decoration replaces only the bare menu-pick/enter with a popup whose
 * onSelect typically submits a completed line back through command.execute.
 * A decoration never manufactures a row: a name with no host catalog entry
 * in the session's directory simply never reaches the decoration.
 * @typeParam Context - the value a pick hands to the UI behavior.
 */
export interface CommandDecoration<Context = SessionId> {
  /** The HOST command name this decorates (without the leading slash). */
  readonly name: string
  /** Capability filter, called with a fresh projection per bare invocation. */
  available(context: Context): boolean
  /** The bare-invocation UI. */
  readonly ui: CommandUiSpec<Context>
}
