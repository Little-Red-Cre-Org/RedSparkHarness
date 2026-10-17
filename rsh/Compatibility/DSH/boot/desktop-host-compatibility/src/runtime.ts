/** One legacy Host response carrier and its complete teardown. */
export interface DesktopHostRuntime {
  /** Dispatch a request through the selected compatibility composition. */
  fetch(request: Request): Promise<Response>
  /** Dispose all Cordis services after in-flight requests settle. */
  dispose(): Promise<void>
}
