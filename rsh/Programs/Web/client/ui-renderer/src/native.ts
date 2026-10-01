/** React mount provider for native Client compositions. */
import { type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createSlotRenderer } from './client/scoped-slots.tsx'
import { SlotRuntime } from './slot-runtime.ts'

/** Application root supplied by the selected native Client composition. */
export interface NativeClientApplication {
  /** Return the React content rendered into the application's mount element. */
  render(): unknown
}

/** Renderer capability supplied to the native Client mount lifecycle. */
export interface NativeClientRenderer {
  /**
   * Mount the selected React application and return its idempotent unmount operation.
   * A failed initial render releases the newly created React root before throwing.
   * @param container - application mount point.
   * @param application - selected native Client application.
   * @param signal - aborted when the native Client composition stops.
   * @returns cleanup operation owned by the native Client composition.
   */
  mount(container: HTMLElement, application: NativeClientApplication, signal: AbortSignal): () => void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Shared React slot runtime used by native Client contributions. */
    clientSlots: SlotRuntime
    /** React application root selected by the native Client profile. */
    clientApplication: NativeClientApplication
    /** React renderer selected by the native Client profile. */
    clientRenderer: NativeClientRenderer
  }
}

/** React renderer Provider for native Client profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: 'client-ui-renderer',
  targets: ['client'],
  requires: [],
  provides: ['clientSlots', 'clientRenderer'],
  resolve: () => (context) => {
    const slots = new SlotRuntime()
    context.provide('clientSlots', slots)
    context.own(slots.install(createSlotRenderer()))
    context.provide('clientRenderer', {
      mount: (container, application, signal) => {
        signal.throwIfAborted()
        const root = createRoot(container)
        let mounted = true
        const unmount = (): void => {
          if (!mounted) return
          mounted = false
          flushSync(() => { root.unmount() })
        }
        try {
          flushSync(() => { root.render(application.render() as ReactNode) })
        } catch (error) {
          try {
            unmount()
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'native Client render and cleanup failed')
          }
          throw error
        }
        return unmount
      },
    })
  },
}
