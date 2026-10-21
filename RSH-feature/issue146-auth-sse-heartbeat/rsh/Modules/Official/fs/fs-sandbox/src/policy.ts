/** Shared write/edit fence for the Cordis and Native filesystem Providers. */

import { FsError } from '@deepseek-ai/dsh-fs/types'
import type { FsTarget } from '@deepseek-ai/dsh-fs/types'
import { writableRoots } from '@deepseek-ai/dsh-sandbox/roots'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox/native-types'
import { isPathUnder } from './containment.ts'

/**
 * Revalidate confinement and the caller's resolved target identity before mutation.
 * @param resolveTarget - backend resolution function used for the fresh check.
 * @param target - caller-resolved target to validate.
 * @param policy - complete policy for this mutation.
 * @returns the original target after validation; denies confinement escapes or a changed target identity.
 */
export async function checkedSandboxTarget(
  resolveTarget: (path: string) => Promise<FsTarget>,
  target: FsTarget,
  policy: SandboxExecutionPolicy,
): Promise<FsTarget> {
  if (policy.mode === 'danger-full-access') return target
  if (policy.mode === 'read-only') {
    throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
  }

  const fresh = await resolveTarget(target.displayPath)
  for (const root of writableRoots(policy)) {
    if (await isPathUnder(fresh.targetKey, root)) {
      if (fresh.targetKey !== target.targetKey) {
        throw new FsError(`cannot write "${target.displayPath}": target changed since it was resolved`, 'FS_STALE_VERSION')
      }
      return target
    }
  }
  throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
}
