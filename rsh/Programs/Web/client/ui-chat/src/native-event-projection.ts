/** Pure Session content projection for the native Chat transcript. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { ChatAssistantBlock } from './native-contracts.ts'

/** Convert durable assistant content into blocks accepted by the shared Markdown view.
 * @param content - content recorded on an assistant Session event.
 * @returns ordered display blocks with opaque additions preserved.
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): ChatAssistantBlock[] {
  return content.map((block): ChatAssistantBlock => {
    switch (block.type) {
      case 'text': return { kind: 'text', text: block.text }
      case 'reasoning': return { kind: 'reasoning', text: block.text }
      case 'image': return { kind: 'image', attachment: block.attachment }
      case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
      default: return { kind: 'other', block }
    }
  })
}
