/** Native local filesystem provider with installation-owned cancellation and draining. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig } from './backend.ts'

/** Explicitly selected local host storage; it provides no sandbox confinement. */
export const localFilesystemPlugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-fs-local',
  targets: ['host'],
  requires: [],
  provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    return (context) => {
      const backend = new LocalFileSystemBackend(config)
      const cancel = () => { void backend.close() }
      context.signal.addEventListener('abort', cancel, { once: true })
      context.own(async () => {
        context.signal.removeEventListener('abort', cancel)
        await backend.close()
      })
      if (context.signal.aborted) cancel()
      context.provide('fs', backend)
    }
  },
}

/** Named package entry validated against package.json.dsh.native before activation. */
export const plugin = localFilesystemPlugin
