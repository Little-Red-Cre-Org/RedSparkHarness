/** Native sandboxing filesystem Provider with installation-owned cancellation and draining. */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import type {} from '@deepseek-ai/dsh-fs/native'
import { FsError } from '@deepseek-ai/dsh-fs/types'
import type { FsEditOutcome, FsEditRequest, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs/types'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox/native-types'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'
import { checkedSandboxTarget } from './policy.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sandboxPolicy: NativeSandboxPolicy }
}

class NativeSandboxedFileSystem extends LocalFileSystemBackend {
  private readonly mutations = new Set<Promise<unknown>>()
  private closing = false
  private drain: Promise<void> | undefined

  constructor(config: ConstructorParameters<typeof LocalFileSystemBackend>[0], private readonly policy: NativeSandboxPolicy) {
    super(config)
  }

  override get sandboxMode(): SandboxMode {
    return this.policy.defaultMode
  }

  /** Fence and track a write from policy resolution through local publication. */
  override writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return this.trackMutation(async () => {
      const checked = await checkedSandboxTarget(path => this.resolve(path), target, sandboxPolicy ?? this.policy.resolve())
      return super.writeText(checked, content, expected, signal)
    })
  }

  /** Fence and track an edit from policy resolution through local publication. */
  override editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return this.trackMutation(async () => {
      const checked = await checkedSandboxTarget(path => this.resolve(path), target, sandboxPolicy ?? this.policy.resolve())
      return super.editText(checked, edit, expected, signal)
    })
  }

  /** Abort backend I/O and await admitted mutations, including their policy checks. */
  override close(): Promise<void> {
    this.closing = true
    if (this.drain) return this.drain
    const backendShutdown = super.close()
    const mutations = [...this.mutations]
    this.drain = (async () => {
      await Promise.allSettled([backendShutdown, ...mutations])
    })()
    return this.drain
  }

  private trackMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new FsError('filesystem operation aborted', 'FS_ABORTED'))
    const pending = Promise.resolve().then(operation)
    this.mutations.add(pending)
    void pending.then(() => this.mutations.delete(pending), () => this.mutations.delete(pending))
    return pending
  }
}

/** Install the selected native policy and local backend as the one `fs` authority. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-fs-sandbox',
  targets: ['host'],
  requires: ['sandboxPolicy'],
  provides: ['fs'],
  resolve(input) {
    const config = resolveLocalFilesystemConfig(input)
    return (context) => {
      const backend = new NativeSandboxedFileSystem(config, context.require('sandboxPolicy'))
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
