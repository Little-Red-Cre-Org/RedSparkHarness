/**
 * Window geometry for the Desktop shell: keep the first window inside the
 * display it opens on, instead of trusting a fixed logical size.
 *
 * The Electron `width`/`height` of a `BrowserWindow` are logical pixels, while
 * a display's work area is physical. A hardcoded 1280x840 therefore overflows
 * a 1707x1067 screen at 1.5x scaling, whose usable logical space is about
 * 1138x711: the window is born larger than the screen, Windows extends it past
 * the edges, and the left column ends up under whatever window sits beside it.
 * Reading the work area once at creation time is the whole fix.
 */

/** A rectangle in physical screen pixels, as Electron reports displays. */
export interface DesktopScreenBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A display's usable area (excluding the taskbar) plus its scale factor. */
export interface DesktopDisplay {
  readonly workArea: DesktopScreenBounds
  readonly scaleFactor: number
}

/** The logical-pixel size and position one window should open with. */
export interface DesktopWindowGeometry {
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
}

/** Preferred logical size, used whenever the display has room for it. */
const PREFERRED_WIDTH = 1280
const PREFERRED_HEIGHT = 840

/** Minimum logical size the shell still lays out correctly. */
const MINIMUM_WIDTH = 880
const MINIMUM_HEIGHT = 600

/** Largest share of the usable work area one window may occupy. */
const WORK_AREA_FRACTION = 0.9

/**
 * Convert one physical axis to logical pixels.
 * @param value - physical pixels from a display work area.
 * @param scaleFactor - display scale factor; a non-positive or non-finite value is treated as 1.
 * @returns the logical-pixel length.
 */
function toLogical(value: number, scaleFactor: number): number {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return value / scale
}

/**
 * Fit one axis: prefer the designed size, shrink to the work area, never
 * exceed the screen, and never go below the shell's minimum unless the screen
 * itself is smaller than that minimum.
 * @param preferred - designed logical length.
 * @param minimum - smallest logical length the shell supports.
 * @param available - usable logical length of the work area.
 * @returns the logical length to request.
 */
function fitAxis(preferred: number, minimum: number, available: number): number {
  const usable = Math.max(1, Math.floor(available))
  const bounded = Math.min(preferred, Math.floor(usable * WORK_AREA_FRACTION))
  // A screen smaller than the shell minimum cannot satisfy both bounds; honour
  // the screen, because an oversized window is exactly the reported failure.
  return Math.max(1, Math.min(Math.max(bounded, Math.min(minimum, usable)), usable))
}

/**
 * Resolve the opening geometry of one window on a display.
 *
 * The window is centred inside the display's work area, so it cannot be born
 * off-screen even when the requested size nearly fills the screen.
 * @param display - the display the window opens on.
 * @param preferred - designed logical size, defaulting to the main window's.
 * @param minimum - smallest logical size the shell supports for this window.
 * @returns logical-pixel size and position for the window.
 */
export function windowGeometry(
  display: DesktopDisplay,
  preferred: { readonly width: number; readonly height: number } = { width: PREFERRED_WIDTH, height: PREFERRED_HEIGHT },
  minimum: { readonly width: number; readonly height: number } = { width: MINIMUM_WIDTH, height: MINIMUM_HEIGHT },
): DesktopWindowGeometry {
  const { workArea, scaleFactor } = display
  const availableWidth = toLogical(workArea.width, scaleFactor)
  const availableHeight = toLogical(workArea.height, scaleFactor)
  const width = fitAxis(preferred.width, minimum.width, availableWidth)
  const height = fitAxis(preferred.height, minimum.height, availableHeight)
  const originX = toLogical(workArea.x, scaleFactor)
  const originY = toLogical(workArea.y, scaleFactor)
  return {
    width,
    height,
    // Centring rounds down, so the window stays inside the work area.
    x: Math.round(originX + Math.max(0, (availableWidth - width) / 2)),
    y: Math.round(originY + Math.max(0, (availableHeight - height) / 2)),
  }
}

/**
 * Decide whether a window rectangle mostly sits on usable screen area.
 *
 * A saved or recovered position can point at a monitor that has since been
 * unplugged, or at negative coordinates on a rearranged desktop. This answers
 * the question a geometry fix needs; it does not move the window itself.
 * @param bounds - the window rectangle in physical screen pixels.
 * @param workAreas - every display's usable area.
 * @param minimumVisible - required overlap in physical pixels on both axes.
 * @returns true when at least one work area covers that much of the window.
 */
export function windowIntersectsDisplays(
  bounds: DesktopScreenBounds,
  workAreas: readonly DesktopScreenBounds[],
  minimumVisible = 100,
): boolean {
  return workAreas.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapWidth >= minimumVisible && overlapHeight >= minimumVisible
  })
}
