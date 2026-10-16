/** Window event for opening a Native Settings destination from another page component. */
const NATIVE_SETTINGS_REQUEST = 'dsh-native:settings-request'

/** Request the Native Settings panel to open at Models.
 * @returns nothing.
 */
export function requestNativeModelSettings(): void {
  window.dispatchEvent(new CustomEvent(NATIVE_SETTINGS_REQUEST, { detail: 'models' as const }))
}

/** Subscribe to Native Settings destination requests.
 * @param listener - receives the requested section.
 * @returns a disposer for the window listener.
 */
export function subscribeNativeSettingsRequests(listener: (section: 'models') => void): () => void {
  const receive = (event: Event): void => { listener((event as CustomEvent<'models'>).detail) }
  window.addEventListener(NATIVE_SETTINGS_REQUEST, receive)
  return () => { window.removeEventListener(NATIVE_SETTINGS_REQUEST, receive) }
}
