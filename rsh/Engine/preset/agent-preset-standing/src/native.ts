/** Contribute one standing Agent preset using this installation's exact NativeScope. */
import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativePresetComposition } from '@redspark/rsh-agent-presets/native-definition'
import type {} from '@redspark/rsh-native-agent'
import type {} from '@redspark/rsh-native-tools/native'
import type {} from '@redspark/rsh-compaction/native'

const configSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('Registry identifier for this standing composition.'),
  name: z.string().trim().min(1).describe('Non-empty preset name shown in the composition picker.'),
  description: z.string().trim().min(1).optional().describe('Optional non-empty description shown with the preset name.'),
  allowedTools: z.array(z.string().min(1)).optional().describe('Inherited tool names kept for Agents in this scope. Omitted keeps every inherited tool.'),
  compaction: z.boolean().optional().describe('Set false to skip automatic and manual compaction for this scope.'),
}).strict()

/** Profile-owned identity and display text for one scope's composition. */
export type Config = z.infer<typeof configSchema>

/** Register the installation scope as one real standing composition. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-agent-preset-standing', targets: ['host'],
  requires: ['agentPresets'], optional: ['tools', 'agents', 'compaction'], provides: [],
  resolve(input) {
    const config = configSchema.parse(input)
    return (context) => {
      const composition: NativePresetComposition = { id: config.id, name: config.name,
        ...(config.description === undefined ? {} : { description: config.description }), scope: context.scope }
      context.effect(context.require('agentPresets').register(composition))
      if (config.allowedTools !== undefined) {
        const tools = context.optional('tools')
        const agents = context.optional('agents')
        if (tools === undefined || agents === undefined) {
          throw new Error('agent-preset-standing: allowedTools requires tools and agents')
        }
        const allow = config.allowedTools
        context.effect(context.on('agent/created', (agent) => {
          const remove = tools.restrict({ allow: [...allow] }, agent.scope)
          context.effect(remove)
          agents.onDispose(agent, remove)
        }))
      }
      if (config.compaction === false) {
        const compaction = context.optional('compaction')
        if (compaction !== undefined) context.effect(compaction.exempt(context.scope))
      }
    }
  },
}
