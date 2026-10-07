/** Contribute one standing Agent preset using this installation's exact NativeScope. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativePresetComposition } from '@deepseek-ai/dsh-agent-presets/native-definition'

const configSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('Registry identifier for this standing composition.'),
  name: z.string().trim().min(1).describe('Non-empty preset name shown in the composition picker.'),
  description: z.string().trim().min(1).optional().describe('Optional non-empty description shown with the preset name.'),
}).strict()

/** Profile-owned identity and display text for one scope's composition. */
export type Config = z.infer<typeof configSchema>

/** Register the installation scope as one real standing composition. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-agent-preset-standing', targets: ['host'],
  requires: ['agentPresets'], provides: [],
  resolve(input) {
    const config = configSchema.parse(input)
    return (context) => {
      const composition: NativePresetComposition = { id: config.id, name: config.name,
        ...(config.description === undefined ? {} : { description: config.description }), scope: context.scope }
      context.effect(context.require('agentPresets').register(composition))
    }
  },
}
