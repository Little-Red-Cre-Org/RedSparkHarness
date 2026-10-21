/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { compileRepeatToolReminder, repeatToolReminderSchema, repeatToolReminderSettings, type RepeatChain } from './core.ts'

export const name = 'repeat-tool-reminder'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
}

/** Runtime schema for {@link Config}, shared with the native installer. */
export const Config: z<Config> = repeatToolReminderSchema

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  const detector = compileRepeatToolReminder(repeatToolReminderSettings(config))

  const chains = new WeakMap<Agent, RepeatChain>()

  /**
   * Advance the calling agent's chain for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold.
   * Counting happens here — in post-execute — because denied calls also flow
   * through this waterfall (`ToolRuntime.execute` routes a deny through the
   * same pipeline), and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  function observe(exec: ToolExecution): UserMessage | undefined {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return undefined
    const observation = detector.observe(chains.get(exec.agent), exec.name, exec.arguments)
    if (observation === undefined) return undefined
    chains.set(exec.agent, observation.chain)
    return observation.reminder
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder onto whatever came back — additionalContexts
  // rides both decision variants, so a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec)
    const downstream = await next()
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(reminder, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })

  // A user interjection changes the context; repetition across it is not a
  // loop. Pure reset hook: always delegates (attaching nothing, vetoing
  // nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) chains.delete(agent)
    return next()
  })
}
