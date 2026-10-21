/** Publish completed answer code to the embedded editor without replaying history. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Collect newly completed answer fences; the initial snapshot establishes history.
 * @returns a reader that emits each completed turn once.
 */
export function completedAnswerCode(): (snapshot: ChatSnapshot) => { language: string; content: string }[] {
  let initialized = false
  const seen = new Set<number>()
  return snapshot => {
    const result: { language: string; content: string }[] = []
    for (const turn of snapshot.legacy.turnEnds.keys()) {
      if (seen.has(turn)) continue
      seen.add(turn)
      if (!initialized) continue
      const answer = snapshot.legacy.nodes.findLast(node => node.kind === 'assistant' && node.turn === turn)
      if (answer?.kind !== 'assistant' || answer.interrupted || answer.messageId === undefined) continue
      for (const block of answer.blocks) {
        if (block.kind !== 'text') continue
        for (const node of fromMarkdown(block.text).children) {
          if (node.type === 'code' && node.value.trim() !== '') {
            result.push({ language: node.lang ?? 'plaintext', content: node.value })
          }
        }
      }
    }
    initialized = true
    return result
  }
}

/**
 * Observe only the selected embedded conversation and open its new answer code.
 * @param sessions - selected Session authority.
 * @param conversation - assembled Chat snapshots.
 * @returns disposer for the selection and answer subscriptions.
 */
export function connectWorkbenchCode(sessions: ISessions, conversation: UiConversation): () => void {
  const url = new URL(location.href)
  const channel = url.searchParams.get('channel')
  if (url.protocol !== 'dsh-app:' || !url.hostname.startsWith('ide-') || channel === null || parent === window) return () => {}
  let connected = false
  let selected: string | undefined
  let stopAnswer = (): void => {}
  const select = (): void => {
    if (!connected) return
    const current = sessions.list.getSnapshot().current
    if (current === selected) return
    stopAnswer()
    selected = current
    if (current === undefined) return
    const source = conversation.binding(current).target('chat')
    const read = completedAnswerCode()
    const publish = (): void => {
      const snapshot = source.getSnapshot()
      if (snapshot === undefined) return
      const blocks = read(snapshot)
      if (blocks.length > 0) parent.postMessage({ type: 'answer-code', channel, sessionId: current, blocks }, '*')
    }
    stopAnswer = source.subscribe(publish)
    publish()
  }
  const receive = (event: MessageEvent<unknown>): void => {
    const value = event.data
    if (event.source !== parent || typeof value !== 'object' || value === null
      || !('channel' in value) || value.channel !== channel || !('type' in value) || value.type !== 'connect') return
    connected = true
    select()
  }
  window.addEventListener('message', receive)
  const stopSelection = sessions.list.subscribe(select)
  return () => { stopAnswer(); stopSelection(); window.removeEventListener('message', receive) }
}
