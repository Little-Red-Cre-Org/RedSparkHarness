// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '../src/client/navigation.ts'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Context } from '@deepseek-ai/cordis'
import { connectWorkbench } from '../src/client/workbench.ts'

afterEach(() => { vi.unstubAllGlobals() })

it.each(['authorized', 'wrong-channel', 'busy', 'switched-workspace'] as const)('workbench handles %s commands and stops delivery on disposal', async (mode) => {
  const parentFrame = { postMessage: vi.fn() }
  vi.stubGlobal('parent', parentFrame)
  vi.stubGlobal('location', new URL('dsh-app://ide-test/index.html?channel=private&workspace=C%3A%2Fproject'))
  const id = 'existing' as never
  const workspace = { workspaceId: 'workspace' as never, path: 'C:/project', title: 'project', sessionIds: [id], createdAt: '0', updatedAt: '0' }
  const second = { ...workspace, workspaceId: 'second' as never, path: 'C:/second', sessionIds: ['second-session' as never] }
  let current = id
  const attachments: string[] = []
  const listeners = new Set<() => void>()
  const subscribe = (callback: () => void): (() => void) => { listeners.add(callback); return () => { listeners.delete(callback) } }
  const insert = vi.fn(() => true)
  const sessions = {
    binding: () => ({ sessionId: current, ctx: { bail: insert } }),
    list: { subscribe, getSnapshot: () => ({ phase: 'ready', ids: [id], byId: { existing: { id, displayTitle: 'Existing task', running: true, cwd: 'C:/project' } }, current }) },
  } as unknown as ISessions
  const conversation = { input: { for: () => {
    const sessionId = current
    return { state: { subscribe, getSnapshot: () => ({
      draft: 'Keep my draft', draftRev: 7, attachmentIds: sessionId === id ? attachments : [], phase: mode === 'busy' ? 'submitting' : 'plain',
    }) } }
  } } } as unknown as IConversation
  const createWorkspace = vi.fn(async () => workspace)
  const workspaces = {
    create: createWorkspace,
    list: { subscribe, getSnapshot: () => ({ items: [workspace, second], archivedSessionIds: [] }) },
  } as unknown as IWorkspaces
  const navigation = { openSession: vi.fn(), openWorkspace: vi.fn(), startSession: vi.fn() }
  const ctx = new Context()
  const dispose = connectWorkbench(sessions, workspaces, navigation as unknown as UiWorkspace, conversation, ctx)
  const send = (type: string, channel = mode === 'wrong-channel' ? 'other' : 'private'): void => {
    window.dispatchEvent(new MessageEvent('message', { source: parentFrame as unknown as Window, data: { type, channel, id, workspaceId: workspace.workspaceId, text: 'main.ts:1:1-1:20\n```typescript\nexport const n = 1\n```' } }))
  }
  try {
    send('connect')
    await Promise.resolve()
    await Promise.resolve()
    send('select-session')
    send('new-session')
    if (mode !== 'wrong-channel') {
      expect(createWorkspace).toHaveBeenCalledWith({ path: 'C:/project' })
      expect(navigation.openSession).toHaveBeenCalledWith(id)
      expect(navigation.startSession).toHaveBeenCalledWith(workspace.workspaceId)
      expect(parentFrame.postMessage).toHaveBeenCalledWith({ type: 'state', channel: 'private', selected: id, tasks: [{ id, title: 'Existing task', running: true }], workspace: 'C:/project', workspaceId: 'workspace', canSwitchWorkspace: mode !== 'busy' }, '*')
    } else {
      expect(createWorkspace).not.toHaveBeenCalled()
      expect(navigation.openSession).not.toHaveBeenCalled()
      expect(navigation.startSession).not.toHaveBeenCalled()
    }
    if (mode === 'switched-workspace') {
      current = second.sessionIds[0]!
      for (const listener of listeners) listener()
      expect(parentFrame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ workspace: 'C:/project' }), '*')
      ctx.emit('conversation/draft-persistence', current, true)
      expect(parentFrame.postMessage).toHaveBeenLastCalledWith({ type: 'state', channel: 'private', selected: current, tasks: [], workspace: 'C:/second', workspaceId: 'second', canSwitchWorkspace: true }, '*')
      attachments.push('unsent-image')
      for (const listener of listeners) listener()
      expect(parentFrame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ workspace: 'C:/second', canSwitchWorkspace: false }), '*')
      attachments.length = 0
      for (const listener of listeners) listener()
      expect(parentFrame.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ canSwitchWorkspace: true }), '*')
    }
    send('selection')
    if (mode === 'authorized') {
      expect(insert).toHaveBeenCalledWith('slash/input-insert-text', {
        text: '\n\nmain.ts:1:1-1:20\n```typescript\nexport const n = 1\n```', span: { start: 13, end: 13, draftRev: 7 },
      })
      expect(insert.mock.calls).toMatchInlineSnapshot(`
        [
          [
            "slash/input-insert-text",
            {
              "span": {
                "draftRev": 7,
                "end": 13,
                "start": 13,
              },
              "text": "

        main.ts:1:1-1:20
        \`\`\`typescript
        export const n = 1
        \`\`\`",
            },
          ],
        ]
      `)
      expect(ctx.bail('workbench/open-file', { sessionId: id, path: 'src/main.ts', line: 4 })).toBe(true)
      expect(parentFrame.postMessage).toHaveBeenLastCalledWith({ channel: 'private', type: 'open-file', path: 'C:/project/src/main.ts', line: 4 }, '*')
    } else {
      expect(insert).not.toHaveBeenCalled()
      if (mode !== 'wrong-channel') expect(parentFrame.postMessage).toHaveBeenLastCalledWith({ type: 'selection-rejected', channel: 'private', reason: mode === 'busy' ? 'busy' : 'workspace' }, '*')
    }
  } finally { dispose() }
  expect(listeners.size).toBe(0)
  expect(ctx.bail('workbench/open-file', { sessionId: id, path: 'main.ts' })).toBeUndefined()
  const calls = parentFrame.postMessage.mock.calls.length
  send('connect', 'private')
  expect(parentFrame.postMessage).toHaveBeenCalledTimes(calls)
})
