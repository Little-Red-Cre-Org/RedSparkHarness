/**
 * Slash-command completion for the Native composer.
 *
 * The candidate filtering, the highlight walk and the line a pick submits are
 * pure decisions owned here. The token recognition is not: it lives in
 * `ui-primitives` as `slashTokenAt`, which the Web trigger pipeline reads
 * too, so one boundary rule decides where a `/` command token starts in
 * both surfaces.
 */

/** One row the Host advertises, reduced to what the menu needs. */
export interface CommandChoice {
  /** Command name without the leading slash. */
  readonly name: string
  /** Human-readable summary shown beside the name. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly hint?: string | undefined
}

/**
 * Filter the advertised commands by a case-insensitive substring of the name.
 *
 * Substring rather than prefix: `/comp` should find `compact` and a user who
 * remembers the middle of a name should not have to guess its start. An empty
 * query keeps every row in Host order, which is the order the Host advertises
 * as its own ranking.
 *
 * @param commands - rows advertised by the Host.
 * @param query - text after the slash.
 * @returns the rows to render, unchanged when the query is empty.
 */
export function filterCommands(
  commands: readonly CommandChoice[],
  query: string,
): readonly CommandChoice[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return commands
  return commands.filter(command => command.name.toLowerCase().includes(needle))
}

/**
 * Walk the highlight by one row, wrapping at both ends.
 *
 * Wrapping is deliberate: the list is short and a menu that dead-ends forces
 * the user to look at the highlight instead of the intent. `-1` means the walk
 * from "nothing highlighted" (which is how the menu opens) selects the first
 * row going down and the last going up.
 *
 * @param current - current highlight index, or -1 for none.
 * @param delta - +1 or -1.
 * @param length - candidate count.
 * @returns the next index, or -1 when there is nothing to highlight.
 */
export function moveHighlight(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return delta === 1 ? 0 : length - 1
  return (current + delta + length) % length
}

/**
 * Build the line a pick submits.
 *
 * The Host executes a complete slash command line, so the leading slash is
 * required here even though the menu shows bare names. A command that takes
 * input is submitted bare: the user completes the arguments in the composer
 * rather than the menu guessing them.
 *
 * @param name - command name without the leading slash.
 * @returns the line to hand to `executeCommand`.
 */
export function commandLine(name: string): string {
  return `/${name.trim().replace(/^\/+/u, '')}`
}

/**
 * Whether a keydown belongs to the open command menu.
 *
 * The composer already uses Escape (stop a running turn) and Enter (submit),
 * so the menu may only claim them while it is open AND has a row to act on.
 * An open-but-empty menu must not swallow Enter, or the user loses the ability
 * to send a message that merely starts with a slash.
 *
 * Arrow keys are reported as consumed even over an empty list: they are
 * meaningless in a single-line textarea, and letting them through would move
 * the caret into text the menu is about to replace.
 *
 * @param key - `event.key`.
 * @param menuOpen - whether the menu is rendered.
 * @param rowCount - candidates currently rendered.
 * @param composing - whether an IME composition owns the key.
 * @returns the action the composer applies, or `pass` to keep native behaviour.
 */
export function commandKeyAction(
  key: string,
  menuOpen: boolean,
  rowCount: number,
  composing = false,
): 'up' | 'down' | 'accept' | 'close' | 'pass' {
  if (!menuOpen || composing) return 'pass'
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  if (key === 'Enter') return rowCount > 0 ? 'accept' : 'pass'
  if (key === 'Escape') return 'close'
  // Tab completes the highlighted name and keeps the menu shut afterwards,
  // which is the one convention every slash palette shares.
  if (key === 'Tab') return rowCount > 0 ? 'accept' : 'close'
  return 'pass'
}
