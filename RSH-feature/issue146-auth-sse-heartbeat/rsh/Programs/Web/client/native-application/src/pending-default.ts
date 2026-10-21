/** Shared busy-send values used by Settings and the Native composer. */
export type BusyEnterBehavior = 'queue' | 'steer'
export type ComposerPendingDefault = 'queued' | 'steering'

export const PENDING_DEFAULT_KEY = 'dsh.native.composer.pendingDefault'

const PENDING_DEFAULT_CHANGED = 'dsh-native:busy-enter-changed'

/** Read the fallback preference used when the Host does not publish ui-conversation.
 * @returns the legacy busy-send value, defaulting to `queue`.
 */
export function readPendingDefault(): BusyEnterBehavior {
  const value = localStorage.getItem(PENDING_DEFAULT_KEY)
  return value === 'steer' || value === 'steering' ? 'steer' : 'queue'
}

/** Save the single fallback preference and notify mounted composer views.
 * @param value - legacy busy-send value.
 */
export function writePendingDefault(value: BusyEnterBehavior): void {
  localStorage.setItem(PENDING_DEFAULT_KEY, value)
  announcePendingDefaultChanged(value)
}

/** Notify mounted composer views after a Host-backed preference changes.
 * @param value - current Host busy-send value.
 */
export function announcePendingDefaultChanged(value: BusyEnterBehavior): void {
  window.dispatchEvent(new CustomEvent<BusyEnterBehavior>(PENDING_DEFAULT_CHANGED, { detail: value }))
}

/** Subscribe to busy-send changes from Settings or the Host event stream.
 * @param listener - receives the legacy busy-send value.
 * @returns a disposer for the window listener.
 */
export function subscribePendingDefault(listener: (value: BusyEnterBehavior) => void): () => void {
  const receive = (event: Event): void => { listener((event as CustomEvent<BusyEnterBehavior>).detail) }
  window.addEventListener(PENDING_DEFAULT_CHANGED, receive)
  return () => { window.removeEventListener(PENDING_DEFAULT_CHANGED, receive) }
}

/** Map the legacy Settings value to the Native Session composer value.
 * @param value - persisted busy-send value.
 * @returns the composer submission placement.
 */
export function composerPendingDefault(value: BusyEnterBehavior): ComposerPendingDefault {
  return value === 'steer' ? 'steering' : 'queued'
}
