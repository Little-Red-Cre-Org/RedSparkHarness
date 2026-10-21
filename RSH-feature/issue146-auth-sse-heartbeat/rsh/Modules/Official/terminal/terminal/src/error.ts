/** Shared machine-routable persistent terminal failures. */
/** Machine-routable PTY service failures. */
export type TerminalErrorCode =
  | 'DUPLICATE_BACKEND'
  | 'DUPLICATE_NAME'
  | 'FOREIGN_SESSION'
  | 'NO_BACKEND'
  | 'NO_SESSION'
  | 'OWNER_NOT_LIVE'
  | 'SEND_ACTIVE'
  | 'SERVICE_DISPOSING'

/** Error carrying a stable {@link TerminalErrorCode}. */
export class TerminalError extends Error {
  constructor(message: string, readonly code: TerminalErrorCode) {
    super(message)
    this.name = 'TerminalError'
  }
}
