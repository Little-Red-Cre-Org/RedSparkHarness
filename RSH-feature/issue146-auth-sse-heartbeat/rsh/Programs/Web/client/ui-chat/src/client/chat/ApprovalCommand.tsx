/** Chat-owned approval detail resolving a correlated command or proposed file change. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

interface ApprovalToolCall {
  readonly callId: string
  readonly argsRaw: string
  readonly name?: string
}

/**
 * Extract a shell command from a correlated Tool call when its arguments carry one.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, malformed, or unrelated arguments.
 */
export function commandOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    return undefined
  }
}

/**
 * Render literal file arguments without reading or applying workspace contents.
 * @param call - running call correlated with the pending approval.
 * @returns path and proposed text fragments, or undefined for other tools.
 */
export function fileChangeOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call?.name !== 'write' && call?.name !== 'edit') return undefined
  let value: unknown
  try { value = JSON.parse(call.argsRaw) } catch { return undefined /* Streamed arguments can be incomplete JSON. */ }
  if (typeof value !== 'object' || value === null || !('file_path' in value) || typeof value.file_path !== 'string') return undefined
  if (call.name === 'write' && 'content' in value && typeof value.content === 'string') {
    return `${value.file_path}\n${value.content.split('\n').map(line => `+ ${line}`).join('\n')}`
  }
  if (call.name !== 'edit' || !('old_string' in value) || typeof value.old_string !== 'string'
    || !('new_string' in value) || typeof value.new_string !== 'string') return undefined
  return `${value.file_path}\n${value.old_string.split('\n').map(line => `- ${line}`).join('\n')}\n${value.new_string.split('\n').map(line => `+ ${line}`).join('\n')}`
}

/**
 * Render the command or literal file proposal correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns proposed text when the correlated running call carries it.
 */
export function ApprovalCommand({ callId, useChat }: PropsRuntime<'conversation.approval.detail'>) {
  const command = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined && root.callId === callId && !('kind' in root)) return fileChangeOf(root) ?? commandOf(root)
    }
    return undefined
  })
  return command ?? null
}
