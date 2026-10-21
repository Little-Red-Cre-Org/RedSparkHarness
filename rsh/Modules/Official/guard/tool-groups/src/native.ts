/** On-demand Native tool groups, restored from the requesting Session's durable grants. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-session-execution'
import './types.ts'

const REQUEST = 'request_tool_group'
const Configuration = z.object({
  initial: z.array(z.string().min(1)),
  groups: z.array(z.object({
    name: z.string().min(1), description: z.string().min(1), tools: z.array(z.string().min(1)).min(1),
  }).strict()).min(1),
}).strict()

/** Native capability selection; install after every tool referenced by the configuration. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-groups', targets: ['host'],
  requires: ['tools', 'activeSessions'], provides: [],
  resolve(input) {
    const config = Configuration.parse(input)
    const groups = new Map(config.groups.map(group => [group.name, group]))
    if (groups.size !== config.groups.length) throw new Error('tool-groups: group names must be unique')
    if (config.groups.some(group => group.tools.includes(REQUEST) || group.tools.includes('run_code'))) {
      throw new Error('tool-groups: request_tool_group and run_code cannot belong to a deferred group')
    }
    return (context) => {
      const tools = context.require('tools')
      const sessions = context.require('activeSessions')
      const catalog = new Map(tools.schemas(context.scope).map(schema => [schema.name, schema]))
      for (const name of [...config.initial, ...config.groups.flatMap(group => group.tools)]) {
        if (!catalog.has(name)) throw new Error(`tool-groups: configure an installed tool: ${name}`)
      }
      const initial = [...config.initial, REQUEST]
      context.effect(tools.selectForRequest({
        initial,
        async select(agent, session) {
          const owner = sessions.owner(agent, session)
          if (owner === undefined) throw new Error('tool-groups: an active Session is required')
          const allowed = new Set(initial)
          for (const event of await owner.readEvents()) {
            if (event.type !== 'tool-groups/opened' || event.data.sessionId !== session.id) continue
            const group = groups.get(event.data.group)
            if (group === undefined) continue
            for (const name of event.data.tools) if (group.tools.includes(name)) allowed.add(name)
          }
          return [...allowed]
        },
      }, context.scope))
      context.effect(tools.registerValueTool({
        schema: {
          name: REQUEST,
          description: 'Request a tool group for this task. Its tools become available in the next model request, '
            + 'not in this batch or program. This does not grant operation permissions. '
            + 'Returned tool schemas describe the new program bindings as well. Groups:\n'
            + config.groups.map(group => `${group.name}: ${group.description}`).join('\n'),
          parameters: { type: 'object', properties: { group: { type: 'string', enum: [...groups.keys()] } },
            required: ['group'], additionalProperties: false },
        },
        output: {
          schema: { type: 'object', properties: {
            group: { type: 'string' },
            tools: { type: 'array', items: { type: 'object', additionalProperties: true } },
          }, required: ['group', 'tools'], additionalProperties: false },
          render: (_call, value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }),
        },
        async execute(call) {
          const { group: name } = call.arguments as { group: string }
          const group = groups.get(name)
          if (group === undefined) throw new Error(`tool-groups: unknown group ${name}`)
          await call.appendEvent('tool-groups/opened', { sessionId: call.session.id, group: name, tools: [...group.tools] })
          return { group: name, tools: group.tools.map(tool => catalog.get(tool)) }
        },
      }, context.scope))
    }
  },
}
