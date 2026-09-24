import type { NativeClientRenderer } from './native-boot.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Browser application renderer selected by the native Client composition. */
    clientRenderer: NativeClientRenderer
  }
}
