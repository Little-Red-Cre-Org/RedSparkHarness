/** Native model tools over the shared workspace-authorized query operations. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import { operations } from './operations.ts'
import { toolInput } from './input.ts'
import {
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  resolveSessionQueryToolConfig,
} from './config.ts'
import type { ResolvedSessionQueryToolConfig, SessionQueryToolConfig } from './config.ts'
import type { SessionQueryToolInvocation, SessionQueryToolServices } from './runtime.ts'
import type {} from '@deepseek-ai/dsh-native-agent/turn-boundary'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-session-query/native'
import type {} from '@deepseek-ai/dsh-session-projection/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'

const PROMPT_TEXT =
  'Use session_search to find relevant work from prior sessions, or session_event_search to search earlier '
  + 'events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with '
  + 'session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.'

type SessionSearchArgs = Parameters<typeof operations.executeSessionSearch>[1]
type EventSearchArgs = Parameters<typeof operations.executeEventSearch>[1]
type SessionTargetArgs = Parameters<typeof operations.executeSessionTrace>[1]
type EventTargetArgs = Parameters<typeof operations.executeEventTrace>[1]
type EventReadArgs = Parameters<typeof operations.executeEventRead>[1]

export {
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
}
export type {
  ResolvedSessionQueryToolConfig as ResolvedNativeSessionQueryToolConfig,
  SessionQueryToolConfig as NativeSessionQueryToolConfig,
}

/** Resolve Native tool limits before service activation.
 * @param input - Native profile configuration.
 * @returns validated limits for both search tools.
 */
export function resolveNativeToolSessionQueryConfig(input: unknown): ResolvedSessionQueryToolConfig {
  return resolveSessionQueryToolConfig(input)
}

function nativeParameters(properties: Record<string, unknown>) {
  const required: string[] = []
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    const { required: isRequired, ...schema } = value as Record<string, unknown>
    if (isRequired === true) required.push(key)
    resolved[key] = schema
  }
  return { type: 'object', properties: resolved, ...(required.length === 0 ? {} : { required }), additionalProperties: false }
}

function invocation(call: NativeToolExecution): SessionQueryToolInvocation {
  return { agent: { session: call.session }, signal: call.signal }
}

// Args contextualizes schema-specific executors before the Native tool contribution erases that input type.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function textTool<Args>(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (call: NativeToolExecution, args: Args) => Promise<string>,
  timeoutMs?: number,
  concurrencySafe = false,
): NativeValueToolContribution {
  return {
    schema: { name, description, parameters: nativeParameters(parameters) },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(concurrencySafe ? { isConcurrencySafe: () => true } : {}),
    output: {
      schema: { type: 'string' as const },
      render: (_call: NativeToolExecution, value: JsonValue) => {
        if (typeof value !== 'string') throw new TypeError('tool-session-query: tool result must be text')
        return { content: [{ type: 'text' as const, text: value }], isError: false }
      },
    },
    execute: (call: NativeToolExecution) => {
      const args = call.arguments as Args
      return execute(call, args)
    },
  }
}

/** Register the Native Consumer over the selected query and projection services. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-tool-session-query',
  targets: ['host'],
  requires: ['sessionQuery', 'sessionProjections', 'tools', 'promptSections'],
  provides: [],
  resolve(input) {
    const config = resolveNativeToolSessionQueryConfig(input)
    return (context) => {
      const services: SessionQueryToolServices = {
        sessionQuery: context.require('sessionQuery'),
        sessionProjections: context.require('sessionProjections'),
      }
      context.effect(context.require('promptSections').register({
        name: 'tool:session-query',
        order: 2300,
        text: () => PROMPT_TEXT,
      }, context.scope))
      const tools = context.require('tools')
      context.effect(tools.registerValueTool(textTool(
        'session_search',
        'Search prior sessions in the caller workspace and return the strongest matching event from each session.',
        toolInput.sessionSearchParameters,
        (call, args: SessionSearchArgs) => operations.executeSessionSearch(services, args, invocation(call), config.maxSearchResults),
        config.searchTimeoutMs,
      ), context.scope))
      context.effect(tools.registerValueTool(textTool(
        'session_event_search',
        'Search prior events in one authorized session; the current session excludes the step performing this call.',
        toolInput.eventSearchParameters,
        (call, args: EventSearchArgs) => operations.executeEventSearch(services, args, invocation(call), config.maxSearchResults),
        config.searchTimeoutMs,
      ), context.scope))
      context.effect(tools.registerValueTool(textTool(
        'session_trace',
        'Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.',
        toolInput.targetSessionParameter,
        (call, args: SessionTargetArgs) => operations.executeSessionTrace(services, args, invocation(call)),
        undefined,
        true,
      ), context.scope))
      context.effect(tools.registerValueTool(textTool(
        'session_event_trace',
        'Read every direct replacement and relationship to a cited source event for one event in an authorized session.',
        { ...toolInput.targetSessionParameter, seq: { type: 'integer', required: true, description: 'Target event sequence number.' } },
        (call, args: EventTargetArgs) => operations.executeEventTrace(services, args, invocation(call)),
        undefined,
        true,
      ), context.scope))
      context.effect(tools.registerValueTool(textTool(
        'session_event_read',
        'Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.',
        {
          ...toolInput.targetSessionParameter,
          seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
          before: { type: 'integer', description: 'Number of preceding raw events to summarize. Omit for none.' },
          after: { type: 'integer', description: 'Number of following raw events to summarize. Omit for none.' },
        },
        (call, args: EventReadArgs) => operations.executeEventRead(services, args, invocation(call)),
        undefined,
        true,
      ), context.scope))
    }
  },
}
