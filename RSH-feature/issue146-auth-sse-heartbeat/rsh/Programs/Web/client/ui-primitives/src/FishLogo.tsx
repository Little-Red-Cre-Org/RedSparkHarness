import type { IconProps } from './icons/props.ts'

/** Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units). */
export const FISH_LOGO_VIEWBOX = { width: 64, height: 64 }

/** RedSpark flame-and-star geometry for SVG marks, entrance effects and masks. */
export const FISH_LOGO_PATH = 'M32 2 C30 18 14 19 14 35 C14 47 23 57 35 62 C27 47 47 45 49 32 C51 22 42 16 39 10 C41 25 30 27 32 2 Z M31 25 L34 36 L45 39 L34 42 L31 53 L28 42 L17 39 L28 36 Z'

/**
 * Render the RedSpark mark; the export name preserves existing consumers.
 * @param props.size - width in px (default 24; height keeps the square ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={FISH_LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
