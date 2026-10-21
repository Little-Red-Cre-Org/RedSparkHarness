/** React mount provider for native Client compositions. */
import { type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
export type { NativeClientApplication, NativeClientRenderer } from '@deepseek-ai/dsh-client-ui-slots/native'
import { createSlotRenderer } from './client/scoped-slots.tsx'
import { SlotRuntime } from './slot-runtime.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Shared React slot runtime used by native Client contributions. */
    clientSlots: SlotRuntime
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
