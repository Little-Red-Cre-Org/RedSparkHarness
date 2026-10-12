/** Adapt a Remote relative read without changing its Session or Host path authority. */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import { htmlRelativePath } from '@deepseek-ai/dsh-client-ui-primitives'
import { documentFileBytes } from '../rpc.ts'
import type { ReadHtmlRelative } from './pack.ts'

/**
 * Read one dependency relative to the addressed HTML file through the Host.
 * @param address - root HTML file address.
 * @param relativePath - decoded dependency path, resolved only by the Host.
 * @param signal - cancellation shared by the tab and packing operation.
 * @returns the Remote complete-byte result, including declared failures.
 */
export type ReadHtmlRelated = (address: string, relativePath: string, signal: AbortSignal) => Promise<RemoteResult<WorkspaceFileBytes>>

/**
 * Decode and validate one HTML dependency path before the Host resolves it.
 * @param reference - URL from a supported HTML script or stylesheet attribute.
 * @returns the decoded workspace-relative dependency path.
 */
export { htmlRelativePath }

/**
 * Bind a package reader to the original HTML file's address.
 * @param readRelated - Remote reader using the Session in the root HTML address.
 * @param address - root HTML file address.
 * @param lifetime - tab lifetime.
 * @returns a reader that strips URL query/fragment, decodes one path, and preserves Host failures.
 */
export function createReadHtmlRelative(readRelated: ReadHtmlRelated, address: string, lifetime: AbortSignal): ReadHtmlRelative {
  return async (reference, signal) => {
    const path = htmlRelativePath(reference)
    const combined = AbortSignal.any([lifetime, signal])
    combined.throwIfAborted()
    const result = await readRelated(address, path, combined)
    combined.throwIfAborted()
    if (!result.ok) throw new Error(result.error.message)
    return documentFileBytes(result.value)
  }
}
