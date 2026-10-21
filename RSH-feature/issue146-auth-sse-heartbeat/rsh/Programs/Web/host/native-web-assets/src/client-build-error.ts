/** Host-only failed Client compilation observations for automatic recovery. */
export class NativeClientBuildError extends Error {
  /**
   * @param cause - original compiler failure retained for diagnostics.
   * @param watchDirectories - exact input and unresolved relative-import directories to observe.
   */
  constructor(cause: unknown, readonly watchDirectories: readonly string[]) {
    super(String(cause), { cause })
    this.name = 'NativeClientBuildError'
  }
}
