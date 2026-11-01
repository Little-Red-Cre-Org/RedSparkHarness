/**
 * Durable context-composition state folded from a Session log.
 *
 * One projection answers "what does this Session's context consist of right now": the system
 * prompt, the tool schemas, the user turns, plugin injections, skill loads and the assistant
 * output, each counted in characters and reported per turn and step. The dashboard and the
 * `/context` command both read this state, so the numbers cannot disagree.
 *
 * @module @deepseek-ai/dsh-context-insight/composition
 */

import { z } from 'zod'

/** One category a context contribution falls into. */
export const COMPOSITION_CATEGORIES = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'] as const

/** A context contribution category. */
export type CompositionCategory = typeof COMPOSITION_CATEGORIES[number]

/** Character counts per category, plus the total the model actually received. */
export type CompositionTotals = Record<CompositionCategory, number>

/** One system prompt the Session ever sent, so a rewrite is visible as a separate entry. */
export interface CompositionSystemPrompt {
  readonly seq: number
  readonly time: number
  readonly chars: number
}

/** One assistant request observed in the log. */
export interface CompositionRequest {
  readonly seq: number
  readonly turn: number
  readonly step: number
  readonly time: number
  readonly total: number
  readonly provider?: string
  readonly model?: string
}

/** Durable composition state for one Session. */
export interface CompositionState {
  readonly totals: CompositionTotals
  readonly turns: number
  readonly steps: number
  readonly injects: number
  readonly skills: number
  readonly systemPrompts: readonly CompositionSystemPrompt[]
  readonly requests: readonly CompositionRequest[]
  readonly lastTotal: number
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly contextWindow?: number
}

/** Characters a string contributes; undefined counts as zero so a missing field never poisons a total. */
function lengthOf(value: string | undefined): number {
  return value?.length ?? 0
}

/** Sum every category. */
function totalOf(totals: CompositionTotals): number {
  return COMPOSITION_CATEGORIES.reduce((sum, category) => sum + totals[category], 0)
}

/**
 * The state a Session starts from before any event is folded.
 * @returns every category at zero, with no recorded prompts or requests.
 */
export function initialCompositionState(): CompositionState {
  return {
    totals: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 },
    turns: 0,
    steps: 0,
    injects: 0,
    skills: 0,
    systemPrompts: [],
    requests: [],
    lastTotal: 0,
  }
}

/**
 * Fold one Session event into the composition state.
 *
 * The fold is pure: the same log always yields the same numbers, which is what lets the
 * dashboard replay a stored Session without the Agent being alive.
 * @param state - current state.
 * @param event - the next durable event.
 * @returns the next state; the same object when the event carries no composition.
 */
export function applyCompositionEvent(
  state: CompositionState,
  event: { readonly type: string; readonly seq: number; readonly time: number; readonly data: unknown },
): CompositionState {
  const data = event.data as Record<string, unknown> | undefined
  switch (event.type) {
    case 'turn/start':
      return { ...state, turns: state.turns + 1 }
    case 'step/start':
      return { ...state, steps: state.steps + 1 }
    case 'system/message': {
      const message = data?.['message'] as { content?: readonly { type: string; text?: string }[] } | undefined
      const chars = (message?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? lengthOf(part.text) : 0), 0)
      const totals = { ...state.totals, system: state.totals.system + chars }
      return {
        ...state,
        totals,
        lastTotal: totalOf(totals),
        systemPrompts: [...state.systemPrompts, { seq: event.seq, time: event.time, chars }],
      }
    }
    case 'user/message': {
      const source = data?.['source'] as { kind?: string } | undefined
      const message = data?.['message'] as { content?: readonly { type: string; text?: string; source?: unknown }[] } | undefined
      const chars = (message?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? lengthOf(part.text) : 0), 0)
      const kind = source?.kind ?? 'user'
      // A plugin injection and a skill load are user-role messages too; keeping them apart is
      // what makes "how much of my context is the harness talking to itself" answerable.
      const category: CompositionCategory = kind === 'plugin' ? 'inject' : kind === 'skill' ? 'skill' : 'user'
      const totals = { ...state.totals, [category]: state.totals[category] + chars }
      return {
        ...state,
        totals,
        lastTotal: totalOf(totals),
        injects: category === 'inject' ? state.injects + 1 : state.injects,
        skills: category === 'skill' ? state.skills + 1 : state.skills,
      }
    }
    case 'assistant/message': {
      const message = data?.['message'] as { content?: readonly { type: string; text?: string }[] } | undefined
      const chars = (message?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? lengthOf(part.text) : 0), 0)
      const totals = { ...state.totals, assistant: state.totals.assistant + chars }
      return { ...state, totals, lastTotal: totalOf(totals) }
    }
    case 'tool/call': {
      const argumentsText = data?.['arguments']
      const chars = typeof argumentsText === 'string' ? argumentsText.length : 0
      const totals = { ...state.totals, tools: state.totals.tools + chars }
      return { ...state, totals, lastTotal: totalOf(totals) }
    }
    case 'tool/result': {
      const result = data?.['result'] as { content?: readonly { type: string; text?: string }[] } | undefined
      const chars = (result?.content ?? []).reduce((sum, part) => sum + (part.type === 'text' ? lengthOf(part.text) : 0), 0)
      const totals = { ...state.totals, tool: state.totals.tool + chars }
      return { ...state, totals, lastTotal: totalOf(totals) }
    }
    case 'request/header': {
      const header = data?.['header'] as {
        config?: { provider?: string; model?: string; reasoningEffort?: string }
        tools?: readonly { name?: string; description?: string }[]
      } | undefined
      const turn = typeof data?.['turn'] === 'number' ? data['turn'] : 0
      const step = typeof data?.['step'] === 'number' ? data['step'] : 0
      const config = header?.config
      const provider = config?.provider ?? state.provider
      const model = config?.model ?? state.model
      const effort = config?.reasoningEffort ?? state.reasoningEffort
      // Tool schemas ride on the header, so their size is counted where they are sent rather
      // than guessed from the calls that happened to use them.
      const toolChars = (header?.tools ?? []).reduce((sum, tool) => sum + lengthOf(tool.name) + lengthOf(tool.description), 0)
      const totals = toolChars === 0 ? state.totals : { ...state.totals, tools: toolChars }
      const request: CompositionRequest = {
        seq: event.seq, turn, step, time: event.time, total: totalOf(totals),
        ...provider === undefined ? {} : { provider },
        ...model === undefined ? {} : { model },
      }
      return {
        ...state,
        totals,
        lastTotal: totalOf(totals),
        requests: [...state.requests, request],
        ...provider === undefined ? {} : { provider },
        ...model === undefined ? {} : { model },
        ...effort === undefined ? {} : { reasoningEffort: effort },
      }
    }
    case 'request/context': {
      const provider = typeof data?.['provider'] === 'string' ? data['provider'] : state.provider
      const model = typeof data?.['model'] === 'string' ? data['model'] : state.model
      const contextWindow = typeof data?.['contextWindow'] === 'number' ? data['contextWindow'] : undefined
      return {
        ...state,
        ...provider === undefined ? {} : { provider },
        ...model === undefined ? {} : { model },
        ...contextWindow === undefined ? {} : { contextWindow },
      }
    }
    default:
      return state
  }
}

const totalsSchema = z.object({
  system: z.number(), tools: z.number(), user: z.number(), inject: z.number(),
  skill: z.number(), assistant: z.number(), tool: z.number(),
})

/** Durable-state schema; a log written by an older fold still parses. */
export const compositionStateSchema = z.object({
  totals: totalsSchema,
  turns: z.number(),
  steps: z.number(),
  injects: z.number(),
  skills: z.number(),
  systemPrompts: z.array(z.object({ seq: z.number(), time: z.number(), chars: z.number() })),
  requests: z.array(z.object({
    seq: z.number(), turn: z.number(), step: z.number(), time: z.number(), total: z.number(),
    provider: z.string().optional(), model: z.string().optional(),
  })),
  lastTotal: z.number(),
  contextWindow: z.number().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
}) as z.ZodType<CompositionState>
