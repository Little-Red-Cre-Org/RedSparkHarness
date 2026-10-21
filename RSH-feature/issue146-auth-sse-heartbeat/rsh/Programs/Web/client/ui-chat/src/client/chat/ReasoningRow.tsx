/** Legacy Chat adapter for the shared Cordis-free reasoning disclosure. */
import { ChatReasoningDisclosure } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'

/** Render one assistant reasoning block using the owning Chat locale.
 * @param props - complete or streaming reasoning text and the running state.
 * @returns the shared reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  return <ChatReasoningDisclosure text={text} running={running} title={t('message.think')}
    runningLabel={t('row.running')} />
}
