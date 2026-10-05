/** Compatibility Workspace vocabulary and Typert error declarations. */
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from './workspace-types.ts'
export type { Workspace, WorkspaceId } from './workspace-types.ts'
declare module '@deepseek-ai/dsh-typert-protocol/types' {
  interface RemoteErrorDetailsMap {
    /** No registration carries that Workspace identity. */
    'workspace/not-found': { readonly workspaceId: WorkspaceId }
  }
}
