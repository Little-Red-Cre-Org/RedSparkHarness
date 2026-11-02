/** Compatibility Workspace vocabulary and Typert error declarations. */
import type {} from '@redspark/rsh-typert-protocol/types'
import type { WorkspaceId } from './workspace-types.ts'
export type { Workspace, WorkspaceId } from './workspace-types.ts'
declare module '@redspark/rsh-typert-protocol/types' {
  interface RemoteErrorDetailsMap {
    /** No registration carries that Workspace identity. */
    'workspace/not-found': { readonly workspaceId: WorkspaceId }
  }
}
