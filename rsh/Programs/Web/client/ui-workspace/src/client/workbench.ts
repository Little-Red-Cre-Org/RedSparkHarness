/** Embedded conversation navigation over a Desktop-minted, parent-bound message channel. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from './navigation.ts'
import type { IConversation, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { captureIdeDraft, restoreIdeDraft } from './desktop-ide.ts'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/**
 * Connect the existing Session models to their enclosing Code OSS task view.
 * @param sessions - authoritative Client Session model.
 * @param workspaces - canonical Workspace controller.
 * @param navigation - existing Session navigation and blank-Session reuse.
 * @param conversation - existing scoped composer input; selections remain unsent drafts.
 * @param ctx - Client effect owner and file-navigation events.
 * @returns disposer for subscriptions and incoming commands.
 */
export function connectWorkbench(
  sessions: ISessions, workspaces: IWorkspaces, navigation: UiWorkspace, conversation: IConversation, ctx: Context,
): () => void {
  if (typeof location === 'undefined' || typeof window === 'undefined') return () => {}
  const url = new URL(location.href)
  const channel = url.searchParams.get('channel')
  const workspacePath = url.searchParams.get('workspace')
  if (location.protocol !== 'dsh-app:' || !location.hostname.startsWith('ide-') || channel === null
    || workspacePath === null || parent === window) return () => {}
  let connected = false
  let disposed = false
  let pending: Promise<void> | undefined
  let workspace: WorkspaceView | undefined
  const persistedDrafts = new Set<SessionId>()
  const inputs = new Map<SessionId, { input: SessionInput; stop: () => void }>()
  const post = (value: Record<string, unknown>): void => { parent.postMessage({ ...value, channel }, '*') }
  const publish = (): void => {
    if (!connected || workspace === undefined || disposed || pending !== undefined) return
    const snapshot = sessions.list.getSnapshot()
    const items = workspaces.list.getSnapshot().items
    const currentWorkspace = items.find(row => snapshot.current !== undefined && row.sessionIds.includes(snapshot.current))
      ?? items.find(row => row.workspaceId === workspace?.workspaceId) ?? workspace
    if (currentWorkspace.workspaceId !== workspace.workspaceId
      && (snapshot.current === undefined || !persistedDrafts.has(snapshot.current))) return
    const binding = snapshot.current === undefined ? undefined : sessions.binding(snapshot.current)
    for (const [id, entry] of inputs) {
      if (id !== snapshot.current && !snapshot.ids.includes(id)) { entry.stop(); inputs.delete(id) }
    }
    if (binding !== undefined && !inputs.has(binding.sessionId)) {
      const input = conversation.input.for(binding.ctx)
      inputs.set(binding.sessionId, { input, stop: input.state.subscribe(publish) })
    }
    const canSwitchWorkspace = [...inputs.values()].every(({ input }) => {
      const state = input.state.getSnapshot()
      return state.phase === 'plain' && state.attachmentIds.length === 0
    })
    workspace = currentWorkspace
    const archived = workspaces.list.getSnapshot().archivedSessionIds
    const tasks = snapshot.ids.flatMap((id) => {
      const row = snapshot.byId[id]
      return row !== undefined && currentWorkspace.sessionIds.includes(id) && !archived.includes(id)
        ? [{ id, title: row.displayTitle, running: row.running }] : []
    })
    post({ type: 'state', tasks, selected: snapshot.current, workspace: currentWorkspace.path, workspaceId: currentWorkspace.workspaceId, canSwitchWorkspace })
  }
  const fail = (error: unknown): void => {
    if (!disposed) post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  const initialize = (): void => {
    if (!connected || disposed || pending !== undefined || workspace !== undefined || sessions.list.getSnapshot().phase !== 'ready') return
    pending = workspaces.create({ path: workspacePath }).then(async (value) => {
      if (disposed) return
      workspace = value
      const handoff: unknown = url.searchParams.has('desktop')
        ? await fetch('/__rsh_desktop/handoff').then(response => response.json()) : null
      // Disposal can occur while the Desktop handoff request is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (disposed) return
      if (handoff !== null) {
        await restoreIdeDraft(handoff, sessions, workspaces, navigation, conversation, ctx.locale.bind('workspace')('ide.inputBusy'))
        pending = undefined
        publish()
        return
      }
      const current = sessions.list.getSnapshot().current
      if (current === undefined || !value.sessionIds.includes(current)) {
        const recent = value.sessionIds.find(id => sessions.list.getSnapshot().byId[id] !== undefined)
        if (recent === undefined) await navigation.openWorkspace(value.workspaceId)
        else navigation.openSession(recent)
      }
      pending = undefined
      publish()
    }).catch(fail).finally(() => { pending = undefined })
  }
  const receive = (event: MessageEvent<unknown>): void => {
    const value = event.data
    if (disposed || event.source !== parent || typeof value !== 'object' || value === null
      || !('channel' in value) || value.channel !== channel || !('type' in value)) return
    if (value.type === 'connect') { connected = true; initialize(); publish(); return }
    if (!connected || workspace === undefined) return
    if (value.type === 'selection' && 'text' in value && typeof value.text === 'string' && value.text !== '') {
      const current = sessions.list.getSnapshot().current
      const binding = current === undefined ? undefined : sessions.binding(current)
      if (!('workspaceId' in value) || value.workspaceId !== workspace.workspaceId || binding === undefined
        || !workspace.sessionIds.includes(binding.sessionId)) {
        post({ type: 'selection-rejected', reason: 'workspace' })
        return
      }
      const input = conversation.input.for(binding.ctx).state.getSnapshot()
      const end = input.draft.length
      if (input.phase !== 'plain' || binding.ctx.bail('slash/input-insert-text', {
        text: `${end === 0 ? '' : '\n\n'}${value.text}`,
        span: { start: end, end, draftRev: input.draftRev },
      }) !== true) post({ type: 'selection-rejected', reason: 'busy' })
    }
    if (value.type === 'return-rsh' && url.searchParams.has('desktop')) {
      const current = sessions.list.getSnapshot().current
      const target = workspaces.list.getSnapshot().items.find(row => current !== undefined && row.sessionIds.includes(current)) ?? workspace
      void Promise.resolve().then(async () => {
        const payload = captureIdeDraft(target.workspaceId, sessions, workspaces, conversation, ctx.locale.bind('workspace')('ide.inputBusy'))
        const response = await fetch('/__rsh_desktop/return', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error(await response.text())
      }).catch(fail)
    }
    if (value.type === 'new-session') navigation.startSession(workspace.workspaceId)
    if (value.type === 'select-session' && 'id' in value && typeof value.id === 'string') {
      const selected = sessions.list.getSnapshot().ids.find(id => id === value.id)
      const currentWorkspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === workspace?.workspaceId)
      if (selected !== undefined && currentWorkspace?.sessionIds.includes(selected)) navigation.openSession(selected)
    }
  }
  window.addEventListener('message', receive)
  const stopDrafts = ctx.on('conversation/draft-persistence', (sessionId, ready) => {
    if (ready) persistedDrafts.add(sessionId)
    else persistedDrafts.delete(sessionId)
    publish()
  })
  const stopFiles = ctx.on('workbench/open-file', ({ sessionId, path, line, diffs }) => {
    if (!connected || workspace === undefined || disposed) return undefined
    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    if (cwd === undefined) return undefined
    post({ type: 'open-file', path: resolveWorkspacePath(cwd, path), line, ...(diffs === undefined ? {} : { diffs }) })
    return true
  })
  const stopSessions = sessions.list.subscribe(() => { initialize(); publish() })
  const stopWorkspaces = workspaces.list.subscribe(publish)
  // The outer frame can finish loading before Cordis activates this plugin.
  post({ type: 'ready' })
  return () => {
    disposed = true
    for (const { stop } of inputs.values()) stop()
    stopDrafts(); stopFiles(); stopSessions(); stopWorkspaces()
    window.removeEventListener('message', receive)
  }
}
