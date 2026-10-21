/** Publish completed answer code to the embedded editor without replaying history. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Collect newly completed answer fences; the initial snapshot establishes history.
 * @param since - earliest turn start time eligible for automatic insertion.
 * @returns a reader that emits each completed turn once.
 */
export function completedAnswerCode(since = -Infinity): (snapshot: ChatSnapshot) => { language: string; content: string }[] {
  let initialized = false
  const seen = new Set<number>()
  return snapshot => {
    const result: { language: string; content: string }[] = []
    for (const turn of snapshot.legacy.turnEnds.keys()) {
      if (seen.has(turn)) continue
      if (!initialized) { seen.add(turn); continue }
      if (since !== -Infinity) {
        const timing = snapshot.legacy.turnTimings.get(turn)
        if (timing === undefined || timing.startTime < since) continue
      }
      const answer = snapshot.legacy.nodes.findLast(node => node.kind === 'assistant' && node.turn === turn)
      if (answer?.kind !== 'assistant' || answer.interrupted || answer.messageId === undefined) continue
      const before = result.length
      for (const block of answer.blocks) {
        if (block.kind !== 'text') continue
        for (const node of fromMarkdown(block.text).children) {
          if (node.type === 'code' && node.value.trim() !== '') {
            result.push({ language: node.lang ?? 'plaintext', content: node.value })
          }
        }
      }
      if (result.length > before) seen.add(turn)
    }
    initialized = true
    return result
  }
}

/**
 * Observe only the selected embedded conversation and open its new answer code.
 * @param sessions - selected Session authority.
 * @param conversation - assembled Chat snapshots.
 * @param ctx - submission effects and localized messages.
 * @returns disposer for the selection and answer subscriptions.
 */
export function connectWorkbenchCode(sessions: ISessions, conversation: UiConversation, ctx: Context): () => void {
  const url = new URL(location.href)
  const channel = url.searchParams.get('channel')
  if (url.protocol !== 'dsh-app:' || !url.hostname.startsWith('ide-') || channel === null || parent === window) return () => {}
  let connected = false
  let selected: string | undefined
  let stopAnswer = (): void => {}
  const t = ctx.locale.bind('workspace')
  let prepare: { id: string; finish(value?: { text: string; path: string; language: string }, error?: Error): void } | undefined
  const stopPrepare = ctx.on('conversation/prepare-prompt', async (session, prompt, signal) => {
    if (!connected || sessions.list.getSnapshot().current !== session.sessionId
      || sessions.list.getSnapshot().byId[session.sessionId]?.running || prepare !== undefined) throw new Error(t('ide.reviewBusy'))
    signal?.throwIfAborted()
    const source = await new Promise<{ text: string; path: string; language: string }>((resolve, reject) => {
      const id = crypto.randomUUID()
      const abort = (): void => finish(undefined, new Error(t('ide.reviewCancelled')))
      const timer = setTimeout(() => finish(undefined, new Error(t('ide.reviewUnavailable'))), 10000)
      const finish = (value?: { text: string; path: string; language: string }, error?: Error): void => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); prepare = undefined
        if (error !== undefined) reject(error)
        else if (value !== undefined) resolve(value)
      }
      prepare = { id, finish }
      signal?.addEventListener('abort', abort, { once: true })
      parent.postMessage({ type: 'prepare-code', channel, requestId: id, sessionId: session.sessionId }, '*')
    })
    signal?.throwIfAborted()
    const permission = await session.command('/permission read-only')
    if (!permission.ok) throw new Error(permission.error.message)
    if (!permission.value.matched) throw new Error(t('ide.reviewUnavailable'))
    if (sessions.list.getSnapshot().current !== session.sessionId) throw new Error(t('ide.reviewCancelled'))
    if (source.text !== '') {
      const fence = '`'.repeat(Math.max(3, ...Array.from(source.text.matchAll(/`+/g), match => match[0].length + 1)))
      prompt.text += `\n\n${t('ide.reviewContext')}\n${source.path}\n${fence}${source.language}\n${source.text}\n${fence}`
    }
  })
  const select = (): void => {
    if (!connected) return
    const current = sessions.list.getSnapshot().current
    if (current === selected) return
    stopAnswer()
    selected = current
    if (current === undefined) return
    const source = conversation.binding(current).target('chat')
    const read = completedAnswerCode(Date.now())
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
      || !('channel' in value) || value.channel !== channel || !('type' in value)) return
    if (value.type === 'prepared-code' && 'requestId' in value && value.requestId === prepare?.id) {
      if ('error' in value && typeof value.error === 'string') prepare?.finish(undefined, new Error(value.error))
      else if ('text' in value && typeof value.text === 'string' && 'path' in value && typeof value.path === 'string'
        && 'language' in value && typeof value.language === 'string') prepare?.finish({ text: value.text, path: value.path, language: value.language })
      return
    }
    if (value.type !== 'connect') return
    connected = true
    select()
  }
  window.addEventListener('message', receive)
  const stopSelection = sessions.list.subscribe(select)
  return () => { prepare?.finish(undefined, new Error(t('ide.reviewCancelled'))); stopPrepare(); stopAnswer(); stopSelection(); window.removeEventListener('message', receive) }
}
