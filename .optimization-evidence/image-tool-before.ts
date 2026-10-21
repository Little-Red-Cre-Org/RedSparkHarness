/** Follow-up questions reuse only images already recorded in the calling Session. */
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import { contentImages, type NativeImageUnderstandingOperations } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { deriveEventMessage } from '@deepseek-ai/dsh-session/native'

/** Build the question tool using the same vision service as automatic image admission.
 * @param vision - configured vision-only service.
 * @param storage - durable history of the calling Session.
 * @returns a scoped tool contribution; calls never accept arbitrary attachment references.
 */
export function imageQuestionTool(
  vision: NativeImageUnderstandingOperations, storage: NativeSessionPersistenceOperations,
): NativeValueToolContribution {
  return {
    schema: { name: 'understand_image',
      description: 'Ask a specific question about an original image already in this conversation. Copy the exact attachment identifier from the Image interpretation text, including its sha256: prefix. These images are stored in the Session, not as workspace files; do not search for guessed filenames.',
      parameters: { type: 'object', properties: {
        attachment_id: { type: 'string', description: 'Complete attachment identifier, including sha256: when present. Copy it verbatim from Image interpretation.' }, question: { type: 'string' },
      }, required: ['attachment_id', 'question'], additionalProperties: false } },
    output: {
      schema: { type: 'string' },
      render: (_call, value) => ({ content: [{ type: 'text', text: value as string }], isError: false }),
    },
    async execute(call) {
      const { attachment_id, question } = call.arguments as { attachment_id: string; question: string }
      if (!attachment_id.trim() || !question.trim()) throw new Error('attachment_id and question must be non-empty')
      await using reader = await storage.open(call.session.id, 'read', { signal: call.signal })
      const history = await reader.read(0, Number.MAX_SAFE_INTEGER, { signal: call.signal })
      const image = history.events.flatMap((event) => {
        const message = deriveEventMessage(event)
        return message === null ? [] : contentImages(message.content)
      }).find(block => block.attachment.attachmentId === attachment_id)
      if (image === undefined) throw new Error('No image matches attachment_id in this conversation. Copy the complete identifier from Image interpretation, including sha256:. Session images are not workspace files.')
      const result = await vision.understand({ image, question, signal: call.signal,
        record: async record => (await call.appendEvent('image/understanding', record)).seq })
      return result.text
    },
  }
}
