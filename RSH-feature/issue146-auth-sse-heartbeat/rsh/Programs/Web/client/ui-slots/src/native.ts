/** Framework-neutral contracts for mounting a Native Client application. */
import type {} from '@deepseek-ai/dsh-native-runtime'

/** Application view supplied by the selected Native Client composition. */
export interface NativeClientApplication {
  /** Produce the view mounted by the selected renderer. */
  render(): unknown
}

/** Renderer capability required by the Native Client boot kernel. */
export interface NativeClientRenderer {
  /**
   * Mount the selected application and return its idempotent unmount operation.
   * @param container - application mount point.
   * @param application - selected Native Client application.
   * @param signal - aborted when the Native Client composition stops.
   * @returns cleanup operation owned by the Native Client composition.
   */
  mount(container: HTMLElement, application: NativeClientApplication, signal: AbortSignal): () => void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Application selected by the Native Client profile. */
    clientApplication: NativeClientApplication
    /** Renderer selected by the Native Client profile. */
    clientRenderer: NativeClientRenderer
  }
}
