/** Standard ACP updates derived from durable Native Session events. */
import type { ContentBlock as AcpContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-token-meter/native'

/** Convert durable text or a stored image into one ACP content block. */
async function acpContent(context: NativeContext, block: SessionEvent<'assistant/message'>['data']['message']['content'][number],
  signal?: AbortSignal): Promise<AcpContentBlock | undefined> {
  if (block.type === 'text') return block.text.length === 0 ? undefined : { type: 'text', text: block.text }
  if (block.type !== 'image') return undefined
  const attachments = context.optional('attachments')
  if (attachments === undefined) throw new Error('native ACP cannot deliver an image without attachment storage')
  const stored = await attachments.readImage(block.attachment, signal)
  return { type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType }
}

/** Capture usage only when the event, route capacity, and estimator are all available.
 * @param context - Native services used for token measurement.
 * @param session - exact live or detached Session prefix for this event.
 * @param event - committed assistant message with optional provider usage.
 * @returns occupancy update when all source facts are present.
 */
export function nativeAcpUsageUpdate(context: NativeContext, session: Session,
  event: SessionEvent<'assistant/message'>): SessionUpdate | undefined {
  if (event.data.usage === undefined) return undefined
  const size = session.requestContext()?.contextWindow
  const meter = context.optional('tokenMeter')
  if (meter === undefined || size === undefined) return undefined
  return { sessionUpdate: 'usage_update', used: meter.measure(session).totalTokens, size }
}

/** Project one committed event to ordered ACP updates; stored image read failures reject the projection.
 * @param context - Native services used for stored image reads.
 * @param event - committed Session event to project.
 * @param signal - request cancellation for asynchronous attachment reads.
 * @param usage - optional usage update calculated from the exact Session event prefix.
 * @returns ordered protocol updates for the event.
 */
export async function nativeAcpUpdates(context: NativeContext, event: SessionEvent, signal?: AbortSignal,
  usage?: SessionUpdate): Promise<SessionUpdate[]> {
  switch (event.type) {
    case 'assistant/message': {
      const projected: SessionUpdate[] = []
      for (const block of event.data.message.content) {
        if (block.type === 'reasoning') {
          if (block.text.length > 0) projected.push({ sessionUpdate: 'agent_thought_chunk', messageId: event.data.message.id,
            content: { type: 'text', text: block.text } })
          continue
        }
        const content = await acpContent(context, block, signal)
        if (content !== undefined) projected.push({ sessionUpdate: 'agent_message_chunk',
          messageId: event.data.message.id, content })
      }
      if (usage !== undefined) projected.push(usage)
      return projected
    }
    case 'tool/call': {
      let rawInput: unknown
      try { rawInput = JSON.parse(event.data.arguments) as unknown }
      catch (_invalidModelArguments) { rawInput = event.data.arguments }
      return [{ sessionUpdate: 'tool_call', toolCallId: event.data.callId, title: event.data.name,
        kind: 'other', status: 'in_progress', rawInput }]
    }
    case 'tool/result': {
      const result = event.data.message.content[0]
      const content: ToolCallContent[] = []
      for (const block of result.content) {
        const projected = await acpContent(context, block, signal)
        if (projected !== undefined) content.push({ type: 'content', content: projected })
      }
      return [{ sessionUpdate: 'tool_call_update', toolCallId: result.toolCallId,
        status: result.isError === true ? 'failed' : 'completed', content }]
    }
    case 'command/done': return event.data.text === undefined ? [] : [{
      sessionUpdate: 'agent_message_chunk', messageId: String(event.data.commandId),
      content: { type: 'text', text: event.data.text },
    }]
    default: return [] // The merge-extensible Session map contains non-presentation facts.
  }
}
