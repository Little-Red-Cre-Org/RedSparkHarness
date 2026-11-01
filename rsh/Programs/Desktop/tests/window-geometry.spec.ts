import { describe, expect, it } from 'vitest'
import { windowGeometry, windowIntersectsDisplays } from '../src/window-geometry.ts'

/** The reported failing display: 1707x1067 physical at 1.5x scaling. */
const SCALED_SCREEN = {
  workArea: { x: 0, y: 0, width: 1707, height: 1019 },
  scaleFactor: 1.5,
}

/** A plain 1920x1080 display at 1x, where the designed size fits. */
const FULL_HD = {
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
}

describe('desktop window geometry', () => {
  it('keeps the designed size when the display has room', () => {
    expect(windowGeometry(FULL_HD)).toEqual({ width: 1280, height: 840, x: 320, y: 100 })
  })

  it('shrinks below the designed size when the work area is smaller in logical pixels', () => {
    // 1707/1.5 = 1138 logical wide, so the 1280 design cannot fit.
    const geometry = windowGeometry(SCALED_SCREEN)
    expect(geometry.width).toBeLessThan(1280)
    expect(geometry.width).toBeLessThanOrEqual(Math.floor(1138 * 0.9) + 1)
    expect(geometry.height).toBeLessThan(840)
  })

  it('never exceeds the usable work area on either axis', () => {
    for (const display of [SCALED_SCREEN, FULL_HD,
      { workArea: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
      { workArea: { x: 0, y: 0, width: 1024, height: 768 }, scaleFactor: 2 }]) {
      const geometry = windowGeometry(display)
      const logicalWidth = display.workArea.width / display.scaleFactor
      const logicalHeight = display.workArea.height / display.scaleFactor
      expect(geometry.width).toBeLessThanOrEqual(logicalWidth)
      expect(geometry.height).toBeLessThanOrEqual(logicalHeight)
      expect(geometry.x).toBeGreaterThanOrEqual(display.workArea.x / display.scaleFactor)
      expect(geometry.y).toBeGreaterThanOrEqual(display.workArea.y / display.scaleFactor)
    }
  })

  it('honours a display smaller than the shell minimum instead of overflowing', () => {
    const geometry = windowGeometry({ workArea: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 })
    expect(geometry.width).toBeLessThanOrEqual(800)
    expect(geometry.height).toBeLessThanOrEqual(600)
  })

  it('centres inside a work area that does not start at the origin', () => {
    const geometry = windowGeometry({ workArea: { x: 1920, y: -200, width: 1920, height: 1040 }, scaleFactor: 1 })
    expect(geometry.x).toBe(1920 + 320)
    expect(geometry.y).toBe(-200 + 100)
  })

  it('treats a missing or nonsensical scale factor as 1', () => {
    const bounds = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(windowGeometry({ workArea: bounds, scaleFactor: 0 })).toEqual(windowGeometry({ workArea: bounds, scaleFactor: 1 }))
    expect(windowGeometry({ workArea: bounds, scaleFactor: Number.NaN }))
      .toEqual(windowGeometry({ workArea: bounds, scaleFactor: 1 }))
  })

  it('fits a smaller window such as the plugin manager', () => {
    const geometry = windowGeometry(SCALED_SCREEN, { width: 900, height: 620 }, { width: 640, height: 480 })
    // 1138x679 logical: the 900 design fits, but 620 of 679 still sits above
    // the 90% share, so this axis is bounded by the work area like the main one.
    expect(geometry.width).toBe(900)
    expect(geometry.height).toBe(Math.floor((1019 / 1.5) * 0.9))
  })
})

describe('window on-screen check', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }

  it('accepts a window fully inside one display', () => {
    expect(windowIntersectsDisplays({ x: 100, y: 100, width: 800, height: 600 }, [primary])).toBe(true)
  })

  it('rejects the reported off-screen position', () => {
    // Left of the display by more than the required visible overlap.
    expect(windowIntersectsDisplays({ x: -1900, y: 0, width: 1721, height: 1033 }, [primary])).toBe(false)
  })

  it('still accepts a window that hangs slightly past the edge', () => {
    expect(windowIntersectsDisplays({ x: -7, y: -7, width: 1721, height: 1033 }, [primary])).toBe(true)
  })

  it('accepts a window on a secondary display', () => {
    const secondary = { x: -1920, y: 0, width: 1920, height: 1040 }
    expect(windowIntersectsDisplays({ x: -1500, y: 100, width: 800, height: 600 }, [primary, secondary])).toBe(true)
  })

  it('rejects a window whose overlap is too narrow to grab', () => {
    expect(windowIntersectsDisplays({ x: -795, y: 100, width: 800, height: 600 }, [primary], 100)).toBe(false)
    expect(windowIntersectsDisplays({ x: -700, y: 100, width: 800, height: 600 }, [primary], 100)).toBe(true)
  })
})
