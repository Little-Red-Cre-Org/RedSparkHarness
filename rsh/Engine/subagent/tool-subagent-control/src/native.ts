/** Native model-facing adjacent messaging and descendant interruption. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-subagent'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import { SessionId } from '@deepseek-ai/dsh-session/native'

/** Register actual controls over the selected native Subagent Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-subagent-control', targets: ['host'],
  requires: ['tools', 'subagents'], optional: [], provides: ['subagentControls'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('native subagent controls: configuration must be empty')
    }
    return (context) => {
      const subagents = context.require('subagents')
      const tools = context.require('tools')
      if (subagents.continuationTools !== tools) throw new Error('native subagent controls: Provider and controls must select the same Tools registry')
      const contributions: NativeValueToolContribution[] = [{
        schema: { name: 'send_message', description: 'Send a message to your direct continuable child, or to your direct parent when you are a resident continuable child. Running children receive steering at their nearest step; idle or closed children resume a turn. This returns delivery confirmation, independently of any answer.',
          parameters: { type: 'object', additionalProperties: false, required: ['agent_id', 'message'], properties: {
            agent_id: { type: 'string' }, message: { type: 'string' },
          } } },
        output: { schema: { type: 'object', additionalProperties: false, required: ['messageId'], properties: { messageId: { type: 'string' } } },
          render: (call, value) => ({ isError: false, content: [{ type: 'text', text: `message delivered to agent ${(call.arguments as { agent_id: string }).agent_id}` }],
            meta: { kind: 'subagent-message', ...(value as { messageId: string }) } }),
        },
        async execute(call) {
          const args = call.arguments as { agent_id: string; message: string }
          if (args.agent_id.length === 0 || args.message.length === 0) throw new Error('send_message: agent_id and message must be nonempty')
          return { messageId: await subagents.sendMessage({ agent: call.agent, session: call.session, target: SessionId(args.agent_id),
            content: [{ type: 'text', text: args.message }] }, call.signal) }
        },
      }, {
        schema: { name: 'interrupt_agent', description: 'Request cancellation of a live descendant\'s current turn. Unclaimed input remains parked until another send_message; owned descendants keep running. An absent target is an accepted no-op.',
          parameters: { type: 'object', additionalProperties: false, required: ['agent_id'], properties: { agent_id: { type: 'string' } } } },
        output: { schema: { type: 'object', additionalProperties: false, required: ['accepted'], properties: { accepted: { type: 'boolean' } } },
          render: call => ({ isError: false, content: [{ type: 'text', text: `interrupt requested for agent ${(call.arguments as { agent_id: string }).agent_id}` }] }),
        },
        execute(call) {
          const args = call.arguments as { agent_id: string }
          if (args.agent_id.length === 0) throw new Error('interrupt_agent: agent_id must be nonempty')
          subagents.interrupt({ agent: call.agent, session: call.session, target: SessionId(args.agent_id) })
          return Promise.resolve({ accepted: true })
        },
      }]
      for (const contribution of contributions) context.effect(tools.registerValueTool(contribution, context.scope))
      context.provide('subagentControls', { subagents, tools })
    }
  },
}
