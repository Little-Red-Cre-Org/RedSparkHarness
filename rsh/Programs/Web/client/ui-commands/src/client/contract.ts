/**
 * Frozen contract of the client command surface, specialized for Cordis. Types
 * only. The CommandUiRuntime (`ctx.commandUi`) implements this face; business
 * packages consume `register` alone.
 *
 * The contribution, decoration, option and confirmation declarations are
 * framework-free and live in `contract-core.ts`, which the Native entry
 * shares; this module only fixes the context type they are generic in.
 */
import type { Context as ClientContext } from '@redspark/cordis'
import type { ClientSessionContext } from '@redspark/rsh-client-ui-input-trigger/client'
import type {
  ActionSpec as CoreActionSpec, CommandContribution as CoreCommandContribution,
  CommandDecoration as CoreCommandDecoration, CommandUiSpec as CoreCommandUiSpec,
  PopupSelectSpec as CorePopupSelectSpec,
} from './contract-core.ts'

export type {
  SelectConfirmation, SelectOption,
} from './contract-core.ts'

/**
 * Business registration for the popupSelect command kind, settled against the
 * ClientSessionContext captured at popup open.
 */
export type PopupSelectSpec = CorePopupSelectSpec<ClientSessionContext>

/**
 * Business registration for the action command kind, run for the
 * ClientSessionContext captured at invocation.
 */
export type ActionSpec = CoreActionSpec<ClientSessionContext>

/** The UI behavior of a contribution or decoration. */
export type CommandUiSpec = CoreCommandUiSpec<ClientSessionContext>

/**
 * One client-owned command contribution: a slash-menu entry whose behavior
 * lives entirely on the client (no host descriptor).
 */
export type CommandContribution = CoreCommandContribution<ClientSessionContext>

/**
 * A UI decoration hung on one HOST command: what its BARE invocation does on
 * this client.
 */
export type CommandDecoration = CoreCommandDecoration<ClientSessionContext>

/** The `ctx.commandUi` service face visible to business packages. */
export interface CommandUiContract {
  /**
   * Register one client command contribution; effect disposer. Duplicate
   * names throw at registration.
   */
  register(contribution: CommandContribution): () => void
  /**
   * Hang a bare-invocation decoration on one host command; effect disposer.
   * Duplicate names throw at registration.
   */
  decorate(decoration: CommandDecoration): () => void
  /** Resolve the per-session popup controller for one session scope (wiring/overlay layer). */
  popupFor(actx: ClientContext): unknown
}
