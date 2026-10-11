import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'

/** Workspace row projected by the Host registry. */
export interface NativeWorkspace {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly sessionIds: readonly SessionId[]
}

/** Complete reconnect state for the Host Workspace registry. */
export interface NativeWorkspaceBaseline {
  readonly workspaces: readonly NativeWorkspace[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One Workspace registry update after a baseline. */
export type NativeWorkspaceFrame =
  | { readonly type: 'baseline'; readonly value: NativeWorkspaceBaseline }
  | { readonly type: 'upsert'; readonly workspace: NativeWorkspace }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Directory row that the browser may enter or select. */
export interface NativeDirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/** One directory level and its filesystem ancestry. */
export interface NativeDirectoryListing {
  readonly path: string
  readonly entries: readonly NativeDirectoryEntry[]
  readonly crumbs: readonly { readonly name: string; readonly path: string }[]
}
