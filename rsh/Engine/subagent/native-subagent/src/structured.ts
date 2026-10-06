/** Scoped structured results commit after the Session owner accepts their transport outcome. */
import type { NativeDelegationSetup } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeToolExecution, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'

const TOOL = 'structured_output'
const INSTRUCTION = 'When you have your final answer, you MUST report it by calling the '
  + '`structured_output` tool with arguments matching its parameter schema exactly. '
  + 'Do not finish with a plain text answer: only the tool call counts as your result.'

/** Accepted structured value retained after child composition is released. */
export interface NativeStructuredAttachment {
  /** @returns the committed object, or undefined if no transport was accepted. */
  captured(): { readonly value: unknown } | undefined
}

/**
 * Install a child-only tool, prompt and monotonic guard through the executor's resource owner.
 * @param setup - exact child Agent and contribution owner.
 * @param tools - selected scoped tool Provider.
 * @param prompt - selected system-prompt Provider.
 * @param schema - validated object-root parameter schema.
 * @returns a handle read after the child executor settles.
 */
export function attachNativeStructuredOutput(
  setup: NativeDelegationSetup, tools: NativeToolRegistry, prompt: NativePromptRegistry, schema: ObjectJsonSchema,
): NativeStructuredAttachment {
  const staged = new WeakMap<NativeToolExecution, { value: unknown }>()
  let pending: { parent: NativeToolExecution; value: unknown } | undefined
  let captured: { value: unknown } | undefined
  setup.own(tools.registerProjectedTool({
    schema: { name: TOOL, description: 'Report your final structured result exactly once, matching the parameter schema.',
      parameters: schema as unknown as Record<string, unknown> },
    output: { schema: { type: 'object', properties: { recorded: { type: 'boolean', const: true } },
      required: ['recorded'], additionalProperties: false },
    render: () => ({ content: [{ type: 'text', text: 'Structured output recorded.' }], isError: false }) },
    execute: (call) => {
      staged.set(call, { value: call.arguments })
      return Promise.resolve({ value: { recorded: true }, concludesTurn: true })
    },
  }, setup.agent.scope))
  setup.own(prompt.register({ name: `tool:${TOOL}`, order: 9900, text: () => INSTRUCTION }, setup.agent.scope))
  setup.own(tools.guard(call => captured === undefined && pending === undefined ? undefined
    : `structured output already recorded: the run is complete, so \`${call.name}\` is not executed`, setup.agent.scope))
  setup.own(tools.onResult((call, result) => {
    const value = staged.get(call)
    if (value !== undefined) {
      staged.delete(call)
      if (result.isError) return
      if (call.parent === undefined) captured ??= value
      else if (captured === undefined && pending === undefined) pending = { parent: call.parent, value: value.value }
      return
    }
    if (pending?.parent !== call) return
    const waiting = pending
    pending = undefined
    if (!result.isError) captured ??= { value: waiting.value }
  }, setup.agent.scope))
  return { captured: () => captured }
}
