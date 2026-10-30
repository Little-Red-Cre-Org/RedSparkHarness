import type { IconProps } from './icons/props.ts'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading mark before the name; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the brand wordmark.
 *
 * TEMPORARY TEXT WORDMARK — not the final artwork. The upstream wordmark is a
 * set of SVG path outlines, so no string replacement could reach it and it
 * kept drawing the previous product's name. Replacement outlines need art this
 * repository does not have yet; text is the real product name rather than a
 * placeholder, so it ships until that art exists. Whoever replaces it must keep
 * the `size` / `includeMark` contract so no caller changes.
 *
 * Rendered as live text rather than outlined artwork: the upstream wordmark is
 * a set of SVG path outlines, which means no string search can find it and it
 * cannot say another name without new artwork. Text keeps the product name in
 * one place, follows the type scale of whatever surrounds it, and stays
 * selectable.
 *
 * @param props.size - cap height in px (default 24); text scales with it.
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to draw the mark before the name.
 * @returns the wordmark element (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${size * 0.3}px`,
        lineHeight: 1,
        fontSize: `${size * 0.82}px`,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {includeMark ? <BrandMark size={size} /> : null}
      <span>RedSpark Harness</span>
    </span>
  )
}

/**
 * The mark drawn before the name: a five-point spark inside a ring, sized to
 * sit on the same baseline as the wordmark text.
 * @param props.size - overall height in px.
 * @returns the spark mark.
 */
function BrandMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flex: '0 0 auto' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <path
        d="M12 3.6l1.86 5.72a1 1 0 00.63.63L20.2 11.8a1 1 0 010 1.9l-5.71 1.86a1 1 0 00-.63.63L12 21.9l-1.86-5.71a1 1 0 00-.63-.63L3.8 13.7a1 1 0 010-1.9l5.71-1.86a1 1 0 00.63-.63L12 3.6z"
        fill="currentColor"
      />
    </svg>
  )
}
