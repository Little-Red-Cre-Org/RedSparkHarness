/** Native conversation navigation through the existing Desktop-owned IDE carrier. */
import type { NativeConversationController } from './controller.ts'

interface DesktopIde {
  open(value: unknown): Promise<void>
  subscribe(listener: (value: unknown) => Promise<void>): () => void
}

function sameWorkspace(left: string | undefined, right: string | null): boolean {
  if (left === undefined || right === null) return false
  const normalize = (value: string): string => /^[a-z]:[\\/]/iu.test(value) ? value.replaceAll('\\', '/').toLowerCase() : value
  return normalize(left) === normalize(right)
}

/** Primary-window IDE capability supplied by the Electron preload.
 * @returns the shell capability, or undefined in an ordinary browser or IDE frame.
 */
export function nativeDesktopIde(): DesktopIde | undefined {
  return (window as Window & { dshDesktop?: { ide?: DesktopIde } }).dshDesktop?.ide
}

/** Capture one settled Native Session and its unsent text for the existing Desktop wire.
 * @param controller - current Native conversation owner.
 * @param draft - unsent composer text.
 * @param blocked - whether attachments or another UI handoff prevent leaving.
 * @param busyMessage - localized refusal.
 * @returns selected Session, workspace path and draft; does not send a turn.
 */
export function nativeIdeHandoff(controller: NativeConversationController, draft: string, blocked: boolean, busyMessage: string) {
  const snapshot = controller.getSnapshot()
  if (blocked || snapshot.state !== 'ready' || snapshot.header?.cwd === undefined) throw new Error(busyMessage)
  return { workspaceId: snapshot.header.cwd, path: snapshot.header.cwd, sessionId: snapshot.header.id, draft }
}

/** Bind the existing Code OSS task messages and primary-window return callback.
 * @param controller - sole Client conversation owner; Host retains execution and persistence.
 * @param composer - current unsent input and localized errors.
 * @returns disposer withdrawing listeners and aborting pending frame requests.
 */
export function connectNativeWorkbench(controller: NativeConversationController, composer: {
  draft(): string
  setDraft(value: string): void
  hasAttachments(): boolean
  error(message: string): void
  busyMessage: string
  workspaceMessage: string
}): () => void {
  const url = new URL(location.href)
  const channel = url.searchParams.get('channel')
  const workspace = url.searchParams.get('workspace')
  const embedded = url.protocol === 'dsh-app:' && url.hostname.startsWith('ide-') && channel !== null && workspace !== null && parent !== window
  const lifetime = new AbortController()
  let initialized = false
  let pending = false
  const post = (value: Record<string, unknown>): void => { parent.postMessage({ ...value, channel }, '*') }
  const checked = async (operation: Promise<void>): Promise<void> => {
    await operation
    lifetime.signal.throwIfAborted()
    const error = controller.getSnapshot().error
    if (error !== undefined) throw new Error(error)
  }
  const restore = async (value: unknown): Promise<void> => {
    if (composer.hasAttachments() || controller.getSnapshot().state !== 'ready') throw new Error(composer.busyMessage)
    if (typeof value !== 'object' || value === null || !('path' in value) || typeof value.path !== 'string'
      || !('sessionId' in value) || typeof value.sessionId !== 'string'
      || !('draft' in value) || typeof value.draft !== 'string'
      || (embedded && !sameWorkspace(value.path, workspace))) throw new Error(composer.workspaceMessage)
    await checked(controller.load())
    const path = value.path
    const header = controller.getSnapshot().sessions.find(row => row.id === value.sessionId && sameWorkspace(row.cwd, path))
    if (header === undefined) throw new Error(composer.workspaceMessage)
    await checked(controller.select(header.id))
    composer.setDraft(value.draft)
  }
  const stopRestore = nativeDesktopIde()?.subscribe(restore)
  const publish = (): void => {
    if (!embedded || !initialized || lifetime.signal.aborted) return
    const snapshot = controller.getSnapshot()
    post({ type: 'state', workspace, workspaceId: workspace, canSwitchWorkspace: false, selected: snapshot.selected,
      tasks: snapshot.sessions.filter(row => sameWorkspace(row.cwd, workspace)).map(row => ({ id: row.id, title: row.id,
        running: row.id === snapshot.selected && (snapshot.state === 'sending' || snapshot.state === 'cancelling') })) })
  }
  const initialize = async (): Promise<void> => {
    const response = await fetch('/__rsh_desktop/handoff', { signal: lifetime.signal })
    if (!response.ok) throw new Error(composer.workspaceMessage)
    const handoff: unknown = await response.json()
    lifetime.signal.throwIfAborted()
    if (handoff !== null) await restore(handoff)
    else {
      const header = controller.getSnapshot().sessions.find(row => sameWorkspace(row.cwd, workspace))
      await checked(header === undefined ? controller.create() : controller.select(header.id))
      const cwd = controller.getSnapshot().header?.cwd
      if (cwd === undefined || !sameWorkspace(cwd, workspace)) throw new Error(composer.workspaceMessage)
    }
    initialized = true
    publish()
  }
  const fail = (error: unknown): void => {
    if (lifetime.signal.aborted) return
    const message = error instanceof Error ? error.message : String(error)
    composer.error(message)
    if (embedded) post({ type: 'error', message })
  }
  const receive = (event: MessageEvent<unknown>): void => {
    const value = event.data
    if (!embedded || event.source !== parent || typeof value !== 'object' || value === null
      || !('channel' in value) || value.channel !== channel || !('type' in value)) return
    if (value.type === 'appearance' && 'colors' in value && Array.isArray(value.colors)
      && value.colors.length === 6 && value.colors.every(color => typeof color === 'string' && CSS.supports('color', color))) {
      document.body.style.backgroundColor = value.colors[0] as string
      document.body.style.color = value.colors[1] as string
      document.documentElement.style.colorScheme = 'dark' in value && value.dark === true ? 'dark' : 'light'
      return
    }
    if (value.type === 'connect') {
      if (initialized) publish()
      else if (!pending && controller.getSnapshot().state === 'ready') {
        pending = true
        void initialize().catch(fail).finally(() => { pending = false })
      }
      return
    }
    if (!initialized || pending) return
    if (controller.getSnapshot().state !== 'ready' || composer.hasAttachments()) { fail(new Error(composer.busyMessage)); return }
    if (value.type === 'selection' && 'text' in value && typeof value.text === 'string') {
      const cwd = controller.getSnapshot().header?.cwd
      if (!('workspaceId' in value) || value.workspaceId !== workspace || cwd === undefined || !sameWorkspace(cwd, workspace)) {
        post({ type: 'selection-rejected', reason: 'workspace' }); return
      }
      composer.setDraft([composer.draft(), value.text].filter(Boolean).join('\n\n'))
      return
    }
    const command = async (): Promise<void> => {
      if (value.type === 'return-rsh') {
        const response = await fetch('/__rsh_desktop/return', { method: 'POST', signal: lifetime.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(nativeIdeHandoff(controller, composer.draft(), composer.hasAttachments(), composer.busyMessage)) })
        if (!response.ok) throw new Error(await response.text())
      } else if (value.type === 'new-session' || value.type === 'select-session') {
        if (composer.draft() !== '') throw new Error(composer.busyMessage)
        if (value.type === 'new-session') await checked(controller.create())
        else {
          const header = controller.getSnapshot().sessions.find(row => 'id' in value && row.id === value.id && sameWorkspace(row.cwd, workspace))
          if (header === undefined) throw new Error(composer.workspaceMessage)
          await checked(controller.select(header.id))
        }
      }
    }
    pending = true
    void command().catch(fail).finally(() => { pending = false; publish() })
  }
  window.addEventListener('message', receive)
  const stop = controller.subscribe(() => {
    publish()
    if (embedded && !initialized && !pending && controller.getSnapshot().state === 'ready') post({ type: 'ready' })
  })
  if (embedded) post({ type: 'ready' })
  return () => { lifetime.abort(); stopRestore?.(); stop(); window.removeEventListener('message', receive) }
}
