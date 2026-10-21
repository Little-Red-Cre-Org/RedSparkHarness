/** Code - OSS workbench capability supplied by the selected Native Provider. */
import type {} from '@deepseek-ai/dsh-native-runtime'

/** One running IDE; its Provider owns the server and extension-host processes. */
export interface NativeIde {
  /** Local workspace URL containing the private connection token; never persist in Session logs. */
  readonly url: string
  /** Server exit code; rejects on process failure. Provider disposal also drains descendants. */
  readonly exited: Promise<number>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** IDE selected by the application profile. */
    ide: NativeIde
  }
}
