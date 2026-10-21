/**
 * Framework-free repeat-call detection shared by the Cordis listener and the native settlement policy.
 * Configuration and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder/core
 */
import z from '@deepseek-ai/schemastery'
import { createUserMessage, type MessageSource, type UserMessage } from '@deepseek-ai/dsh-llm/native'

/** Settings after defaults; validated by {@link compileRepeatToolReminder}. */
export interface RepeatToolReminderSettings {
  readonly thresholds: readonly number[]
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  readonly argumentsPreviewChars: number
}

/** Defaults shared by the Cordis schema and the native configuration. */
export const REPEAT_TOOL_REMINDER_DEFAULTS: RepeatToolReminderSettings = Object.freeze({
  thresholds: Object.freeze([3, 5, 8]),
  include: Object.freeze([]),
  exclude: Object.freeze([]),
  argumentsPreviewChars: 500,
})

/** Accepted configuration before defaults; both entries parse it with {@link repeatToolReminderSchema}. */
export interface RepeatToolReminderInput {
  thresholds?: number[]
  include?: string[]
  exclude?: string[]
  argumentsPreviewChars?: number
}

/** Schema shared by the Cordis `Config` export and the native installer; it fills the defaults. */
export const repeatToolReminderSchema: z<RepeatToolReminderInput> = z.object({
  thresholds: z.array(z.number()).default([...REPEAT_TOOL_REMINDER_DEFAULTS.thresholds]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(REPEAT_TOOL_REMINDER_DEFAULTS.argumentsPreviewChars),
})

/**
 * Convert schema-validated configuration into detector settings.
 * @param config - output of {@link repeatToolReminderSchema}, whose defaults set every field.
 * @returns the settings {@link compileRepeatToolReminder} validates.
 */
export function repeatToolReminderSettings(config: RepeatToolReminderInput): RepeatToolReminderSettings {
  return {
    thresholds: config.thresholds ?? REPEAT_TOOL_REMINDER_DEFAULTS.thresholds,
    include: config.include ?? [],
    exclude: config.exclude ?? [],
    argumentsPreviewChars: config.argumentsPreviewChars ?? REPEAT_TOOL_REMINDER_DEFAULTS.argumentsPreviewChars,
  }
}

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
export interface RepeatChain {
  readonly key: string
  readonly count: number
}

/** Outcome of observing one tracked call. */
export interface RepeatObservation {
  /** Chain to retain for the calling agent. */
  readonly chain: RepeatChain
  /** Logged model context to deliver when the run length hits a configured threshold. */
  readonly reminder?: UserMessage
}

/** Compiled, validated repeat detector. */
export interface RepeatToolReminder {
  /**
   * Advance one agent's chain for a recorded call attempt.
   * @param chain - the agent's previous chain, or undefined after a reset.
   * @param name - called tool name.
   * @param argumentsValue - parsed JSON arguments, or the raw text of malformed argument JSON.
   * @returns undefined for an untracked tool (transparent: neither counts nor resets), else the next chain.
   */
  observe(chain: RepeatChain | undefined, name: string, argumentsValue: unknown): RepeatObservation | undefined
}

/**
 * Validate settings per the fail-loud contract and compile the detector.
 * @param settings - settings after defaults.
 * @returns the detector shared by both runtimes.
 */
export function compileRepeatToolReminder(settings: RepeatToolReminderSettings): RepeatToolReminder {
  const thresholds = validateThresholds(settings.thresholds)
  const thresholdSet = new Set(thresholds)
  const includePatterns = settings.include.map(wildcardToRegExp)
  const excludePatterns = settings.exclude.map(wildcardToRegExp)
  const argumentsPreviewChars = settings.argumentsPreviewChars
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  return {
    observe(chain, name, argumentsValue) {
      if (!tracked(name)) return undefined
      const canonical = canonicalize(argumentsValue)
      const key = JSON.stringify([name, canonical])
      const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
      const next = { key, count }
      if (!thresholdSet.has(count)) return { chain: next }
      const text = count === thresholds[0]
        ? GENTLE_REMINDER
        : detailedReminder(name, count, previewArguments(canonical, argumentsPreviewChars))
      return {
        chain: next,
        reminder: createUserMessage({
          content: [{ type: 'text', text }],
          source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${name} × ${count}` },
        }),
      }
    },
  }
}
