/** Native filesystem service and policy events; importing this entry registers no provider. */
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { FileSystemOperations } from './operations.ts'
import type { FsObservation, FsTarget, FsVersion, FsWriteIntent } from './types.ts'

export { FileSystemOperations } from './operations.ts'
export * from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    fs: FileSystemOperations
  }
  interface NativeEvents {
    /**
     * Choose one write guard; delegating to next permits the terminal provider intent.
     * @mode waterfall
     * @param target - resolved target about to be written.
     * @param actor - tool execution identity used by the policy owner.
     */
    'fs/write-intent': {
      mode: 'waterfall'
      args: [target: FsTarget, actor: object | undefined]
      result: FsWriteIntent | undefined
    }
    /**
     * Choose one edit version guard; delegation yields the terminal provider intent.
     * @mode waterfall
     * @param target - resolved target about to be edited.
     * @param actor - tool execution identity used by the policy owner.
     */
    'fs/edit-intent': {
      mode: 'waterfall'
      args: [target: FsTarget, actor: object | undefined]
      result: { version: FsVersion } | undefined
    }
    /**
     * Record the observation synchronously; a recorder failure fails the calling operation.
     * @mode emit
     * @param target - observed target.
     * @param observation - authoritative presence or absence and version.
     * @param actor - observing tool execution identity.
     */
    'fs/observed': {
      mode: 'sync'
      args: [target: FsTarget, observation: FsObservation, actor: object | undefined]
      result: undefined
    }
  }
}
