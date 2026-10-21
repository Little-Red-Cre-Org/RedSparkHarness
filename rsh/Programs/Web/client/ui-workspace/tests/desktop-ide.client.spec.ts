// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UiWorkspace } from '../src/client/navigation.ts'
import { captureIdeDraft, restoreIdeDraft } from '../src/client/desktop-ide.ts'

it.each(['plain', 'attachments'] as const)('Desktop draft handoff: %s', async (mode) => {
  const id = 'session' as never
  const workspaceId = 'workspace' as never
  let draft = '原本的草稿'
  const setDraft = vi.fn((text: string) => { draft = text })
  const input = { setDraft, state: { getSnapshot: () => ({ phase: 'plain', draft, attachmentIds: mode === 'plain' ? [] : ['image'] }) } }
  const sessions = {
    binding: (value: string) => value === id ? { sessionId: id, ctx: {} } : undefined,
    list: { getSnapshot: () => ({ current: id }) },
  } as unknown as ISessions
  const workspaces = { list: { getSnapshot: () => ({ items: [
    { workspaceId, path: '/project', sessionIds: [id] },
    { workspaceId: 'second', path: '/second', sessionIds: [] },
  ] }) } } as unknown as IWorkspaces
  const conversation = { input: { for: () => input } } as unknown as IConversation
  const openSession = vi.fn()
  const navigation = { openSession, openWorkspace: vi.fn(async () => {}) } as unknown as UiWorkspace
  const capture = () => captureIdeDraft(workspaceId, sessions, workspaces, conversation, 'busy')
  const incoming = { workspaceId, path: '/project', sessionId: id, draft: 'IDE 增补的代码' }
  if (mode === 'plain') {
    expect(capture()).toEqual({ workspaceId, path: '/project', sessionId: id, draft: '原本的草稿' })
    await restoreIdeDraft(incoming, sessions, workspaces, navigation, conversation, 'busy')
    expect(draft).toBe('IDE 增补的代码')
    expect(openSession).toHaveBeenCalledWith(id)
    await restoreIdeDraft({ ...incoming, draft: '' }, sessions, workspaces, navigation, conversation, 'busy')
    expect(draft).toBe('')
    await expect(restoreIdeDraft({ ...incoming, workspaceId: 'second', path: '/second' }, sessions, workspaces, navigation, conversation, 'busy')).rejects.toThrow('Conversation is no longer available')
  } else {
    expect(capture).toThrow('busy')
    await expect(restoreIdeDraft(incoming, sessions, workspaces, navigation, conversation, 'busy')).rejects.toThrow('busy')
    expect(draft).toBe('原本的草稿')
    expect(setDraft).not.toHaveBeenCalled()
  }
  expect(captureIdeDraft('second' as never, sessions, workspaces, conversation, 'busy')).toEqual({ workspaceId: 'second', path: '/second' })
})
