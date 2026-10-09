/**
 * Native repeat-call reminder over recorded tool settlements of the selected tool registry.
 * @module @deepseek-ai/dsh-repeat-tool-reminder/native
 */
import type { Message } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import { compileRepeatToolReminder, repeatToolReminderSchema, repeatToolReminderSettings, type RepeatChain, type RepeatToolReminderSettings } from './core.ts'

const FIELDS = new Set(['thresholds', 'include', 'exclude', 'argumentsPreviewChars'])

/**
 * Resolve native configuration with the Cordis schema and defaults; native profiles also reject unknown fields.
 * @param input - installation configuration.
 * @returns settings after defaults, before the detector's fail-loud checks.
 */
export function resolveNativeRepeatToolReminderConfig(input: unknown): RepeatToolReminderSettings {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('repeat-tool-reminder: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (!FIELDS.has(key)) throw new Error(`repeat-tool-reminder: unknown configuration field ${key}`)
  }
  return repeatToolReminderSettings(repeatToolReminderSchema(input ?? {}))
}

/** The newest user-authored input in derived history; a different value means the user interjected. */
function latestUserInput(session: Session): Message | undefined {
  return session.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'user')
}

/** One Agent's chain and the user input it was observed after. */
interface AgentChain {
  readonly chain: RepeatChain
  readonly userInput: Message | undefined
}

/** Install the advisory repeat-call reminder for every Agent visible in this installation's scope. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-repeat-tool-reminder', targets: ['host'],
  requires: ['tools'], provides: [],
  resolve(input) {
    const detector = compileRepeatToolReminder(resolveNativeRepeatToolReminderConfig(input))
    return (context) => {
      const chains = new WeakMap<NativeAgent, AgentChain>()
      context.effect(context.require('tools').onSettlement((settlement) => {
        // A user interjection changes the context; repetition across it is not a loop.
        const userInput = latestUserInput(settlement.session)
        const previous = chains.get(settlement.agent)
        const current = previous !== undefined && previous.userInput === userInput ? previous.chain : undefined
        if (previous !== undefined && current === undefined) chains.delete(settlement.agent)
        const observation = detector.observe(current, settlement.name, settlement.arguments)
        if (observation === undefined) return []
        chains.set(settlement.agent, { chain: observation.chain, userInput })
        return observation.reminder === undefined ? [] : [observation.reminder]
      }, context.scope))
    }
  },
}
