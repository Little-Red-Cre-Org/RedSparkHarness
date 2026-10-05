/** One mutually exclusive Host assembly mounted under Electron's private byte pipes. */
export interface DesktopHostRuntime {
  /**
   * Dispatch an Electron-authenticated custom-protocol request.
   * @param request - Private carrier request.
   * @returns Selected Host response.
   */
  fetch(request: Request): Promise<Response>
  /**
   * Stop and drain every selected Host contribution.
   * @returns Completion after Host resources settle.
   */
  dispose(): Promise<void>
}
