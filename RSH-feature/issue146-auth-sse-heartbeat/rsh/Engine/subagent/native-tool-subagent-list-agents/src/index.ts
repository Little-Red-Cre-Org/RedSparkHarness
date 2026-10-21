/** Independently selected native continuable subagent discovery tool. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-subagent'
import type {} from '@deepseek-ai/dsh-native-tools'

/** Register read-only discovery over the selected Provider and exact Tools registry. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tool-subagent-list-agents', targets: ['host'],
  requires: ['tools', 'subagents'], optional: [], provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('native subagent directory: configuration must be empty')
    }
    return (context) => {
      const subagents = context.require('subagents')
      const tools = context.require('tools')
      if (subagents.continuationTools !== tools) throw new Error('native subagent directory: Provider and discovery must select the same Tools registry')
      context.effect(tools.registerValueTool({
        schema: { name: 'list_agents', description: 'List your continuable subagents by durable id and label. Status is running for current work, idle for a resident Agent between turns, and ready for a closed resumable Session. Descendants traverses ordinary Sessions and one-shot children in stable pre-order, adding parent and depth. Only direct children may receive send_message; deeper entries are interruption candidates. Listing grants no control permission. Unreadable children are diagnostics.',
          parameters: { type: 'object', additionalProperties: false, properties: {
            scope: { type: 'string', enum: ['children', 'descendants'], description: 'children (default) or the complete descendant tree.' },
          } } },
        output: { schema: { type: 'array', items: { oneOf: [
          { type: 'object', additionalProperties: false, required: ['kind', 'id', 'label', 'status'], properties: {
            kind: { type: 'string', enum: ['child'] }, id: { type: 'string' }, label: { type: 'string' },
            status: { type: 'string', enum: ['running', 'idle', 'ready'] }, parent: { type: 'string' }, depth: { type: 'integer' },
          } },
          { type: 'object', additionalProperties: false, required: ['kind', 'id', 'reason'], properties: {
            kind: { type: 'string', enum: ['diagnostic'] }, id: { type: 'string' },
            reason: { type: 'string', enum: ['corrupt', 'unsupported', 'unavailable'] }, parent: { type: 'string' }, depth: { type: 'integer' },
          } },
        ] } }, render: (_call, value) => ({ isError: false,
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }) },
        execute(call) {
          const request = call.arguments as { scope?: 'children' | 'descendants' }
          const spec = { scope: request.scope ?? 'children' as const }
          return subagents.list({ agent: call.agent, session: call.session, ...spec }, call.signal)
        },
      }, context.scope))
    }
  },
}
