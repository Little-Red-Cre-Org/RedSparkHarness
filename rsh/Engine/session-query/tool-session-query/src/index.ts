/**
 * Model-facing, workspace-authorized session-history search and read tools.
 *
 * @module @deepseek-ai/dsh-tool-session-query
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_TIMEOUT_MS, resolveSessionQueryToolConfig } from './config.ts'
import type { SessionQueryToolConfig } from './config.ts'
import { toolInput } from './input.ts'
import { operations } from './operations.ts'
import { presentation } from './presentation.ts'
import type { SessionQueryToolInvocation, SessionQueryToolServices } from './runtime.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-session-query'

/** Capability services required by the model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery', 'sessionProjections']

export { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_TIMEOUT_MS }

/** Deployment-owned compatibility config type backed by the shared resolver. */
export interface Config extends SessionQueryToolConfig {}

/** Shared deployment config consumed by the Cordis and Native installers. */
export type { SessionQueryToolConfig } from './config.ts'

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  searchTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_SEARCH_TIMEOUT_MS),
})

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const PROMPT_TEXT =
  'Use session_search to find relevant work from prior sessions, or session_event_search to search earlier '
  + 'events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with '
  + 'session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.'

/** Register all five tools and their shared model guidance. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveSessionQueryToolConfig(config)
  const services: SessionQueryToolServices = {
    sessionQuery: ctx.sessionQuery,
    sessionProjections: ctx.sessionProjections,
    warn: (message) => { ctx.logger.warn(message) },
  }
  ctx.systemPrompt.section({
    name: 'tool:session-query',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY'),
    text: PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'session_search',
    description: 'Search prior sessions in the caller workspace and return the strongest matching event from each session.',
    parameters: toolInput.sessionSearchParameters,
    output: TEXT_OUTPUT,
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeSessionSearch(services, args, invocation(exec), resolved.maxSearchResults),
    presentCall: presentation.presentSessionSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_search',
    description: 'Search prior events in one authorized session; the current session excludes the step performing this call.',
    parameters: toolInput.eventSearchParameters,
    output: TEXT_OUTPUT,
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeEventSearch(services, args, invocation(exec), resolved.maxSearchResults),
    presentCall: presentation.presentEventSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_trace',
    description: 'Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.',
    parameters: toolInput.targetSessionParameter,
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeSessionTrace(services, args, invocation(exec)),
    presentCall: presentation.presentSessionTraceCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_trace',
    description: 'Read every direct replacement and relationship to a cited source event for one event in an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventTrace(services, args, invocation(exec)),
    presentCall: args => presentation.presentEventTargetCall('Trace event', args),
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_read',
    description: 'Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
      before: { type: 'integer', description: 'Number of preceding raw events to summarize. Omit for none.' },
      after: { type: 'integer', description: 'Number of following raw events to summarize. Omit for none.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventRead(services, args, invocation(exec)),
    presentCall: args => presentation.presentEventTargetCall('Read event', args),
  }))
}

function invocation(exec: ToolRunContext): SessionQueryToolInvocation {
  const agent = exec.agent
  return {
    ...agent === undefined ? {} : { agent: { session: agent.session } },
    signal: exec.signal,
  }
}
