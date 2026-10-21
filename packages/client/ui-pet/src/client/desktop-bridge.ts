/** Optional Electron presentation transport; browsers do not acquire native-window behavior. */

/** Presentation-only bridge implemented by the desktop carrier. */
export interface PetDesktopBridge {
  /** @param value - Selected PNG frame and localized status; hidden updates retain no window visibility. */
  update(value: { visible: boolean; atlasUrl: string; frame: number; label: string }): Promise<void>
}

/**
 * Resolves the optional desktop carrier bridge without importing an Electron implementation.
 * @returns The bridge when the carrier exposes it.
 */
export function desktopBridge(): PetDesktopBridge | undefined {
  return (window as Window & { dshDesktop?: { pet?: PetDesktopBridge } }).dshDesktop?.pet
}
