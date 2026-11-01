/**
 * Cordis-free bridge between the trigger controller and the Native event bus.
 *
 * The controller's only Cordis dependency is {@link InputDispatch}: it hands a
 * pick outcome to the session-scoped input machine and needs a boolean back.
 * Cordis answers that through `actx.bail(...)`, which stops at the first
 * listener returning a value. The Native bus has no bail mode, so this module
 * reproduces it over `waterfall`: the first non-`undefined` answer wins and the
 * remaining listeners do not run.
 *
 * Keeping the adapter this thin is the point. `InputTriggerController` owns
 * ~580 lines of hit/fetch/highlight state that has nothing to do with Cordis,
 * so the Native entry drives the SAME controller rather than a copy of it —
 * one pipeline, two transports, no drift.
 */

/** One pick outcome handed to the session-scoped input machine. */
export type InputDispatchEvent =
  | { readonly kind: 'begin-command'; readonly request: unknown }
  | { readonly kind: 'insert-text'; readonly request: unknown }
  | { readonly kind: 'insert-reference'; readonly request: unknown }

/**
 * Apply one pick outcome to the scoped input machine.
 * @param event - which input mutation the pick asked for, and its payload.
 * @returns true when a listener applied it; false when nobody claimed it.
 */
export type InputDispatch = (event: InputDispatchEvent) => boolean

/**
 * Native event names mirroring the Cordis `slash/input-*` bail events, one per
 * {@link InputDispatchEvent} kind. Declared here so a Native input machine and
 * this package agree without importing Cordis.
 */
export const SLASH_INPUT_EVENTS = {
  'begin-command': 'slash/input-begin-command',
  'insert-text': 'slash/input-insert-text',
  'insert-reference': 'slash/input-insert-reference',
} as const satisfies Record<InputDispatchEvent['kind'], string>
