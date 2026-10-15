/** Local preference for messages submitted while a turn is running. */
export const PENDING_DEFAULT_KEY = 'dsh.native.composer.pendingDefault'

/** Read the running-turn submission preference, defaulting to Queue.
 * @returns `steering` only when stored; otherwise `queued`.
 */
export function readPendingDefault(): 'queued' | 'steering' {
  return localStorage.getItem(PENDING_DEFAULT_KEY) === 'steering' ? 'steering' : 'queued'
}

/** Store the running-turn submission preference.
 * @param value - the placement to use for implicit submissions while running.
 * @returns nothing.
 */
export function writePendingDefault(value: 'queued' | 'steering'): void {
  localStorage.setItem(PENDING_DEFAULT_KEY, value)
}
