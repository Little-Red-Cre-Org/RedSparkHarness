/** Workspace-scoped Desktop navigation and unsent text handoff. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from './navigation.ts'

interface DesktopIde {
  open(value: unknown): Promise<void>
  provideSelection(listener: () => unknown): () => void
  subscribe(listener: (value: unknown) => Promise<void>): () => void
}

/** Resolve the primary Desktop renderer's IDE capability.
 * @returns Desktop navigation when supplied by the primary renderer preload.
 */
export function desktopIde(): DesktopIde | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { dshDesktop?: { ide?: DesktopIde } }).dshDesktop?.ide
}

/**
 * Capture a selected Host workspace and its currently selected plain-text draft.
 * @param workspaceId - explicit menu target, or current workspace on return.
 * @param sessions - Client Session projections.
 * @param workspaces - Host-projected workspaces.
 * @param conversation - scoped draft owner.
 * @param busyMessage - localized refusal for attachments or an active input operation.
 * @returns wire request for Desktop; never submits input.
 */
export function captureIdeDraft(
  workspaceId: WorkspaceId, sessions: ISessions, workspaces: IWorkspaces,
  conversation: IConversation, busyMessage: string,
): { workspaceId: WorkspaceId; path: string; sessionId?: string; draft?: string } {
  const workspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === workspaceId)
  if (workspace === undefined) throw new Error('Workspace is no longer available')
  const current = sessions.list.getSnapshot().current
  const binding = current === undefined || !workspace.sessionIds.includes(current) ? undefined : sessions.binding(current)
  if (binding === undefined) return { workspaceId, path: workspace.path }
  const input = conversation.input.for(binding.ctx).state.getSnapshot()
  if (input.phase !== 'plain' || input.attachmentIds.length !== 0) throw new Error(busyMessage)
  return { workspaceId, path: workspace.path, sessionId: binding.sessionId, draft: input.draft }
}

/**
 * Restore a known session's text before revealing its destination renderer.
 * @param value - untrusted Desktop handoff JSON.
 * @param sessions - Client Session projections.
 * @param workspaces - Host-projected workspaces.
 * @param navigation - existing session navigation.
 * @param conversation - scoped draft owner.
 * @param busyMessage - localized refusal for a destination input that cannot be replaced.
 */
export async function restoreIdeDraft(
  value: unknown, sessions: ISessions, workspaces: IWorkspaces, navigation: UiWorkspace,
  conversation: IConversation, busyMessage: string,
): Promise<void> {
  if (typeof value !== 'object' || value === null || !('workspaceId' in value)
    || typeof value.workspaceId !== 'string' || !('path' in value) || typeof value.path !== 'string') {
    throw new Error('Invalid desktop workspace handoff')
  }
  const workspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === value.workspaceId && row.path === value.path)
  if (workspace === undefined) throw new Error('Workspace is no longer available')
  if (!('sessionId' in value)) { await navigation.openWorkspace(workspace.workspaceId); return }
  const id = workspace.sessionIds.find(id => id === value.sessionId)
  const binding = id === undefined ? undefined : sessions.binding(id)
  if (binding === undefined || !('draft' in value) || typeof value.draft !== 'string') {
    throw new Error('Conversation is no longer available')
  }
  const input = conversation.input.for(binding.ctx)
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' || state.attachmentIds.length !== 0) throw new Error(busyMessage)
  input.setDraft(value.draft)
  navigation.openSession(binding.sessionId)
}

/**
 * Capture the current conversation's workspace for the Desktop application menu.
 * @param sessions - selected Session projection.
 * @param workspaces - available workspace projection.
 * @param conversation - current draft owner.
 * @param busyMessage - localized refusal for non-plain input.
 * @returns current workspace and draft, or undefined when no workspace is selected.
 */
export function captureCurrentIdeDraft(
  sessions: ISessions, workspaces: IWorkspaces, conversation: IConversation, busyMessage: string,
): ReturnType<typeof captureIdeDraft> | undefined {
  const current = sessions.list.getSnapshot().current
  const workspace = current === undefined ? undefined
    : workspaces.list.getSnapshot().items.find(row => row.sessionIds.includes(current))
  return workspace === undefined ? undefined
    : captureIdeDraft(workspace.workspaceId, sessions, workspaces, conversation, busyMessage)
}
