/** Append one reminder through the selected Program's sole root Session writer. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { Task, Run } from './types.ts'
import { formatReminderRecord } from './reminder-format.ts'

/**
 * Durably append an idempotent reminder notice without enqueueing a model turn.
 * @param owner - Exact owner admitted by NativeRootExecution.maintenance.
 * @param task - Persisted plan that owns the occurrence.
 * @param run - Successful occurrence presentation.
 * @param signal - Root maintenance cancellation.
 */
export async function appendNativeReminderRecord(owner: NativeActiveSessionOwner, task: Task, run: Run,
  signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const record = formatReminderRecord(task, run)
  const events = await owner.readEvents({ signal })
  if (events.some(event => event.type === 'user/message' && String(event.data.id) === record.id)) return
  signal.throwIfAborted()
  const message = createUserMessage({ source: { kind: 'plugin', plugin: 'task-scheduler', form: 'notice', summary: record.summary },
    content: [{ type: 'text', text: record.text }] })
  owner.append('user/message', { ...message, id: brandString<typeof message.id>(record.id) }, { surfaceOp: 'append' })
  await owner.flush()
}
