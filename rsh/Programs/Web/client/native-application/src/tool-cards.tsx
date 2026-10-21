/** Tool presentation derived solely from accepted, durable Session facts. */
import { NativeToolCard, type ToolCallBlock, type RunningToolCall } from '@deepseek-ai/dsh-client-ui-tool/tool-renderer'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

interface ToolCardRecord { readonly seq: number; readonly block: ToolCallBlock }

/**
 * Pair root Tool calls with persisted result content, errors and presentation metadata.
 * @param events - accepted live or restored Session events, in durable order.
 * @returns one record per root call; result-only history retains its available facts.
 */
export function toolCardRecords(events: readonly SessionEvent[]): readonly ToolCardRecord[] {
  const calls = new Map<string, { seq: number; call: RunningToolCall }>()
  const cards = new Map<string, ToolCardRecord>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      const call: RunningToolCall = { callId: event.data.callId, name: event.data.name, argsRaw: event.data.arguments,
        turn: event.data.turn, step: event.data.step, time: event.time, subCalls: [] }
      calls.set(call.callId, { seq: event.seq, call })
      cards.set(call.callId, { seq: event.seq, block: call })
    } else if (event.type === 'tool/result') {
      const id = event.data.message.source.callId
      const previous = calls.get(id)
      const result = event.data.message.content[0]
      cards.set(id, { seq: previous?.seq ?? event.seq, block: {
        kind: 'tool-result', seq: event.seq, time: event.time, callId: id,
        call: previous === undefined ? null : { name: previous.call.name, argsRaw: previous.call.argsRaw },
        callTime: previous?.call.time ?? null, content: result.content, isError: result.isError === true,
        ...event.data.error === undefined ? {} : { error: event.data.error },
        ...event.data.meta === undefined ? {} : { meta: event.data.meta }, subCalls: [],
      } })
    }
  }
  return [...cards.values()]
}

/**
 * Render a paired root call without offering unavailable Host file or trajectory actions.
 * @param props - accepted call material and the selected locale and working directory.
 * @returns the shared result card with its recorded failure and metadata.
 */
export function ToolCard({ block, locale, cwd }: { block: ToolCallBlock; locale: 'en' | 'zh'; cwd?: string | undefined }) {
  const toolName = 'kind' in block ? block.call?.name ?? block.callId : block.name
  return <NativeToolCard block={block} toolName={toolName} locale={locale} cwd={cwd} />
}
