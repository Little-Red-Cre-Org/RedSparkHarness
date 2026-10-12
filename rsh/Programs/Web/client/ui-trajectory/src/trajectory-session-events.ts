/** Build the Native Trajectory projection directly from durable Session events. */

import type {
  AssistantMessageNode, ConversationLocation, ConversationNode, RunningToolCall, ToolResultNode,
  SystemPromptNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TrajectorySnapshot } from './client/trajectory-contract.ts'
import { contextForm, contextProvenance, toAssistantBlocks } from './client/trajectory-event-projection.ts'

/** Project the loaded durable append-origin records for the Native Trajectory views.
 * @param events - selected Session events already held by the Native controller.
 * @returns the snapshot consumed by the Trajectory layout and table.
 */
export function buildTrajectorySnapshot(events: readonly SessionEvent[]): TrajectorySnapshot {
  const eventNodes: ConversationNode[] = []
  const systemPrompts: SystemPromptNode[] = []
  const calls = new Map<string, RunningToolCall>()

  for (const event of events) {
    switch (event.type) {
      case 'tool/call': {
        calls.set(String(event.data.callId), {
          callId: String(event.data.callId),
          name: event.data.name,
          argsRaw: event.data.arguments,
          turn: event.data.turn,
          step: event.data.step,
          time: event.time,
          subCalls: [],
        })
        break
      }
      case 'user/message': {
        if (event.surfaceOp !== 'append') break
        eventNodes.push(event.data.source.kind === 'user'
          ? {
            kind: 'user', seq: event.seq, time: event.time,
            content: event.data.content, source: event.data.source,
          }
          : {
            kind: 'context', seq: event.seq, time: event.time,
            content: event.data.content, source: event.data.source,
            provenance: contextProvenance(event.data.source),
            form: contextForm(event.data.source),
          })
        break
      }
      case 'assistant/message': {
        if (event.surfaceOp !== 'append') break
        const assistant: AssistantMessageNode = {
          kind: 'assistant',
          seq: event.seq,
          messageId: event.data.message.id,
          time: event.time,
          turn: event.data.turn,
          step: event.data.step,
          blocks: toAssistantBlocks(event.data.message.content),
          usage: event.data.usage,
          provenance: {
            provider: event.data.message.source.provider,
            model: event.data.message.source.model,
          },
          ...(event.data.interrupted === true ? { interrupted: true } : {}),
        }
        eventNodes.push(assistant)
        break
      }
      case 'system/message': {
        if (event.surfaceOp !== 'append') break
        systemPrompts.push({
          seq: event.seq,
          time: event.time,
          turn: event.data.turn,
          step: event.data.step,
          text: event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n'),
          update: systemPrompts.length > 0,
        })
        break
      }
      case 'tool/result': {
        if (event.surfaceOp !== 'append') break
        const callId = String(event.data.message.source.callId)
        const call = calls.get(callId)
        const result = event.data.message.content[0]
        const node: ToolResultNode = {
          kind: 'tool-result',
          seq: event.seq,
          time: event.time,
          callId,
          call: call === undefined ? null : { name: call.name, argsRaw: call.argsRaw },
          callTime: call?.time ?? null,
          content: result.content,
          isError: result.isError === true,
          ...(event.data.error === undefined ? {} : { error: event.data.error }),
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
          subCalls: call?.subCalls ?? [],
        }
        eventNodes.push(node)
        calls.delete(callId)
        break
      }
      default:
        break
    }
  }

  const eventLocations = new Map<number, ConversationLocation>()
  return {
    systemPrompts,
    eventNodes,
    eventLocations,
    requests: [],
    callSchemas: new Map(),
    partial: null,
    runningCalls: [...calls.values()],
  }
}
