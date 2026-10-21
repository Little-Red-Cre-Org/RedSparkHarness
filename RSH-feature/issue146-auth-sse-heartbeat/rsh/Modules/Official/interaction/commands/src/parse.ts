/** Framework-neutral slash syntax shared by human command adapters. */
/** Syntactically valid slash command before registry resolution. */
export interface ParsedCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Exact text following the command name. */
  readonly rawInput: string
}

/**
 * Parse an exact slash command without normalizing its trailing input.
 * @param line - complete human input.
 * @returns parsed command, or undefined for ordinary input.
 */
export function parseCommand(line: string): ParsedCommand | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
  if (match === null || match[1] === undefined) return undefined
  return Object.freeze({ name: match[1], rawInput: line.slice(match[0].length) })
}
