// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import { NativeConversationController } from '../src/controller.ts'
import { connectNativeWorkbench, nativeIdeHandoff } from '../src/workbench.ts'

it.each(['Native IDE'])('%s preserves drafts, scopes commands and withdraws listeners', async () => {
  const header = { id: 'session-1', cwd: 'C:\\work', createdAt: 0, version: 3, isSeeded: false, delegationDepth: 0 } as SessionHeader
  const create = vi.fn(async () => ({ sessionId: header.id }))
  const client = {
    list: vi.fn(async () => [header]), modelControls: async () => ({ catalog: null, canSelectModel: false, presets: [] }),
    history: vi.fn(async () => ({ header, events: [] })), create,
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveEvents: 100, maxLiveTextChars: 1000 })
  const parentFrame = { postMessage: vi.fn<(value: Record<string, unknown>, target: string) => void>() }
  const url = new URL('dsh-app://ide-test/index.html?desktop=1&channel=private&workspace=c%3A%2Fwork')
  const fetcher = vi.fn(async () => Response.json({ workspaceId: header.cwd, path: header.cwd, sessionId: header.id, draft: 'original' }))
  let draft = ''
  const error = vi.fn()
  let dispose: (() => void) | undefined
  const receive = (data: Record<string, unknown>, source: unknown = parentFrame): void => {
    window.dispatchEvent(new MessageEvent('message', { data: { channel: 'private', ...data }, source: source as MessageEventSource }))
  }
  try {
    vi.stubGlobal('location', url); vi.stubGlobal('parent', parentFrame); vi.stubGlobal('fetch', fetcher)
    await controller.load()
    dispose = connectNativeWorkbench(controller, {
      draft: () => draft, setDraft: (value) => { draft = value }, hasAttachments: () => false,
      error, busyMessage: 'Handle the unsent draft first.', workspaceMessage: 'Wrong workspace.',
    })
    receive({ type: 'connect' }, window)
    expect(fetcher).not.toHaveBeenCalled()
    receive({ type: 'connect' })
    await vi.waitFor(() => { expect(draft).toBe('original') })
    await vi.waitFor(() => { expect(parentFrame.postMessage.mock.calls.some(([value]) => value.type === 'state')).toBe(true) })
    receive({ type: 'selection', workspaceId: 'C:\\other', text: 'wrong' })
    expect(draft).toBe('original')
    receive({ type: 'selection', workspaceId: 'c:/work', text: 'selected code' })
    expect(nativeIdeHandoff(controller, draft, false, 'busy')).toEqual({ workspaceId: header.cwd, path: header.cwd,
      sessionId: header.id, draft: 'original\n\nselected code' })
    expect(() => nativeIdeHandoff(controller, draft, true, 'busy')).toThrow('busy')
    receive({ type: 'new-session' })
    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('Handle the unsent draft first.') })
    expect(create).not.toHaveBeenCalled()
    const state = parentFrame.postMessage.mock.calls.find(([value]) => value.type === 'state')?.[0]
    expect(state).toMatchInlineSnapshot(`
      {
        "canSwitchWorkspace": false,
        "channel": "private",
        "selected": "session-1",
        "tasks": [
          {
            "id": "session-1",
            "running": false,
            "title": "session-1",
          },
        ],
        "type": "state",
        "workspace": "c:/work",
        "workspaceId": "c:/work",
      }
    `)
    dispose(); dispose = undefined
    receive({ type: 'selection', workspaceId: 'c:/work', text: 'after close' })
    expect(draft).toBe('original\n\nselected code')
  } finally { dispose?.(); await controller.close(); vi.unstubAllGlobals() }
})
