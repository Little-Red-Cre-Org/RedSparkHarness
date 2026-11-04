/**
 * `/` command-token recognition shared by every client surface that offers a
 * slash menu.
 *
 * The Web trigger pipeline (`ui-input-trigger`) and the Native composer palette
 * both ask this module where a `/` token starts, so one boundary rule governs
 * both and neither surface can drift from the other.
 */

const WORD_CHAR = /[\p{L}\p{N}_]/u
const WHITESPACE = /\s/u

/** A live `/` token under the caret. */
export interface SlashToken {
  /** Text between the slash and the caret; the filter. */
  readonly query: string
  /** Offset of the slash that opened the token. */
  readonly start: number
  /** Caret offset, i.e. one past the last query character. */
  readonly end: number
}

/**
 * Whether a `/` at `index` opens a command token.
 *
 * A slash opens a token at start-of-draft, after whitespace (newlines
 * included), or after punctuation. It stays an ordinary character directly
 * after a word character, which is what keeps `a/b` and `see src/main` out of the
 * menu. A `/` in `1/2 cup` also stays inert: the `1` is a word character.
 *
 * Two carve-outs keep `/` dead inside URLs: directly after another `/` (the
 * second slash of `//`), and directly after a `:` that itself follows a
 * non-whitespace character (a scheme separator such as `https:/`).
 *
 * @param draft - full draft text.
 * @param index - offset of the candidate slash.
 * @returns whether a token may open at `index`.
 */
function boundaryOpen(draft: string, index: number): boolean {
  if (index === 0) return true
  const prev = draft.charAt(index - 1)
  if (WHITESPACE.test(prev)) return true
  if (WORD_CHAR.test(prev)) return false
  if (prev === '/') return false
  if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false
  return true
}

/**
 * Recognize the `/` token the caret sits in.
 *
 * The scan walks left to the first whitespace, so a token ends the way an
 * ordinary word ends. A caret still ON the terminating space keeps the name
 * live, which is the instant a user presses space expecting the menu to settle.
 *
 * Slashes that fail the boundary are ordinary token characters, so the scan
 * continues past them — that is what makes a URL's inner slashes inert
 * instead of closing the menu.
 *
 * @param draft - full draft text.
 * @param caret - caret offset into `draft`.
 * @returns the live token, or null when the caret is not inside a `/` token.
 */
export function slashTokenAt(draft: string, caret: number): SlashToken | null {
  if (caret < 0 || caret > draft.length) return null
  for (let index = caret - 1; index >= 0; index--) {
    const char = draft.charAt(index)
    if (WHITESPACE.test(char)) return null
    if (char !== '/') continue
    if (!boundaryOpen(draft, index)) continue
    return { query: draft.slice(index + 1, caret), start: index, end: caret }
  }
  return null
}
