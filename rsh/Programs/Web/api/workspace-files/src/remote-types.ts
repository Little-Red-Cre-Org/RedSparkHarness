/** Remote error details paired with the Cordis-free workspace file wire types.
 * @module @deepseek-ai/dsh-api-workspace-files/types
 */
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol/types' {
  interface RemoteErrorDetailsMap {
    /** No entry exists at that path inside the workspace. */
    'workspace-file/not-found': { readonly path: string }
    /** The directory listing path resolves outside the session's workspace root. */
    'workspace-file/outside-workspace': { readonly path: string }
    /** The requested page exceeds the configured byte cap; nothing is returned. */
    'workspace-file/too-large': { readonly path: string; readonly limit: number }
    /** The content read so far is not decodable UTF-8 text, or the page carries NUL bytes. */
    'workspace-file/not-text': { readonly path: string }
    /** The path is not a regular file, so it has no text to read. */
    'workspace-file/not-regular-file': {
      readonly path: string
      readonly kind: 'directory' | 'symlink' | 'other'
    }
    /** The path is not a directory, so it has no children to list. */
    'workspace-file/not-directory': {
      readonly path: string
      readonly kind: 'file' | 'symlink' | 'other'
    }
  }
}
